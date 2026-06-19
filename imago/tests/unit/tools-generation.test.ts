/**
 * Generation Tools — Unit Tests
 *
 * Copre i 3 tool MCP di generazione immagini:
 * - generate_image: esegue un workflow template (txt2img, img2img, upscale)
 * - regenerate: rigenera un job da un prompt_id esistente
 * - view_image: ottiene una thumbnail WebP di un'immagine generata
 *
 * Pattern: Mock del McpServer + dipendenze iniettate mockate.
 * Il mock server bypassa la validazione Zod per testare il
 * comportamento dei callback direttamente.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { registerGenerationTools } from '../../src/tools/generation.js';
import { McpError } from '@modelcontextprotocol/sdk/types.js';
import type { GenerationDeps } from '../../src/tools/generation.js';

// ─── Mock Framework ──────────────────────────────────────────────────────────

function createMockServer() {
  const tools = new Map<string, { cb: Function }>();
  return {
    tool: (_name: string, _desc: string, _schema: unknown, cb: Function) => {
      tools.set(_name, { cb });
      return { remove: () => tools.delete(_name) };
    },
    callTool: async (name: string, args: unknown) => {
      const tool = tools.get(name);
      if (!tool) throw new Error(`Tool ${name} not found`);
      return tool.cb(args);
    },
  };
}

function createMockDeps() {
  return {
    comfyClient: {
      queuePrompt: vi.fn(),
      getHistory: vi.fn(),
      getView: vi.fn(),
    },
    workflowManager: {
      getWorkflow: vi.fn(),
      renderWorkflow: vi.fn(),
      applyOverrides: vi.fn(),
      validateWorkflow: vi.fn(),
      parseParameters: vi.fn(),
    },
    assetRegistry: {
      getAsset: vi.fn(),
      registerAsset: vi.fn(),
    },
    imageHandler: {
      processImage: vi.fn(),
      getImageInfo: vi.fn(),
      toDataUri: vi.fn(),
      createThumbnail: vi.fn(),
    },
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Configura i mock per il percorso felice di processOutputImages:
 * getView, getImageInfo, processImage, toDataUri, registerAsset.
 */
function setupImageProcessingMocks(deps: ReturnType<typeof createMockDeps>) {
  deps.comfyClient.getView.mockResolvedValue(Buffer.from('fake-image-data'));
  deps.imageHandler.getImageInfo.mockResolvedValue({
    width: 1024,
    height: 768,
    format: 'png',
    size: 50000,
  });
  deps.imageHandler.processImage.mockResolvedValue({
    data: Buffer.from('processed'),
    mimeType: 'image/webp',
    width: 256,
    height: 192,
    originalWidth: 1024,
    originalHeight: 768,
    size: 12000,
    sizeKB: 12,
  });
  deps.imageHandler.toDataUri.mockReturnValue(
    'data:image/webp;base64,ZmFrZQ==',
  );
  deps.assetRegistry.registerAsset.mockReturnValue({
    id: 'asset-uuid-output-1',
  });
}

/**
 * Configura i mock per il percorso felice di generate_image:
 * workflow trovato, render riuscito, validazione ok, history completa.
 */
function setupGenerateSuccessMocks(
  deps: ReturnType<typeof createMockDeps>,
  promptId = 'prompt-abc-123',
) {
  deps.workflowManager.getWorkflow.mockReturnValue({
    class_type: 'Workflow',
    inputs: {},
  });
  deps.workflowManager.renderWorkflow.mockResolvedValue({
    '3': { class_type: 'KSampler', inputs: { seed: 42 } },
  });
  deps.workflowManager.validateWorkflow.mockReturnValue({
    valid: true,
    errors: [],
  });
  deps.workflowManager.parseParameters.mockReturnValue([
    { name: 'seed', value: 42 },
  ]);
  deps.comfyClient.queuePrompt.mockResolvedValue({ prompt_id: promptId });
  deps.comfyClient.getHistory.mockResolvedValue({
    [promptId]: {
      outputs: {
        '9': {
          images: [
            {
              filename: 'ComfyUI_00001_.png',
              subfolder: '',
              type: 'output',
            },
          ],
        },
      },
      status: { completed: true },
    },
  });
}

// ─── Suite ───────────────────────────────────────────────────────────────────

