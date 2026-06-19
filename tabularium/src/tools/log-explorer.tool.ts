/**
 * tools/log-explorer.tool.ts
 * Tool MCP per esplorazione log eventi con filtri e paginazione.
 *
 * Interroga la tabella event_log (migrazione 019) con filtri per
 * livello/type, intervallo temporale, e paginazione.
 * Supporta anche la tabella file_changes come fonte secondaria.
 *
 * @module tools/log-explorer
 */

import type { ToolHandler, ToolResult } from '../types/mcp.js';
import { getDatabase } from '../core/database.js';

// ---------------------------------------------------------------------------
// Tool: tabularium_log_explorer
// ---------------------------------------------------------------------------

export const logExplorerToolHandler: ToolHandler = {
  name: 'tabularium_log_explorer',
  description:
    'Esplorazione log eventi Tabularium con filtri e paginazione. ' +
    'Interroga la tabella event_log con supporto per filtri per ' +
    'tipo evento (level), intervallo temporale (from/to). ' +
    'I risultati sono ordinati per timestamp decrescente.',
  inputSchema: {
    type: 'object',
    properties: {
      level: {
        type: 'string',
        description:
          'Filtra per tipo evento (event_type). ' +
          'Esempi: "task_completed", "tool_called", "error", "warning", "info".',
      },
      from: {
        type: 'string',
        description:
          'Data/ora inizio intervallo in formato ISO 8601. ' +
          'Esempio: "2026-06-01T00:00:00.000Z". Default: 7 giorni fa.',
      },
      to: {
        type: 'string',
        description:
          'Data/ora fine intervallo in formato ISO 8601. ' +
          'Esempio: "2026-06-16T23:59:59.000Z". Default: ora corrente.',
      },
      limit: {
        type: 'number',
        description: 'Numero massimo di risultati (default: 50, max: 500)',
      },
      offset: {
        type: 'number',
        description: 'Offset per paginazione (default: 0)',
      },
    },
  },

  handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
    try {
      // Validazione parametri
      const level = args.level && typeof args.level === 'string'
        ? args.level.trim()
        : null;

      const from = args.from && typeof args.from === 'string'
        ? args.from.trim()
        : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

      const to = args.to && typeof args.to === 'string'
        ? args.to.trim()
        : new Date().toISOString();

      const rawLimit = args.limit != null ? Number(args.limit) : 50;
      const limit = Math.max(1, Math.min(500, Number.isFinite(rawLimit) ? Math.floor(rawLimit) : 50));

      const rawOffset = args.offset != null ? Number(args.offset) : 0;
      const offset = Math.max(0, Number.isFinite(rawOffset) ? Math.floor(rawOffset) : 0);

      // Accedi al database
      let db;
      try {
        db = getDatabase();
      } catch {
        return errorResult('Database not initialized. Call initDatabase() first.');
      }

      // Assicura che la tabella event_log esista
      try {
        db.exec(`
          CREATE TABLE IF NOT EXISTS event_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            event_type TEXT NOT NULL,
            payload TEXT NOT NULL DEFAULT '{}',
            channel_id TEXT,
            agent_name TEXT,
            event_timestamp TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
          )
        `);
      } catch {
        // Tabella già esistente
      }

      // Costruisci WHERE dinamico
      const whereClauses: string[] = [];
      const params: unknown[] = [];

      if (level) {
        whereClauses.push('event_type = ?');
        params.push(level);
      }

      whereClauses.push('event_timestamp >= ?');
      params.push(from);

      whereClauses.push('event_timestamp <= ?');
      params.push(to);

      const whereSQL = whereClauses.length > 0
        ? 'WHERE ' + whereClauses.join(' AND ')
        : '';

      // Count totale
      const countRow = db.prepare(
        `SELECT COUNT(*) as total FROM event_log ${whereSQL}`
      ).get(...params) as { total: number };
      const total = countRow.total;

      // Query paginata
      const rows = db.prepare(`
        SELECT id, event_type, payload, channel_id, agent_name,
               event_timestamp, created_at
        FROM event_log
        ${whereSQL}
        ORDER BY event_timestamp DESC
        LIMIT ? OFFSET ?
      `).all(...params, limit, offset) as Array<Record<string, unknown>>;

      // Formatta risultati
      const entries = rows.map((row) => ({
        id: row.id,
        event_type: row.event_type,
        payload: tryParseJson(String(row.payload ?? '{}')),
        channel_id: row.channel_id ?? null,
        agent_name: row.agent_name ?? null,
        event_timestamp: row.event_timestamp,
        created_at: row.created_at,
      }));

      // Calcola statistiche veloci
      const types = new Map<string, number>();
      for (const entry of entries) {
        const t = String(entry.event_type);
        types.set(t, (types.get(t) ?? 0) + 1);
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                data: {
                  total,
                  limit,
                  offset,
                  returned: entries.length,
                  entries,
                  typeBreakdown: Object.fromEntries(types),
                  filters: {
                    level: level ?? 'all',
                    from,
                    to,
                  },
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
                error: 'LOG_EXPLORER_ERROR',
                message: `tabularium_log_explorer failed: ${error instanceof Error ? error.message : String(error)}`,
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Tenta il parsing JSON di una stringa.
 * Se fallisce, restituisce la stringa originale.
 */
function tryParseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

/**
 * Crea un ToolResult di errore.
 */
function errorResult(message: string): ToolResult {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          {
            success: false,
            error: 'VALIDATION_ERROR',
            message,
          },
          null,
          2
        ),
      },
    ],
    isError: true,
  };
}
