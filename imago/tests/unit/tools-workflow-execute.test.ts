/**
 * WorkflowExecute Tools — Unit Tests
 *
 * Copre i 4 tool MCP di esecuzione workflow:
 * - enqueue_workflow: invia un workflow JSON a ComfyUI
 * - get_job_status: verifica lo stato di un job
 * - get_queue: mostra la coda corrente
 * - cancel_job: cancella un job dalla coda
 *
 * Pattern: Mock del McpServer + dipendenze iniettate mockate.
 * Il mock server bypassa la validazione Zod per testare il
 * comportamento dei callback direttamente.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerWorkflowExecuteTools } from '../../src/tools/workflow-execute.js';
import { McpError } from '@modelcontextprotocol/sdk/types.js';
import type { WorkflowExecuteDeps } from '../../src/tools/workflow-execute.js';

// ─── Mock Framework ──────────────────────────────────────────────────────────

/**
 * Crea un McpServer finto con un metodo tool() semplificato.
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

/**
 * Crea dipendenze mockate per WorkflowExecuteDeps.
 * Ogni mock è un vi.fn() che restituisce una promise risolta.
 */
function createMockDeps() {
  return {
    comfyClient: {
      queuePrompt: vi.fn(),
      getHistory: vi.fn(),
      getQueue: vi.fn(),
      cancelJob: vi.fn(),
    },
    workflowManager: {
      getWorkflow: vi.fn(),
      renderWorkflow: vi.fn(),
      listWorkflows: vi.fn(),
    },
    assetRegistry: {
      registerAsset: vi.fn(),
      getAsset: vi.fn(),
    },
  };
}

// ─── Suite ───────────────────────────────────────────────────────────────────

