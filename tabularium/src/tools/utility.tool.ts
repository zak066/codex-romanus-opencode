/**
 * tools/utility.tool.ts
 * Tool MCP con funzioni di utilità: health check, info sistema, cache management.
 * Strumenti di manutenzione come la rete idrica di Roma.
 */

import type { ToolHandler, ToolResult } from '../types/mcp.js';
import { invalidateAllCaches, openCodeCache, progressCache, decisionsCache } from '../core/cache.js';
import { validateConfig } from '../core/validator.js';
import { parseOpenCode } from '../core/opencode-parser.js';

export const utilityToolHandler: ToolHandler = {
  name: 'utility',
  description:
    'Strumenti di utilità: health check, info sistema, gestione cache e validazione.',
  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['health', 'info', 'cache-stats', 'clear-cache', 'validate'],
        description: 'Azione da eseguire',
      },
    },
    required: ['action'],
  },

  handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
    const action = String(args.action ?? 'health');

    switch (action) {
      case 'health':
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  status: 'ok',
                  timestamp: new Date().toISOString(),
                  uptime: process.uptime(),
                  nodeVersion: process.version,
                  memoryUsage: process.memoryUsage(),
                },
                null,
                2
              ),
            },
          ],
        };

      case 'info': {
        try {
          const config = await parseOpenCode();
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    project: 'Codex Romanus - Tabularium MCP Server',
                    version: '1.0.0',
                    agents: Object.keys(config.agents).length,
                    models: Object.keys(config.models).length,
                    primaryAgent: config.primaryAgent,
                    workingDirectory: process.cwd(),
                  },
                  null,
                  2
                ),
              },
            ],
          };
        } catch {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({ error: 'Could not read opencode.json' }, null, 2),
              },
            ],
            isError: true,
          };
        }
      }

      case 'cache-stats':
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  openCodeCache: openCodeCache.getStats(),
                  progressCache: progressCache.getStats(),
                  decisionsCache: decisionsCache.getStats(),
                },
                null,
                2
              ),
            },
          ],
        };

      case 'clear-cache':
        invalidateAllCaches();
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ message: 'All caches cleared', timestamp: new Date().toISOString() }),
            },
          ],
        };

      case 'validate': {
        const errors = await validateConfig();
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  valid: errors.length === 0,
                  errorCount: errors.length,
                  errors,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      default:
        return {
          content: [{ type: 'text', text: `Unknown action: ${action}` }],
          isError: true,
        };
    }
  },
};


// ---------------------------------------------------------------------------
// db_maintenance Tool
// ---------------------------------------------------------------------------

export const dbMaintenanceTool: ToolHandler = {
  name: 'db_maintenance',
  description: 'Manutenzione database SQLite: integrity check, WAL checkpoint, FTS rebuild, VACUUM, ANALYZE',
  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['check', 'vacuum', 'checkpoint', 'fts_rebuild', 'optimize'],
        description: 'Azione di manutenzione da eseguire',
      },
    },
    required: ['action'],
  },
  handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
    const action = String(args.action ?? '');

    try {
      const { getDatabase, runDatabaseHealthCheck } = await import('../core/database.js');

      switch (action) {
        case 'check': {
          const health = runDatabaseHealthCheck();
          return {
            content: [{ type: 'text', text: JSON.stringify({ success: true, data: health }, null, 2) }],
          };
        }

        case 'vacuum': {
          const db = getDatabase();
          db.exec('VACUUM');
          return {
            content: [{ type: 'text', text: JSON.stringify({ success: true, data: { action: 'vacuum', message: 'VACUUM completed successfully' } }, null, 2) }],
          };
        }

        case 'checkpoint': {
          const db = getDatabase();
          const result = db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get();
          return {
            content: [{ type: 'text', text: JSON.stringify({ success: true, data: { action: 'checkpoint', result } }, null, 2) }],
          };
        }

        case 'fts_rebuild': {
          const db = getDatabase();
          db.exec("INSERT INTO knowledge_fts(knowledge_fts) VALUES('rebuild')");
          return {
            content: [{ type: 'text', text: JSON.stringify({ success: true, data: { action: 'fts_rebuild', message: 'FTS index rebuilt successfully' } }, null, 2) }],
          };
        }

        case 'optimize': {
          const db = getDatabase();
          db.exec('PRAGMA optimize');
          return {
            content: [{ type: 'text', text: JSON.stringify({ success: true, data: { action: 'optimize', message: 'PRAGMA optimize completed' } }, null, 2) }],
          };
        }

        default:
          return {
            content: [{ type: 'text', text: `Unknown action: ${action}. Valid: check, vacuum, checkpoint, fts_rebuild, optimize` }],
            isError: true,
          };
      }
    } catch (error) {
      return {
        content: [{ type: 'text', text: `db_maintenance failed: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      };
    }
  },
};
