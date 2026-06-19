/**
 * Test per core/quality-collector.ts — Quality Collector (Fase 5: CENSUS)
 *
 * Copertura:
 * - collectQualityMetrics: con execSync mockato per ogni tool
 * - snapshotQuality: verifica che chiami storeMetric per ogni metrica raccolta
 *
 * @module tests/core/quality-collector
 */

import { execSync } from 'node:child_process';
import path from 'node:path';
import { initDatabase, closeDatabase, getDatabase, resetDatabase } from '../../src/core/database.js';
import { ensureMetricsSchema } from '../../src/core/metrics-engine.js';
import {
  collectQualityMetrics,
  snapshotQuality,
} from '../../src/core/quality-collector.js';
import type { QualityMetrics } from '../../src/core/quality-collector.js';

// ---------------------------------------------------------------------------
// Mock execSync
// ---------------------------------------------------------------------------

jest.mock('node:child_process', () => ({
  execSync: jest.fn(),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function initFreshDb(): Promise<void> {
  closeDatabase();
  await initDatabase(':memory:');
  ensureMetricsSchema();
}

const mockExecSync = execSync as jest.MockedFunction<typeof execSync>;

// ---------------------------------------------------------------------------
// Suite: collectQualityMetrics
// ---------------------------------------------------------------------------

describe('collectQualityMetrics', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('raccoglie tutte le metriche con esecuzioni riuscite', () => {
    // Mock eslint output
    mockExecSync
      .mockImplementationOnce(() => JSON.stringify([
        { errorCount: 3, warningCount: 5 },
        { errorCount: 1, warningCount: 2 },
      ])) // collectLintErrors
      .mockImplementationOnce(() => JSON.stringify([
        { errorCount: 3, warningCount: 5 },
        { errorCount: 1, warningCount: 2 },
      ])) // collectLintWarnings
      .mockImplementationOnce(() => 'No errors found') // collectTsErrors (nessun error TS)
      .mockImplementationOnce(() => 'Tests: 42 passed, 3 failed') // collectTestPass
      .mockImplementationOnce(() => 'Tests: 42 passed, 3 failed') // collectTestFail
      .mockImplementationOnce(() => {
        // collectCoveragePct — output con tabella
        return `
          -----------|---------|----------|---------|---------|-------------------
          File       | % Stmts | % Branch | % Funcs | % Lines | Uncovered Line #s
          -----------|---------|----------|---------|---------|-------------------
          All files  |    85.5 |    79.23 |    90.1 |    88.3 |
          -----------|---------|----------|---------|---------|-------------------
        `;
      });

    const metrics = collectQualityMetrics('/fake/project');

    expect(metrics.lint_errors).toBe(4); // 3 + 1
    expect(metrics.lint_warnings).toBe(7); // 5 + 2
    expect(metrics.ts_errors).toBe(0);
    expect(metrics.test_pass).toBe(42);
    expect(metrics.test_fail).toBe(3);
    // collectione coverage: cerca il primo numero nella riga "All files"
    expect(metrics.coverage_pct).toBe(85.5);
    // bundle_size_kb: dist/ non esiste → -1
    expect(metrics.bundle_size_kb).toBe(-1);

    // Verifica che execSync sia stato chiamato per ogni tool
    expect(mockExecSync).toHaveBeenCalled();
  });

  it('gestisce fallimenti di tool con -1', () => {
    // Tutti i tool lanciano eccezioni
    mockExecSync.mockImplementation(() => {
      throw new Error('Tool not found');
    });

    const metrics = collectQualityMetrics('/fake/project');

    expect(metrics.lint_errors).toBe(-1);
    expect(metrics.lint_warnings).toBe(-1);
    expect(metrics.ts_errors).toBe(-1);
    expect(metrics.test_pass).toBe(-1);
    expect(metrics.test_fail).toBe(-1);
    expect(metrics.coverage_pct).toBe(-1);
    expect(metrics.bundle_size_kb).toBe(-1);
  });

  it('restituisce sempre la struttura QualityMetrics completa', () => {
    mockExecSync.mockImplementation(() => {
      throw new Error('fail');
    });

    const metrics = collectQualityMetrics('/fake/project');

    const expectedKeys: Array<keyof QualityMetrics> = [
      'lint_errors',
      'lint_warnings',
      'ts_errors',
      'test_pass',
      'test_fail',
      'coverage_pct',
      'bundle_size_kb',
    ];

    for (const key of expectedKeys) {
      expect(metrics).toHaveProperty(key);
    }
  });

  it('colleziona lint_errors da output eslint JSON', () => {
    mockExecSync
      .mockImplementationOnce(() => JSON.stringify([{ errorCount: 5 }, { errorCount: 3 }]))
      .mockImplementation(() => { throw new Error('skip'); });

    const metrics = collectQualityMetrics('/fake/project');
    expect(metrics.lint_errors).toBe(8);
  });

  it('colleziona lint_warnings da output eslint JSON', () => {
    mockExecSync
      .mockImplementationOnce(() => { throw new Error('skip lint errors'); })
      .mockImplementationOnce(() => JSON.stringify([{ warningCount: 2 }, { warningCount: 4 }]))
      .mockImplementation(() => { throw new Error('skip'); });

    const metrics = collectQualityMetrics('/fake/project');
    expect(metrics.lint_warnings).toBe(6);
  });

  it('colleziona ts_errors contando linee "error TS"', () => {
    mockExecSync
      .mockImplementationOnce(() => { throw new Error('skip'); })
      .mockImplementationOnce(() => { throw new Error('skip'); })
      .mockImplementationOnce(() => {
        // tsc può lanciare errore con stderr pieno di errori TS
        const err = new Error('tsc failed') as Error & { stderr: string };
        err.stderr = 'src/file.ts:1:1 - error TS2322: Type mismatch\nsrc/file2.ts:5:3 - error TS2554: Wrong args';
        throw err;
      })
      .mockImplementation(() => { throw new Error('skip'); });

    const metrics = collectQualityMetrics('/fake/project');
    expect(metrics.ts_errors).toBe(2);
  });

  it('colleziona test_pass da output jest', () => {
    mockExecSync
      .mockImplementationOnce(() => { throw new Error('skip'); })
      .mockImplementationOnce(() => { throw new Error('skip'); })
      .mockImplementationOnce(() => { throw new Error('skip'); })
      .mockImplementationOnce(() => 'Tests: 150 passed, 5 failed')
      .mockImplementation(() => { throw new Error('skip'); });

    const metrics = collectQualityMetrics('/fake/project');
    expect(metrics.test_pass).toBe(150);
  });

  it('colleziona test_fail da output jest', () => {
    mockExecSync
      .mockImplementationOnce(() => { throw new Error('skip'); })
      .mockImplementationOnce(() => { throw new Error('skip'); })
      .mockImplementationOnce(() => { throw new Error('skip'); })
      .mockImplementationOnce(() => { throw new Error('skip'); })
      .mockImplementationOnce(() => 'Tests: 150 passed, 5 failed');

    const metrics = collectQualityMetrics('/fake/project');
    expect(metrics.test_fail).toBe(5);
  });

  it('test_fail = 0 se non ci sono "X failed" nel summary', () => {
    mockExecSync
      .mockImplementationOnce(() => { throw new Error('skip'); })
      .mockImplementationOnce(() => { throw new Error('skip'); })
      .mockImplementationOnce(() => { throw new Error('skip'); })
      .mockImplementationOnce(() => { throw new Error('skip'); })
      .mockImplementationOnce(() => 'Tests: 10 passed'); // nessun failed

    const metrics = collectQualityMetrics('/fake/project');
    expect(metrics.test_fail).toBe(0);
  });

  it('colleziona coverage_pct dal summary table', () => {
    mockExecSync
      .mockImplementationOnce(() => { throw new Error('skip'); })
      .mockImplementationOnce(() => { throw new Error('skip'); })
      .mockImplementationOnce(() => { throw new Error('skip'); })
      .mockImplementationOnce(() => { throw new Error('skip'); })
      .mockImplementationOnce(() => { throw new Error('skip'); })
      .mockImplementationOnce(() => {
        // Coverage output senza tabella "All files", con fallback
        return 'Coverage summary: 92.5% | ...';
      });

    const metrics = collectQualityMetrics('/fake/project');
    expect(metrics.coverage_pct).toBe(92.5);
  });
});

// ---------------------------------------------------------------------------
// Suite: snapshotQuality
// ---------------------------------------------------------------------------

describe('snapshotQuality', () => {
  beforeEach(async () => {
    await initFreshDb();
    jest.clearAllMocks();
  });

  afterAll(() => {
    closeDatabase();
  });

  it('chiama storeMetric per ogni metrica raccolta', () => {
    // Tutte le metriche restituiscono valori validi
    mockExecSync
      .mockImplementationOnce(() => JSON.stringify([{ errorCount: 2, warningCount: 3 }]))
      .mockImplementationOnce(() => JSON.stringify([{ errorCount: 2, warningCount: 3 }]))
      .mockImplementationOnce(() => 'No errors')
      .mockImplementationOnce(() => 'Tests: 100 passed, 2 failed')
      .mockImplementationOnce(() => 'Tests: 100 passed, 2 failed')
      .mockImplementationOnce(() => {
        return `
          -----------|---------|----------|---------|---------|-------------------
          File       | % Stmts | % Branch | % Funcs | % Lines |
          -----------|---------|----------|---------|---------|-------------------
          All files  |    90.0 |    80.0  |    85.0 |    88.0 |
          -----------|---------|----------|---------|---------|-------------------
        `;
      });

    snapshotQuality('/fake/project');

    // Verifica che le metriche siano state storeate nel DB
    const db = getDatabase();
    const rows = db.prepare('SELECT metric_name, value FROM metrics WHERE domain = ? ORDER BY metric_name').all('quality') as Array<{ metric_name: string; value: number }>;

    // Dovrebbero esserci 7 metriche
    expect(rows.length).toBe(7);

    const metricMap = new Map(rows.map((r) => [r.metric_name, r.value]));
    expect(metricMap.get('lint_errors')).toBe(2);
    expect(metricMap.get('lint_warnings')).toBe(3);
    expect(metricMap.get('ts_errors')).toBe(0);
    expect(metricMap.get('test_pass')).toBe(100);
    expect(metricMap.get('test_fail')).toBe(2);
    expect(metricMap.get('coverage_pct')).toBe(90);
    expect(metricMap.get('bundle_size_kb')).toBe(-1);
  });

  it('chiama storeMetric con tags opzionali', () => {
    mockExecSync.mockImplementation(() => { throw new Error('fail'); });

    snapshotQuality('/fake/project', { agent: 'catone', branch: 'main' });

    const db = getDatabase();
    const rows = db.prepare('SELECT tags FROM metrics WHERE domain = ?').all('quality') as Array<{ tags: string }>;

    // Ogni metrica deve avere i tag passati
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const tags = JSON.parse(row.tags);
      expect(tags.agent).toBe('catone');
      expect(tags.branch).toBe('main');
    }
  });

  it('non lancia eccezioni se collectQualityMetrics fallisce internamente', () => {
    // execSync lancia per ogni chiamata
    mockExecSync.mockImplementation(() => { throw new Error('fail'); });

    // snapshotQuality ha try/catch interno
    expect(() => snapshotQuality('/fake/project')).not.toThrow();

    // Tutti i valori sono -1
    const db = getDatabase();
    const rows = db.prepare('SELECT value FROM metrics WHERE domain = ?').all('quality') as Array<{ value: number }>;
    expect(rows.length).toBe(7);
    for (const row of rows) {
      expect(row.value).toBe(-1);
    }
  });

  it('usa dominio "quality" per tutte le metriche', () => {
    mockExecSync.mockImplementation(() => { throw new Error('fail'); });

    snapshotQuality('/fake/project');

    const db = getDatabase();
    const domains = db.prepare('SELECT DISTINCT domain FROM metrics').all() as Array<{ domain: string }>;
    expect(domains.length).toBe(1);
    expect(domains[0].domain).toBe('quality');
  });
});
