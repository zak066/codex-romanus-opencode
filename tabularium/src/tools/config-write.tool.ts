/**
 * tools/config-write.tool.ts
 * Tool MCP per scrivere configurazione Tabularium con snapshot.
 *
 * Scrive una coppia chiave-valore nella tabella config_snapshots del DB,
 * creando automaticamente uno snapshot della configurazione e un changelog.
 *
 * @module tools/config-write
 */

import type { ToolHandler, ToolResult } from '../types/mcp.js';
import { getDatabase } from '../core/database.js';
import crypto from 'node:crypto';

// ---------------------------------------------------------------------------
// Tool: config_write
// ---------------------------------------------------------------------------

export const configWriteToolHandler: ToolHandler = {
  name: 'config_write',
  description:
    "Scrive configurazione Tabularium con snapshot. " +
    "Salva una coppia key-value nella tabella config_snapshots del database " +
    "con timestamp e crea un changelog della modifica.",
  inputSchema: {
    type: 'object',
    properties: {
      key: {
        type: 'string',
        description: 'Chiave della configurazione da salvare',
      },
      value: {
        description: 'Valore della configurazione (stringa, numero, booleano, array o oggetto)',
      },
    },
    required: ['key', 'value'],
  },

  handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
    // Validazione key
    if (!args.key || typeof args.key !== 'string' || args.key.trim().length === 0) {
      return errorResult('key is required and must be a non-empty string');
    }

    // value può essere qualsiasi cosa, ma validiamo che esista
    if (args.value === undefined || args.value === null) {
      return errorResult('value is required');
    }

    try {
      const db = getDatabase();

      const key = String(args.key).trim();
      const value = args.value;
      const now = new Date().toISOString();
      const snapshotId = `cfg_${crypto.randomUUID()}`;

      // Assicura che la tabella config_snapshots esista
      db.exec(`
        CREATE TABLE IF NOT EXISTS config_snapshots (
          id          TEXT PRIMARY KEY,
          cfg_key     TEXT NOT NULL,
          cfg_value   TEXT NOT NULL,
          created_at  TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE(cfg_key)
        )
      `);

      // Assicura che la tabella config_changelog esista
      db.exec(`
        CREATE TABLE IF NOT EXISTS config_changelog (
          id          TEXT PRIMARY KEY,
          cfg_key     TEXT NOT NULL,
          old_value   TEXT,
          new_value   TEXT,
          changed_at  TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `);

      // Leggi il valore precedente
      let oldValue: string | null = null;
      try {
        const existing = db.prepare('SELECT cfg_value FROM config_snapshots WHERE cfg_key = ?').get(key) as { cfg_value: string } | undefined;
        if (existing) {
          oldValue = existing.cfg_value;
        }
      } catch {
        // Tabella appena creata o errore
      }

      // Serializza il valore in JSON
      const serializedValue = typeof value === 'string' ? value : JSON.stringify(value);

      // UPSERT: inserisce o aggiorna
      db.prepare(`
        INSERT INTO config_snapshots (id, cfg_key, cfg_value, created_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(cfg_key) DO UPDATE SET
          cfg_value = excluded.cfg_value,
          created_at = excluded.created_at
      `).run(snapshotId, key, serializedValue, now);

      // Crea changelog
      const changelogId = `cl_${crypto.randomUUID()}`;
      db.prepare(`
        INSERT INTO config_changelog (id, cfg_key, old_value, new_value, changed_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(changelogId, key, oldValue, serializedValue, now);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                data: {
                  key,
                  value: typeof value === 'string' ? value : '<structured>',
                  previousValue: oldValue ?? null,
                  snapshotId,
                  changelogId,
                  updatedAt: now,
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
                error: 'CONFIG_WRITE_ERROR',
                message: `config_write failed: ${error instanceof Error ? error.message : String(error)}`,
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
