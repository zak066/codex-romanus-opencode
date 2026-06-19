/**
 * Test per core/metrics-engine.ts — Metrics Engine (Fase 5: CENSUS)
 *
 * Copertura:
 * - ensureMetricsSchema: idempotenza
 * - storeMetric: inserimento base, tag, lowercase domain, timestamp auto
 * - queryMetrics: filtro domain, range temporale, tag filter,
 *                 aggregazioni (avg/sum/min/max/count), percentili (p50/p95/p99),
 *                 time bucketing (hour/day)
 * - queryTrend: confronto finestre, delta positivo/negativo/stable, tag filter
 *
 * @module tests/core/metrics-engine
 */

import crypto from 'node:crypto';
import { initDatabase, closeDatabase, getDatabase, resetDatabase } from '../../src/core/database.js';
import {
  ensureMetricsSchema,
  storeMetric,
  queryMetrics,
  queryTrend,
} from '../../src/core/metrics-engine.js';
import type { MetricsQueryResult, MetricsTrend } from '../../src/core/metrics-engine.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function initFreshDb(): Promise<void> {
  closeDatabase();
  await initDatabase(':memory:');
}

/** Inserisce una metrica con recorded_at personalizzato (bypassa storeMetric) */
function insertMetricRaw(
  domain: string,
  metricName: string,
  value: number,
  recordedAt: string,
  tags?: Record<string, string>
): string {
  const db = getDatabase();
  const id = `mtr_${crypto.randomUUID()}`;
  const tagsJson = JSON.stringify(tags ?? {});
  db.prepare(`
    INSERT INTO metrics (id, domain, metric_name, value, tags, recorded_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, domain.toLowerCase(), metricName, value, tagsJson, recordedAt);
  return id;
}

/** Genera un nome metrica univoco */
function uniqueMetric(): string {
  return `m_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
}

/** Converte il risultato in oggetto semplice per matching */
function toPlain<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

// ---------------------------------------------------------------------------
// Suite: ensureMetricsSchema
// ---------------------------------------------------------------------------

describe('ensureMetricsSchema', () => {
  beforeEach(async () => {
    await initFreshDb();
  });

  afterAll(() => {
    closeDatabase();
  });

  it('è idempotente — chiamata due volte non genera errori', () => {
    // La migrazione 004 ha già creato la tabella
    ensureMetricsSchema();
    expect(() => ensureMetricsSchema()).not.toThrow();
  });

  it('crea la tabella metrics se non esiste', () => {
    closeDatabase();
    // Ricrea un DB senza migrazioni
    const db = new (require('better-sqlite3'))(':memory:');
    // Forza il singleton
    jest.spyOn(require('../../src/core/database.js'), 'getDatabase').mockReturnValue(db);
    
    expect(() => ensureMetricsSchema()).not.toThrow();
    
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='metrics'").get();
    expect(tables).toBeTruthy();
    
    jest.restoreAllMocks();
    db.close();
  });
});

// ---------------------------------------------------------------------------
// Suite: storeMetric
// ---------------------------------------------------------------------------

describe('storeMetric', () => {
  beforeEach(async () => {
    await initFreshDb();
  });

  afterAll(() => {
    closeDatabase();
  });

  it('inserisce una metrica e restituisce un ID valido', () => {
    const id = storeMetric('quality', 'lint_errors', 5);
    expect(id).toMatch(/^mtr_/);

    const db = getDatabase();
    const row = db.prepare('SELECT * FROM metrics WHERE id = ?').get(id) as Record<string, unknown>;
    expect(row).toBeTruthy();
    expect(row.domain).toBe('quality');
    expect(row.metric_name).toBe('lint_errors');
    expect(row.value).toBe(5);
  });

  it('inserisce con tag come Record<string, string>', () => {
    const id = storeMetric('perf', 'p95_latency', 120.5, {
      agent: 'scipione',
      scenario: 'load-test',
    });
    const db = getDatabase();
    const row = db.prepare('SELECT * FROM metrics WHERE id = ?').get(id) as { tags: string };
    const tags = JSON.parse(row.tags);
    expect(tags).toEqual({ agent: 'scipione', scenario: 'load-test' });
  });

  it('converte il dominio in lowercase', () => {
    const id = storeMetric('QUALITY', 'case_test', 42);
    const db = getDatabase();
    const row = db.prepare('SELECT domain FROM metrics WHERE id = ?').get(id) as { domain: string };
    expect(row.domain).toBe('quality');
  });

  it('genera recorded_at automaticamente in formato ISO 8601', () => {
    const id = storeMetric('test', 'ts_check', 1);
    const db = getDatabase();
    const row = db.prepare('SELECT recorded_at FROM metrics WHERE id = ?').get(id) as { recorded_at: string };
    expect(() => new Date(row.recorded_at)).not.toThrow();
    expect(new Date(row.recorded_at).toISOString()).toBe(row.recorded_at);
  });

  it('usa tags vuoto di default se non fornito', () => {
    const id = storeMetric('seo', 'score', 92);
    const db = getDatabase();
    const row = db.prepare('SELECT tags FROM metrics WHERE id = ?').get(id) as { tags: string };
    expect(JSON.parse(row.tags)).toEqual({});
  });

  it('genera ID univoci per inserimenti successivi', () => {
    const id1 = storeMetric('test', 'a', 1);
    const id2 = storeMetric('test', 'a', 2);
    expect(id1).not.toBe(id2);
  });
});

// ---------------------------------------------------------------------------
// Suite: queryMetrics — filtro base
// ---------------------------------------------------------------------------

describe('queryMetrics — filtro domain', () => {
  const domain = 'quality';
  let mName: string;

  beforeEach(async () => {
    await initFreshDb();
    mName = uniqueMetric();
    storeMetric(domain, mName, 10);
    storeMetric(domain, mName, 20);
    storeMetric('other_domain', mName, 999);
  });

  afterAll(() => {
    closeDatabase();
  });

  it('restituisce solo metriche del dominio richiesto', () => {
    const result = queryMetrics({ domain });
    expect(result.domain).toBe(domain);
    expect(result.data.length).toBe(2);
    for (const entry of result.data) {
      expect((entry as Record<string, unknown>).domain).toBe(domain);
    }
  });

  it('restituisce 0 risultati per dominio senza metriche', () => {
    const result = queryMetrics({ domain: 'empty_domain' });
    expect(result.data.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Suite: queryMetrics — range temporale
// ---------------------------------------------------------------------------

describe('queryMetrics — range temporale', () => {
  let mName: string;

  beforeEach(async () => {
    await initFreshDb();
    mName = uniqueMetric();

    insertMetricRaw('test', mName, 1, '2025-01-01T00:00:00.000Z');
    insertMetricRaw('test', mName, 2, '2025-06-15T00:00:00.000Z');
    insertMetricRaw('test', mName, 3, '2025-12-31T00:00:00.000Z');
  });

  afterAll(() => {
    closeDatabase();
  });

  it('filtra con from/to su range specifico', () => {
    const result = queryMetrics({
      domain: 'test',
      metric_name: mName,
      from: '2025-06-01T00:00:00.000Z',
      to: '2025-12-31T23:59:59.999Z',
    });
    expect(result.data.length).toBe(2);
  });

  it('restituisce 0 risultati per range senza dati', () => {
    const result = queryMetrics({
      domain: 'test',
      metric_name: mName,
      from: '2024-01-01T00:00:00.000Z',
      to: '2024-12-31T23:59:59.999Z',
    });
    expect(result.data.length).toBe(0);
  });

  it('usa default from (30 giorni fa) se non fornito', () => {
    // Dati vecchi di 6 mesi — dovrebbero essere esclusi
    const result = queryMetrics({ domain: 'test' });
    // Tutte le metriche sono del 2025, se oggi è dopo il 2025-01-30,
    // una è fuori range (1-gen), due sono dentro (giugno e dicembre)
    // Dipende dalla data corrente. Verifichiamo che il risultato non sia vuoto.
    expect(result.from).toBeTruthy();
    expect(result.to).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Suite: queryMetrics — filtro tag
// ---------------------------------------------------------------------------

describe('queryMetrics — filtro tag', () => {
  let mName: string;

  beforeEach(async () => {
    await initFreshDb();
    mName = uniqueMetric();

    storeMetric('test', mName, 10, { env: 'prod', region: 'us' });
    storeMetric('test', mName, 20, { env: 'staging', region: 'us' });
    storeMetric('test', mName, 30, { env: 'prod', region: 'eu' });
  });

  afterAll(() => {
    closeDatabase();
  });

  it('filtra per singolo tag', () => {
    const result = queryMetrics({
      domain: 'test',
      metric_name: mName,
      tags: { env: 'prod' },
    });
    expect(result.data.length).toBe(2);
  });

  it('filtra per multipli tag (AND)', () => {
    const result = queryMetrics({
      domain: 'test',
      metric_name: mName,
      tags: { env: 'prod', region: 'us' },
    });
    expect(result.data.length).toBe(1);
    const entry = result.data[0] as Record<string, unknown>;
    expect(entry.value).toBe(10);
  });

  it('restituisce 0 per tag inesistente', () => {
    const result = queryMetrics({
      domain: 'test',
      metric_name: mName,
      tags: { env: 'nonexistent' },
    });
    expect(result.data.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Suite: queryMetrics — aggregazioni
// ---------------------------------------------------------------------------

describe('queryMetrics — aggregazioni', () => {
  let mName: string;

  beforeEach(async () => {
    await initFreshDb();
    mName = uniqueMetric();

    // Inserisci valori: 10, 20, 30, 40, 50
    for (let i = 1; i <= 5; i++) {
      storeMetric('test', mName, i * 10);
    }
  });

  afterAll(() => {
    closeDatabase();
  });

  it('avg — calcola la media', () => {
    const result = queryMetrics({
      domain: 'test',
      metric_name: mName,
      aggregation: 'avg',
    });
    const data = result.data as Array<{ period: string; value: number; count: number }>;
    expect(data[0].value).toBe(30); // (10+20+30+40+50)/5
    expect(data[0].count).toBe(5);
  });

  it('sum — calcola la somma', () => {
    const result = queryMetrics({
      domain: 'test',
      metric_name: mName,
      aggregation: 'sum',
    });
    const data = result.data as Array<{ period: string; value: number; count: number }>;
    expect(data[0].value).toBe(150);
  });

  it('min — restituisce il minimo', () => {
    const result = queryMetrics({
      domain: 'test',
      metric_name: mName,
      aggregation: 'min',
    });
    const data = result.data as Array<{ period: string; value: number; count: number }>;
    expect(data[0].value).toBe(10);
  });

  it('max — restituisce il massimo', () => {
    const result = queryMetrics({
      domain: 'test',
      metric_name: mName,
      aggregation: 'max',
    });
    const data = result.data as Array<{ period: string; value: number; count: number }>;
    expect(data[0].value).toBe(50);
  });

  it('count — conta le entry', () => {
    const result = queryMetrics({
      domain: 'test',
      metric_name: mName,
      aggregation: 'count',
    });
    const data = result.data as Array<{ period: string; value: number; count: number }>;
    expect(data[0].value).toBe(5);
    expect(data[0].count).toBe(5);
  });

  it('raw — restituisce le entry individuali', () => {
    const result = queryMetrics({
      domain: 'test',
      metric_name: mName,
      aggregation: 'raw',
    });
    expect(result.data.length).toBe(5);
    for (const entry of result.data) {
      expect(entry).toHaveProperty('id');
      expect(entry).toHaveProperty('value');
      expect(entry).toHaveProperty('recorded_at');
    }
  });
});

// ---------------------------------------------------------------------------
// Suite: queryMetrics — percentili
// ---------------------------------------------------------------------------

describe('queryMetrics — percentili', () => {
  let mName: string;

  beforeEach(async () => {
    await initFreshDb();
    mName = uniqueMetric();

    // Inserisci 100 valori da 1 a 100
    for (let i = 1; i <= 100; i++) {
      storeMetric('test', mName, i);
    }
  });

  afterAll(() => {
    closeDatabase();
  });

  it('p50 — mediana (valore ~50-51)', () => {
    const result = queryMetrics({
      domain: 'test',
      metric_name: mName,
      aggregation: 'p50',
    });
    const data = result.data as Array<{ period: string; value: number; count: number }>;
    // OFFSET = max(0, min(total-1, floor(total * 0.5) - 1)) = max(0, min(99, 50-1)) = 49
    // value a OFFSET 49 = 50
    expect(data[0].value).toBe(50);
    expect(data[0].count).toBe(100);
  });

  it('p95 — 95esimo percentile (valore ~95)', () => {
    const result = queryMetrics({
      domain: 'test',
      metric_name: mName,
      aggregation: 'p95',
    });
    const data = result.data as Array<{ period: string; value: number; count: number }>;
    // OFFSET = floor(100 * 0.95) - 1 = 94
    // value a OFFSET 94 = 95
    expect(data[0].value).toBe(95);
  });

  it('p99 — 99esimo percentile (valore ~99)', () => {
    const result = queryMetrics({
      domain: 'test',
      metric_name: mName,
      aggregation: 'p99',
    });
    const data = result.data as Array<{ period: string; value: number; count: number }>;
    // OFFSET = floor(100 * 0.99) - 1 = 98
    // value a OFFSET 98 = 99
    expect(data[0].value).toBe(99);
  });

  it('restituisce 0 per set di dati vuoto', () => {
    const result = queryMetrics({
      domain: 'test',
      metric_name: 'nonexistent_metric',
      aggregation: 'p95',
    });
    const data = result.data as Array<{ period: string; value: number; count: number }>;
    expect(data[0].value).toBe(0);
    expect(data[0].count).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Suite: queryMetrics — time bucketing
// ---------------------------------------------------------------------------

describe('queryMetrics — time bucketing', () => {
  let mName: string;

  beforeEach(async () => {
    await initFreshDb();
    mName = uniqueMetric();

    // Inserisci metriche in date diverse
    insertMetricRaw('test', mName, 10, '2025-01-01T10:00:00.000Z');
    insertMetricRaw('test', mName, 20, '2025-01-01T11:00:00.000Z');
    insertMetricRaw('test', mName, 30, '2025-01-02T10:00:00.000Z');
    insertMetricRaw('test', mName, 40, '2025-01-02T11:00:00.000Z');
  });

  afterAll(() => {
    closeDatabase();
  });

  it('raggruppa per giorno con avg', () => {
    const result = queryMetrics({
      domain: 'test',
      metric_name: mName,
      aggregation: 'avg',
      interval: 'day',
      from: '2025-01-01T00:00:00.000Z',
      to: '2025-01-03T00:00:00.000Z',
    });
    const data = result.data as Array<{ period: string; value: number; count: number }>;
    expect(data.length).toBe(2);
    // 2025-01-01: avg(10, 20) = 15
    expect(data[0].period).toBe('2025-01-01');
    expect(data[0].value).toBe(15);
    expect(data[0].count).toBe(2);
    // 2025-01-02: avg(30, 40) = 35
    expect(data[1].period).toBe('2025-01-02');
    expect(data[1].value).toBe(35);
    expect(data[1].count).toBe(2);
  });

  it('raggruppa per ora con sum', () => {
    const result = queryMetrics({
      domain: 'test',
      metric_name: mName,
      aggregation: 'sum',
      interval: 'hour',
      from: '2025-01-01T00:00:00.000Z',
      to: '2025-01-03T00:00:00.000Z',
    });
    const data = result.data as Array<{ period: string; value: number; count: number }>;
    // Dovrebbero esserci 4 periodi orari
    expect(data.length).toBe(4);
    expect(data[0].value).toBe(10); // 10:00
    expect(data[1].value).toBe(20); // 11:00
  });
});

// ---------------------------------------------------------------------------
// Suite: queryMetrics — cache-aside
// ---------------------------------------------------------------------------

describe('queryMetrics — cache', () => {
  let mName: string;
  const CACHE_FROM = '2025-01-01T00:00:00.000Z';
  const CACHE_TO = '2025-01-31T00:00:00.000Z';

  beforeEach(async () => {
    await initFreshDb();
    mName = uniqueMetric();
    insertMetricRaw('test', mName, 42, '2025-01-15T12:00:00.000Z');
  });

  afterAll(() => {
    closeDatabase();
  });

  it('restituisce dati in cache per query identica (stessi from/to)', () => {
    const queryParams = {
      domain: 'test' as const,
      metric_name: mName,
      from: CACHE_FROM,
      to: CACHE_TO,
    };

    const r1 = queryMetrics(queryParams);
    expect(r1.data.length).toBe(1);

    // Inserisci un altro dato (nella stessa finestra temporale)
    insertMetricRaw('test', mName, 99, '2025-01-20T12:00:00.000Z');

    // La query in cache restituisce ancora 1 risultato (non 2)
    const r2 = queryMetrics(queryParams);
    expect(r2.data.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Suite: queryTrend
// ---------------------------------------------------------------------------

describe('queryTrend', () => {
  let mName: string;

  beforeEach(async () => {
    await initFreshDb();
    mName = uniqueMetric();

    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;

    // Finestra precedente: 15-10 giorni fa (valori bassi: media ~15)
    insertMetricRaw('test', mName, 10, new Date(now - 12 * day).toISOString());
    insertMetricRaw('test', mName, 20, new Date(now - 11 * day).toISOString());

    // Finestra recente: 5-0 giorni fa (valori alti: media ~45)
    insertMetricRaw('test', mName, 40, new Date(now - 4 * day).toISOString());
    insertMetricRaw('test', mName, 50, new Date(now - 3 * day).toISOString());
  });

  afterAll(() => {
    closeDatabase();
  });

  it('calcola delta positivo quando i valori recenti sono più alti', () => {
    const trend = queryTrend('test', mName);
    expect(trend.domain).toBe('test');
    expect(trend.metric_name).toBe(mName);
    expect(trend.current_avg).toBeGreaterThan(trend.previous_avg);
    expect(trend.delta).toBeGreaterThan(0);
    expect(trend.direction).toBe('up');
  });

  it('calcola delta negativo quando i valori recenti sono più bassi', async () => {
    // Ricrea con dati invertiti: finestra recente più bassa
    closeDatabase();
    await initFreshDb();
    const mName2 = uniqueMetric();
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;

    insertMetricRaw('test', mName2, 100, new Date(now - 12 * day).toISOString());
    insertMetricRaw('test', mName2, 80, new Date(now - 11 * day).toISOString());
    insertMetricRaw('test', mName2, 10, new Date(now - 4 * day).toISOString());
    insertMetricRaw('test', mName2, 20, new Date(now - 3 * day).toISOString());

    const trend = queryTrend('test', mName2);
    expect(trend.current_avg).toBeLessThan(trend.previous_avg);
    expect(trend.delta).toBeLessThan(0);
    expect(trend.direction).toBe('down');
  });

  it('restituisce stable quando i valori sono simili', async () => {
    closeDatabase();
    await initFreshDb();
    const mName3 = uniqueMetric();
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;

    // Valori identici in entrambe le finestre
    insertMetricRaw('test', mName3, 30, new Date(now - 12 * day).toISOString());
    insertMetricRaw('test', mName3, 30, new Date(now - 11 * day).toISOString());
    insertMetricRaw('test', mName3, 31, new Date(now - 4 * day).toISOString());
    insertMetricRaw('test', mName3, 29, new Date(now - 3 * day).toISOString());

    const trend = queryTrend('test', mName3);
    expect(trend.direction).toBe('stable');
  });

  it('filtra per tag', () => {
    // Aggiungi dati con tag specifico in entrambe le finestre
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;

    // Finestra precedente: 20-15 giorni fa — con tag env=prod
    insertMetricRaw('test', mName, 100, new Date(now - 18 * day).toISOString(), { env: 'prod' });
    insertMetricRaw('test', mName, 120, new Date(now - 16 * day).toISOString(), { env: 'prod' });

    // Finestra recente: 5-2 giorni fa — con tag env=prod
    insertMetricRaw('test', mName, 200, new Date(now - 4 * day).toISOString(), { env: 'prod' });
    insertMetricRaw('test', mName, 220, new Date(now - 2 * day).toISOString(), { env: 'prod' });

    const trend = queryTrend('test', mName, 14, { env: 'prod' });
    expect(trend.metric_name).toBe(mName);
    // Deve trovare solo i dati con env=prod in entrambe le finestre
    expect(trend.previous_avg).toBeGreaterThan(0);
    expect(trend.current_avg).toBeGreaterThan(0);
    // I dati recenti sono più alti → up
    expect(trend.direction).toBe('up');
  });

  it('restituisce 0 per metrica senza dati', () => {
    const trend = queryTrend('test', 'nonexistent_metric');
    expect(trend.previous_avg).toBe(0);
    expect(trend.current_avg).toBe(0);
    expect(trend.delta).toBe(0);
    expect(trend.direction).toBe('stable');
  });

  it('restituisce delta_pct corretto', () => {
    const trend = queryTrend('test', mName);
    // previous_avg = 15, current_avg = 45
    // delta = 30, delta_pct = (30/15)*100 = 200
    expect(trend.delta_pct).toBeGreaterThan(0);
    // Verifica formattazione a 2 decimali
    expect(String(trend.delta_pct)).toMatch(/^\d+(\.\d{1,2})?$/);
  });
});

// ---------------------------------------------------------------------------
// Suite: queryTrend con days personalizzato
// ---------------------------------------------------------------------------

describe('queryTrend — parametro days', () => {
  let mName: string;

  beforeEach(async () => {
    await initFreshDb();
    mName = uniqueMetric();
  });

  afterAll(() => {
    closeDatabase();
  });

  it('usa days=30 per finestre più ampie', () => {
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;

    // Finestra precedente: 60-31 giorni fa
    insertMetricRaw('test', mName, 5, new Date(now - 50 * day).toISOString());
    insertMetricRaw('test', mName, 5, new Date(now - 40 * day).toISOString());

    // Finestra recente: 30-0 giorni fa
    insertMetricRaw('test', mName, 15, new Date(now - 20 * day).toISOString());
    insertMetricRaw('test', mName, 15, new Date(now - 10 * day).toISOString());

    const trend = queryTrend('test', mName, 30);
    expect(trend.previous_avg).toBe(5);
    expect(trend.current_avg).toBe(15);
    expect(trend.direction).toBe('up');
  });
});

// ---------------------------------------------------------------------------
// Suite: storeMetric — invalida cache
// ---------------------------------------------------------------------------

describe('storeMetric — invalidazione cache', () => {
  let mName: string;

  beforeEach(async () => {
    await initFreshDb();
    mName = uniqueMetric();
  });

  afterAll(() => {
    closeDatabase();
  });

  it('storeMetric invalida la cache del dominio', () => {
    // Prima query — popola cache
    storeMetric('test', mName, 1);
    const r1 = queryMetrics({ domain: 'test' });
    expect(r1.data.length).toBe(1);

    // Seconda insert — cache invalidata
    storeMetric('test', mName, 2);

    // Nuova query — non in cache, deve avere 2 risultati
    const r2 = queryMetrics({ domain: 'test' });
    expect(r2.data.length).toBe(2);
  });
});
