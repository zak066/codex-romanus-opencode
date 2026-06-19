/**
 * Test per core/trend-analyzer.ts — Trend Analyzer esteso (Fase 5: CENSUS)
 *
 * Copertura:
 * - analyzeMetricTrend: trend reale su metriche inserite
 * - analyzeDomainMetricTrends: trend per dominio
 * - generateTrendReport: con parametro domain
 *
 * @module tests/core/metrics-trend
 */

import crypto from 'node:crypto';
import { initDatabase, closeDatabase, getDatabase, resetDatabase } from '../../src/core/database.js';
import { ensureMetricsSchema, storeMetric, queryTrend } from '../../src/core/metrics-engine.js';
import {
  analyzeMetricTrend,
  analyzeDomainMetricTrends,
  generateTrendReport,
} from '../../src/core/trend-analyzer.js';
import type { DomainMetricTrend, DomainTrendSummary } from '../../src/core/trend-analyzer.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function initFreshDb(): Promise<void> {
  closeDatabase();
  await initDatabase(':memory:');
  ensureMetricsSchema();
}

/** Inserisce metrica con recorded_at arbitrario */
function insertMetricRaw(
  domain: string,
  metricName: string,
  value: number,
  recordedAt: string,
): string {
  const db = getDatabase();
  const id = `mtr_${crypto.randomUUID()}`;
  db.prepare(`
    INSERT INTO metrics (id, domain, metric_name, value, tags, recorded_at)
    VALUES (?, ?, ?, ?, '{}', ?)
  `).run(id, domain.toLowerCase(), metricName, value, recordedAt);
  return id;
}

