/**
 * tools/metrics.tool.ts
 * Tool MCP per il sistema di metriche time-series (CENSUS — Fase 5).
 *
 * Espone tre tool:
 * - metrics_store: registra una nuova metrica
 * - metrics_query: interroga metriche con filtri e aggregazioni
 * - metrics_trend: confronta due finestre temporali per trend
 *
 * @module tools/metrics
 */

import type { ToolHandler, ToolResult } from '../types/mcp.js';
import {
  storeMetric,
  queryMetrics,
  queryTrend,
  ensureMetricsSchema,
} from '../core/metrics-engine.js';

// ---------------------------------------------------------------------------
// Domini validi
// ---------------------------------------------------------------------------

const VALID_DOMAINS = ['quality', 'perf', 'security', 'test', 'seo', 'devops', 'memory'];

const VALID_AGGREGATIONS = [
  'avg', 'sum', 'min', 'max',
  'p50', 'p95', 'p99',
  'count',
];

const VALID_INTERVALS = ['hour', 'day', 'week', 'month'];

// ---------------------------------------------------------------------------
// Helper: validazione
// ---------------------------------------------------------------------------

/**
 * Valida il dominio, restituisce errore se non valido.
 */
function validateDomain(domain: unknown): string | null {
  if (!domain || typeof domain !== 'string') {
    return 'domain is required and must be a string';
  }

  const lower = domain.toLowerCase().trim();
  if (!VALID_DOMAINS.includes(lower)) {
    return `Invalid domain '${domain}'. Supported domains: ${VALID_DOMAINS.join(', ')}`;
  }

  return null; // OK
}

/**
 * Valida metric_name: alfanumerico + underscore, max 100 caratteri.
 */
function validateMetricName(name: unknown): string | null {
  if (!name || typeof name !== 'string') {
    return 'metric_name is required and must be a string';
  }

  if (name.length > 100) {
    return `metric_name exceeds maximum length of 100 characters (received ${name.length})`;
  }

  if (!/^[a-zA-Z0-9_]+$/.test(name)) {
    return 'metric_name must be alphanumeric with underscores only';
  }

  return null;
}

/**
 * Valida value: deve essere un numero finito.
 */
function validateValue(value: unknown): string | null {
  if (value === undefined || value === null || typeof value !== 'number') {
    return 'value is required and must be a number';
  }

  if (!Number.isFinite(value)) {
    return 'value must be a finite number (not Infinity, NaN, or null)';
  }

  return null;
}

/**
 * Valida tags: deve essere un oggetto JSON valido, max 10 chiavi.
 */
function validateTags(tags: unknown): string | null {
  if (tags === undefined || tags === null) {
    return null; // tags opzionali
  }

  if (typeof tags !== 'object' || Array.isArray(tags)) {
    return 'tags must be an object (Record<string, string>)';
  }

  const keys = Object.keys(tags as Record<string, unknown>);
  if (keys.length > 10) {
    return `tags exceeds maximum of 10 keys (received ${keys.length})`;
  }

  // Verifica che tutti i valori siano stringhe
  for (const [key, value] of Object.entries(tags as Record<string, unknown>)) {
    if (typeof value !== 'string') {
      return `tag '${key}' must be a string (received ${typeof value})`;
    }
  }

  // Verifica dimensione serializzata
  const serialized = JSON.stringify(tags);
  if (new TextEncoder().encode(serialized).length > 256) {
    return 'tags serialized size exceeds 256 bytes';
  }

  return null;
}

/**
 * Valida aggregation: deve essere uno dei valori validi.
 */
function validateAggregation(agg: unknown): string | null {
  if (agg === undefined || agg === null) {
    return null; // opzionale, default raw
  }

  if (typeof agg !== 'string') {
    return 'aggregation must be a string';
  }

  if (!VALID_AGGREGATIONS.includes(agg)) {
    return `Invalid aggregation '${agg}'. Supported values: ${VALID_AGGREGATIONS.join(', ')}`;
  }

  return null;
}

/**
 * Valida interval: deve essere uno dei valori validi.
 */
function validateInterval(interval: unknown): string | null {
  if (interval === undefined || interval === null) {
    return null; // opzionale
  }

  if (typeof interval !== 'string') {
    return 'interval must be a string';
  }

  if (!VALID_INTERVALS.includes(interval)) {
    return `Invalid interval '${interval}'. Supported values: ${VALID_INTERVALS.join(', ')}`;
  }

  return null;
}

/**
 * Valida days: deve essere un intero positivo.
 */
function validateDays(days: unknown): string | null {
  if (days === undefined || days === null) {
    return null; // opzionale, default 7
  }

  if (typeof days !== 'number' || !Number.isInteger(days) || days < 1 || days > 365) {
    return 'days must be an integer between 1 and 365';
  }

  return null;
}

// ---------------------------------------------------------------------------
// Tool: metrics_store
// ---------------------------------------------------------------------------

