/**
 * WorkflowExecute Tools — Tool MCP per l'esecuzione di workflow su ComfyUI.
 *
 * Fase 4 (F4): espone 4 tool handler MCP:
 * - enqueue_workflow: invia un workflow JSON a ComfyUI
 * - get_job_status: verifica lo stato di un job
 * - get_queue: mostra la coda corrente
 * - cancel_job: cancella un job dalla coda
 *
 * Pattern: Bridge + Adapter — i tool traducono chiamate MCP in operazioni
 * sul dominio ComfyUI tramite dipendenze iniettate.
 */

import { z } from 'zod';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ComfyClient } from '../comfyui/client.js';
import type { WorkflowManager } from '../services/workflow-manager.js';
import type { AssetRegistry } from '../services/asset-registry.js';
import type { WorkflowNode } from '../comfyui/types.js';
import { info, error as logError } from '../utils/logger.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface WorkflowExecuteDeps {
  comfyClient: ComfyClient;
  workflowManager: WorkflowManager;
  assetRegistry: AssetRegistry;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const TEXT_TYPE = 'text' as const;

// ─── Register Tools ──────────────────────────────────────────────────────────

/**
 * Registra i 4 tool di esecuzione workflow sul server MCP.
 *
 * @param server Istanza McpServer su cui registrare i tool
 * @param deps   Dipendenze iniettate (comfyClient, workflowManager, assetRegistry)
 */
export function registerWorkflowExecuteTools(
  server: McpServer,
  deps: WorkflowExecuteDeps,
): void {
  const { comfyClient } = deps;

  // ─── Tool 1: enqueue_workflow ─────────────────────────────────────────

  server.tool(
    'enqueue_workflow',
    'Submit a workflow JSON to ComfyUI for execution',
    {
      workflow: z.looseObject({}),
      extra_data: z.looseObject({}).optional(),
      description: z.string().optional(),
    },
    async (args) => {
      try {
        // Validazione esplicita (oltre a quella di Zod)
        if (!args.workflow || typeof args.workflow !== 'object' || Array.isArray(args.workflow)) {
          throw new McpError(ErrorCode.InvalidParams, 'workflow must be a non-null object');
        }

        const response = await comfyClient.queuePrompt(
          args.workflow as Record<string, WorkflowNode>,
          args.extra_data,
        );

        info('Workflow enqueued', {
          prompt_id: response.prompt_id,
          number: response.number,
          description: args.description,
        });

        return {
          content: [
            {
              type: TEXT_TYPE,
              text: JSON.stringify({
                prompt_id: response.prompt_id,
                number: response.number,
                node_errors: response.node_errors ?? undefined,
              }),
            },
          ],
        };
      } catch (err) {
        if (err instanceof McpError) throw err;
        logError('Failed to enqueue workflow', {
          error: (err as Error).message,
        });
        throw new McpError(
          ErrorCode.InternalError,
          `Failed to enqueue workflow: ${(err as Error).message}`,
        );
      }
    },
  );

  // ─── Tool 2: get_job_status ───────────────────────────────────────────

  server.tool(
    'get_job_status',
    'Check the status of a workflow job by prompt_id',
    {
      prompt_id: z.string().min(1, { error: 'prompt_id is required' }),
    },
    async (args) => {
      try {
        const history = await comfyClient.getHistory(args.prompt_id);
        const keys = Object.keys(history);

        // History vuota → ancora in coda o non ancora processato
        if (keys.length === 0) {
          return {
            content: [
              {
                type: TEXT_TYPE,
                text: JSON.stringify({ status: 'pending' }),
              },
            ],
          };
        }

        const entry = history[args.prompt_id];
        if (!entry) {
          // Prompt ID non trovato tra le chiavi della history
          return {
            content: [
              {
                type: TEXT_TYPE,
                text: JSON.stringify({ status: 'pending' }),
              },
            ],
          };
        }

        if (entry.status.completed) {
          // Raccogli tutte le immagini dagli output
          const images: Array<{ filename: string; subfolder: string; type: string }> = [];
          for (const outputKey of Object.keys(entry.outputs)) {
            const output = entry.outputs[outputKey];
            if (output.images) {
              for (const img of output.images) {
                images.push({
                  filename: img.filename,
                  subfolder: img.subfolder,
                  type: img.type,
                });
              }
            }
          }

          if (images.length > 0) {
            return {
              content: [
                {
                  type: TEXT_TYPE,
                  text: JSON.stringify({
                    status: 'completed',
                    result: { images },
                  }),
                },
              ],
            };
          }

          // Completato ma senza immagini → cerca errori nei messaggi
          if (entry.status.messages && entry.status.messages.length > 0) {
            const errorMessages = entry.status.messages
              .filter(([msgType]) => msgType === 'error')
              .map(([, data]) => String(data));

            const errorText = errorMessages.length > 0
              ? errorMessages.join('; ')
              : 'Unknown error — job completed with no output images';

            return {
              content: [
                {
                  type: TEXT_TYPE,
                  text: JSON.stringify({
                    status: 'failed',
                    error: errorText,
                  }),
                },
              ],
            };
          }

          return {
            content: [
              {
                type: TEXT_TYPE,
                text: JSON.stringify({
                  status: 'failed',
                  error: 'No output images found',
                }),
              },
            ],
          };
        }

        // In history ma non completato → running (raro via REST)
        return {
          content: [
            {
              type: TEXT_TYPE,
              text: JSON.stringify({
                status: 'running',
              }),
            },
          ],
        };
      } catch (err) {
        // Errore di connessione o HTTP → not_found
        return {
          content: [
            {
              type: TEXT_TYPE,
              text: JSON.stringify({
                status: 'not_found',
                error: (err as Error).message,
              }),
            },
          ],
        };
      }
    },
  );

  // ─── Tool 3: get_queue ────────────────────────────────────────────────

  server.tool(
    'get_queue',
    'Show the current execution queue on ComfyUI',
    {},
    async () => {
      try {
        const queue = await comfyClient.getQueue();

        const running = queue.queue_running.map(([promptId, number]) => ({
          prompt_id: String(promptId),
          number,
        }));

        const pending = queue.queue_pending.map(([promptId, number]) => ({
          prompt_id: String(promptId),
          number,
        }));

        return {
          content: [
            {
              type: TEXT_TYPE,
              text: JSON.stringify({
                running,
                pending,
                queue_size: running.length + pending.length,
              }),
            },
          ],
        };
      } catch (err) {
        logError('Failed to get queue', {
          error: (err as Error).message,
        });
        throw new McpError(
          ErrorCode.InternalError,
          `Failed to get queue: ${(err as Error).message}`,
        );
      }
    },
  );

  // ─── Tool 4: cancel_job ───────────────────────────────────────────────

  server.tool(
    'cancel_job',
    'Cancel a job from the ComfyUI queue by prompt_id',
    {
      prompt_id: z.string().min(1, { error: 'prompt_id is required' }),
    },
    async (args) => {
      try {
        await comfyClient.cancelJob(args.prompt_id);

        info('Job cancelled', {
          prompt_id: args.prompt_id,
        });

        return {
          content: [
            {
              type: TEXT_TYPE,
              text: JSON.stringify({
                cancelled: true,
                message: 'Job cancelled',
              }),
            },
          ],
        };
      } catch (err) {
        if (err instanceof McpError) throw err;
        logError('Failed to cancel job', {
          prompt_id: args.prompt_id,
          error: (err as Error).message,
        });
        throw new McpError(
          ErrorCode.InternalError,
          `Failed to cancel job: ${(err as Error).message}`,
        );
      }
    },
  );
}
