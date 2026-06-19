/**
 * Test per core/warmup-engine.ts — Session Warm-up Engine (Fase 7 FABRICA)
 *
 * Copertura:
 * - generateWarmupContext: restituisce oggetto con campi attesi
 * - generateWarmupContext: graceful degradation (tutte le fonti falliscono → array vuoti)
 * - generateWarmupContext: graceful degradation (solo alcune fonti falliscono)
 * - formatAge: testa vari formati (secondi, minuti, ore, giorni, settimane, mesi)
 *
 * @module tests/core/warmup-engine
 */

// ---------------------------------------------------------------------------
// MOCK: tutte le dipendenze esterne
// ---------------------------------------------------------------------------

import type { FileChangeRecord } from '../../src/core/file-journal.js';
import type { BugRecord, ListBugsResult } from '../../src/core/bug-tracker.js';
import type { ScorecardResult } from '../../src/core/scorecard-engine.js';

// Mock file-journal
jest.mock('../../src/core/file-journal.js', () => ({
  getRecentChanges: jest.fn(),
}));

// Mock bug-tracker
jest.mock('../../src/core/bug-tracker.js', () => ({
  listBugs: jest.fn(),
}));

// Mock database — necessario per collectRecentAdrs
jest.mock('../../src/core/database.js', () => ({
  getDatabase: jest.fn(),
}));

// Mock schedule-purge
jest.mock('../../src/core/schedule-purge.js', () => ({
  getLastPurgeAgeDays: jest.fn(),
  getScheduleConfig: jest.fn(),
}));

// Mock scorecard-engine
jest.mock('../../src/core/scorecard-engine.js', () => ({
  getScorecard: jest.fn(),
}));

// Import dopo i mock
import { generateWarmupContext, formatAge } from '../../src/core/warmup-engine.js';
import { getRecentChanges } from '../../src/core/file-journal.js';
import { listBugs } from '../../src/core/bug-tracker.js';
import { getDatabase } from '../../src/core/database.js';
import { getScorecard } from '../../src/core/scorecard-engine.js';
import { getLastPurgeAgeDays, getScheduleConfig } from '../../src/core/schedule-purge.js';