function uniqueMetric(): string {
  return `tm_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
}

// ---------------------------------------------------------------------------
// Suite: analyzeMetricTrend
// ---------------------------------------------------------------------------

describe('analyzeMetricTrend', () => {
  let mName: string;

  beforeEach(async () => {
    await initFreshDb();
    mName = uniqueMetric();
  });

  afterAll(() => {
    closeDatabase();
  });

  it('restituisce trend up per valori recenti in aumento', () => {
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;

    // Valori precedenti (12-10 giorni fa): media ~15
    insertMetricRaw('quality', mName, 10, new Date(now - 12 * day).toISOString());
    insertMetricRaw('quality', mName, 20, new Date(now - 10 * day).toISOString());

    // Valori recenti (4-2 giorni fa): media ~45
    insertMetricRaw('quality', mName, 40, new Date(now - 4 * day).toISOString());
    insertMetricRaw('quality', mName, 50, new Date(now - 2 * day).toISOString());

    const trend = analyzeMetricTrend('quality', mName);
    expect(trend.domain).toBe('quality');
    expect(trend.metric_name).toBe(mName);
    expect(trend.direction).toBe('up');
    expect(trend.current_avg).toBeGreaterThan(trend.previous_avg);
  });

  it('restituisce trend down per valori recenti in calo', () => {
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;

    insertMetricRaw('quality', mName, 100, new Date(now - 12 * day).toISOString());
    insertMetricRaw('quality', mName, 80, new Date(now - 10 * day).toISOString());
    insertMetricRaw('quality', mName, 10, new Date(now - 4 * day).toISOString());
    insertMetricRaw('quality', mName, 20, new Date(now - 2 * day).toISOString());

    const trend = analyzeMetricTrend('quality', mName);
    expect(trend.direction).toBe('down');
    expect(trend.current_avg).toBeLessThan(trend.previous_avg);
  });

  it('restituisce stable per valori simili', () => {
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;

    insertMetricRaw('quality', mName, 30, new Date(now - 12 * day).toISOString());
    insertMetricRaw('quality', mName, 30, new Date(now - 10 * day).toISOString());
    insertMetricRaw('quality', mName, 31, new Date(now - 4 * day).toISOString());
    insertMetricRaw('quality', mName, 29, new Date(now - 2 * day).toISOString());

    const trend = analyzeMetricTrend('quality', mName);
    expect(trend.direction).toBe('stable');
  });

  it('restituisce tutti i campi DomainMetricTrend', () => {
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;

    insertMetricRaw('perf', mName, 50, new Date(now - 12 * day).toISOString());
    insertMetricRaw('perf', mName, 100, new Date(now - 4 * day).toISOString());

    const trend = analyzeMetricTrend('perf', mName);

    const expectedKeys: Array<keyof DomainMetricTrend> = [
      'domain',
      'metric_name',
      'previous_avg',
      'current_avg',
      'delta',
      'delta_pct',
      'direction',
    ];
    for (const key of expectedKeys) {
      expect(trend).toHaveProperty(key);
    }
    expect(trend.domain).toBe('perf');
  });

  it('restituisce stable per metrica senza dati', () => {
    const trend = analyzeMetricTrend('quality', 'nonexistent_metric');
    expect(trend.previous_avg).toBe(0);
    expect(trend.current_avg).toBe(0);
    expect(trend.delta).toBe(0);
    expect(trend.direction).toBe('stable');
  });

  it('accetta parametro days personalizzato', () => {
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;

    // Inserisci dati in finestre di 30 giorni
    insertMetricRaw('test', mName, 5, new Date(now - 50 * day).toISOString());
    insertMetricRaw('test', mName, 5, new Date(now - 40 * day).toISOString());
    insertMetricRaw('test', mName, 15, new Date(now - 20 * day).toISOString());
    insertMetricRaw('test', mName, 15, new Date(now - 10 * day).toISOString());

    const trend = analyzeMetricTrend('test', mName, 30);
    expect(trend.previous_avg).toBe(5);
    expect(trend.current_avg).toBe(15);
    expect(trend.direction).toBe('up');
  });

  it('accetta parametro tags per filtrare', () => {
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;

    // Dati con tag agent=catone
    storeMetric('test', mName, 10, { agent: 'catone' });
    storeMetric('test', mName, 20, { agent: 'catone' });

    const trend = analyzeMetricTrend('test', mName, 7, { agent: 'catone' });
    expect(trend.metric_name).toBe(mName);
  });
});

// ---------------------------------------------------------------------------
// Suite: analyzeDomainMetricTrends
// ---------------------------------------------------------------------------

describe('analyzeDomainMetricTrends', () => {
  beforeEach(async () => {
    await initFreshDb();
  });

  afterAll(() => {
    closeDatabase();
  });

  it('restituisce trend per tutte le metriche di default del dominio quality', () => {
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;

    // Inserisci dati per ogni metrica quality di default
    const defaultQualityMetrics = ['lint_errors', 'coverage_pct', 'ts_errors', 'lint_warnings', 'bundle_size_kb'];

    for (const metric of defaultQualityMetrics) {
      insertMetricRaw('quality', metric, 10, new Date(now - 12 * day).toISOString());
      insertMetricRaw('quality', metric, 20, new Date(now - 4 * day).toISOString());
    }

    const results = analyzeDomainMetricTrends('quality');
    expect(results.length).toBe(defaultQualityMetrics.length);
    expect(results.every((r) => r.domain === 'quality')).toBe(true);

    const metricNames = results.map((r) => r.metric_name).sort();
    expect(metricNames).toEqual(defaultQualityMetrics.sort());
  });

  it('accetta metricNames personalizzati sovrascrivendo i default', () => {
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;

    insertMetricRaw('test', 'custom_metric_a', 10, new Date(now - 12 * day).toISOString());
    insertMetricRaw('test', 'custom_metric_a', 20, new Date(now - 4 * day).toISOString());
    insertMetricRaw('test', 'custom_metric_b', 5, new Date(now - 12 * day).toISOString());
    insertMetricRaw('test', 'custom_metric_b', 15, new Date(now - 4 * day).toISOString());

    const results = analyzeDomainMetricTrends('test', ['custom_metric_a', 'custom_metric_b']);
    expect(results.length).toBe(2);
    const names = results.map((r) => r.metric_name).sort();
    expect(names).toEqual(['custom_metric_a', 'custom_metric_b']);
  });

  it('restituisce array vuoto per dominio sconosciuto senza metricNames', () => {
    const results = analyzeDomainMetricTrends('unknown_domain');
    expect(results).toEqual([]);
  });

  it('ogni entry DomainMetricTrend ha struttura valida', () => {
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;

    insertMetricRaw('perf', 'p50_latency_ms', 50, new Date(now - 12 * day).toISOString());
    insertMetricRaw('perf', 'p50_latency_ms', 100, new Date(now - 4 * day).toISOString());

    const results = analyzeDomainMetricTrends('perf');
    expect(results.length).toBeGreaterThan(0);

    for (const r of results) {
      expect(r).toHaveProperty('domain');
      expect(r).toHaveProperty('metric_name');
      expect(r).toHaveProperty('previous_avg');
      expect(r).toHaveProperty('current_avg');
      expect(r).toHaveProperty('delta');
      expect(r).toHaveProperty('delta_pct');
      expect(r).toHaveProperty('direction');
      expect(['up', 'down', 'stable']).toContain(r.direction);
    }
  });
});

// ---------------------------------------------------------------------------
// Suite: generateTrendReport
// ---------------------------------------------------------------------------

describe('generateTrendReport', () => {
  beforeEach(async () => {
    await initFreshDb();
  });

  afterAll(() => {
    closeDatabase();
  });

  it('genera report senza domain — solo models, agents, errors, generatedAt', () => {
    const report = generateTrendReport();
    expect(report).toHaveProperty('models');
    expect(report).toHaveProperty('agents');
    expect(report).toHaveProperty('errors');
    expect(report).toHaveProperty('generatedAt');
    expect(report.metrics).toBeUndefined();
    expect(() => new Date(report.generatedAt)).not.toThrow();
  });

  it('genera report con domain — include metrics array', () => {
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;

    // Inserisci dati per metriche quality
    insertMetricRaw('quality', 'lint_errors', 5, new Date(now - 12 * day).toISOString());
    insertMetricRaw('quality', 'lint_errors', 15, new Date(now - 4 * day).toISOString());
    insertMetricRaw('quality', 'coverage_pct', 80, new Date(now - 12 * day).toISOString());
    insertMetricRaw('quality', 'coverage_pct', 90, new Date(now - 4 * day).toISOString());

    const report = generateTrendReport('quality');
    expect(report.metrics).toBeDefined();
    expect(report.metrics!.length).toBeGreaterThanOrEqual(2);
    expect(report.metrics!.every((m) => m.domain === 'quality')).toBe(true);
  });

  it('report con domain restituisce metriche significative', () => {
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;

    // Inserisci trend up chiaro
    insertMetricRaw('quality', 'lint_errors', 5, new Date(now - 12 * day).toISOString());
    insertMetricRaw('quality', 'lint_errors', 5, new Date(now - 10 * day).toISOString());
    insertMetricRaw('quality', 'lint_errors', 25, new Date(now - 4 * day).toISOString());
    insertMetricRaw('quality', 'lint_errors', 35, new Date(now - 3 * day).toISOString());

    const report = generateTrendReport('quality');
    expect(report.metrics).toBeDefined();

    const lintTrend = report.metrics!.find((m) => m.metric_name === 'lint_errors');
    expect(lintTrend).toBeDefined();
    expect(lintTrend!.direction).toBe('up');
    expect(lintTrend!.current_avg).toBeGreaterThan(lintTrend!.previous_avg);
  });

  it('generatedAt è in formato ISO 8601', () => {
    const report = generateTrendReport();
    expect(report.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it('report senza errori se DB ha solo migration ma nessun dato di sessioni/eventi', () => {
    // initFreshDb crea solo la tabella metrics ma non sessioni/eventi
    const report = generateTrendReport('quality');
    expect(report.models).toEqual([]);
    expect(report.agents).toEqual([]);
    expect(report.errors).toEqual([]);
    expect(report.metrics).toBeDefined();
  });

  it('non lancia eccezioni se chiamato senza init', async () => {
    closeDatabase(); // DB non inizializzato
    // generateTrendReport non tocca direttamente il DB per models/agents/errors
    // ma analyzeDomainMetricTrends sì — non lancia
    expect(() => generateTrendReport('quality')).not.toThrow();
    // Inizializza di nuovo per i test successivi
    await initFreshDb();
  });
});
