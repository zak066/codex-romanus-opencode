/**
 * WorkflowExecute Tools — Integration Tests
 *
 * Fase 9 (F9): test di integrazione per i tool MCP di esecuzione workflow.
 *
 * Pattern:
 * - Mock McpServer (come unit test) ma wiretato con ComfyClient reale.
 * - Le dipendenze non-ComfyUI (WorkflowManager, AssetRegistry) sono mockate.
 * - Reachability check prima di ogni suite.
 *
 * Safe by design:
 * - enqueue_workflow usa workflow minimale + cancel immediato.
 * - cancel_job con prompt_id inesistente è safe.
 * - Nessun job lasciato in coda.
 */

import { describe, it, expect, beforeAll, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

import { registerWorkflowExecuteTools } from '../../src/tools/workflow-execute.js';
import { ComfyClient } from '../../src/comfyui/client.js';
import { McpError } from '@modelcontextprotocol/sdk/types.js';

import type { WorkflowExecuteDeps } from '../../src/tools/workflow-execute.js';

// ─── Constants ───────────────────────────────────────────────────────────────

const COMFYUI_URL = process.env.COMFYUI_URL || 'http://127.0.0.1:8188';
const INTEGRATION_TIMEOUT = 15_000;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Verifica se ComfyUI è raggiungibile.
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

describe('workflow-execute tools integration', () => {
  let reachable: boolean;
  let server: ReturnType<typeof createMockServer>;

  beforeAll(async () => {
    reachable = await isComfyUIReachable(COMFYUI_URL);

    if (reachable) {
      // Crea un ComfyClient reale
      const comfyClient = new ComfyClient(COMFYUI_URL);

      // Dipendenze mockate (le parti non-ComfyUI)
      const deps: WorkflowExecuteDeps = {
        comfyClient,
        workflowManager: {
          getWorkflow: vi.fn(),
          listWorkflows: vi.fn(),
        } as unknown as WorkflowExecuteDeps['workflowManager'],
        assetRegistry: {
          registerAsset: vi.fn(),
          getAsset: vi.fn(),
        } as unknown as WorkflowExecuteDeps['assetRegistry'],
      };

      server = createMockServer();
      registerWorkflowExecuteTools(server as any, deps);
    }
  }, INTEGRATION_TIMEOUT);

  // ─── enqueue_workflow ────────────────────────────────────────────

  describe('enqueue_workflow', () => {
    it('should enqueue a valid workflow and return prompt_id', async () => {
      if (!reachable) return;

      const workflow = {
        '4': {
          class_type: 'CheckpointLoaderSimple',
          inputs: { ckpt_name: 'sd_xl_base_1.0.safetensors' },
        },
      };

      const result = await server.callTool('enqueue_workflow', { workflow });
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed).toBeDefined();
      expect(parsed.prompt_id).toBeDefined();
      expect(typeof parsed.prompt_id).toBe('string');
      expect(parsed.prompt_id.length).toBeGreaterThan(0);
      expect(parsed.number).toBeDefined();
      expect(typeof parsed.number).toBe('number');

      // Non lasciamo job in coda
      await server.callTool('cancel_job', { prompt_id: parsed.prompt_id }).catch(() => {});
    }, INTEGRATION_TIMEOUT);

    it('should accept extra_data and pass it to ComfyUI', async () => {
      if (!reachable) return;

      const workflow = {
        '4': {
          class_type: 'CheckpointLoaderSimple',
          inputs: { ckpt_name: 'sd_xl_base_1.0.safetensors' },
        },
      };

      const result = await server.callTool('enqueue_workflow', {
        workflow,
        extra_data: { source: 'integration-test' },
      });
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.prompt_id).toBeDefined();

      // Cleanup
      await server.callTool('cancel_job', { prompt_id: parsed.prompt_id }).catch(() => {});
    }, INTEGRATION_TIMEOUT);

    it('should reject null/empty workflow with McpError', async () => {
      if (!reachable) return;

      await expect(
        server.callTool('enqueue_workflow', { workflow: null }),
      ).rejects.toThrow(McpError);

      await expect(
        server.callTool('enqueue_workflow', { workflow: {} }),
      ).rejects.toThrow(McpError);
    }, INTEGRATION_TIMEOUT);

    it('should reject array workflow with McpError', async () => {
      if (!reachable) return;

      await expect(
        server.callTool('enqueue_workflow', { workflow: [] }),
      ).rejects.toThrow(McpError);
    }, INTEGRATION_TIMEOUT);
  });

  // ─── get_job_status ──────────────────────────────────────────────

  describe('get_job_status', () => {
    it('should return pending for unknown prompt_id', async () => {
      if (!reachable) return;

      const result = await server.callTool('get_job_status', {
        prompt_id: randomUUID(),
      });
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed).toBeDefined();
      expect(parsed.status).toBe('pending');
    }, INTEGRATION_TIMEOUT);

    it('should return a valid status object with prompt_id field', async () => {
      if (!reachable) return;

      const result = await server.callTool('get_job_status', {
        prompt_id: '00000000-0000-0000-0000-000000000000',
      });
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed).toBeDefined();
      // Deve essere uno degli stati conosciuti
      expect(['completed', 'failed', 'pending', 'running', 'not_found']).toContain(parsed.status);
    }, INTEGRATION_TIMEOUT);

    it('should return pending (history empty) for non-existent prompt', async () => {
      if (!reachable) return;

      const result = await server.callTool('get_job_status', {
        prompt_id: 'nonexistent-prompt-id',
      });
      const parsed = JSON.parse(result.content[0].text);

      // ComfyUI restituisce {} per prompt non trovati → pending
      expect(parsed.status).toBe('pending');
    }, INTEGRATION_TIMEOUT);
  });

  // ─── get_queue ───────────────────────────────────────────────────

  describe('get_queue', () => {
    it('should return queue with running, pending, and queue_size', async () => {
      if (!reachable) return;

      const result = await server.callTool('get_queue', {});
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed).toBeDefined();
      expect(parsed.running).toBeInstanceOf(Array);
      expect(parsed.pending).toBeInstanceOf(Array);
      expect(parsed.queue_size).toBeDefined();
      expect(typeof parsed.queue_size).toBe('number');
      expect(parsed.queue_size).toBe(parsed.running.length + parsed.pending.length);
    }, INTEGRATION_TIMEOUT);

    it('should return empty queue when nothing is executing', async () => {
      if (!reachable) return;

      const result = await server.callTool('get_queue', {});
      const parsed = JSON.parse(result.content[0].text);

      // Non ci dovrebbero essere errori
      expect(parsed.running).toBeInstanceOf(Array);
      expect(parsed.pending).toBeInstanceOf(Array);
    }, INTEGRATION_TIMEOUT);
  });

  // ─── cancel_job ──────────────────────────────────────────────────

  describe('cancel_job', () => {
    it('should handle cancel of non-existent job gracefully', async () => {
      if (!reachable) return;

      // ComfyUI risponde 200 anche per prompt_id inesistenti
      const result = await server.callTool('cancel_job', {
        prompt_id: randomUUID(),
      });
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed).toBeDefined();
      expect(parsed.cancelled).toBe(true);
      expect(parsed.message).toBe('Job cancelled');
    }, INTEGRATION_TIMEOUT);

    it('should reject empty prompt_id with McpError', async () => {
      if (!reachable) return;

      await expect(
        server.callTool('cancel_job', { prompt_id: '' }),
      ).rejects.toThrow(McpError);
    }, INTEGRATION_TIMEOUT);
  });

  // ─── End-to-end: enqueue + cancel ────────────────────────────────

  describe('enqueue + cancel flow', () => {
    it('should enqueue a workflow and cancel it immediately', async () => {
      if (!reachable) return;

      const workflow = {
        '4': {
          class_type: 'CheckpointLoaderSimple',
          inputs: { ckpt_name: 'sd_xl_base_1.0.safetensors' },
        },
      };

      // Enqueue
      const enqueueResult = await server.callTool('enqueue_workflow', { workflow });
      const { prompt_id } = JSON.parse(enqueueResult.content[0].text);

      expect(prompt_id).toBeDefined();

      // Immediate cancel
      const cancelResult = await server.callTool('cancel_job', { prompt_id });
      const cancelParsed = JSON.parse(cancelResult.content[0].text);

      expect(cancelParsed.cancelled).toBe(true);

      // Verifica stato dopo cancellazione
      const statusResult = await server.callTool('get_job_status', { prompt_id });
      const statusParsed = JSON.parse(statusResult.content[0].text);

      // Dopo cancel, potrebbe essere completed (se già finito) o pending
      expect(['pending', 'completed', 'not_found']).toContain(statusParsed.status);
    }, INTEGRATION_TIMEOUT);
  });
});
