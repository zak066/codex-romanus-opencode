/**
 * tools/config-history.tool.ts
 * Tool MCP per lo storico delle modifiche alla configurazione.
 *
 * Interroga la tabella config_changelog per restituire la cronologia
 * delle modifiche alle configurazioni, con supporto per filtri per
 * chiave e paginazione.
 *
 * @module tools/config-history
 */

import type { ToolHandler, ToolResult } from '../types/mcp.js';
import { getDatabase } from '../core/database.js';

// ---------------------------------------------------------------------------
// Tool: tabularium_config_history
// ---------------------------------------------------------------------------

export const configHistoryToolHandler: ToolHandler = {
  name: 'tabularium_config_history',
  description:
    'Storico delle modifiche alla configurazione Tabularium. ' +
    "Interroga la tabella config_changelog per restituire la cronologia " +
    "delle modifiche, con filtri per chiave specifica e paginazione. " +
    "Ogni entry mostra il valore precedente, il nuovo valore e il timestamp.",
  inputSchema: {
    type: 'object',
    properties: {
      key: {
        type: 'string',
        description:
          'Filtra per chiave di configurazione specifica. ' +
          'Esempio: "log_level", "db_path". Default: tutte le chiavi.',
      },
      limit: {
        type: 'number',
        description: 'Numero massimo di risultati (default: 50, max: 500)',
      },
    },
  },

  handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
    try {
      // Validazione parametri
      const key = args.key && typeof args.key === 'string'
        ? args.key.trim()
        : null;

      const rawLimit = args.limit != null ? Number(args.limit) : 50;
      const limit = Math.max(1, Math.min(500, Number.isFinite(rawLimit) ? Math.floor(rawLimit) : 50));

      // Accedi al database
      let db;
      try {
        db = getDatabase();
      } catch {
        return errorResult('Database not initialized. Call initDatabase() first.');
      }

      // Assicura che le tabelle esistano
      try {
        db.exec(`
          CREATE TABLE IF NOT EXISTS config_changelog (
            id          TEXT PRIMARY KEY,
            cfg_key     TEXT NOT NULL,
            old_value   TEXT,
            new_value   TEXT,
            changed_at  TEXT NOT NULL DEFAULT (datetime('now'))
          )
        `);
        db.exec(`
          CREATE TABLE IF NOT EXISTS config_snapshots (
            id          TEXT PRIMARY KEY,
            cfg_key     TEXT NOT NULL,
            cfg_value   TEXT NOT NULL,
            created_at  TEXT NOT NULL DEFAULT (datetime('now')),
            UNIQUE(cfg_key)
          )
        `);
      } catch {
        // Tabelle già esistenti
      }

      // Costruisci WHERE
      const whereClauses: string[] = [];
      const params: unknown[] = [];

      if (key) {
        whereClauses.push('cfg_key = ?');
        params.push(key);
      }

      const whereSQL = whereClauses.length > 0
        ? 'WHERE ' + whereClauses.join(' AND ')
        : '';

      // Count totale
      const countRow = db.prepare(
        `SELECT COUNT(*) as total FROM config_changelog ${whereSQL}`
      ).get(...params) as { total: number };
      const total = countRow.total;

      // Query paginata
      const rows = db.prepare(`
        SELECT id, cfg_key, old_value, new_value, changed_at
        FROM config_changelog
        ${whereSQL}
        ORDER BY changed_at DESC
        LIMIT ?
      `).all(...params, limit) as Array<Record<string, unknown>>;

      // Formatta risultati
      const entries = rows.map((row) => ({
        id: row.id,
        key: row.cfg_key,
        oldValue: tryParseJson(String(row.old_value ?? '')),
        newValue: tryParseJson(String(row.new_value ?? '')),
        changedAt: row.changed_at,
        hasDiff: row.old_value !== null && row.old_value !== row.new_value,
      }));

      // Recupera valori correnti
      let currentSnapshots: Array<Record<string, unknown>> = [];
      try {
        if (key) {
          currentSnapshots = db.prepare(
            'SELECT cfg_key, cfg_value, created_at FROM config_snapshots WHERE cfg_key = ?'
          ).all(key) as Array<Record<string, unknown>>;
        } else {
          currentSnapshots = db.prepare(
            'SELECT cfg_key, cfg_value, created_at FROM config_snapshots ORDER BY cfg_key'
          ).all() as Array<Record<string, unknown>>;
        }
      } catch {
        // Tabella non ancora creata
      }

      const current = currentSnapshots.map((row) => ({
        key: row.cfg_key,
        value: tryParseJson(String(row.cfg_value ?? '')),
        updatedAt: row.created_at,
      }));

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
                  returned: entries.length,
                  entries,
                  currentValues: current,
                  filters: {
                    key: key ?? 'all',
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
                error: 'CONFIG_HISTORY_ERROR',
                message: `tabularium_config_history failed: ${error instanceof Error ? error.message : String(error)}`,
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
