/**
 * core/regression-detector.ts
 * Regression Alert Engine (AUTOMATA — Fase 6).
 *
 * Confronta l'ultimo run di metriche con la baseline storica (media
 * degli ultimi N run escluso l'ultimo) e genera RegressionAlert quando
 * la deviazione supera la soglia configurabile.
 *
 * Integrazione con metrics-engine (Fase 5 — CENSUS):
 *   - queryMetrics per recuperare i dati cronologici per dominio/metrica
 *
 * @module core/regression-detector
 */

import crypto from 'node:crypto';
import { queryMetrics } from './metrics-engine.js';
import type { MetricEntry } from './metrics-engine.js';

// ---------------------------------------------------------------------------
// Tipi pubblici
// ---------------------------------------------------------------------------

/** Configurazione del regression detector */
export interface RegressionConfig {
  /** Numero di run storici per la media baseline (default: 10) */
  baselineWindow?: number;
  /** Soglia di deviazione percentuale oltre cui generare alert (default: 0.20 = 20%) */
  deviationThreshold?: number;
  /** Domini da analizzare (default: quality, perf, test, security, seo) */
  domains?: string[];
}

/** Alert generato da una regressione rilevata */
export interface RegressionAlert {
  /** UUID con prefisso alr_ */
  id: string;
  /** Dominio della metrica (quality, perf, test, security, seo) */
  domain: string;
  /** Nome della metrica (es. lint_errors, p95_latency_ms) */
  metricName: string;
  /** Valore corrente (ultimo run) */
  currentValue: number;
  /** Media della baseline (ultimi N run, escluso l'ultimo) */
  baselineAvg: number;
  /** Deviazione percentuale positiva = peggioramento */
  deviationPct: number;
  /** up = aumentato (peggio per errori), down = diminuito (peggio per coverage) */
  direction: 'up' | 'down';
  /** Severità in base alla deviazione percentuale */
  severity: 'low' | 'medium' | 'high' | 'critical';
  /** Descrizione leggibile dell'alert */
  message: string;
  /** Timestamp ISO 8601 di rilevamento */
  detectedAt: string;
}

