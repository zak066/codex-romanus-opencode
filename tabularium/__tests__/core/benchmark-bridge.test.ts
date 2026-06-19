/**
 * Test per core/benchmark-bridge.ts — Benchmark Bridge (Fase 5: CENSUS)
 *
 * Copertura:
 * - snapshotBenchmark: verifica che chiami storeMetric con domain="perf"
 * - collectAllBenchmarks: con file results.json mockato (mock fs)
 *
 * @module tests/core/benchmark-bridge
 */

import fs from 'node:fs';
import { initDatabase, closeDatabase, getDatabase, resetDatabase } from '../../src/core/database.js';
import { ensureMetricsSchema } from '../../src/core/metrics-engine.js';
import {
  snapshotBenchmark,
  collectAllBenchmarks,
} from '../../src/core/benchmark-bridge.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function initFreshDb(): Promise<void> {
  closeDatabase();
  await initDatabase(':memory:');
  ensureMetricsSchema();
}

// ---------------------------------------------------------------------------
// Suite: snapshotBenchmark
// ---------------------------------------------------------------------------

describe('snapshotBenchmark', () => {
  beforeEach(async () => {
    await initFreshDb();
  });

  afterAll(() => {
    closeDatabase();
  });

  it('salva un benchmark con domain="perf" e restituisce ID valido', () => {
    const id = snapshotBenchmark('sqlite-read', 0.5, 'ms');
    expect(id).toMatch(/^mtr_/);

    const db = getDatabase();
    const row = db.prepare('SELECT * FROM metrics WHERE id = ?').get(id) as Record<string, unknown>;
    expect(row.domain).toBe('perf');
    expect(row.metric_name).toContain('sqlite_read');
  });

  it('aggiunge l\'unità come suffisso al nome metrica', () => {
    const id = snapshotBenchmark('latency', 120, 'ms');
    const db = getDatabase();
    const row = db.prepare('SELECT metric_name FROM metrics WHERE id = ?').get(id) as { metric_name: string };
    expect(row.metric_name.endsWith('_ms')).toBe(true);
  });

  it('normalizza il nome benchmark: spazi e trattini diventano underscore', () => {
    const id = snapshotBenchmark('big-load-test', 999, 'ms');
    const db = getDatabase();
    const row = db.prepare('SELECT metric_name FROM metrics WHERE id = ?').get(id) as { metric_name: string };
    // 'big-load-test' → 'big_load_test' → 'big_load_test_ms'
    expect(row.metric_name).toBe('big_load_test_ms');
  });

  it('aggiunge unità nei tags', () => {
    const id = snapshotBenchmark('throughput', 1500, 'ops/s');
    const db = getDatabase();
    const row = db.prepare('SELECT tags FROM metrics WHERE id = ?').get(id) as { tags: string };
    const tags = JSON.parse(row.tags);
    expect(tags.unit).toBe('ops/s');
  });

  it('unisce tags personalizzati con unit', () => {
    const id = snapshotBenchmark('query', 5.2, 'ms', { scenario: 'select', engine: 'sqlite' });
    const db = getDatabase();
    const row = db.prepare('SELECT tags FROM metrics WHERE id = ?').get(id) as { tags: string };
    const tags = JSON.parse(row.tags);
    expect(tags.scenario).toBe('select');
    expect(tags.engine).toBe('sqlite');
    expect(tags.unit).toBe('ms');
  });

  it('converte unità in suffisso senza duplicazione', () => {
    const id = snapshotBenchmark('query_ms', 100, 'ms');
    const db = getDatabase();
    const row = db.prepare('SELECT metric_name FROM metrics WHERE id = ?').get(id) as { metric_name: string };
    // 'query_ms' già termina con '_ms' → non duplica
    expect(row.metric_name).toBe('query_ms');
  });

  it('converte nome benchmark in lowercase', () => {
    const id = snapshotBenchmark('LATENCY_TEST', 50, 'ms');
    const db = getDatabase();
    const row = db.prepare('SELECT metric_name FROM metrics WHERE id = ?').get(id) as { metric_name: string };
    expect(row.metric_name).toBe('latency_test_ms');
  });

  it('gestisce unità percentuale (%)', () => {
    const id = snapshotBenchmark('cpu_usage', 75, '%');
    const db = getDatabase();
    const row = db.prepare('SELECT metric_name FROM metrics WHERE id = ?').get(id) as { metric_name: string };
    expect(row.metric_name).toBe('cpu_usage_pct');
  });

  it('gestisce unità MB/s', () => {
    const id = snapshotBenchmark('disk_write', 500, 'MB/s');
    const db = getDatabase();
    const row = db.prepare('SELECT metric_name FROM metrics WHERE id = ?').get(id) as { metric_name: string };
    expect(row.metric_name).toBe('disk_write_mb_per_s');
  });
});

