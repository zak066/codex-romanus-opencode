/**
 * tools/db-health.tool.ts
 * Tool MCP per health check completo del database SQLite.
 *
 * Esegue integrity_check, misura dimensione WAL/DB, verifica FTS,
 * conta entry knowledge e fornisce raccomandazioni.
 *
 * @module tools/db-health
 */

import type { ToolHandler, ToolResult } from '../types/mcp.js';

// ---------------------------------------------------------------------------
// Tool: db_health
// ---------------------------------------------------------------------------

export const dbHealthToolHandler: ToolHandler = {
  name: 'db_health',
  description:
    'Health check completo del database SQLite. ' +
    'Esegue integrity_check, WAL checkpoint check, verifica dimensione ' +
    'e connettività. Non richiede parametri.',
  inputSchema: {
    type: 'object',
    properties: {},
  },

  handler: async (): Promise<ToolResult> => {
    try {
      const { getDatabase, runDatabaseHealthCheck, getDbPath } = await import('../core/database.js');

      // Test connessione
      let connected = false;
      let dbPath = '';

      try {
        const db = getDatabase();
        connected = true;
        dbPath = getDbPath();
      } catch {
        // Database non ancora inizializzato
      }

      // Health check
      let health;
      try {
        health = runDatabaseHealthCheck();
      } catch (err) {
        health = {
          error: err instanceof Error ? err.message : String(err),
        };
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                data: {
                  connected,
                  dbPath,
                  health,
                  timestamp: new Date().toISOString(),
                },
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: false,
                error: 'DB_HEALTH_ERROR',
                message: `db_health failed: ${error instanceof Error ? error.message : String(error)}`,
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
