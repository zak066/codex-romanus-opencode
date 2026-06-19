/**
 * resources/metrics.resource.ts
 * Resource MCP per il sistema di metriche time-series.
 * URI: tabularium://metrics/{domain}
 *
 * Supporta:
 * - tabularium://metrics/{domain} — tutte le metriche del dominio (ultimi 30gg)
 * - tabularium://metrics/{domain}?metric_name=...&days=7&aggregation=avg
 *
 * @module resources/metrics
 */

import type { ResourceContent, ResourceHandler } from '../types/mcp.js';
import { queryMetrics, ensureMetricsSchema } from '../core/metrics-engine.js';
import { getDatabase } from '../core/database.js';

// ---------------------------------------------------------------------------
// Costanti
// ---------------------------------------------------------------------------

const BASE_URI = 'tabularium://metrics';

// Pattern: tabularium://metrics/{domain}[?param=value&...]
const URI_PATTERN = /^tabularium:\/\/metrics\/([a-z]+)(?:\?(.+))?$/;

// ---------------------------------------------------------------------------
// Resource Handler
// ---------------------------------------------------------------------------

/**
 * Resource handler per metriche.
 * Risponde a tabularium://metrics/{domain} con parametri opzionali.
 */
export const metricsResourceHandler: ResourceHandler = {
  uri: BASE_URI,
  name: 'Metrics',
  description: 'Time-series metrics: quality, perf, security, test, seo, devops',
  mimeType: 'application/json',

  handler: async (): Promise<ResourceContent[]> => {
    try {
      const db = getDatabase();

      // Verifica che la tabella esista
      const tableExists = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='metrics'"
      ).get();

      if (!tableExists) {
        return [
          {
            uri: `${BASE_URI}/overview`,
            mimeType: 'application/json',
            text: JSON.stringify({
              status: 'not_initialized',
              message: 'Metrics table does not exist. Call ensureMetricsSchema() first.',
            }),
          },
        ];
      }

      // Statistiche per dominio
      const domains = db.prepare(`
        SELECT
          domain,
          COUNT(*) as total_entries,
          COUNT(DISTINCT metric_name) as unique_metrics,
          MIN(recorded_at) as oldest,
          MAX(recorded_at) as newest
        FROM metrics
        GROUP BY domain
        ORDER BY domain
      `).all() as Array<{
        domain: string;
        total_entries: number;
        unique_metrics: number;
        oldest: string;
        newest: string;
      }>;

      return [
        {
          uri: `${BASE_URI}/overview`,
          mimeType: 'application/json',
          text: JSON.stringify(
            {
              status: 'available',
              domains: domains.map((d) => ({
                domain: d.domain,
                entries: d.total_entries,
                unique_metrics: d.unique_metrics,
                time_range: { from: d.oldest, to: d.newest },
              })),
              endpoints: [
                { uri: `${BASE_URI}/{domain}`, description: 'Metrics for a specific domain' },
                { uri: `${BASE_URI}/{domain}?metric_name=...`, description: 'Filter by metric name' },
                { uri: `${BASE_URI}/{domain}?aggregation=avg`, description: 'Aggregated metrics' },
              ],
            },
            null,
            2
          ),
        },
      ];
    } catch {
      return [
        {
          uri: `${BASE_URI}/overview`,
          mimeType: 'application/json',
          text: JSON.stringify({ status: 'unavailable', message: 'Metrics database not initialized' }),
        },
      ];
    }
  },
};

// ---------------------------------------------------------------------------
// URI Resolution
// ---------------------------------------------------------------------------

/**
 * Risolve un URI specifico di metrica e restituisce i contenuti.
 * Chiamato dal router centrale quando l'URI inizia con tabularium://metrics.
 *
 * @param uri - URI completo da risolvere (es. tabularium://metrics/quality?metric_name=lint_errors)
 * @returns Array di ResourceContent
 */
export async function resolveMetricsUri(uri: string): Promise<ResourceContent[]> {
  // Assicura che lo schema esista
  try {
    ensureMetricsSchema();
  } catch {
    // Se il database non è inizializzato, restituisci errore
    return [
      {
        uri,
        mimeType: 'application/json',
        text: JSON.stringify({ error: 'Database not initialized. Cannot access metrics.' }),
      },
    ];
  }

  const match = uri.match(URI_PATTERN);
  if (!match) {
    // URI non riconosciuto, restituisci panoramica
    return metricsResourceHandler.handler();
  }

  const domain = match[1];
  const queryString = match[2];

  // Parsing parametri
  const params = parseQueryString(queryString ?? '');

  const metricName = params.metric_name as string | undefined;
  const aggregation = params.aggregation as
    | 'avg' | 'sum' | 'min' | 'max' | 'p50' | 'p95' | 'p99' | 'count'
    | undefined;
  const days = params.days ? parseInt(params.days as string, 10) : 30;
  const limit = params.limit ? parseInt(params.limit as string, 10) : 1000;
  const tagsParam = params.tags ? (params.tags as string) : undefined;

  let tags: Record<string, string> | undefined;
  if (tagsParam) {
    try {
      tags = JSON.parse(tagsParam) as Record<string, string>;
    } catch {
      tags = undefined;
    }
  }

  // Calcola finestra
  const toDate = new Date().toISOString();
  const fromDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  try {
    const result = queryMetrics({
      domain,
      metric_name: metricName,
      from: fromDate,
      to: toDate,
      aggregation,
      tags,
    });

    return [
      {
        uri,
        mimeType: 'application/json',
        text: JSON.stringify(
          {
            domain: result.domain,
            metric_name: result.metric_name,
            count: Array.isArray(result.data) ? result.data.length : 0,
            data: result.data,
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
          error: `Failed to query metrics: ${error instanceof Error ? error.message : String(error)}`,
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
 * Converte "?metric_name=lint_errors&days=7" in { metric_name: 'lint_errors', days: '7' }
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