describe('workflow-execute tools', () => {
  let server: ReturnType<typeof createMockServer>;
  let deps: ReturnType<typeof createMockDeps>;

  beforeEach(() => {
    server = createMockServer();
    deps = createMockDeps();
    registerWorkflowExecuteTools(server as any, deps as unknown as WorkflowExecuteDeps);
  });

  // ─── enqueue_workflow ─────────────────────────────────────────

  describe('enqueue_workflow', () => {
    it('submits workflow and returns prompt_id and number', async () => {
      deps.comfyClient.queuePrompt.mockResolvedValue({
        prompt_id: 'abc-123',
        number: 1,
      });

      const workflow = { '3': { class_type: 'KSampler', inputs: {} } };
      const result = await server.callTool('enqueue_workflow', { workflow });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.prompt_id).toBe('abc-123');
      expect(parsed.number).toBe(1);
      expect(deps.comfyClient.queuePrompt).toHaveBeenCalledTimes(1);
    });

    it('passes extra_data to queuePrompt', async () => {
      deps.comfyClient.queuePrompt.mockResolvedValue({
        prompt_id: 'abc-123',
        number: 1,
      });

      const workflow = { '3': { class_type: 'KSampler', inputs: {} } };
      const extra = { client_id: 'test-client' };
      await server.callTool('enqueue_workflow', { workflow, extra_data: extra });

      expect(deps.comfyClient.queuePrompt).toHaveBeenCalledWith(
        workflow,
        extra,
      );
    });

    it('rejects missing workflow with McpError', async () => {
      await expect(
        server.callTool('enqueue_workflow', {}),
      ).rejects.toThrow(McpError);
    });

    it('rejects array workflow with McpError', async () => {
      await expect(
        server.callTool('enqueue_workflow', { workflow: [] }),
      ).rejects.toThrow(McpError);
    });

    it('wraps comfyClient error in McpError', async () => {
      deps.comfyClient.queuePrompt.mockRejectedValue(
        new Error('Connection refused'),
      );

      await expect(
        server.callTool('enqueue_workflow', {
          workflow: { '1': { class_type: 'Test', inputs: {} } },
        }),
      ).rejects.toThrow(McpError);
    });

    it('returns node_errors when present', async () => {
      deps.comfyClient.queuePrompt.mockResolvedValue({
        prompt_id: 'def-456',
        number: 2,
        node_errors: { '3': { error: 'Missing input' } },
      });

      const workflow = { '3': { class_type: 'KSampler', inputs: {} } };
      const result = await server.callTool('enqueue_workflow', { workflow });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.prompt_id).toBe('def-456');
      expect(parsed.node_errors).toBeDefined();
      expect(parsed.node_errors['3'].error).toBe('Missing input');
    });
  });

  // ─── get_job_status ───────────────────────────────────────────

  describe('get_job_status', () => {
    it('returns completed status with images', async () => {
      deps.comfyClient.getHistory.mockResolvedValue({
        'prompt-1': {
          outputs: {
            '9': {
              images: [
                { filename: 'img.png', subfolder: '', type: 'output' },
              ],
            },
          },
          status: { completed: true },
        },
      });

      const result = await server.callTool('get_job_status', {
        prompt_id: 'prompt-1',
      });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.status).toBe('completed');
      expect(parsed.result.images).toHaveLength(1);
      expect(parsed.result.images[0].filename).toBe('img.png');
    });

    it('returns pending when history is empty', async () => {
      deps.comfyClient.getHistory.mockResolvedValue({});

      const result = await server.callTool('get_job_status', {
        prompt_id: 'prompt-1',
      });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.status).toBe('pending');
    });

    it('returns not_found when client throws an error', async () => {
      deps.comfyClient.getHistory.mockRejectedValue(
        new Error('Not found'),
      );

      const result = await server.callTool('get_job_status', {
        prompt_id: 'unknown',
      });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.status).toBe('not_found');
      expect(parsed.error).toBeDefined();
    });

    it('returns running when history entry exists but not completed', async () => {
      deps.comfyClient.getHistory.mockResolvedValue({
        'prompt-1': {
          outputs: {},
          status: { completed: false },
        },
      });

      const result = await server.callTool('get_job_status', {
        prompt_id: 'prompt-1',
      });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.status).toBe('running');
    });

    it('returns failed when completed but no images and has error messages', async () => {
      deps.comfyClient.getHistory.mockResolvedValue({
        'prompt-1': {
          outputs: { '9': {} },
          status: {
            completed: true,
            messages: [['error', 'Out of memory']],
          },
        },
      });

      const result = await server.callTool('get_job_status', {
        prompt_id: 'prompt-1',
      });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.status).toBe('failed');
      expect(parsed.error).toContain('Out of memory');
    });
  });

  // ─── get_queue ────────────────────────────────────────────────

  describe('get_queue', () => {
    it('returns running and pending items with correct queue_size', async () => {
      deps.comfyClient.getQueue.mockResolvedValue({
        queue_running: [
          ['run-1', 2],
          ['run-2', 1],
        ],
        queue_pending: [
          ['pend-1', 4],
          ['pend-2', 5],
          ['pend-3', 6],
        ],
      });

      const result = await server.callTool('get_queue', {});

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.running).toHaveLength(2);
      expect(parsed.pending).toHaveLength(3);
      expect(parsed.queue_size).toBe(5);
    });

    it('returns empty queue when nothing is queued', async () => {
      deps.comfyClient.getQueue.mockResolvedValue({
        queue_running: [],
        queue_pending: [],
      });

      const result = await server.callTool('get_queue', {});

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.queue_size).toBe(0);
      expect(parsed.running).toHaveLength(0);
      expect(parsed.pending).toHaveLength(0);
    });

    it('throws McpError when comfyClient fails', async () => {
      deps.comfyClient.getQueue.mockRejectedValue(
        new Error('Connection lost'),
      );

      await expect(server.callTool('get_queue', {})).rejects.toThrow(
        McpError,
      );
    });
  });

  // ─── cancel_job ───────────────────────────────────────────────

  describe('cancel_job', () => {
    it('cancels a job and returns success', async () => {
      deps.comfyClient.cancelJob.mockResolvedValue(undefined);

      const result = await server.callTool('cancel_job', {
        prompt_id: 'prompt-to-cancel',
      });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.cancelled).toBe(true);
      expect(parsed.message).toBe('Job cancelled');
      expect(deps.comfyClient.cancelJob).toHaveBeenCalledWith(
        'prompt-to-cancel',
      );
    });

    it('wraps comfyClient error in McpError', async () => {
      deps.comfyClient.cancelJob.mockRejectedValue(
        new Error('Job not found'),
      );

      await expect(
        server.callTool('cancel_job', { prompt_id: 'missing' }),
      ).rejects.toThrow(McpError);
    });
  });
});