// ---------------------------------------------------------------------------
// Suite: collectAllBenchmarks
// ---------------------------------------------------------------------------

describe('collectAllBenchmarks', () => {
  let existsSpy: jest.SpyInstance;
  let readFileSpy: jest.SpyInstance;

  beforeEach(async () => {
    await initFreshDb();
    existsSpy = jest.spyOn(fs, 'existsSync');
    readFileSpy = jest.spyOn(fs, 'readFileSync');
  });

  afterEach(() => {
    existsSpy.mockRestore();
    readFileSpy.mockRestore();
  });

  afterAll(() => {
    closeDatabase();
  });

  it('carica results.json e storea i benchmark come metriche perf', () => {
    const mockResults = {
      results: [
        { name: 'sqlite-read', value: 0.5, unit: 'ms' },
        { name: 'sqlite-write', value: 1.2, unit: 'ms' },
        { name: 'throughput', value: 5000, unit: 'ops/s' },
      ],
    };

    existsSpy.mockReturnValue(true);
    readFileSpy.mockReturnValue(JSON.stringify(mockResults));

    const stored = collectAllBenchmarks();

    expect(stored).toBe(3);

    // Verifica nel DB
    const db = getDatabase();
    const rows = db.prepare('SELECT * FROM metrics WHERE domain = ?').all('perf') as Array<Record<string, unknown>>;
    expect(rows.length).toBe(3);

    const names = rows.map((r) => r.metric_name).sort();
    expect(names).toContain('sqlite_read_ms');
    expect(names).toContain('sqlite_write_ms');
    expect(names).toContain('throughput_ops_per_s');
  });

  it('restituisce 0 se results.json non esiste', () => {
    existsSpy.mockReturnValue(false);

    const stored = collectAllBenchmarks();
    expect(stored).toBe(0);
  });

  it('restituisce 0 se results.json non è parsabile', () => {
    existsSpy.mockReturnValue(true);
    readFileSpy.mockReturnValue('invalid json');

    const stored = collectAllBenchmarks();
    expect(stored).toBe(0);
  });

  it('restituisce 0 se il file non ha array results', () => {
    existsSpy.mockReturnValue(true);
    readFileSpy.mockReturnValue(JSON.stringify({ not_results: [] }));

    const stored = collectAllBenchmarks();
    expect(stored).toBe(0);
  });

  it('restituisce 0 se results è array vuoto', () => {
    existsSpy.mockReturnValue(true);
    readFileSpy.mockReturnValue(JSON.stringify({ results: [] }));

    const stored = collectAllBenchmarks();
    expect(stored).toBe(0);
  });

  it('gestisce errore di lettura file', () => {
    existsSpy.mockReturnValue(true);
    readFileSpy.mockImplementation(() => { throw new Error('Permission denied'); });

    expect(() => collectAllBenchmarks()).not.toThrow();
    const stored = collectAllBenchmarks();
    expect(stored).toBe(0);
  });

  it('gestisce tag opzionali in results.json', () => {
    const mockResults = {
      results: [
        { name: 'query', value: 10, unit: 'ms', tags: { scenario: 'oltp', version: 'v2' } },
      ],
    };

    existsSpy.mockReturnValue(true);
    readFileSpy.mockReturnValue(JSON.stringify(mockResults));

    collectAllBenchmarks();

    const db = getDatabase();
    const row = db.prepare('SELECT tags FROM metrics').get() as { tags: string };
    const tags = JSON.parse(row.tags);
    expect(tags.scenario).toBe('oltp');
    expect(tags.version).toBe('v2');
  });
});
