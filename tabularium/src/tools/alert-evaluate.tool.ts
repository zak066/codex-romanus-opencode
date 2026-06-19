/**
 * tools/alert-evaluate.tool.ts
 * Tool MCP per valutare soglie metriche e generare alert automaticamente.
 *
 * Confronta le metriche recenti con le soglie fornite e crea alert
 * nel database per ogni metrica che supera la soglia.
 *
 * @module tools/alert-evaluate
 */

import type { ToolHandler, ToolResult } from '../types/mcp.js';
import { queryMetrics } from '../core/metrics-engine.js';
import { createAlert } from '../core/alert-manager.js';

// ---------------------------------------------------------------------------
// Domini validi
// ---------------------------------------------------------------------------

const VALID_DOMAINS = ['quality', 'perf', 'security', 'test', 'seo', 'devops'];

// ---------------------------------------------------------------------------
// Tool: alert_evaluate
// ---------------------------------------------------------------------------

export const alertEvaluateToolHandler: ToolHandler = {
  name: 'alert_evaluate',
  description:
    'Valuta soglie metriche e genera alert automaticamente. ' +
    'Confronta le metriche recenti (ultimi 7 giorni) con le soglie fornite ' +
    'per dominio e crea alert per ogni metrica che supera la soglia.',
  inputSchema: {
    type: 'object',
    properties: {
      domain: {
        type: 'string',
        description: 'Dominio da valutare (quality, perf, security, test, seo, devops)',
      },
      thresholds: {
        type: 'object',
        description:
          'Soglie per metriche: chiave = nome metrica (es. lint_errors), ' +
          'valore = soglia numerica (es. 10). Le metriche con valore >= soglia ' +
          'generano alert.',
        additionalProperties: { type: 'number' },
      },
    },
    required: ['domain'],
  },

  handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
    // Validazione domain
    if (!args.domain || typeof args.domain !== 'string') {
      return errorResult('domain is required and must be a string');
    }

    const domain = args.domain.toLowerCase().trim();
    if (!VALID_DOMAINS.includes(domain)) {
      return errorResult(`Invalid domain '${args.domain}'. Supported: ${VALID_DOMAINS.join(', ')}`);
    }

    try {
      const thresholds = args.thresholds as Record<string, number> | undefined;

      // Se nessuna soglia fornita, usa soglie di default per il dominio
      const defaultThresholds: Record<string, number> = getDefaultThresholds(domain);
      const effectiveThresholds = thresholds ?? defaultThresholds;

      const alertsCreated: Array<Record<string, unknown>> = [];

      // Per ogni metrica, query la media recente e confronta
      for (const [metricName, threshold] of Object.entries(effectiveThresholds)) {
        // Query metriche recenti (ultimi 7 giorni)
        const result = queryMetrics({
          domain,
          metric_name: metricName,
          aggregation: 'avg',
          from: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
        });

        // Estrai valore medio
        let currentValue: number | null = null;

        if (result.data && result.data.length > 0) {
          const first = result.data[0] as Record<string, unknown>;
          if (typeof first.value === 'number') {
            currentValue = first.value;
          }
        }

        // Se non ci sono dati, salta
        if (currentValue === null) continue;

        // Determina se supera la soglia
        // Per metriche "buone" (coverage, pass rate), soglia è un minimo
        // Per metriche "cattive" (errori, vulnerabilità), soglia è un massimo
        const isLowerIsBetter = isMetricLowerBetter(metricName);
        const exceedsThreshold = isLowerIsBetter
          ? currentValue > threshold
          : currentValue < threshold;

        if (exceedsThreshold) {
          const severity = determineSeverity(currentValue, threshold, isLowerIsBetter);

          const alert = createAlert({
            domain,
            metric_name: metricName,
            severity,
            source: 'manual',
            message: `Metric '${metricName}' ${isLowerIsBetter ? 'exceeded' : 'below'} threshold: ${currentValue} (threshold: ${threshold})`,
            current_value: currentValue,
            threshold_value: threshold,
            deviation_pct: threshold > 0
              ? Math.round(((Math.abs(currentValue - threshold) / threshold) * 100) * 100) / 100
              : undefined,
          });

          alertsCreated.push({
            id: alert.id,
            domain: alert.domain,
            metric_name: alert.metric_name,
            severity: alert.severity,
            current_value: currentValue,
            threshold_value: threshold,
            message: alert.message,
          });
        }
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                data: {
                  domain,
                  thresholdsEvaluated: effectiveThresholds,
                  alertsCreated,
                  totalAlerts: alertsCreated.length,
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
                error: 'ALERT_EVALUATE_ERROR',
                message: `alert_evaluate failed: ${error instanceof Error ? error.message : String(error)}`,
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
 * Soglie di default per dominio.
 */
function getDefaultThresholds(domain: string): Record<string, number> {
  const thresholds: Record<string, Record<string, number>> = {
    quality: { lint_errors: 0, ts_errors: 0, lint_warnings: 10 },
    perf: { p95_latency_ms: 500, p50_latency_ms: 200 },
    security: { vuln_critical: 0, vuln_high: 0, vuln_medium: 5 },
    test: { tests_failed: 0, coverage_pct: 80 },
    seo: { lighthouse_performance: 80, lighthouse_seo: 85 },
    devops: { deploy_duration_s: 300, incident_count: 1 },
  };

  return thresholds[domain] ?? {};
}

/**
 * Determina se per questa metrica valori più bassi sono migliori.
 * Esempio: errori → lower is better; coverage → higher is better.
 */
function isMetricLowerBetter(metricName: string): boolean {
  const lowerBetter = [
    'lint_errors', 'ts_errors', 'lint_warnings',
    'vuln_critical', 'vuln_high', 'vuln_medium',
    'tests_failed',
    'p50_latency_ms', 'p95_latency_ms', 'p99_latency_ms',
    'deploy_duration_s', 'incident_count',
    'bundle_size_kb', 'secrets_found',
  ];
  return lowerBetter.includes(metricName);
}

/**
 * Determina la severità dell'alert in base allo scostamento dalla soglia.
 */
function determineSeverity(
  currentValue: number,
  threshold: number,
  lowerIsBetter: boolean
): 'low' | 'medium' | 'high' | 'critical' {
  const deviation = threshold > 0
    ? Math.abs(currentValue - threshold) / threshold
    : Math.abs(currentValue - threshold);

  if (deviation <= 0.1) return 'low';
  if (deviation <= 0.25) return 'medium';
  if (deviation <= 0.5) return 'high';
  return 'critical';
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