const mockGetRecentChanges = getRecentChanges as jest.MockedFunction<typeof getRecentChanges>;
const mockListBugs = listBugs as jest.MockedFunction<typeof listBugs>;
const mockGetDatabase = getDatabase as jest.MockedFunction<typeof getDatabase>;
const mockGetScorecard = getScorecard as jest.MockedFunction<typeof getScorecard>;
const mockGetLastPurgeAgeDays = getLastPurgeAgeDays as jest.MockedFunction<typeof getLastPurgeAgeDays>;
const mockGetScheduleConfig = getScheduleConfig as jest.MockedFunction<typeof getScheduleConfig>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFakeChange(overrides?: Partial<FileChangeRecord>): FileChangeRecord {
  return {
    id: 'fc_test_1',
    file_path: 'src/core/test.ts',
    agent: 'diana-tester',
    change_type: 'modified',
    summary: 'Test change',
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

function makeFakeBug(overrides?: Partial<BugRecord>): BugRecord {
  return {
    id: 'bug_test_1',
    title: 'Test bug',
    description: 'Description',
    component: 'auth',
    severity: 'major',
    status: 'open',
    reported_by: 'diana-tester',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function makeFakeScorecard(): ScorecardResult {
  return {
    grade: 'A',
    score: 95,
    breakdown: {
      lint: { score: 90, weight: 0.2, metrics: { errors: 0 } },
      ts: { score: 95, weight: 0.2, metrics: { errors: 0 } },
      test: { score: 100, weight: 0.25, metrics: { coverage: 85 } },
      security: { score: 95, weight: 0.2, metrics: { vulns: 0 } },
      perf: { score: 85, weight: 0.15, metrics: { lcp: 2.5 } },
    },
    generatedAt: new Date().toISOString(),
    period: { from: '2026-04-26', to: '2026-05-26' },
  };
}

function makeFakeDb() {
  return {
    prepare: jest.fn().mockReturnValue({
      get: jest.fn().mockReturnValue(undefined),
      all: jest.fn().mockReturnValue([]),
      run: jest.fn(),
    }),
    exec: jest.fn(),
  };
}

// ---------------------------------------------------------------------------
// Suite: warmup-engine
// ---------------------------------------------------------------------------

describe('warmup-engine', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default: purgeHealth graceful degradation (schedule-purge mock fallisce)
    mockGetLastPurgeAgeDays.mockImplementation(() => { throw new Error('DB not ready'); });

  });

  // ── generateWarmupContext ─────────────────────────────────────────────

  describe('generateWarmupContext', () => {
    it('restituisce oggetto con tutti i campi attesi quando tutte le fonti funzionano', async () => {
      // Setup mock per tutte e 4 le fonti
      mockGetRecentChanges.mockReturnValue([
        makeFakeChange({ file_path: 'src/core/test.ts', agent: 'diana', summary: 'Fix bug' }),
        makeFakeChange({ file_path: 'src/tools/test.tool.ts', agent: 'vulcanus', summary: 'Add tool' }),
      ]);

      mockListBugs.mockReturnValue({
        total: 1,
        bugs: [makeFakeBug({ id: 'bug_001', title: 'Login crash', severity: 'critical', component: 'auth' })],
      });

      const fakeDb = makeFakeDb();
      fakeDb.prepare().get.mockReturnValue({ name: 'decisions' }); // tabella esiste
      fakeDb.prepare().all.mockReturnValue([
        { id: 'adr_001', title: 'Use SQLite', status: 'accepted' },
      ]);
      mockGetDatabase.mockReturnValue(fakeDb as never);

      mockGetScorecard.mockResolvedValue(makeFakeScorecard());

      // Act
      const ctx = await generateWarmupContext();

      // Assert
      expect(ctx).toHaveProperty('recentChanges');
      expect(ctx).toHaveProperty('openBugs');
      expect(ctx).toHaveProperty('recentAdrs');
      expect(ctx).toHaveProperty('metricsSnapshot');
      expect(ctx).toHaveProperty('generatedAt');
      expect(ctx).toHaveProperty('age');

      // Controlli specifici
      expect(Array.isArray(ctx.recentChanges)).toBe(true);
      expect(ctx.recentChanges).toHaveLength(2);
      expect(ctx.recentChanges[0].file).toBe('src/core/test.ts');
      expect(ctx.recentChanges[0].agent).toBe('diana');
      expect(ctx.recentChanges[0].summary).toBe('Fix bug');

      expect(ctx.openBugs).toHaveLength(1);
      expect(ctx.openBugs[0].id).toBe('bug_001');
      expect(ctx.openBugs[0].severity).toBe('critical');

      expect(ctx.recentAdrs).toHaveLength(1);
      expect(ctx.recentAdrs[0].title).toBe('Use SQLite');

      expect(ctx.metricsSnapshot).toHaveLength(5); // 5 domini
      expect(ctx.metricsSnapshot[0]).toHaveProperty('domain');
      expect(ctx.metricsSnapshot[0]).toHaveProperty('score');
      expect(ctx.metricsSnapshot[0]).toHaveProperty('grade');

      expect(typeof ctx.generatedAt).toBe('string');
      expect(typeof ctx.age).toBe('string');
    });

    it('non crasha se tutte le fonti falliscono (graceful degradation)', async () => {
      // Tutti i mock lanciano errori
      mockGetRecentChanges.mockImplementation(() => { throw new Error('Table not found'); });
      mockListBugs.mockImplementation(() => { throw new Error('Table not found'); });
      mockGetDatabase.mockImplementation(() => { throw new Error('DB not initialized'); });
      mockGetScorecard.mockRejectedValue(new Error('Scorecard not available'));

      const ctx = await generateWarmupContext();

      expect(ctx.recentChanges).toEqual([]);
      expect(ctx.openBugs).toEqual([]);
      expect(ctx.recentAdrs).toEqual([]);
      expect(ctx.metricsSnapshot).toEqual([]);
      expect(typeof ctx.generatedAt).toBe('string');
      expect(typeof ctx.age).toBe('string');
    });

    it('gestisce graceful degradation quando solo alcune fonti falliscono', async () => {
      // changes funziona, bugs fallisce, adrs funziona, scorecard fallisce
      mockGetRecentChanges.mockReturnValue([
        makeFakeChange({ file_path: 'src/test.ts', agent: 'diana', summary: 'Test' }),
      ]);

      mockListBugs.mockImplementation(() => { throw new Error('Bugs table missing'); });

      const fakeDb = makeFakeDb();
      fakeDb.prepare().get.mockReturnValue({ name: 'decisions' });
      fakeDb.prepare().all.mockReturnValue([
        { id: 'adr_002', title: 'Use Jest', status: 'proposed' },
      ]);
      mockGetDatabase.mockReturnValue(fakeDb as never);

      mockGetScorecard.mockRejectedValue(new Error('Scorecard not available'));

      const ctx = await generateWarmupContext();

      expect(ctx.recentChanges).toHaveLength(1);
      expect(ctx.openBugs).toEqual([]);
      expect(ctx.recentAdrs).toHaveLength(1);
      expect(ctx.metricsSnapshot).toEqual([]);
    });

    it('popola generatedAt con una data ISO valida', async () => {
      // Setup minimo
      mockGetRecentChanges.mockReturnValue([]);
      mockListBugs.mockReturnValue({ total: 0, bugs: [] });
      mockGetDatabase.mockImplementation(() => { throw new Error('No DB'); });
      mockGetScorecard.mockResolvedValue(makeFakeScorecard());

      const ctx = await generateWarmupContext();

      expect(ctx.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(() => new Date(ctx.generatedAt)).not.toThrow();
    });


    it('include purgeHealth con campi attesi quando schedule-purge funziona', async () => {
      mockGetRecentChanges.mockReturnValue([]);
      mockListBugs.mockReturnValue({ total: 0, bugs: [] });
      mockGetDatabase.mockImplementation(() => { throw new Error('No DB'); });
      mockGetScorecard.mockResolvedValue(makeFakeScorecard());

      // Mock schedule-purge: 10 giorni fa, soglia 30
      mockGetLastPurgeAgeDays.mockReturnValue(10);
      mockGetScheduleConfig.mockReturnValue({
        scheduleType: 'interval',
        intervalDays: 30,
        dryRun: true,
        olderThan: 30,
        keepLastSnapshots: 3,
        compactFirst: true,
        enabled: false,
      });

      const ctx = await generateWarmupContext();

      expect(ctx).toHaveProperty('purgeHealth');
      expect(ctx.purgeHealth.ageDays).toBe(10);
      expect(ctx.purgeHealth.overdue).toBe(false);
      expect(ctx.purgeHealth.overdueDays).toBeNull();
      expect(ctx.purgeHealth.threshold).toBe(30);
      expect(ctx.purgeHealth.icon).toBe('\u{1F7E2}'); // 🟢
      expect(typeof ctx.purgeHealth.recommendation).toBe('string');
      expect(ctx.purgeHealth.recommendation).toContain('healthy');
    });

    it('purgeHealth segnala overdue quando ageDays > soglia', async () => {
      mockGetRecentChanges.mockReturnValue([]);
      mockListBugs.mockReturnValue({ total: 0, bugs: [] });
      mockGetDatabase.mockImplementation(() => { throw new Error('No DB'); });
      mockGetScorecard.mockResolvedValue(makeFakeScorecard());

      mockGetLastPurgeAgeDays.mockReturnValue(35);
      mockGetScheduleConfig.mockReturnValue({
        scheduleType: 'interval',
        intervalDays: 30,
        dryRun: true,
        olderThan: 30,
        keepLastSnapshots: 3,
        compactFirst: true,
        enabled: false,
      });

      const ctx = await generateWarmupContext();

      expect(ctx.purgeHealth.overdue).toBe(true);
      expect(ctx.purgeHealth.overdueDays).toBe(5);
      expect(ctx.purgeHealth.icon).toBe('\u{1F534}'); // 🔴
      expect(ctx.purgeHealth.recommendation).toContain('overdue');
    });

    it('purgeHealth graceful degradation quando schedule-purge fallisce', async () => {
      mockGetRecentChanges.mockReturnValue([]);
      mockListBugs.mockReturnValue({ total: 0, bugs: [] });
      mockGetDatabase.mockImplementation(() => { throw new Error('No DB'); });
      mockGetScorecard.mockResolvedValue(makeFakeScorecard());

      // Simula fallimento di schedule-purge
      mockGetLastPurgeAgeDays.mockImplementation(() => { throw new Error('DB not ready'); });

      const ctx = await generateWarmupContext();

      expect(ctx).toHaveProperty('purgeHealth');
      expect(ctx.purgeHealth.icon).toBe('\u26AA'); // ⚪
      expect(ctx.purgeHealth.ageDays).toBeNull();
      expect(ctx.purgeHealth.overdue).toBe(false);
    });

    it('popola age con una stringa non vuota tipo "pochi secondi fa"', async () => {
      mockGetRecentChanges.mockReturnValue([]);
      mockListBugs.mockReturnValue({ total: 0, bugs: [] });
      mockGetDatabase.mockImplementation(() => { throw new Error('No DB'); });
      mockGetScorecard.mockResolvedValue(makeFakeScorecard());

      const ctx = await generateWarmupContext();

      expect(ctx.age).toBeTruthy();
      expect(typeof ctx.age).toBe('string');
      // L'età dovrebbe essere molto recente
      expect(['pochi secondi fa', '1 minuto fa']).toContain(ctx.age);
    });
  });

  // ── formatAge ─────────────────────────────────────────────────────────

  describe('formatAge', () => {
    it('restituisce "data sconosciuta" per data non valida', () => {
      expect(formatAge('not-a-date')).toBe('data sconosciuta');
      expect(formatAge('')).toBe('data sconosciuta');
    });

    it('restituisce "pochi secondi fa" per date nel futuro', () => {
      const futureDate = new Date(Date.now() + 60_000).toISOString();
      expect(formatAge(futureDate)).toBe('pochi secondi fa');
    });

    it('restituisce "pochi secondi fa" per date di 5 secondi fa', () => {
      const date = new Date(Date.now() - 5_000).toISOString();
      expect(formatAge(date)).toBe('pochi secondi fa');
    });

    it('restituisce "1 minuto fa" per date di 1 minuto fa', () => {
      const date = new Date(Date.now() - 60_000).toISOString();
      expect(formatAge(date)).toBe('1 minuto fa');
    });

    it('restituisce "5 minuti fa" per date di 5 minuti fa', () => {
      const date = new Date(Date.now() - 5 * 60_000).toISOString();
      expect(formatAge(date)).toBe('5 minuti fa');
    });

    it('restituisce "1 ora fa" per date di 1 ora fa', () => {
      const date = new Date(Date.now() - 3_600_000).toISOString();
      expect(formatAge(date)).toBe('1 ora fa');
    });

    it('restituisce "3 ore fa" per date di 3 ore fa', () => {
      const date = new Date(Date.now() - 3 * 3_600_000).toISOString();
      expect(formatAge(date)).toBe('3 ore fa');
    });

    it('restituisce "ieri" per date di 1 giorno fa', () => {
      const date = new Date(Date.now() - 86_400_000).toISOString();
      expect(formatAge(date)).toBe('ieri');
    });

    it('restituisce "3 giorni fa" per date di 3 giorni fa', () => {
      const date = new Date(Date.now() - 3 * 86_400_000).toISOString();
      expect(formatAge(date)).toBe('3 giorni fa');
    });

    it('restituisce "1 settimana fa" per date di 7 giorni fa', () => {
      const date = new Date(Date.now() - 7 * 86_400_000).toISOString();
      expect(formatAge(date)).toBe('1 settimana fa');
    });

    it('restituisce "2 settimane fa" per date di 14 giorni fa', () => {
      const date = new Date(Date.now() - 14 * 86_400_000).toISOString();
      expect(formatAge(date)).toBe('2 settimane fa');
    });

    it('restituisce "4 settimane fa" per date di 30 giorni fa (weeks ha priorità su months)', () => {
      // La logica controlla prima weeks (< 5), poi months
      // 30 giorni = 4 settimane (30/7=4), quindi weeks < 5 → "4 settimane fa"
      const date = new Date(Date.now() - 30 * 86_400_000).toISOString();
      expect(formatAge(date)).toBe('4 settimane fa');
    });

    it('restituisce "1 mese fa" per date di 35 giorni fa (weeks >= 5 → months)', () => {
      // 35 giorni = 5 settimane, months = 1
      const date = new Date(Date.now() - 35 * 86_400_000).toISOString();
      expect(formatAge(date)).toBe('1 mese fa');
    });

    it('restituisce "3 mesi fa" per date di 90 giorni fa', () => {
      const date = new Date(Date.now() - 90 * 86_400_000).toISOString();
      expect(formatAge(date)).toBe('3 mesi fa');
    });
  });
});