/** Risultato completo dell'analisi regressioni */
export interface RegressionResult {
  /** Numero totale di metriche analizzate */
  totalMetrics: number;
  /** Alert generati */
  alerts: RegressionAlert[];
  /** Domini effettivamente analizzati */
  checkedDomains: string[];
  /** Durata dell'analisi in millisecondi */
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Costanti
// ---------------------------------------------------------------------------

const DEFAULT_BASELINE_WINDOW = 10;
const DEFAULT_DEVIATION_THRESHOLD = 0.20;
const DEFAULT_DOMAINS = ['quality', 'perf', 'test', 'security', 'seo'];

/**
 * Metriche monitorate per dominio.
 * Ogni dominio ha una lista di metriche da analizzare per regressioni.
 */
const DOMAIN_METRICS: Record<string, string[]> = {
  quality: ['lint_errors', 'lint_warnings', 'ts_errors', 'coverage_pct', 'bundle_size_kb'],
  test: ['test_pass', 'test_fail'],
  perf: ['p50_latency_ms', 'p95_latency_ms', 'throughput_rps'],
  security: ['vuln_count', 'critical_vuln', 'secret_findings'],
  seo: ['lighthouse_performance', 'lighthouse_accessibility', 'core_web_vitals_lcp'],
};

// ---------------------------------------------------------------------------
// Regression Detector
// ---------------------------------------------------------------------------

/**
 * Analizza le metriche recenti per dominio e rileva regressioni rispetto
 * alla baseline storica.
 *
 * Per ogni dominio configurato:
 * 1. Interroga queryMetrics per ciascuna metrica rilevante
 * 2. Raggruppa per metric_name, ordina per recorded_at DESC
 * 3. L'ultimo valore è il "corrente", i precedenti N formano la baseline
 * 4. Se la deviazione supera la soglia, genera RegressionAlert
 *
 * @param config - Configurazione opzionale (baselineWindow, deviationThreshold, domains)
 * @returns RegressionResult con metriche totali, alert, domini controllati e durata
 */
export function detectRegressions(config?: RegressionConfig): RegressionResult {
  const startTime = Date.now();

  const baselineWindow = config?.baselineWindow ?? DEFAULT_BASELINE_WINDOW;
  const deviationThreshold = config?.deviationThreshold ?? DEFAULT_DEVIATION_THRESHOLD;
  const domains = config?.domains ?? DEFAULT_DOMAINS;

  const alerts: RegressionAlert[] = [];
  let totalMetrics = 0;
  const checkedDomains: string[] = [];

  for (const domain of domains) {
    const domainLower = domain.toLowerCase();
    const relevantMetrics = DOMAIN_METRICS[domainLower];

    // Salta domini sconosciuti
    if (!relevantMetrics) {
      continue;
    }

    checkedDomains.push(domainLower);

    for (const metricName of relevantMetrics) {
      totalMetrics++;

      try {
        // Recupera i dati grezzi della metrica (ordinati per recorded_at DESC)
        const result = queryMetrics({
          domain: domainLower,
          metric_name: metricName,
          aggregation: 'raw',
        });

        const entries = result.data as MetricEntry[];

        // Servono almeno 2 valori: 1 per il current + 1 per la baseline
        if (entries.length < 2) {
          continue;
        }

        // Il primo record è l'ultimo cronologicamente (ordinamento DESC)
        const currentValue = entries[0].value;

        // I successivi baselineWindow record formano la baseline
        const baselineEntries = entries.slice(1, 1 + baselineWindow);

        if (baselineEntries.length < 1) {
          continue;
        }

        // Calcola la media della baseline
        const baselineSum = baselineEntries.reduce((sum, e) => sum + e.value, 0);
        const baselineAvg = baselineSum / baselineEntries.length;

        // Baseline zero = dato insufficiente (deviazione infinita)
        if (baselineAvg === 0) {
          continue;
        }

        // Calcola deviazione percentuale
        const deviationPct = Math.abs(
          ((currentValue - baselineAvg) / baselineAvg) * 100
        );

        // Applica la soglia
        if (deviationPct <= deviationThreshold * 100) {
          continue;
        }

        // Direzione: up o down
        const direction: 'up' | 'down' = currentValue > baselineAvg ? 'up' : 'down';

        // Severità: <30%=low, <50%=medium, <75%=high, >=75%=critical
        const severity = computeSeverity(deviationPct);

        const message = direction === 'up'
          ? `Metric ${metricName} in domain ${domainLower} increased from avg ${baselineAvg.toFixed(2)} to ${currentValue} (${deviationPct.toFixed(2)}% deviation, threshold: ${(deviationThreshold * 100).toFixed(0)}%)`
          : `Metric ${metricName} in domain ${domainLower} decreased from avg ${baselineAvg.toFixed(2)} to ${currentValue} (${deviationPct.toFixed(2)}% deviation, threshold: ${(deviationThreshold * 100).toFixed(0)}%)`;

        alerts.push({
          id: `alr_${crypto.randomUUID()}`,
          domain: domainLower,
          metricName,
          currentValue,
          baselineAvg: Number(baselineAvg.toFixed(4)),
          deviationPct: Number(deviationPct.toFixed(2)),
          direction,
          severity,
          message,
          detectedAt: new Date().toISOString(),
        });
      } catch {
        // Se queryMetrics fallisce per questa metrica, salta silenziosamente
        continue;
      }
    }
  }

  const durationMs = Date.now() - startTime;

  return {
    totalMetrics,
    alerts,
    checkedDomains,
    durationMs,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Calcola la severity in base alla deviazione percentuale.
 *
 * Regole:
 * - < 30%  → low
 * - < 50%  → medium
 * - < 75%  → high
 * - >= 75% → critical
 *
 * @param deviationPct - Deviazione percentuale (0-∞)
 * @returns Severità dell'alert
 */
function computeSeverity(deviationPct: number): 'low' | 'medium' | 'high' | 'critical' {
  if (deviationPct < 30) {
    return 'low';
  }
  if (deviationPct < 50) {
    return 'medium';
  }
  if (deviationPct < 75) {
    return 'high';
  }
  return 'critical';
}
