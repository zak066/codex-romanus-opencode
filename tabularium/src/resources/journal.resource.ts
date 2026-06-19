/**
 * resources/journal.resource.ts
 * Resource MCP per il File Change Journal (FABRICA — Fase 7.2).
 *
 * URI supportati:
 *   tabularium://journal/file/{filePath}?limit=10   — cronologia per file
 *   tabularium://journal/recent?limit=20             — ultime modifiche
 *
 * @module resources/journal
 */

import type { ResourceContent, ResourceHandler } from '../types/mcp.js';
import {
  getChangesByFile,
  getRecentChanges,
  queryChanges,
  ensureFileJournalSchema,
} from '../core/file-journal.js';

// ---------------------------------------------------------------------------
// Costanti
// ---------------------------------------------------------------------------

/** URI base per navigazione */
const BASE_URI = 'tabularium://journal';

/** Pattern per cronologia file: tabularium://journal/file/{filePath} */
const FILE_URI_PATTERN = /^tabularium:\/\/journal\/file\/(.+?)(?:\?(.+))?$/;

/** Pattern per recenti: tabularium://journal/recent */
const RECENT_URI_PATTERN = /^tabularium:\/\/journal\/recent(?:\?(.+))?$/;

// ---------------------------------------------------------------------------
// Resource Handler (panoramica)
// ---------------------------------------------------------------------------

/**
 * Handler che restituisce una panoramica della resource journal,
 * inclusi URI di esempio e parametri supportati.
 */
export const journalResourceHandler: ResourceHandler = {
  uri: BASE_URI,
  name: 'File Change Journal',
  description: 'Tracciamento delle modifiche ai file del progetto',
  mimeType: 'application/json',

  handler: async (): Promise<ResourceContent[]> => {
    try {
      // Verifica che il database sia accessibile
      try {
        ensureFileJournalSchema();
      } catch {
        return [
          {
            uri: BASE_URI,
            mimeType: 'application/json',
            text: JSON.stringify({
              status: 'not_initialized',
              message: 'Journal database not initialized. Schema unavailable.',
            }),
          },
        ];
      }

      // Ultime 5 modifiche come antipasto
      const recent = getRecentChanges(5);

      return [
        {
          uri: BASE_URI,
          mimeType: 'application/json',
          text: JSON.stringify(
            {
              uri: BASE_URI,
              description: 'File Change Journal — traccia ogni modifica ai file del progetto',
              total_tracked: recent.length,
              recent_changes: recent,
              usage: {
                examples: [
                  `${BASE_URI}/file/src/server.ts`,
                  `${BASE_URI}/file/src/server.ts?limit=20`,
                  `${BASE_URI}/recent`,
                  `${BASE_URI}/recent?limit=50`,
                ],
                parameters: {
                  limit: { type: 'integer', default: 10, description: 'Numero massimo di risultati' },
                },
              },
            },
            null,
            2
          ),
        },
      ];
    } catch (error) {
      return [
        {
          uri: BASE_URI,
          mimeType: 'application/json',
          text: JSON.stringify({
            status: 'error',
            message: `Journal read failed: ${error instanceof Error ? error.message : String(error)}`,
          }),
        },
      ];
    }
  },
};

// ---------------------------------------------------------------------------
// URI Resolution
// ---------------------------------------------------------------------------

/**
 * Risolve un URI specifico del journal e restituisce il risultato.
 * Chiamato dal router centrale quando l'URI inizia con tabularium://journal.
 *
 * URI supportati:
 *   tabularium://journal                          → panoramica
 *   tabularium://journal/file/{filePath}          → cronologia per file
 *   tabularium://journal/file/{filePath}?limit=20 → cronologia con limite
 *   tabularium://journal/recent                   → ultime modifiche
 *   tabularium://journal/recent?limit=50          → ultime N modifiche
 *
 * @param uri - URI completo da risolvere
 * @returns Array di ResourceContent
 */
export async function resolveJournalUri(uri: string): Promise<ResourceContent[]> {
  // Assicura che lo schema esista
  try {
    ensureFileJournalSchema();
  } catch {
    return [
      {
        uri,
        mimeType: 'application/json',
        text: JSON.stringify({ error: 'Database not initialized. Cannot read journal.' }),
      },
    ];
  }

  // ── Cronologia per file ────────────────────
  const fileMatch = uri.match(FILE_URI_PATTERN);
  if (fileMatch) {
    const filePath = decodeURIComponent(fileMatch[1]);
    const queryString = fileMatch[2];
    const params = parseQueryString(queryString ?? '');
    const limit = params.limit ? parseInt(params.limit as string, 10) : 10;

    try {
      const changes = getChangesByFile(filePath, limit);

      return [
        {
          uri,
          mimeType: 'application/json',
          text: JSON.stringify(
            {
              file_path: filePath,
              total: changes.length,
              changes,
            },
            null,
            2
          ),
        },
      ];
    } catch (error) {
      return [
        {
          uri,
          mimeType: 'application/json',
          text: JSON.stringify({
            error: `Failed to read journal for file '${filePath}': ${error instanceof Error ? error.message : String(error)}`,
          }),
        },
      ];
    }
  }

  // ── Ultime modifiche ───────────────────────
  const recentMatch = uri.match(RECENT_URI_PATTERN);
  if (recentMatch) {
    const queryString = recentMatch[1];
    const params = parseQueryString(queryString ?? '');
    const limit = params.limit ? parseInt(params.limit as string, 10) : 20;

    try {
      const changes = getRecentChanges(limit);

      return [
        {
          uri,
          mimeType: 'application/json',
          text: JSON.stringify(
            {
              recent: true,
              total: changes.length,
              changes,
            },
            null,
            2
          ),
        },
      ];
    } catch (error) {
      return [
        {
          uri,
          mimeType: 'application/json',
          text: JSON.stringify({
            error: `Failed to read recent journal entries: ${error instanceof Error ? error.message : String(error)}`,
          }),
        },
      ];
    }
  }

  // ── Fallback: panoramica ───────────────────
  return journalResourceHandler.handler();
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

/**
 * Parser semplice di query string.
 * Converte "?limit=20" in { limit: '20' }
 */
function parseQueryString(queryString: string): Record<string, string> {
  const params: Record<string, string> = {};

  if (!queryString) return params;

  // Rimuovi eventuale ? iniziale
  const qs = queryString.startsWith('?') ? queryString.substring(1) : queryString;

  for (const part of qs.split('&')) {
    const [key, value] = part.split('=');
    if (key && value) {
      try {
        params[decodeURIComponent(key)] = decodeURIComponent(value);
      } catch {
        params[key] = value;
      }
    }
  }

  return params;
}
