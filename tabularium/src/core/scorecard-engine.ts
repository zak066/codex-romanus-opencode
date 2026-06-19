/**
 * core/scorecard-engine.ts
 * Quality Scorecard Engine (AUTOMATA — Fase 6.5).
 *
 * Aggrega metriche da lint + TS + test + security + perf in un grado A-F.
 * I pesi sono configurabili: lint 20%, TS 20%, test 25%, security 20%, perf 15%.
 *
 * @module core/scorecard-engine
 */

import { queryMetrics, type MetricEntry } from './metrics-engine.js';

// ---------------------------------------------------------------------------
// Tipi pubblici
// ---------------------------------------------------------------------------

/** Pesi configurabili per ogni dominio dello scorecard */
export interface ScorecardWeights {
  lint?: number;      // default: 0.20
  ts?: number;        // default: 0.20
  test?: number;      // default: 0.25
  security?: number;  // default: 0.20
  perf?: number;      // default: 0.15
}

/** Breakdown per singolo dominio */
export interface ScorecardBreakdownItem {
  score: number;
  weight: number;
  metrics: Record<string, number>;
}

/** Breakdown completo dello scorecard */
export interface ScorecardBreakdown {
  lint: ScorecardBreakdownItem;
  ts: ScorecardBreakdownItem;
  test: ScorecardBreakdownItem;
  security: ScorecardBreakdownItem;
  perf: ScorecardBreakdownItem;
}

/** Risultato completo dello scorecard */
export interface ScorecardResult {
  grade: 'A' | 'B' | 'C' | 'D' | 'E' | 'F';
  score: number;           // 0-100
  breakdown: ScorecardBreakdown;
  generatedAt: string;     // ISO
  period: { from: string; to: string };
}

// ---------------------------------------------------------------------------
// Costanti
// ---------------------------------------------------------------------------

/** Pesi predefiniti per ogni dominio */
const DEFAULT_WEIGHTS: Required<ScorecardWeights> = {
  lint: 0.20,
  ts: 0.20,
  test: 0.25,
  security: 0.20,
  perf: 0.15,
};

/** Soglie per i gradi */
const GRADE_THRESHOLDS: Array<{ grade: 'A' | 'B' | 'C' | 'D' | 'E' | 'F'; min: number }> = [
  { grade: 'A', min: 90 },
  { grade: 'B', min: 75 },
  { grade: 'C', min: 60 },
  { grade: 'D', min: 45 },
  { grade: 'E', min: 30 },
  { grade: 'F', min: 0 },
];

// ---------------------------------------------------------------------------
// Pubblica — Scorecard
// ---------------------------------------------------------------------------

/**
 * Calcola il quality scorecard aggregando le metriche recenti dai domini
 * lint, TypeScript, test, security e performance.
 *
 * @param projectPath - Percorso del progetto (non utilizzato nell'implementazione
 *                      attuale, riservato per estensioni future con collector esterni)
 * @param fromDays - Finestra temporale in giorni (default: 7)
 * @param weights - Pesi opzionali per sovrascrivere i default
 * @returns ScorecardResult con grado A-F e breakdown dettagliato
 */
export async function getScorecard(
  projectPath?: string,
  fromDays?: number,
  weights?: ScorecardWeights
): Promise<ScorecardResult> {
  const days = fromDays ?? 7;
  const resolvedWeights: Required<ScorecardWeights> = {
    lint: weights?.lint ?? DEFAULT_WEIGHTS.lint,
    ts: weights?.ts ?? DEFAULT_WEIGHTS.ts,
    test: weights?.test ?? DEFAULT_WEIGHTS.test,
    security: weights?.security ?? DEFAULT_WEIGHTS.security,
    perf: weights?.perf ?? DEFAULT_WEIGHTS.perf,
  };

  // Finestra temporale
  const to = new Date().toISOString();
  const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  // Raccogli metriche per ogni dominio
  const lintMetrics = await collectDomainMetrics('quality', ['lint_errors', 'lint_warnings'], from, to);
  const tsMetrics = await collectDomainMetrics('quality', ['ts_errors', 'tsc_errors'], from, to);
  // Fallback: if ts_errors not found but tsc_errors is, alias it
  if (tsMetrics.ts_errors === undefined && tsMetrics.tsc_errors !== undefined) {
    tsMetrics.ts_errors = tsMetrics.tsc_errors;
  }
  const testMetrics = await collectDomainMetrics('quality', ['test_pass', 'test_fail', 'coverage_pct'], from, to);
  const securityMetrics = await collectDomainMetrics('security', ['vuln_count', 'critical_vuln'], from, to);
  const perfMetrics = await collectDomainMetrics('perf', ['p95_latency_ms', 'throughput_rps'], from, to);

  // Calcola punteggi per dominio
  const lintScore = calculateLintScore(
    lintMetrics.lint_errors ?? null,
    lintMetrics.lint_warnings ?? null
  );
  const tsScore = calculateTsScore(tsMetrics.ts_errors ?? null);
  const testScore = calculateTestScore(
    testMetrics.test_pass ?? null,
    testMetrics.test_fail ?? null,
    testMetrics.coverage_pct ?? null
  );
  const securityScore = calculateSecurityScore(
    securityMetrics.vuln_count ?? null,
    securityMetrics.critical_vuln ?? null
  );
  const perfScore = calculatePerfScore(perfMetrics.p95_latency_ms ?? null);

  // Punteggio composito
  const score =
    lintScore * resolvedWeights.lint +
    tsScore * resolvedWeights.ts +
    testScore * resolvedWeights.test +
    securityScore * resolvedWeights.security +
    perfScore * resolvedWeights.perf;

  // Grado
  const grade = calculateGrade(score);

  // Breakdown
  const breakdown: ScorecardBreakdown = {
    lint: { score: lintScore, weight: resolvedWeights.lint, metrics: lintMetrics },
    ts: { score: tsScore, weight: resolvedWeights.ts, metrics: tsMetrics },
    test: { score: testScore, weight: resolvedWeights.test, metrics: testMetrics },
    security: { score: securityScore, weight: resolvedWeights.security, metrics: securityMetrics },
    perf: { score: perfScore, weight: resolvedWeights.perf, metrics: perfMetrics },
  };

  return {
    grade,
    score: Math.round(score * 100) / 100, // arrotonda a 2 decimali
    breakdown,
    generatedAt: to,
    period: { from, to },
  };
}

