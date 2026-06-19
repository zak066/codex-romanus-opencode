/**
 * resources/scorecard.resource.ts
 * Resource MCP per il Quality Scorecard aggregato (AUTOMATA — Fase 6.5).
 *
 * URI: tabularium://quality/scorecard
 * URI con parametri: tabularium://quality/scorecard?days=7&weights={"lint":0.25}
 *
 * Restituisce un grado A-F con breakdown dettagliato per dominio.
 * I dati provengono dal metrics-engine (CENSUS — Fase 5).
 *
 * @module resources/scorecard
 */

import type { ResourceContent, ResourceHandler } from '../types/mcp.js';
import {
  getScorecard,
  type ScorecardWeights,
  type ScorecardResult,
} from '../core/scorecard-engine.js';
import { ensureMetricsSchema } from '../core/metrics-engine.js';

// ---------------------------------------------------------------------------
// Costanti
// ---------------------------------------------------------------------------

/** URI base della resource */
const BASE_URI = 'tabularium://quality/scorecard';

/** Pattern per URI con parametri: tabularium://quality/scorecard?days=7&weights=... */
const URI_PATTERN = /^tabularium:\/\/quality\/scorecard(?:\?(.+))?$/;

// ---------------------------------------------------------------------------
// Resource Handler (panoramica)
// ---------------------------------------------------------------------------

/**
 * Handler che restituisce una panoramica della resource scorecard,
 * inclusi URI di esempio e parametri supportati.
 */
