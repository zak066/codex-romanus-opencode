/**
 * tools/cache-warmup.tool.ts
 * Tool MCP per il Cache Warmup System (Task C5 — ADR-006).
 *
 * Espone il tool:
 * - cache_warmup: esegue warmup, ne mostra lo stato e gestisce lo scheduler
 *
 * Azioni supportate:
 *   - status    → report dell'ultimo warmup + elenco task registrati + stato scheduler
 *   - run       → esegue warmupAll()
 *   - run_tag   → esegue warmupByTag(tag)
 *   - run_single → esegue warmupSingle(name)
 *   - schedule  → avvia/ferma lo scheduler periodico
 *
 * Stesso pattern di warmup.tool.ts, journal.tool.ts, task.tool.ts:
 *   - Validazione input
 *   - Try/catch con messaggi di errore strutturati
 *   - Risultati in JSON formattato
 *
 * @module tools/cache-warmup
 */

import type { ToolHandler, ToolResult } from '../types/mcp.js';
import { cacheWarmup, registerDefaultWarmupTasks, WarmupStatus } from '../core/cache-warmup.js';

// ---------------------------------------------------------------------------
// Tool: cache_warmup
// ---------------------------------------------------------------------------

export const cacheWarmupToolHandler: ToolHandler = {
  name: 'cache_warmup',
  description:
    'Gestisce il preriscaldamento delle cache. Azioni: status (report corrente), run (esegue tutti i task), run_tag (per tag), run_single (task specifico), schedule (avvia/ferma scheduler periodico).',
  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['status', 'run', 'run_tag', 'run_single', 'schedule'],
        description:
          "Azione da eseguire: status (report), run (warmupAll), run_tag (warmupByTag), run_single (warmupSingle), schedule (start/stop scheduler)",
      },
      tag: {
        type: 'string',
        description: "Tag per filtrare i task (per action=run_tag, es. 'startup', 'periodic')",
      },
      name: {
        type: 'string',
        description: "Nome del task singolo da eseguire (per action=run_single)",
      },
      schedule_action: {
        type: 'string',
        enum: ['start', 'stop'],
        description: "Azione scheduler: start (avvia), stop (ferma) — per action=schedule",
      },
      interval_ms: {
        type: 'number',
        description: 'Intervallo in ms per lo scheduler (default: 300000 = 5 min, solo per schedule_action=start)',
      },
    },
    required: ['action'],
  },

  handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
    const action = String(args.action ?? 'status');

    try {
      switch (action) {
        // ── status ──────────────────────────────────────────────────────
        case 'status': {
          const report = cacheWarmup.getReport();

          // Elenca i task registrati con i loro dettagli
          const registeredTasks = [
            { name: 'decisions-warmup', tags: ['startup', 'periodic'], priority: 80 },
            { name: 'scorecard-warmup', tags: ['startup', 'periodic'], priority: 70 },
            { name: 'agent-status-warmup', tags: ['startup', 'periodic'], priority: 60 },
            { name: 'sessions-warmup', tags: ['startup'], priority: 50 },
            { name: 'knowledge-warmup', tags: ['startup'], priority: 40 },
          ];

          const actualTaskCount = cacheWarmup.taskCount;

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    success: true,
                    data: {
                      scheduler: {
                        active: cacheWarmup.isSchedulerActive,
                      },
                      lastReport: report,
                      tasks: {
                        registered: actualTaskCount,
                        known: registeredTasks,
                      },
                    },
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        // ── run ─────────────────────────────────────────────────────────
        case 'run': {
          // Assicura che i task di default siano registrati
          registerDefaultWarmupTasks();

          const report = await cacheWarmup.warmupAll();

          const icon = report.failed === 0 ? '✅' : report.completed > 0 ? '⚠️' : '❌';

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    success: true,
                    data: {
                      icon,
                      message: `Warmup completato: ${report.completed} completati, ${report.failed} falliti, ${report.skipped} saltati in ${report.totalDuration}ms`,
                      report,
                    },
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        // ── run_tag ─────────────────────────────────────────────────────
        case 'run_tag': {
          const tag = String(args.tag ?? '').trim();
          if (!tag) {
            return {
              content: [{ type: 'text', text: 'Error: parameter "tag" is required for action=run_tag' }],
              isError: true,
            };
          }

          registerDefaultWarmupTasks();
          const report = await cacheWarmup.warmupByTag(tag);

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    success: true,
                    data: {
                      tag,
                      message: `Warmup per tag '${tag}': ${report.completed} completati, ${report.failed} falliti, ${report.skipped} saltati`,
                      report,
                    },
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        // ── run_single ──────────────────────────────────────────────────
        case 'run_single': {
          const name = String(args.name ?? '').trim();
          if (!name) {
            return {
              content: [{ type: 'text', text: 'Error: parameter "name" is required for action=run_single' }],
              isError: true,
            };
          }

          registerDefaultWarmupTasks();
          const result = await cacheWarmup.warmupSingle(name);

          const icon = result.status === WarmupStatus.COMPLETED ? '✅' : result.status === WarmupStatus.FAILED ? '❌' : '⏭️';

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    success: result.status !== WarmupStatus.SKIPPED,
                    data: {
                      icon,
                      message: `Task '${name}': ${result.status} (${result.duration}ms)`,
                      result,
                    },
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        // ── schedule ────────────────────────────────────────────────────
        case 'schedule': {
          const scheduleAction = String(args.schedule_action ?? '').trim();

          if (scheduleAction === 'start') {
            const intervalMs = Number(args.interval_ms ?? 300_000);
            if (Number.isNaN(intervalMs) || intervalMs < 10_000) {
              return {
                content: [
                  {
                    type: 'text',
                    text: 'Error: interval_ms must be a number >= 10000 (10 seconds)',
                  },
                ],
                isError: true,
              };
            }

            registerDefaultWarmupTasks();
            cacheWarmup.startScheduler(intervalMs);

            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(
                    {
                      success: true,
                      data: {
                        message: `Scheduler avviato con intervallo di ${intervalMs}ms (${Math.round(intervalMs / 1000)}s)`,
                        scheduler: {
                          active: true,
                          intervalMs,
                        },
                      },
                    },
                    null,
                    2
                  ),
                },
              ],
            };
          }

          if (scheduleAction === 'stop') {
            cacheWarmup.stopScheduler();

            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(
                    {
                      success: true,
                      data: {
                        message: 'Scheduler fermato',
                        scheduler: {
                          active: false,
                        },
                      },
                    },
                    null,
                    2
                  ),
                },
              ],
            };
          }

          return {
            content: [
              {
                type: 'text',
                text: `Error: schedule_action must be 'start' or 'stop', got '${scheduleAction}'`,
              },
            ],
            isError: true,
          };
        }

        // ── default ─────────────────────────────────────────────────────
        default:
          return {
            content: [{ type: 'text', text: `Unknown action: ${action}. Valid actions: status, run, run_tag, run_single, schedule` }],
            isError: true,
          };
      }
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: false,
                error: 'CACHE_WARMUP_ERROR',
                message: `Cache warmup failed: ${error instanceof Error ? error.message : String(error)}`,
              },
              null,
              2
            ),
          },
        ],
        isError: true,
      };
    }
  },
};
