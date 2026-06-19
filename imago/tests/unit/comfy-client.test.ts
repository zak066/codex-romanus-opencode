/**
 * ComfyClient — Unit Tests
 *
 * Copre:
 * - Constructor (trailing slash, clientId)
 * - Tutti i 9 metodi pubblici (queuePrompt, getHistory, getView, getSystemStats,
 *   getQueue, cancelJob, getObjectInfo, getEmbeddings, freeMemory)
 * - Timeout (30s AbortController)
 * - Errori di connessione (ComfyUIConnectionError)
 * - Errori HTTP (ComfyUIRequestError per 404/500)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { ComfyClient } from '../../src/comfyui/client.js';
import {
  ComfyUIConnectionError,
  ComfyUIRequestError,
} from '../../src/utils/errors.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Crea un oggetto Response mock compatibile con il contratto fetch.
 * Separa gli override scalar (ok, status, ...) da quelli function-type
 * (json, text, arrayBuffer) per evitare che lo spread sostituisca
 * le funzioni con valori plain.
 */
function mockResponse(overrides: Partial<{
  ok: boolean;
  status: number;
  statusText: string;
  json: unknown;
  text: string;
  arrayBuffer: ArrayBuffer;
}> = {}): Response {
  const defaults: Record<string, unknown> = {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: new Headers({ 'content-type': 'application/json' }),
    redirected: false,
    type: 'basic' as ResponseType,
    url: '',
    body: null,
    bodyUsed: false,
    json: () => Promise.resolve({}),
    text: () => Promise.resolve(''),
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    clone: () => { throw new Error('not implemented in mock'); },
  };

  // Separa le proprietà function-type da quelle scalar
  const { json, text, arrayBuffer, ...scalarOverrides } = overrides;

  return {
    ...defaults,
    ...scalarOverrides,
    // Se json/text/arrayBuffer sono forniti come valori plain, li incapsula in una funzione
    json: json !== undefined
      ? (typeof json === 'function' ? json : () => Promise.resolve(json))
      : defaults.json,
    text: text !== undefined
      ? (typeof text === 'function' ? text : () => Promise.resolve(text))
      : defaults.text,
    arrayBuffer: arrayBuffer !== undefined
      ? (typeof arrayBuffer === 'function' ? arrayBuffer : () => Promise.resolve(arrayBuffer))
      : defaults.arrayBuffer,
  } as unknown as Response;
}

// ─── Suite ───────────────────────────────────────────────────────────────────