export const scorecardResourceHandler: ResourceHandler = {
  uri: BASE_URI,
  name: 'Quality Scorecard',
  description: 'Aggregated quality score (A-F) from lint, TS, test, security, and perf metrics',
  mimeType: 'application/json',

  handler: async (): Promise<ResourceContent[]> => {
    try {
      // Verifica che il database metriche sia accessibile
      try {
        ensureMetricsSchema();
      } catch {
        return [
          {
            uri: BASE_URI,
            mimeType: 'application/json',
            text: JSON.stringify({
              status: 'not_initialized',
              message: 'Metrics database not initialized. Metrics schema unavailable.',
            }),
          },
        ];
      }

      // Esegui scorecard con parametri di default
      const result = await getScorecard(undefined, 7);

      return [
        {
          uri: BASE_URI,
          mimeType: 'application/json',
          text: JSON.stringify(
            {
              uri: BASE_URI,
              description: 'Quality Scorecard aggregato (grado A-F)',
              current: formatScorecardResponse(result),
              usage: {
                examples: [
                  `${BASE_URI}?days=7`,
                  `${BASE_URI}?days=30`,
                  `${BASE_URI}?days=7&weights={"lint":0.25,"test":0.30}`,
                ],
                parameters: {
                  days: { type: 'integer', default: 7, description: 'Finestra temporale in giorni' },
                  weights: { type: 'JSON', default: '{"lint":0.20,"ts":0.20,"test":0.25,"security":0.20,"perf":0.15}', description: 'Pesi personalizzati per dominio' },
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
            message: `Scorecard computation failed: ${error instanceof Error ? error.message : String(error)}`,
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
 * Risolve un URI specifico dello scorecard e restituisce il risultato.
 * Chiamato dal router centrale quando l'URI inizia con tabularium://quality/scorecard.
 *
 * URI supportati:
 *   tabularium://quality/scorecard                    → scorecard default (7gg)
 *   tabularium://quality/scorecard?days=30            → scorecard ultimi 30gg
 *   tabularium://quality/scorecard?days=7&weights=... → scorecard con pesi custom
 *
 * @param uri - URI completo da risolvere
 * @returns Array di ResourceContent
 */
export async function resolveScorecardUri(uri: string): Promise<ResourceContent[]> {
  // Assicura che lo schema esista
  try {
    ensureMetricsSchema();
  } catch {
    return [
      {
        uri,
        mimeType: 'application/json',
        text: JSON.stringify({ error: 'Database not initialized. Cannot compute scorecard.' }),
      },
    ];
  }

  const match = uri.match(URI_PATTERN);
  if (!match) {
    // URI non riconosciuto, restituisci panoramica
    return scorecardResourceHandler.handler();
  }

  const queryString = match[1];

  // Parsing parametri
  const params = parseQueryString(queryString ?? '');

  const days = params.days ? parseInt(params.days as string, 10) : 7;
  let weights: ScorecardWeights | undefined;

  if (params.weights) {
    try {
      weights = JSON.parse(params.weights as string) as ScorecardWeights;
    } catch {
      // Se il parsing del JSON fallisce, ignora weights
    }
  }

  try {
    const result = await getScorecard(undefined, days, weights);

    return [
      {
        uri,
        mimeType: 'application/json',
        text: JSON.stringify(formatScorecardResponse(result), null, 2),
      },
    ];
  } catch (error) {
    return [
      {
        uri,
        mimeType: 'application/json',
        text: JSON.stringify({
          error: `Failed to compute scorecard: ${error instanceof Error ? error.message : String(error)}`,
        }),
      },
    ];
  }
}

// ---------------------------------------------------------------------------
// Formattazione risposta
// ---------------------------------------------------------------------------

/**
 * Formatta un ScorecardResult in un response object pronto per JSON.
 * Aggiunge il grado come stringa leggibile e il riepilogo dei componenti.
 */
function formatScorecardResponse(result: ScorecardResult): Record<string, unknown> {
  const breakdown = result.breakdown;

  return {
    grade: result.grade,
    score: result.score,
    generatedAt: result.generatedAt,
    window_days: computeWindowDays(result.period),
    period: result.period,
    components: [
      {
        name: 'lint',
        weight: breakdown.lint.weight,
        score: breakdown.lint.score,
        grade: scoreToGrade(breakdown.lint.score),
        metrics: breakdown.lint.metrics,
      },
      {
        name: 'typescript',
        weight: breakdown.ts.weight,
        score: breakdown.ts.score,
        grade: scoreToGrade(breakdown.ts.score),
        metrics: breakdown.ts.metrics,
      },
      {
        name: 'test',
        weight: breakdown.test.weight,
        score: breakdown.test.score,
        grade: scoreToGrade(breakdown.test.score),
        metrics: breakdown.test.metrics,
      },
      {
        name: 'security',
        weight: breakdown.security.weight,
        score: breakdown.security.score,
        grade: scoreToGrade(breakdown.security.score),
        metrics: breakdown.security.metrics,
      },
      {
        name: 'performance',
        weight: breakdown.perf.weight,
        score: breakdown.perf.score,
        grade: scoreToGrade(breakdown.perf.score),
        metrics: breakdown.perf.metrics,
      },
    ],
    breakdown: {
      lint_errors: breakdown.lint.metrics.lint_errors ?? null,
      lint_warnings: breakdown.lint.metrics.lint_warnings ?? null,
      ts_errors: breakdown.ts.metrics.ts_errors ?? null,
      test_pass: breakdown.test.metrics.test_pass ?? null,
      test_fail: breakdown.test.metrics.test_fail ?? null,
      coverage_pct: breakdown.test.metrics.coverage_pct ?? null,
      vuln_count: breakdown.security.metrics.vuln_count ?? null,
      critical_vuln: breakdown.security.metrics.critical_vuln ?? null,
      p95_latency_ms: breakdown.perf.metrics.p95_latency_ms ?? null,
      throughput_rps: breakdown.perf.metrics.throughput_rps ?? null,
    },
    weights: {
      lint: breakdown.lint.weight,
      ts: breakdown.ts.weight,
      test: breakdown.test.weight,
      security: breakdown.security.weight,
      perf: breakdown.perf.weight,
    },
  };
}

/**
 * Calcola il numero di giorni dalla finestra period.
 */
function computeWindowDays(period: { from: string; to: string }): number {
  try {
    const fromMs = new Date(period.from).getTime();
    const toMs = new Date(period.to).getTime();
    return Math.max(1, Math.round((toMs - fromMs) / (24 * 60 * 60 * 1000)));
  } catch {
    return 7;
  }
}

/**
 * Converte un punteggio 0-100 in un grado A-F.
 */
function scoreToGrade(score: number): string {
  if (score >= 90) return 'A';
  if (score >= 75) return 'B';
  if (score >= 60) return 'C';
  if (score >= 45) return 'D';
  if (score >= 30) return 'E';
  return 'F';
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

/**
 * Parser semplice di query string.
 * Converte "?days=7&weights=..." in { days: '7', weights: '...' }
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
