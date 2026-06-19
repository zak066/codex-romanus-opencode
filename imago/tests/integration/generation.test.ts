/**
 * Generation Tools — Integration Tests
 *
 * Fase 9 (F9): test di integrazione per i tool MCP di generazione immagini.
 *
 * Pattern Reachability Check (come comfy-client.test.ts e workflow-execute.test.ts):
 * - Prima di ogni suite, verifichiamo se ComfyUI è raggiungibile.
 * - Ogni test inizia con `if (!reachable) return;` per saltare gracefulmente.
 * - Timeout più lunghi (15s) per tollerare latenza di rete/GPU.
 *
 * Mock strategy:
 * - WorkflowManager, AssetRegistry, ImageHandler sono mockati (parti non di rete).
 * - ComfyClient è reale (test di integrazione).
 * - Mock McpServer identico ai test unitari.
 *
 * Safe by design:
 * - generate_image con wait=false + cancel immediato.
 * - generate_image con workflow minimale CheckpointLoaderSimple (solo model load).
 * - regenerate con prompt_id inesistente è safe (ComfyUI ritorna {}).
 * - view_image con filename inesistente ritorna 500 — testato come errore.
 */

import { describe, it, expect, beforeAll, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

import { registerGenerationTools } from '../../src/tools/generation.js';
import { ComfyClient } from '../../src/comfyui/client.js';
import { McpError } from '@modelcontextprotocol/sdk/types.js';

import type { GenerationDeps } from '../../src/tools/generation.js';

// ─── Constants ───────────────────────────────────────────────────────────────

const COMFYUI_URL = process.env.COMFYUI_URL || 'http://127.0.0.1:8188';
const INTEGRATION_TIMEOUT = 15_000;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Verifica se un'istanza ComfyUI è raggiungibile via HTTP.
 */
async function isComfyUIReachable(url: string): Promise<boolean> {
  try {
    const resp = await fetch(`${url}/system_stats`, {
      signal: AbortSignal.timeout(3000),
    });
    return resp.ok;
  } catch {
    return false;
  }
}

/**
 * Crea un McpServer finto (stesso pattern dei test unitari).
 * I tool registrati sono accessibili via callTool(name, args).
 */
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

// ─── Suite ───────────────────────────────────────────────────────────────────

describe('generation tools integration', () => {
  let reachable: boolean;
  let server: ReturnType<typeof createMockServer>;
  let comfyClient: ComfyClient;

  // Mock helper references — configurati per-test per isolamento
  // eslint-disable-next-line prefer-const
  let mockWf: ReturnType<typeof createWfMocks>;
  // eslint-disable-next-line prefer-const
  let mockAr: ReturnType<typeof createArMocks>;

  function createWfMocks() {
    return {
      getWorkflow: vi.fn(),
      renderWorkflow: vi.fn(),
      applyOverrides: vi.fn(),
      validateWorkflow: vi.fn(),
      parseParameters: vi.fn(),
    };
  }

  function createArMocks() {
    return {
      getAsset: vi.fn(),
      registerAsset: vi.fn(),
    };
  }

  beforeAll(async () => {
    reachable = await isComfyUIReachable(COMFYUI_URL);

    if (reachable) {
      comfyClient = new ComfyClient(COMFYUI_URL);

      mockWf = createWfMocks();
      mockAr = createArMocks();

      const deps: GenerationDeps = {
        comfyClient,
        workflowManager: mockWf as unknown as GenerationDeps['workflowManager'],
        assetRegistry: mockAr as unknown as GenerationDeps['assetRegistry'],
      };

      server = createMockServer();
      registerGenerationTools(server as any, deps);
    }
  }, INTEGRATION_TIMEOUT);

  // ─── Test 1: generate_image with wait=false ─────────────────────────

  it('generate_image with txt2img and wait=false — returns queued status', async () => {
    if (!reachable) return;

    // Setup workflow mocks per il percorso felice
    mockWf.getWorkflow.mockReturnValue({
      id: 'txt2img',
      name: 'Txt2Img',
      description: 'Generate images from text prompts',
      category: 'txt2img',
      json: {},
      parameters: [],
    });
    mockWf.renderWorkflow.mockResolvedValue({
      '4': {
        class_type: 'CheckpointLoaderSimple',
        inputs: { ckpt_name: 'sd_xl_base_1.0.safetensors' },
      },
    });
    mockWf.validateWorkflow.mockReturnValue({
      valid: true,
      errors: [],
      warnings: [],
    });
    mockWf.parseParameters.mockReturnValue([]);

    const result = await server.callTool('generate_image', {
      workflow: 'txt2img',
      wait: false,
    });

    const parsed = JSON.parse(result.content[0].text);

    expect(parsed).toBeDefined();
    expect(parsed.prompt_id).toBeDefined();
    expect(typeof parsed.prompt_id).toBe('string');
    expect(parsed.prompt_id.length).toBeGreaterThan(0);
    expect(parsed.status).toBe('queued');
    expect(parsed.images).toEqual([]);

    // Non ci devono essere chiamate a getHistory (nessun polling)
    // Nota: non possiamo verificare qui perché il mock è globale

    // Cleanup: cancella il job se ancora in coda
    await comfyClient.cancelJob(parsed.prompt_id).catch(() => {});
  }, INTEGRATION_TIMEOUT);

  // ─── Test 2: invalid workflow name ─────────────────────────────────

  it('generate_image with invalid workflow name throws McpError', async () => {
    if (!reachable) return;

    // getWorkflow restituisce undefined per workflow inesistente
    mockWf.getWorkflow.mockReturnValue(undefined);

    await expect(
      server.callTool('generate_image', { workflow: 'nonexistent' }),
    ).rejects.toThrow(McpError);
  }, INTEGRATION_TIMEOUT);

  // ─── Test 3: view_image ────────────────────────────────────────────

  it('view_image with non-existent filename throws McpError from ComfyUI', async () => {
    if (!reachable) return;

    // ComfyUI restituisce 500 per file inesistenti;
    // il tool cattura l'errore e rilancia McpError(InternalError)
    await expect(
      server.callTool('view_image', {
        filename: 'nonexistent_file_that_does_not_exist.png',
      }),
    ).rejects.toThrow(McpError);
  }, INTEGRATION_TIMEOUT);

  // ─── Test 4: regenerate with fake prompt_id ────────────────────────

  it('regenerate with non-existent prompt_id throws McpError', async () => {
    if (!reachable) return;

    const fakeId = randomUUID();

    // ComfyUI restituisce {} per prompt non trovati → tool lancia McpError
    await expect(
      server.callTool('regenerate', { prompt_id: fakeId }),
    ).rejects.toThrow(McpError);
  }, INTEGRATION_TIMEOUT);

  // ─── Test 5: full pipeline wait=true ───────────────────────────────

  it('generate_image full pipeline with wait=true — enqueue, poll, complete', async () => {
    if (!reachable) return;

    // Setup workflow mocks — CheckpointLoaderSimple è rapido
    mockWf.getWorkflow.mockReturnValue({
      id: 'txt2img',
      name: 'Txt2Img',
      description: 'Generate images from text prompts',
      category: 'txt2img',
      json: {},
      parameters: [],
    });
    mockWf.renderWorkflow.mockResolvedValue({
      '4': {
        class_type: 'CheckpointLoaderSimple',
        inputs: { ckpt_name: 'sd_xl_base_1.0.safetensors' },
      },
    });
    mockWf.validateWorkflow.mockReturnValue({
      valid: true,
      errors: [],
      warnings: [],
    });
    mockWf.parseParameters.mockReturnValue([]);

    const result = await server.callTool('generate_image', {
      workflow: 'txt2img',
      wait: true,
    });

    const parsed = JSON.parse(result.content[0].text);

    expect(parsed).toBeDefined();
    expect(parsed.prompt_id).toBeDefined();
    expect(typeof parsed.prompt_id).toBe('string');
    expect(parsed.prompt_id.length).toBeGreaterThan(0);

    // CheckpointLoaderSimple non produce immagini, ma il workflow
    // completa comunque. Lo status deve essere 'completed'.
    expect(parsed.status).toBe('completed');
    expect(Array.isArray(parsed.images)).toBe(true);

    // Cleanup: cancella il job per sicurezza
    await comfyClient.cancelJob(parsed.prompt_id).catch(() => {});
  }, 30_000);
});