export const metricsStoreToolHandler: ToolHandler = {
  name: 'metrics_store',
  description: 'Register a new metric value in the time-series database',
  inputSchema: {
    type: 'object',
    properties: {
      domain: {
        type: 'string',
        description: 'Metric domain: quality, perf, security, test, seo, devops, memory',
      },
      metric_name: {
        type: 'string',
        description: 'Metric name (alphanumeric + underscores, max 100 chars)',
      },
      value: {
        type: 'number',
        description: 'Numeric value (REAL)',
      },
      tags: {
        type: 'object',
        description: 'Optional metadata: { "agent": "...", "file": "...", "branch": "..." }',
        additionalProperties: { type: 'string' },
      },
    },
    required: ['domain', 'metric_name', 'value'],
  },

  handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
    // Validazione
    const domainErr = validateDomain(args.domain);
    if (domainErr) return errorResult(domainErr);

    const nameErr = validateMetricName(args.metric_name);
    if (nameErr) return errorResult(nameErr);

    const valueErr = validateValue(args.value);
    if (valueErr) return errorResult(valueErr);

    const tagsErr = validateTags(args.tags);
    if (tagsErr) return errorResult(tagsErr);

    try {
      // Assicura che lo schema esista
      try {
        ensureMetricsSchema();
      } catch {
        // Database non ancora inizializzato
      }

      const id = storeMetric(
        String(args.domain),
        String(args.metric_name),
        Number(args.value),
        args.tags as Record<string, string> | undefined
      );

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                data: {
                  id,
                  domain: String(args.domain).toLowerCase(),
                  metric_name: String(args.metric_name),
                  value: Number(args.value),
                  recorded_at: new Date().toISOString(),
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
                error: 'STORE_ERROR',
                message: `Failed to store metric: ${error instanceof Error ? error.message : String(error)}`,
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
// Tool: metrics_query
// ---------------------------------------------------------------------------

export const metricsQueryToolHandler: ToolHandler = {
  name: 'metrics_query',
  description: 'Query metrics with filters, aggregation, and time bucketing',
  inputSchema: {
    type: 'object',
    properties: {
      domain: {
        type: 'string',
        description: 'Metric domain: quality, perf, security, test, seo, devops, memory',
      },
      metric_name: {
        type: 'string',
        description: 'Filter by specific metric name (optional)',
      },
      from: {
        type: 'string',
        description: 'Start of time window in ISO 8601 (default: 30 days ago)',
      },
      to: {
        type: 'string',
        description: 'End of time window in ISO 8601 (default: now)',
      },
      aggregation: {
        type: 'string',
        enum: ['avg', 'sum', 'min', 'max', 'p50', 'p95', 'p99', 'count'],
        description: 'Aggregation function (default: raw data)',
      },
      tags: {
        type: 'object',
        description: 'Filter by exact tag match: { "agent": "vulcanus" }',
        additionalProperties: { type: 'string' },
      },
      interval: {
        type: 'string',
        enum: ['hour', 'day', 'week', 'month'],
        description: 'Time bucketing interval (only with aggregation)',
      },
    },
    required: ['domain'],
  },

  handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
    // Validazione
    const domainErr = validateDomain(args.domain);
    if (domainErr) return errorResult(domainErr);

    if (args.metric_name !== undefined) {
      const nameErr = validateMetricName(args.metric_name);
      if (nameErr) return errorResult(nameErr);
    }

    const aggErr = validateAggregation(args.aggregation);
    if (aggErr) return errorResult(aggErr);

    const intervalErr = validateInterval(args.interval);
    if (intervalErr) return errorResult(intervalErr);

    const tagsErr = validateTags(args.tags);
    if (tagsErr) return errorResult(tagsErr);

    // Se interval è specificato, aggregation è obbligatorio
    if (args.interval && !args.aggregation) {
      return errorResult('aggregation is required when interval is specified');
    }

    try {
      const result = queryMetrics({
        domain: String(args.domain),
        metric_name: args.metric_name ? String(args.metric_name) : undefined,
        from: args.from ? String(args.from) : undefined,
        to: args.to ? String(args.to) : undefined,
        aggregation: args.aggregation as
          | 'avg' | 'sum' | 'min' | 'max' | 'p50' | 'p95' | 'p99' | 'count' | undefined,
        tags: args.tags as Record<string, string> | undefined,
        interval: args.interval ? String(args.interval) : undefined,
      });

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
                error: 'QUERY_ERROR',
                message: `Failed to query metrics: ${error instanceof Error ? error.message : String(error)}`,
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
// Tool: metrics_trend
// ---------------------------------------------------------------------------

export const metricsTrendToolHandler: ToolHandler = {
  name: 'metrics_trend',
  description: 'Compare two time windows and compute trend direction for a metric',
  inputSchema: {
    type: 'object',
    properties: {
      domain: {
        type: 'string',
        description: 'Metric domain: quality, perf, security, test, seo, devops, memory',
      },
      metric_name: {
        type: 'string',
        description: 'Metric name to analyze',
      },
      days: {
        type: 'number',
        description: 'Window size in days for comparison (default: 7, max: 365)',
      },
      tags: {
        type: 'object',
        description: 'Filter by exact tag match: { "agent": "diana-tester" }',
        additionalProperties: { type: 'string' },
      },
    },
    required: ['domain', 'metric_name'],
  },

  handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
    // Validazione
    const domainErr = validateDomain(args.domain);
    if (domainErr) return errorResult(domainErr);

    const nameErr = validateMetricName(args.metric_name);
    if (nameErr) return errorResult(nameErr);

    const daysErr = validateDays(args.days);
    if (daysErr) return errorResult(daysErr);

    const tagsErr = validateTags(args.tags);
    if (tagsErr) return errorResult(tagsErr);

    try {
      const trend = queryTrend(
        String(args.domain),
        String(args.metric_name),
        args.days ? Number(args.days) : 7,
        args.tags as Record<string, string> | undefined
      );

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                data: trend,
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
                error: 'TREND_ERROR',
                message: `Failed to compute trend: ${error instanceof Error ? error.message : String(error)}`,
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
// Helper: errore
// ---------------------------------------------------------------------------

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
