/**
 * Test per core/regression-detector.ts — Regression Alert Engine (Fase 6: AUTOMATA)
 *
 * Copertura:
 * - detectRegressions con queryMetrics mockato
 * - Baseline calcolata correttamente
 * - Deviazione > soglia genera alert
 * - Deviazione < soglia NON genera alert
 * - Severità: low/medium/high/critical in base alla deviazione
 * - Dominio con dati insufficienti (skip graceful)
 * - Dominio senza metriche (skip, nessun errore)
 * - Parametri custom (baselineWindow, deviationThreshold, domains)
 *
 * @module tests/core/regression-detector
 */

import { detectRegressions } from '../../src/core/regression-detector.js';
import type { MetricsQueryResult, MetricEntry } from '../../src/core/metrics-engine.js';

// ---------------------------------------------------------------------------
// Mock queryMetrics
// ---------------------------------------------------------------------------

jest.mock('../../src/core/metrics-engine.js', () => ({
  queryMetrics: jest.fn(),
}));

import { queryMetrics } from '../../src/core/metrics-engine.js';
const mockQueryMetrics = queryMetrics as jest.MockedFunction<typeof queryMetrics>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Crea un risultato queryMetrics per una metrica specifica con valori in
 * ordine decrescente di recorded_at.
 *
 * @param values - Array di [value, ore_fa] — il primo è il più recente
 */
function makeMetricData(values: Array<[number, number]>): MetricsQueryResult {
  const now = Date.now();
  const data: MetricEntry[] = values.map(([val, hoursAgo], i) => ({
    id: `mtr_test_${Math.random().toString(36).substring(2, 8)}`,
    domain: 'quality',
    metric_name: 'lint_errors',
    value: val,
    tags: {},
    recorded_at: new Date(now - hoursAgo * 60 * 60 * 1000).toISOString(),
  }));

  return {
    domain: 'quality',
    metric_name: 'lint_errors',
    aggregation: 'raw',
    from: new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString(),
    to: new Date(now).toISOString(),
    data,
  };
}

/**
 * Crea un risultato queryMetrics vuoto (nessuna metrica per dominio).
 */
function emptyMetricData(domain = 'quality'): MetricsQueryResult {
  return {
    domain,
    from: new Date(0).toISOString(),
    to: new Date().toISOString(),
    data: [],
  };
}

/**
 * Crea un risultato queryMetrics con un solo valore (dati insufficienti).
 */
