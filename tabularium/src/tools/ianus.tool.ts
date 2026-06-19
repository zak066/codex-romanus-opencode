/**
 * tools/ianus.tool.ts
 * Tool MCP per l'importazione del journal di Ianus Liminalis
 * nel database Tabularium.
 *
 * Legge il file JSONL prodotto da Ianus, mappa ogni operazione
 * in una entry file_changes, deduplica e inserisce nel database.
 *
 * @module tools/ianus
 */

import type { ToolHandler, ToolResult } from '../types/mcp.js';
import { getDatabase } from '../core/database.js';
import { ingestIanusJournal } from '../core/ianus-ingest.js';
import { resolve } from 'node:path';

// ---------------------------------------------------------------------------
// Tool Handler
// ---------------------------------------------------------------------------

export const ianusIngestToolHandler: ToolHandler = {
  name: 'ianus_ingest',
  description:
    "Importa le entry del journal di Ianus Liminalis nel database Tabularium. " +
    "Legge il file JSONL da ../ianus-liminalis/.ianus-journal/journal.jsonl, " +
    "mappa le operazioni (write, edit, delete, backup, rollback) in entry " +
    "file_changes, deduplica tramite ianus_ingest_tracker e le inserisce " +
    "nel database. Supporta filtro temporale (since), limite (limit) e " +
    "modalità dry-run (dryRun) per simulare senza scrivere.",
  inputSchema: {
    type: 'object',
    properties: {
      limit: {
        type: 'number',
        description:
          'Numero massimo di entry da importare (default: 100, max: 1000)',
      },
      since: {
        type: 'string',
        description:
          'ISO timestamp — importa solo entry con timestamp >= a questo valore. ' +
          'Esempi: "2026-01-01T00:00:00.000Z", "2026-05-01"',
      },
      dryRun: {
        type: 'boolean',
        description:
          'Se true, simula l\'importazione leggendo e parsando il journal ' +
          'senza scrivere alcun dato nel database (default: false)',
      },
    },
  },

  handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
    try {
      // ── 1. Parse args con default ──────────────────────────────────────
      const limit = args.limit !== undefined ? Number(args.limit) : 100;
      const since = args.since ? String(args.since) : undefined;
      const dryRun = args.dryRun === true;

      if (Number.isNaN(limit) || limit < 1) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                { success: false, error: 'limit must be a positive number' },
                null,
                2,
              ),
            },
          ],
          isError: true,
        };
      }

      const effectiveLimit = Math.min(limit, 1000);

      // ── 2. Get DB ──────────────────────────────────────────────────────
      const db = getDatabase();

      // ── 3. Risolvi percorso del journal Ianus ──────────────────────────
      // Tabularium gira da tabularium/, il journal Ianus è in
      // ../ianus-liminalis/.ianus-journal/journal.jsonl
      const journalPath = resolve(
        process.cwd(),
        '..',
        'ianus-liminalis',
        '.ianus-journal',
        'journal.jsonl',
      );

      // ── 4. Esegui l'ingestion ──────────────────────────────────────────
      const result = await ingestIanusJournal(db, journalPath, {
        limit: effectiveLimit,
        since,
        dryRun,
      });

      // ── 5. Costruisci risposta ─────────────────────────────────────────
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                data: result,
              },
              null,
              2,
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
                error: `ianus_ingest failed: ${error instanceof Error ? error.message : String(error)}`,
              },
              null,
              2,
            ),
          },
        ],
        isError: true,
      };
    }
  },
};
