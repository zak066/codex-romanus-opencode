/**
 * resources/doc-freshness.resource.ts
 * Resource MCP per l'analisi della freschezza della documentazione.
 * Confronta i file .md in docs/ con i file .ts in src/ e produce un report
 * completo con punteggi, stato e statistiche.
 *
 * URI: tabularium://project/docs
 *
 * Query parameters supportati:
 *   - coverage=true   Restituisce solo le metriche aggregate (no entries)
 *   - status=fresh|stale|missing  Filtra per stato
 *   - minScore=N      Filtra per punteggio minimo (0-100)
 *
 * @module resources/doc-freshness
 */

import type { ResourceContent, ResourceHandler } from '../types/mcp.js';
import { analyzeDocFreshness } from '../core/doc-freshness.js';
import type { DocStatus } from '../core/doc-freshness.js';

// ---------------------------------------------------------------------------
// Costanti
// ---------------------------------------------------------------------------

const BASE_URI = 'tabularium://project/docs';

/**
 * Pattern per l'URI con query string opzionale.
 * tabularium://project/docs
 * tabularium://project/docs?coverage=true
 * tabularium://project/docs?status=fresh
 */
const URI_PATTERN = /^tabularium:\/\/project\/docs(?:\?(.+))?$/;

// ---------------------------------------------------------------------------
// Resource Handler (panoramica / senza parametri)
// ---------------------------------------------------------------------------

/**
 * Resource handler per la freschezza dei documenti.
 * Il handler base restituisce il report completo.
 */
export const docFreshnessResourceHandler: ResourceHandler = {
  uri: BASE_URI,
  name: 'Doc Freshness',
  description:
    'Report di freschezza della documentazione: confronta i .md in docs/ con i .ts in src/, calcola punteggi e rileva documentazione mancante o obsoleta.',
  mimeType: 'application/json',

  handler: async (): Promise<ResourceContent[]> => {
    try {
      const report = analyzeDocFreshness();
      return [
        {
          uri: BASE_URI,
          mimeType: 'application/json',
          text: JSON.stringify(report, null, 2),
        },
      ];
    } catch (error) {
      return [
        {
          uri: BASE_URI,
          mimeType: 'application/json',
          text: JSON.stringify({
            error: true,
            message:
              error instanceof Error ? error.message : String(error),
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
 * Risolve un URI specifico nell'albero tabularium://project/docs.
 * Chiamato dal router centrale quando l'URI inizia con
 * tabularium://project/docs.
 *
 * Supporta i parametri query:
 *   - coverage=true   → solo metriche aggregate
 *   - status=...      → filtra per stato
 *   - minScore=...    → filtra per punteggio minimo
 *
 * @param uri - URI completo da risolvere
 * @returns Array di ResourceContent
 */
export async function resolveDocFreshnessUri(
  uri: string
): Promise<ResourceContent[]> {
  const match = uri.match(URI_PATTERN);
  if (!match) {
    // URI non riconosciuto, restituisci il report completo
    return docFreshnessResourceHandler.handler();
  }

  try {
    const report = analyzeDocFreshness();
    const queryString = match[1] ?? '';
    const params = parseQueryString(queryString);

    // ── coverage=true → solo metriche aggregate ──
    if (params.get('coverage')?.toLowerCase() === 'true') {
      return [
        {
          uri,
          mimeType: 'application/json',
          text: JSON.stringify(
            {
              totalDocs: report.totalDocs,
              freshCount: report.freshCount,
              staleCount: report.staleCount,
              missingCount: report.missingCount,
              overallScore: report.overallScore,
              generatedAt: report.generatedAt,
            },
            null,
            2
          ),
        },
      ];
    }

    // ── Filtri ──
    let filteredEntries = [...report.entries];

    const statusFilter = params.get('status');
    if (statusFilter && isValidStatus(statusFilter)) {
      filteredEntries = filteredEntries.filter(
        (e) => e.status === statusFilter
      );
    }

    const minScoreRaw = params.get('minScore');
    if (minScoreRaw) {
      const minScore = parseInt(minScoreRaw, 10);
      if (!isNaN(minScore)) {
        filteredEntries = filteredEntries.filter(
          (e) => e.score >= minScore
        );
      }
    }

    return [
      {
        uri,
        mimeType: 'application/json',
        text: JSON.stringify(
          {
            ...report,
            entries: filteredEntries,
            totalDocs: filteredEntries.length,
            freshCount: filteredEntries.filter((e) => e.status === 'fresh').length,
            staleCount: filteredEntries.filter((e) => e.status === 'stale').length,
            missingCount: filteredEntries.filter((e) => e.status === 'missing').length,
            overallScore:
              filteredEntries.length > 0
                ? Math.round(
                    filteredEntries.reduce((acc, e) => acc + e.score, 0) /
                      filteredEntries.length
                  )
                : 100,
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
          error: true,
          message:
            error instanceof Error ? error.message : String(error),
        }),
      },
    ];
  }
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

/**
 * Parser semplice di query string.
 *
 * @param queryString - Query string (senza ? iniziale)
 * @returns Map chiave → valore (ultima occorrenza se duplicato)
 */
function parseQueryString(queryString: string): Map<string, string> {
  const params = new Map<string, string>();

  if (!queryString) return params;

  for (const part of queryString.split('&')) {
    if (!part) continue;
    const eqIndex = part.indexOf('=');
    let key: string;
    let value: string;

    if (eqIndex === -1) {
      key = decodeURIComponent(part);
      value = '';
    } else {
      try {
        key = decodeURIComponent(part.substring(0, eqIndex));
        value = decodeURIComponent(part.substring(eqIndex + 1));
      } catch {
        key = part.substring(0, eqIndex);
        value = part.substring(eqIndex + 1);
      }
    }

    params.set(key, value);
  }

  return params;
}

/**
 * Verifica se una stringa è uno stato DocStatus valido.
 *
 * @param value - Stringa da validare
 * @returns true se è un DocStatus valido
 */
function isValidStatus(value: string): value is DocStatus {
  return ['fresh', 'stale', 'missing'].includes(value);
}