describe('generation tools', () => {
  let server: ReturnType<typeof createMockServer>;
  let deps: ReturnType<typeof createMockDeps>;

  beforeEach(() => {
    server = createMockServer();
    deps = createMockDeps();
    registerGenerationTools(
      server as any,
      deps as unknown as GenerationDeps,
    );
  });

  // ─── generate_image ────────────────────────────────────────────

  describe('generate_image', () => {
    it('txt2img basic — generates image with completed status', async () => {
      const promptId = 'prompt-abc-123';
      setupGenerateSuccessMocks(deps, promptId);
      setupImageProcessingMocks(deps);

      const result = await server.callTool('generate_image', {
        workflow: 'txt2img',
        wait: true,
      });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.prompt_id).toBe(promptId);
      expect(parsed.status).toBe('completed');
      expect(Array.isArray(parsed.images)).toBe(true);
      expect(parsed.images).toHaveLength(1);
      expect(parsed.images[0]).toHaveProperty('asset_id');
      expect(parsed.images[0]).toHaveProperty('filename');
      expect(parsed.images[0]).toHaveProperty('thumbnail');
      expect(parsed.images[0].filename).toBe('ComfyUI_00001_.png');

      // Verifica chiamate chiave
      expect(deps.workflowManager.getWorkflow).toHaveBeenCalledWith('txt2img');
      expect(deps.workflowManager.renderWorkflow).toHaveBeenCalledWith(
        'txt2img',
        {},
      );
      expect(deps.workflowManager.validateWorkflow).toHaveBeenCalledTimes(1);
      expect(deps.comfyClient.queuePrompt).toHaveBeenCalledTimes(1);
      expect(deps.comfyClient.getHistory).toHaveBeenCalledWith(promptId);
    });

    it('with wait=false returns queued status and empty images', async () => {
      deps.workflowManager.getWorkflow.mockReturnValue({
        class_type: 'Workflow',
        inputs: {},
      });
      deps.workflowManager.renderWorkflow.mockResolvedValue({
        '3': { class_type: 'KSampler', inputs: {} },
      });
      deps.workflowManager.validateWorkflow.mockReturnValue({
        valid: true,
        errors: [],
      });
      deps.workflowManager.parseParameters.mockReturnValue([]);
      deps.comfyClient.queuePrompt.mockResolvedValue({
        prompt_id: 'prompt-queued-1',
      });

      const result = await server.callTool('generate_image', {
        workflow: 'txt2img',
        wait: false,
      });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.prompt_id).toBe('prompt-queued-1');
      expect(parsed.status).toBe('queued');
      expect(parsed.images).toEqual([]);

      // Con wait=false NON si deve arrivare al polling
      expect(deps.comfyClient.getHistory).not.toHaveBeenCalled();
    });

    it('with params overrides passes them to applyOverrides', async () => {
      const promptId = 'prompt-override-1';
      deps.workflowManager.getWorkflow.mockReturnValue({
        class_type: 'Workflow',
        inputs: {},
      });
      deps.workflowManager.renderWorkflow.mockResolvedValue({
        '3': { class_type: 'KSampler', inputs: { seed: 42 } },
      });
      deps.workflowManager.applyOverrides.mockReturnValue({
        '3': { class_type: 'KSampler', inputs: { seed: 999 } },
      });
      deps.workflowManager.validateWorkflow.mockReturnValue({
        valid: true,
        errors: [],
      });
      deps.workflowManager.parseParameters.mockReturnValue([]);
      deps.comfyClient.queuePrompt.mockResolvedValue({
        prompt_id: promptId,
      });
      setupImageProcessingMocks(deps);
      // getHistory per pollForCompletion
      deps.comfyClient.getHistory.mockResolvedValue({
        [promptId]: {
          outputs: {
            '9': {
              images: [
                {
                  filename: 'override.png',
                  subfolder: '',
                  type: 'output',
                },
              ],
            },
          },
          status: { completed: true },
        },
      });

      const params = { seed: 999, steps: 30 };
      await server.callTool('generate_image', {
        workflow: 'txt2img',
        params,
        wait: true,
      });

      expect(deps.workflowManager.applyOverrides).toHaveBeenCalledWith(
        expect.anything(),
        params,
      );
    });

    it('invalid workflow name throws McpError', async () => {
      deps.workflowManager.getWorkflow.mockReturnValue(undefined);

      await expect(
        server.callTool('generate_image', { workflow: 'unknown' }),
      ).rejects.toThrow(McpError);
    });

    it('polling timeout throws McpError', async () => {
      vi.useFakeTimers();

      deps.workflowManager.getWorkflow.mockReturnValue({
        class_type: 'Workflow',
        inputs: {},
      });
      deps.workflowManager.renderWorkflow.mockResolvedValue({
        '3': { class_type: 'KSampler', inputs: {} },
      });
      deps.workflowManager.validateWorkflow.mockReturnValue({
        valid: true,
        errors: [],
      });
      deps.workflowManager.parseParameters.mockReturnValue([]);
      deps.comfyClient.queuePrompt.mockResolvedValue({
        prompt_id: 'timeout-prompt',
      });
      // Mai completato — restituisce sempre oggetto vuoto
      deps.comfyClient.getHistory.mockResolvedValue({});

      // Registra il catch handler PRIMA di avanzare i timer,
      // altrimenti la rejection durante advanceTimersByTimeAsync
      // diventa unhandled
      let timeoutError: unknown = undefined;
      const callPromise = server
        .callTool('generate_image', {
          workflow: 'txt2img',
          wait: true,
        })
        .catch((err) => {
          timeoutError = err;
        });

      // Avanza il tempo oltre il timeout di 120s
      await vi.advanceTimersByTimeAsync(121000);

      expect(timeoutError).toBeInstanceOf(McpError);

      vi.useRealTimers();
    });
  });

  // ─── regenerate ───────────────────────────────────────────────

  describe('regenerate', () => {
    it('basic — regenerates from existing prompt_id', async () => {
      const origPromptId = 'orig-456';
      const newPromptId = 'new-789';
      const originalWorkflow = {
        '3': { class_type: 'KSampler', inputs: { seed: 42 } },
      };

      deps.comfyClient.getHistory.mockResolvedValueOnce({
        [origPromptId]: {
          prompt: originalWorkflow,
          outputs: {},
          status: { completed: true },
        },
      });
      deps.workflowManager.validateWorkflow.mockReturnValue({
        valid: true,
        errors: [],
      });
      deps.comfyClient.queuePrompt.mockResolvedValue({
        prompt_id: newPromptId,
      });
      setupImageProcessingMocks(deps);
      // getHistory per pollForCompletion
      deps.comfyClient.getHistory.mockResolvedValue({
        [newPromptId]: {
          outputs: {
            '9': {
              images: [
                {
                  filename: 'regenerated.png',
                  subfolder: '',
                  type: 'output',
                },
              ],
            },
          },
          status: { completed: true },
        },
      });

      const result = await server.callTool('regenerate', {
        prompt_id: origPromptId,
        wait: true,
      });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.prompt_id).toBe(newPromptId);
      expect(parsed.status).toBe('completed');
      expect(Array.isArray(parsed.images)).toBe(true);
      expect(parsed.images).toHaveLength(1);

      // Verifica che il workflow originale sia stato rieseguito
      expect(deps.comfyClient.getHistory).toHaveBeenCalledWith(origPromptId);
      expect(deps.comfyClient.queuePrompt).toHaveBeenCalledWith(
        originalWorkflow,
      );
    });

    it('with new params applies overrides', async () => {
      const origPromptId = 'orig-params-1';
      const newPromptId = 'new-params-1';
      const originalWorkflow = {
        '3': { class_type: 'KSampler', inputs: { seed: 42 } },
      };

      deps.comfyClient.getHistory.mockResolvedValueOnce({
        [origPromptId]: {
          prompt: originalWorkflow,
          outputs: {},
          status: { completed: true },
        },
      });
      deps.workflowManager.applyOverrides.mockReturnValue({
        '3': { class_type: 'KSampler', inputs: { seed: 777 } },
      });
      deps.workflowManager.validateWorkflow.mockReturnValue({
        valid: true,
        errors: [],
      });
      deps.comfyClient.queuePrompt.mockResolvedValue({
        prompt_id: newPromptId,
      });
      setupImageProcessingMocks(deps);
      deps.comfyClient.getHistory.mockResolvedValue({
        [newPromptId]: {
          outputs: {
            '9': {
              images: [
                {
                  filename: 'with-params.png',
                  subfolder: '',
                  type: 'output',
                },
              ],
            },
          },
          status: { completed: true },
        },
      });

      const newParams = { seed: 777, steps: 50 };
      await server.callTool('regenerate', {
        prompt_id: origPromptId,
        params: newParams,
        wait: true,
      });

      expect(deps.workflowManager.applyOverrides).toHaveBeenCalledWith(
        originalWorkflow,
        newParams,
      );
      // Queue deve ricevere il workflow con override applicati
      expect(deps.comfyClient.queuePrompt).toHaveBeenCalledWith(
        { '3': { class_type: 'KSampler', inputs: { seed: 777 } } },
      );
    });

    it('prompt_id not found throws McpError', async () => {
      deps.comfyClient.getHistory.mockResolvedValue({});

      await expect(
        server.callTool('regenerate', { prompt_id: 'missing-prompt' }),
      ).rejects.toThrow(McpError);
    });
  });

  // ─── view_image ───────────────────────────────────────────────

  describe('view_image', () => {
    it('by asset_id — resolves from registry and returns thumbnail', async () => {
      deps.assetRegistry.getAsset.mockReturnValue({
        id: 'asset-abc',
        identity: {
          filename: 'stored_image.png',
          subfolder: 'output',
          type: 'output',
        },
      });
      deps.comfyClient.getView.mockResolvedValue(
        Buffer.from('fake-image-data'),
      );
      deps.imageHandler.processImage.mockResolvedValue({
        data: Buffer.from('webp-data'),
        mimeType: 'image/webp',
        width: 256,
        height: 256,
        originalWidth: 1024,
        originalHeight: 1024,
        size: 10000,
        sizeKB: 10,
      });
      deps.imageHandler.toDataUri.mockReturnValue(
        'data:image/webp;base64,dGVzdA==',
      );

      const result = await server.callTool('view_image', {
        asset_id: 'asset-abc',
      });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.asset_id).toBe('asset-abc');
      expect(parsed.filename).toBe('stored_image.png');
      expect(parsed.thumbnail).toBe('data:image/webp;base64,dGVzdA==');
      expect(parsed.width).toBe(256);
      expect(parsed.height).toBe(256);

      expect(deps.assetRegistry.getAsset).toHaveBeenCalledWith('asset-abc');
      expect(deps.comfyClient.getView).toHaveBeenCalledWith(
        'stored_image.png',
        'output',
        'output',
      );
    });

    it('by filename — uses explicit filename without registry', async () => {
      deps.comfyClient.getView.mockResolvedValue(
        Buffer.from('fake-image-data'),
      );
      deps.imageHandler.processImage.mockResolvedValue({
        data: Buffer.from('webp-data'),
        mimeType: 'image/webp',
        width: 128,
        height: 128,
        originalWidth: 512,
        originalHeight: 512,
        size: 5000,
        sizeKB: 5,
      });
      deps.imageHandler.toDataUri.mockReturnValue(
        'data:image/webp;base64,ZmlsZQ==',
      );

      const result = await server.callTool('view_image', {
        filename: 'ComfyUI_00001_.png',
        subfolder: '',
        width: 128,
        height: 128,
        quality: 70,
      });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.filename).toBe('ComfyUI_00001_.png');
      expect(parsed.asset_id).toBeNull();
      expect(parsed.thumbnail).toBe('data:image/webp;base64,ZmlsZQ==');
      expect(parsed.width).toBe(128);
      expect(parsed.height).toBe(128);

      expect(deps.comfyClient.getView).toHaveBeenCalledWith(
        'ComfyUI_00001_.png',
        '',
        'output',
      );
      // processImage deve ricevere le opzioni width/height/quality/format
      expect(deps.imageHandler.processImage).toHaveBeenCalledWith(
        expect.any(Buffer),
        {
          maxWidth: 128,
          maxHeight: 128,
          quality: 70,
          format: 'webp',
        },
      );
    });

    it('without asset_id or filename throws McpError', async () => {
      await expect(
        server.callTool('view_image', {}),
      ).rejects.toThrow(McpError);
    });

    it('asset_id not found and no filename throws McpError', async () => {
      deps.assetRegistry.getAsset.mockReturnValue(null);

      await expect(
        server.callTool('view_image', { asset_id: 'unknown-id' }),
      ).rejects.toThrow(McpError);
    });
  });
});