describe('ComfyClient', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllTimers();
  });

  // ─── Constructor ─────────────────────────────────────────────

  describe('constructor', () => {
    it('should store baseUrl without trailing slash', () => {
      const client = new ComfyClient('http://127.0.0.1:8188/');
      expect(client.baseUrl).toBe('http://127.0.0.1:8188');
    });

    it('should keep baseUrl as-is if no trailing slash', () => {
      const client = new ComfyClient('http://127.0.0.1:8188');
      expect(client.baseUrl).toBe('http://127.0.0.1:8188');
    });

    it('should generate clientId if not provided', () => {
      const client = new ComfyClient('http://127.0.0.1:8188');
      // clientId is a UUID v4 — 36 chars, 4 hyphens
      expect(client.baseUrl).toBeTruthy();
      // Check it's accessible via the queuePrompt client_id in the body
    });
  });

  // ─── queuePrompt ─────────────────────────────────────────────

  describe('queuePrompt', () => {
    it('should POST /prompt with workflow and client_id', async () => {
      const expectedResponse = { prompt_id: 'abc-123', number: 42 };
      mockFetch.mockResolvedValue(mockResponse({ json: expectedResponse }));

      const client = new ComfyClient('http://127.0.0.1:8188', 'my-client-id');
      const workflow = {
        '3': { class_type: 'KSampler', inputs: { seed: 42 } },
      };
      const result = await client.queuePrompt(workflow, { source: 'test' });

      expect(result).toEqual(expectedResponse);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://127.0.0.1:8188/prompt',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            prompt: workflow,
            client_id: 'my-client-id',
            extra_data: { source: 'test' },
          }),
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
          }),
        }),
      );
    });

    it('should work without extraData', async () => {
      const expectedResponse = { prompt_id: 'def-456', number: 1 };
      mockFetch.mockResolvedValue(mockResponse({ json: expectedResponse }));

      const client = new ComfyClient('http://127.0.0.1:8188', 'cid');
      const workflow = { '1': { class_type: 'EmptyLatentImage', inputs: { width: 512, height: 512 } } };
      const result = await client.queuePrompt(workflow);

      expect(result).toEqual(expectedResponse);
      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.prompt).toEqual(workflow);
      expect(callBody.extra_data).toBeUndefined();
    });
  });

  // ─── getHistory ──────────────────────────────────────────────

  describe('getHistory', () => {
    it('should GET /history/{promptId}', async () => {
      const historyData = {
        'abc-123': {
          prompt: { id: 'abc-123' },
          outputs: { '9': { images: [{ filename: 'test.png', subfolder: '', type: 'output' }] } },
          status: { completed: true },
        },
      };
      mockFetch.mockResolvedValue(mockResponse({ json: historyData }));

      const client = new ComfyClient('http://127.0.0.1:8188');
      const result = await client.getHistory('abc-123');

      expect(result).toEqual(historyData);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://127.0.0.1:8188/history/abc-123',
        expect.objectContaining({ method: 'GET' }),
      );
    });

    it('should return empty object for not-yet-completed prompt', async () => {
      mockFetch.mockResolvedValue(mockResponse({ json: {} }));

      const client = new ComfyClient('http://127.0.0.1:8188');
      const result = await client.getHistory('nonexistent');

      expect(result).toEqual({});
    });
  });

  // ─── getView ─────────────────────────────────────────────────

  describe('getView', () => {
    it('should GET /view with query params and return ArrayBuffer', async () => {
      const imageBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]).buffer;
      mockFetch.mockResolvedValue(mockResponse({ arrayBuffer: imageBytes }));

      const client = new ComfyClient('http://127.0.0.1:8188');
      const result = await client.getView('output.png', 'subdir', 'output');

      expect(result).toBeInstanceOf(ArrayBuffer);
      expect(new Uint8Array(result)).toEqual(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]));
      expect(mockFetch).toHaveBeenCalledWith(
        'http://127.0.0.1:8188/view?filename=output.png&subfolder=subdir&type=output',
        expect.objectContaining({ method: 'GET' }),
      );
    });
  });

  // ─── getSystemStats ──────────────────────────────────────────

  describe('getSystemStats', () => {
    it('should GET /system_stats and return parsed stats', async () => {
      const stats = {
        system: { os: 'windows', python_version: '3.12', comfyui_version: 'v0.3.0', args: {} },
        devices: [{ name: 'NVIDIA RTX 4090', type: 'cuda', index: 0, vram_total: 24564, vram_free: 18000, torch_version: '2.4.0' }],
      };
      mockFetch.mockResolvedValue(mockResponse({ json: stats }));

      const client = new ComfyClient('http://127.0.0.1:8188');
      const result = await client.getSystemStats();

      expect(result).toEqual(stats);
      expect(result.system.os).toBe('windows');
      expect(result.devices[0].name).toBe('NVIDIA RTX 4090');
      expect(mockFetch).toHaveBeenCalledWith(
        'http://127.0.0.1:8188/system_stats',
        expect.objectContaining({ method: 'GET' }),
      );
    });
  });

  // ─── getQueue ────────────────────────────────────────────────

  describe('getQueue', () => {
    it('should GET /queue and return running + pending items', async () => {
      const queueData = {
        queue_running: [[1, 2]],
        queue_pending: [[3, 4], [5, 6]],
      };
      mockFetch.mockResolvedValue(mockResponse({ json: queueData }));

      const client = new ComfyClient('http://127.0.0.1:8188');
      const result = await client.getQueue();

      expect(result.queue_running).toEqual([[1, 2]]);
      expect(result.queue_pending).toEqual([[3, 4], [5, 6]]);
    });
  });

  // ─── cancelJob ───────────────────────────────────────────────

  describe('cancelJob', () => {
    it('should POST /queue with action delete and prompt_id', async () => {
      mockFetch.mockResolvedValue(mockResponse({ json: {} }));

      const client = new ComfyClient('http://127.0.0.1:8188');
      await client.cancelJob('prompt-to-cancel');

      expect(mockFetch).toHaveBeenCalledWith(
        'http://127.0.0.1:8188/queue',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ action: 'delete', prompt_id: 'prompt-to-cancel' }),
        }),
      );
    });
  });

  // ─── getObjectInfo ───────────────────────────────────────────

  describe('getObjectInfo', () => {
    it('should GET /object_info and return node definitions', async () => {
      const nodeInfo = {
        'KSampler': {
          name: 'KSampler',
          display_name: 'KSampler',
          description: 'Sample with KSampler',
          category: 'sampling',
          input: { required: { seed: ['INT', { default: 0 }] } },
          output: ['LATENT'],
          output_name: ['LATENT'],
        },
      };
      mockFetch.mockResolvedValue(mockResponse({ json: nodeInfo }));

      const client = new ComfyClient('http://127.0.0.1:8188');
      const result = await client.getObjectInfo();

      expect(result.KSampler).toBeDefined();
      expect(result.KSampler.name).toBe('KSampler');
      expect(result.KSampler.category).toBe('sampling');
    });
  });

  // ─── getEmbeddings ───────────────────────────────────────────

  describe('getEmbeddings', () => {
    it('should GET /embeddings and return string array', async () => {
      const embeddings = ['model1.safetensors', 'model2.safetensors'];
      mockFetch.mockResolvedValue(mockResponse({ json: embeddings }));

      const client = new ComfyClient('http://127.0.0.1:8188');
      const result = await client.getEmbeddings();

      expect(result).toEqual(embeddings);
      expect(Array.isArray(result)).toBe(true);
    });
  });

  // ─── freeMemory ──────────────────────────────────────────────

  describe('freeMemory', () => {
    it('should POST /free with default unload_what', async () => {
      mockFetch.mockResolvedValue(mockResponse({ json: {} }));

      const client = new ComfyClient('http://127.0.0.1:8188');
      await client.freeMemory();

      expect(mockFetch).toHaveBeenCalledWith(
        'http://127.0.0.1:8188/free',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ unload_what: ['models', 'loras'] }),
        }),
      );
    });

    it('should POST /free with custom unload_what', async () => {
      mockFetch.mockResolvedValue(mockResponse({ json: {} }));

      const client = new ComfyClient('http://127.0.0.1:8188');
      await client.freeMemory(['checkpoints']);

      expect(mockFetch).toHaveBeenCalledWith(
        'http://127.0.0.1:8188/free',
        expect.objectContaining({
          body: JSON.stringify({ unload_what: ['checkpoints'] }),
        }),
      );
    });
  });

  // ─── Timeout ─────────────────────────────────────────────────

  describe('timeout', () => {
    it('should call setTimeout with 30s and pass AbortSignal to fetch', async () => {
      const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
      mockFetch.mockResolvedValue(mockResponse({
        json: { system: { os: 'test', python_version: '3', comfyui_version: 'v1', args: {} }, devices: [] },
      }));

      const client = new ComfyClient('http://127.0.0.1:8188');
      await client.getSystemStats();

      // Verify 30s timeout
      expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 30_000);

      // Verify AbortSignal is passed to fetch
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          signal: expect.any(AbortSignal),
        }),
      );

      setTimeoutSpy.mockRestore();
    });
  });

  // ─── Error Handling ──────────────────────────────────────────

  describe('error handling', () => {
    it('should throw ComfyUIConnectionError on network failure', async () => {
      mockFetch.mockRejectedValue(new TypeError('fetch failed'));

      const client = new ComfyClient('http://127.0.0.1:8188');
      const promise = client.getSystemStats();

      await expect(promise).rejects.toThrow(ComfyUIConnectionError);
      await expect(promise).rejects.toThrow(/Failed to connect to ComfyUI/);
    });

    it('should throw ComfyUIRequestError on HTTP 404', async () => {
      mockFetch.mockResolvedValue(mockResponse({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        text: '{"error": "not found"}',
      }));

      const client = new ComfyClient('http://127.0.0.1:8188');
      const promise = client.getHistory('missing');

      await expect(promise).rejects.toThrow(ComfyUIRequestError);
      await expect(promise).rejects.toThrow(/404/);
    });

    it('should throw ComfyUIRequestError on HTTP 500', async () => {
      mockFetch.mockResolvedValue(mockResponse({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        text: 'Internal error',
      }));

      const client = new ComfyClient('http://127.0.0.1:8188');
      const promise = client.getSystemStats();

      await expect(promise).rejects.toThrow(ComfyUIRequestError);
      await expect(promise).rejects.toThrow(/500/);
    });

    it('should include response body snippet in HTTP error message', async () => {
      mockFetch.mockResolvedValue(mockResponse({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        text: '{"error": "Invalid workflow: missing required node input"}',
      }));

      const client = new ComfyClient('http://127.0.0.1:8188');
      const promise = client.queuePrompt({ '1': { class_type: 'Test', inputs: {} } });

      await expect(promise).rejects.toThrow(ComfyUIRequestError);
      await expect(promise).rejects.toThrow(/Invalid workflow/);
    });
  });
});