// ---------------------------------------------------------------------------
// Calcolo punteggi per dominio
// ---------------------------------------------------------------------------

/**
 * Calcola il punteggio lint (0-100).
 * Penalità: ogni errore costa 10 punti, ogni warning costa 2 punti.
 * Se metriche non disponibili → score 50 (neutro).
 */
function calculateLintScore(errors: number | null, warnings: number | null): number {
  if (errors === null && warnings === null) return 50; // dominio non disponibile
  const e = errors ?? 0;
  const w = warnings ?? 0;
  return Math.max(0, 100 - e * 10 - w * 2);
}

/**
 * Calcola il punteggio TypeScript (0-100).
 * Penalità: ogni errore costa 20 punti.
 * Se metriche non disponibili → score 50 (neutro).
 */
function calculateTsScore(errors: number | null): number {
  if (errors === null) return 50;
  return Math.max(0, 100 - errors * 20);
}

/**
 * Calcola il punteggio test (0-100).
 * 40% basato su pass/fail ratio, 60% su coverage.
 * Se metriche non disponibili → score 50 (neutro).
 */
function calculateTestScore(
  pass: number | null,
  fail: number | null,
  coverage: number | null
): number {
  if (pass === null && fail === null && coverage === null) return 50;

  const p = pass ?? 0;
  const f = fail ?? 0;
  const c = coverage ?? 0;

  // Ratio test passati
  const total = p + f;
  const ratioScore = total > 0 ? (p / total) * 100 : 100;

  return ratioScore * 0.4 + c * 0.6;
}

/**
 * Calcola il punteggio security (0-100).
 * Penalità: ogni vulnerabilità costa 15 punti, ogni critica costa 30 punti.
 * Se metriche non disponibili → score 50 (neutro).
 */
function calculateSecurityScore(vulnCount: number | null, criticalVuln: number | null): number {
  if (vulnCount === null && criticalVuln === null) return 50;
  const v = vulnCount ?? 0;
  const c = criticalVuln ?? 0;
  return Math.max(0, 100 - v * 15 - c * 30);
}

/**
 * Calcola il punteggio performance (0-100).
 * Basato su p95 latency:
 *   - < 100ms  → 90
 *   - < 500ms  → 70
 *   - < 2000ms → 50
 *   - ≥ 2000ms → 30
 * Se metriche non disponibili → score 50 (neutro).
 */
function calculatePerfScore(p95LatencyMs: number | null): number {
  if (p95LatencyMs === null) return 50;
  if (p95LatencyMs < 100) return 90;
  if (p95LatencyMs < 500) return 70;
  if (p95LatencyMs < 2000) return 50;
  return 30;
}

// ---------------------------------------------------------------------------
// Grado
// ---------------------------------------------------------------------------

/**
 * Mappa un punteggio 0-100 in un grado A-F.
 * A ≥ 90, B ≥ 75, C ≥ 60, D ≥ 45, E ≥ 30, F < 30.
 */
function calculateGrade(score: number): 'A' | 'B' | 'C' | 'D' | 'E' | 'F' {
  for (const threshold of GRADE_THRESHOLDS) {
    if (score >= threshold.min) return threshold.grade;
  }
  return 'F';
}

// ---------------------------------------------------------------------------
// Helpers interni
// ---------------------------------------------------------------------------

/**
 * Raccoglie i valori più recenti per un elenco di metriche in un dominio.
 * Ogni metrica è interrogata singolarmente tramite queryMetrics.
 *
 * @param domain - Dominio delle metriche (es. 'quality', 'security', 'perf')
 * @param metricNames - Nomi delle metriche da raccogliere
 * @param from - Inizio finestra temporale ISO
 * @param to - Fine finestra temporale ISO
 * @returns Record con nome metrica → ultimo valore disponibile
 */
async function collectDomainMetrics(
  domain: string,
  metricNames: string[],
  from: string,
  to: string
): Promise<Record<string, number>> {
  const result: Record<string, number> = {};

  for (const metricName of metricNames) {
    const value = getLatestMetricValue(domain, metricName, from, to);
    if (value !== null) {
      result[metricName] = value;
    }
  }

  return result;
}

/**
 * Interroga l'ultimo valore disponibile per una metrica in una finestra temporale.
 * Usa queryMetrics con aggregation raw e prende la prima entry (la più recente,
 * ordinata per recorded_at DESC). Se non ci sono dati, restituisce null.
 */
function getLatestMetricValue(
  domain: string,
  metricName: string,
  from: string,
  to: string
): number | null {
  try {
    const result = queryMetrics({
      domain,
      metric_name: metricName,
      from,
      to,
    });

    const entries = result.data as MetricEntry[];
    if (entries.length > 0) {
      return entries[0].value;
    }
    return null;
  } catch {
    return null;
  }
}