function singleValueData(domain = 'quality'): MetricsQueryResult {
  return {
    domain,
    metric_name: 'lint_errors',
    aggregation: 'raw',
    from: new Date(0).toISOString(),
    to: new Date().toISOString(),
    data: [
      {
        id: 'mtr_single',
        domain,
        metric_name: 'lint_errors',
        value: 10,
        tags: {},
        recorded_at: new Date().toISOString(),
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Suite: detectRegressions
// ---------------------------------------------------------------------------

describe('detectRegressions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── Baseline corretta ────────────────────────────────────────────────

  it('calcola la baseline come media degli ultimi N valori (escluso corrente)', () => {
    // Valore corrente (ultimo): 5
    // Baseline (precedenti): [3, 1, 2, 4, 3] → avg = 2.6
    // Deviazione: |5 - 2.6| / 2.6 * 100 = 92.3% → critical

    const mockData = makeMetricData([
      [5, 0],   // corrente (più recente)
      [3, 24],  // baseline
      [1, 48],
      [2, 72],
      [4, 96],
      [3, 120],
    ]);

    mockQueryMetrics.mockReturnValue(mockData);

    const result = detectRegressions();

    expect(result.totalMetrics).toBeGreaterThan(0);

    // Dovrebbe aver generato almeno un alert per lint_errors
    const lintAlert = result.alerts.find((a) => a.metricName === 'lint_errors');
    expect(lintAlert).toBeDefined();
    expect(lintAlert!.currentValue).toBe(5);
    expect(lintAlert!.baselineAvg).toBeCloseTo(2.6, 1);
    expect(lintAlert!.deviationPct).toBeGreaterThan(90);
  });

  // ── Deviazione > soglia genera alert ─────────────────────────────────

  it('genera alert quando la deviazione supera la soglia', () => {
    // Valore corrente: 100, baseline avg: 50 → deviazione 100% → critical
    const mockData = makeMetricData([
      [100, 0],
      [50, 24],
      [50, 48],
    ]);

    mockQueryMetrics.mockReturnValue(mockData);

    const result = detectRegressions({ deviationThreshold: 0.20 });

    expect(result.alerts.length).toBeGreaterThan(0);
    expect(result.alerts[0].severity).toBe('critical');
    expect(result.alerts[0].direction).toBe('up');
  });

  // ── Deviazione < soglia NON genera alert ─────────────────────────────

  it('NON genera alert quando la deviazione è sotto la soglia', () => {
    // Valore corrente: 52, baseline: [50, 50] → avg = 50 → deviazione = 4%
    // Soglia 20% → 4% < 20% → nessun alert
    const mockData = makeMetricData([
      [52, 0],
      [50, 24],
      [50, 48],
    ]);

    mockQueryMetrics.mockReturnValue(mockData);

    const result = detectRegressions({ deviationThreshold: 0.20 });

    const lintAlert = result.alerts.find((a) => a.metricName === 'lint_errors');
    expect(lintAlert).toBeUndefined();
    expect(result.alerts.length).toBe(0);
  });

  // ── Severità ─────────────────────────────────────────────────────────

  it('assegna severity low per deviazione < 30%', () => {
    // Valore corrente: 11, baseline: [10] → deviazione = 10% → low
    const mockData = makeMetricData([
      [11, 0],
      [10, 24],
    ]);

    mockQueryMetrics.mockReturnValue(mockData);

    const result = detectRegressions({ deviationThreshold: 0.01 });
    const alert = result.alerts.find((a) => a.metricName === 'lint_errors');
    expect(alert).toBeDefined();
    expect(alert!.severity).toBe('low');
  });

  it('assegna severity medium per deviazione tra 30% e 50%', () => {
    // Valore corrente: 13, baseline: [10] → deviazione = 30% → medium
    const mockData = makeMetricData([
      [13, 0],
      [10, 24],
    ]);

    mockQueryMetrics.mockReturnValue(mockData);

    const result = detectRegressions({ deviationThreshold: 0.01 });
    const alert = result.alerts.find((a) => a.metricName === 'lint_errors');
    expect(alert).toBeDefined();
    expect(alert!.severity).toBe('medium');
  });

  it('assegna severity high per deviazione tra 50% e 75%', () => {
    // Valore corrente: 16, baseline: [10] → deviazione = 60% → high
    const mockData = makeMetricData([
      [16, 0],
      [10, 24],
    ]);

    mockQueryMetrics.mockReturnValue(mockData);

    const result = detectRegressions({ deviationThreshold: 0.01 });
    const alert = result.alerts.find((a) => a.metricName === 'lint_errors');
    expect(alert).toBeDefined();
    expect(alert!.severity).toBe('high');
  });

  it('assegna severity critical per deviazione >= 75%', () => {
    // Valore corrente: 18, baseline: [10] → deviazione = 80% → critical
    const mockData = makeMetricData([
      [18, 0],
      [10, 24],
    ]);

    mockQueryMetrics.mockReturnValue(mockData);

    const result = detectRegressions({ deviationThreshold: 0.01 });
    const alert = result.alerts.find((a) => a.metricName === 'lint_errors');
    expect(alert).toBeDefined();
    expect(alert!.severity).toBe('critical');
  });

  // ── Direction: up (peggioramento) ────────────────────────────────────

  it('segnala direction=up quando il valore corrente è maggiore della baseline', () => {
    const mockData = makeMetricData([
      [20, 0],
      [10, 24],
    ]);

    mockQueryMetrics.mockReturnValue(mockData);

    const result = detectRegressions({ deviationThreshold: 0.01 });
    const alert = result.alerts.find((a) => a.metricName === 'lint_errors');
    expect(alert).toBeDefined();
    expect(alert!.direction).toBe('up');
  });

  // ── Direction: down (miglioramento o peggioramento negativo) ─────────

  it('segnala direction=down quando il valore corrente è minore della baseline', () => {
    // Per metriche come coverage_pct, un valore più basso è peggio
    const mockData = makeMetricData([
      [5, 0],
      [10, 24],
    ]);

    mockQueryMetrics.mockReturnValue(mockData);

    const result = detectRegressions({ deviationThreshold: 0.01 });
    const alert = result.alerts.find((a) => a.metricName === 'lint_errors');
    expect(alert).toBeDefined();
    expect(alert!.direction).toBe('down');
  });

  // ── Dati insufficienti (solo 1 valore) ───────────────────────────────

  it('salta gracefulmente metriche con un solo valore (dati insufficienti)', () => {
    mockQueryMetrics.mockReturnValue(singleValueData());

    const result = detectRegressions();

    // Nessun errore, solo skip
    expect(result.totalMetrics).toBeGreaterThan(0);
    expect(result.alerts.length).toBe(0);
  });

  // ── Dominio senza metriche ───────────────────────────────────────────

  it('salta silentemente domini senza metriche (nessun errore)', () => {
    // queryMetrics restituisce dati vuoti per QUALITY
    mockQueryMetrics.mockReturnValue(emptyMetricData('quality'));

    const result = detectRegressions();

    expect(result.totalMetrics).toBeGreaterThan(0);
    expect(result.alerts.length).toBe(0);
    expect(result.checkedDomains).toContain('quality');
  });

  // ── Parametri custom ─────────────────────────────────────────────────

  it('accetta baselineWindow personalizzato', () => {
    // Con window=2, usa solo 2 valori per la baseline
    const mockData = makeMetricData([
      [100, 0],
      [10, 24],
      [10, 48],
      [10, 72],
    ]);

    mockQueryMetrics.mockReturnValue(mockData);

    // baselineWindow = 2 → baseline = (10 + 10) / 2 = 10
    // deviazione = |100-10|/10*100 = 900% → critical
    const result = detectRegressions({
      baselineWindow: 2,
      deviationThreshold: 0.20,
    });

    const alert = result.alerts.find((a) => a.metricName === 'lint_errors');
    expect(alert).toBeDefined();
    expect(alert!.baselineAvg).toBe(10);
    expect(alert!.deviationPct).toBeGreaterThan(800);
  });

  it('accetta deviationThreshold personalizzato', () => {
    const mockData = makeMetricData([
      [15, 0],
      [10, 24],
    ]);

    mockQueryMetrics.mockReturnValue(mockData);

    // Soglia 50% → deviazione 50% < 50%? No, deviazione = 50% → non dovrebbe
    // superare la soglia se threshold = 0.50 (50%)
    const resultWithHighThreshold = detectRegressions({ deviationThreshold: 0.50 });

    const alertWithHigh = resultWithHighThreshold.alerts.find(
      (a) => a.metricName === 'lint_errors'
    );
    expect(alertWithHigh).toBeUndefined();

    // Soglia 30% → deviazione 50% > 30% → alert
    const resultWithLowThreshold = detectRegressions({ deviationThreshold: 0.30 });

    const alertWithLow = resultWithLowThreshold.alerts.find(
      (a) => a.metricName === 'lint_errors'
    );
    expect(alertWithLow).toBeDefined();
  });

  it('accetta domains personalizzato limitando i domini analizzati', () => {
    // Mock per solo quality
    mockQueryMetrics.mockReturnValue(makeMetricData([
      [100, 0],
      [50, 24],
    ]));

    const result = detectRegressions({
      domains: ['quality'],
      deviationThreshold: 0.01,
    });

    expect(result.checkedDomains).toEqual(['quality']);
    expect(result.alerts.length).toBeGreaterThan(0);

    // Dovrebbe avere solo metriche di quality
    const allQuality = result.alerts.every((a) => a.domain === 'quality');
    expect(allQuality).toBe(true);
  });

  // ── Domini sconosciuti ───────────────────────────────────────────────

  it('salta domini sconosciuti senza generare errori', () => {
    const result = detectRegressions({
      domains: ['nonexistent_domain'],
    });

    expect(result.checkedDomains).toHaveLength(0);
    expect(result.totalMetrics).toBe(0);
    expect(result.alerts).toHaveLength(0);
  });

  // ── Struttura risultato ──────────────────────────────────────────────

  it('restituisce struttura RegressionResult completa', () => {
    mockQueryMetrics.mockReturnValue(makeMetricData([
      [100, 0],
      [50, 24],
      [50, 48],
    ]));

    const result = detectRegressions({ deviationThreshold: 0.01 });

    expect(result).toHaveProperty('totalMetrics');
    expect(result).toHaveProperty('alerts');
    expect(result).toHaveProperty('checkedDomains');
    expect(result).toHaveProperty('durationMs');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(result.alerts)).toBe(true);
    expect(Array.isArray(result.checkedDomains)).toBe(true);

    if (result.alerts.length > 0) {
      const alert = result.alerts[0];
      expect(alert).toHaveProperty('id');
      expect(alert).toHaveProperty('domain');
      expect(alert).toHaveProperty('metricName');
      expect(alert).toHaveProperty('currentValue');
      expect(alert).toHaveProperty('baselineAvg');
      expect(alert).toHaveProperty('deviationPct');
      expect(alert).toHaveProperty('direction');
      expect(alert).toHaveProperty('severity');
      expect(alert).toHaveProperty('message');
      expect(alert).toHaveProperty('detectedAt');
      expect(alert.id).toMatch(/^alr_/);
    }
  });

  // ── Alert ID univoco ─────────────────────────────────────────────────

  it('genera ID univoci per ogni alert', () => {
    // Mock per tutte le metriche di quality
    mockQueryMetrics.mockReturnValue(makeMetricData([
      [100, 0],
      [50, 24],
    ]));

    const result = detectRegressions({
      domains: ['quality'],
      deviationThreshold: 0.01,
    });

    const ids = result.alerts.map((a) => a.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  // ── Baseline zero → skip ─────────────────────────────────────────────

  it('salta metriche con baseline zero (deviazione infinita)', () => {
    // Baseline = 0 → deviazione non calcolabile → skip
    const mockData = makeMetricData([
      [10, 0],
      [0, 24],
      [0, 48],
    ]);

    mockQueryMetrics.mockReturnValue(mockData);

    const result = detectRegressions({ deviationThreshold: 0.01 });

    // Dovrebbe skippare lint_errors
    const lintAlert = result.alerts.find((a) => a.metricName === 'lint_errors');
    expect(lintAlert).toBeUndefined();
  });
});
