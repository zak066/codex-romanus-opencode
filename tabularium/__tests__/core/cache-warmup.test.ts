/**
 * Test per core/cache-warmup.ts — Cache Warmup System
 *
 * Copertura:
 * - Registrazione e rimozione task (register/unregister)
 * - Esecuzione completa (warmupAll), per tag (warmupByTag), singola (warmupSingle)
 * - Status lifecycle e error handling
 * - Scheduler periodico
 * - registerDefaultWarmupTasks
 * - Priority ordering
 *
 * @module tests/core/cache-warmup
 */

import { CacheWarmup } from '../../src/core/cache-warmup';
import type { WarmupTask } from '../../src/core/cache-warmup';
import { registerDefaultWarmupTasks, cacheWarmup } from '../../src/core/cache-warmup';

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function makeTask(name: string, tags: string[] = ['test'], priority = 50): WarmupTask {
  return {
    name,
    tags,
    priority,
    execute: jest.fn().mockResolvedValue(undefined),
  };
}

// ---------------------------------------------------------------------------
// Suite: CacheWarmup
// ---------------------------------------------------------------------------

describe('CacheWarmup', () => {
  let warmup: CacheWarmup;

  beforeEach(() => {
    warmup = new CacheWarmup();
  });

  // ── Test 1: register incrementa count ──────────────────────────────────

  describe('register', () => {
    it('incrementa il numero di task registrati (report results length = 2)', async () => {
      warmup.register(makeTask('task-1'));
      warmup.register(makeTask('task-2'));

      const report = await warmup.warmupAll();

      expect(report.results).toHaveLength(2);
    });
  });

  // ── Test 2: unregister rimuove ────────────────────────────────────────

  describe('unregister', () => {
    it('rimuove un task registrato dal report', async () => {
      warmup.register(makeTask('task-1'));
      warmup.register(makeTask('task-2'));
      warmup.unregister('task-1');

      const report = await warmup.warmupAll();

      expect(report.results).toHaveLength(1);
      expect(report.results[0].name).toBe('task-2');
    });
  });

  // ── Test 3: warmupAll esegue tutti ─────────────────────────────────────

  describe('warmupAll', () => {
    it('esegue tutti i task registrati (execute chiamato per ognuno)', async () => {
      const task1 = makeTask('task-1');
      const task2 = makeTask('task-2');
      const task3 = makeTask('task-3');

      warmup.register(task1);
      warmup.register(task2);
      warmup.register(task3);

      const report = await warmup.warmupAll();

      expect(task1.execute).toHaveBeenCalledTimes(1);
      expect(task2.execute).toHaveBeenCalledTimes(1);
      expect(task3.execute).toHaveBeenCalledTimes(1);
      expect(report.results).toHaveLength(3);
    });
  });

  // ── Test 4: warmupByTag esegue per tag ────────────────────────────────

  describe('warmupByTag', () => {
    it('esegue solo i task con il tag specificato', async () => {
      const cache1 = makeTask('cache-1', ['cache']);
      const cache2 = makeTask('cache-2', ['cache']);
      const db1 = makeTask('db-1', ['db']);

      warmup.register(cache1);
      warmup.register(cache2);
      warmup.register(db1);

      const report = await warmup.warmupByTag('cache');

      expect(report.results).toHaveLength(2);
      expect(cache1.execute).toHaveBeenCalledTimes(1);
      expect(cache2.execute).toHaveBeenCalledTimes(1);
      expect(db1.execute).not.toHaveBeenCalled();
    });
  });

  // ── Test 5: warmupSingle esegue per nome ──────────────────────────────

  describe('warmupSingle', () => {
    it('esegue un singolo task per nome', async () => {
      const task = makeTask('test-1');
      warmup.register(task);

      const result = await warmup.warmupSingle('test-1');

      expect(task.execute).toHaveBeenCalledTimes(1);
      expect(result.name).toBe('test-1');
    });
  });

  // ── Test 6: Status lifecycle ──────────────────────────────────────────

  describe('status lifecycle', () => {
    it('warmupSingle restituisce status completed', async () => {
      const task = makeTask('test-1');
      warmup.register(task);

      const result = await warmup.warmupSingle('test-1');

      expect(result.status).toBe('completed');
    });
  });

  // ── Test 7: Error handling ────────────────────────────────────────────

  describe('error handling', () => {
    it('warmupAll non crasha e task fallito ha status failed', async () => {
      const good = makeTask('good');
      const bad = makeTask('bad');
      bad.execute = jest.fn().mockRejectedValue(new Error('DB not available'));

      warmup.register(good);
      warmup.register(bad);

      // Non deve lanciare
      const report = await warmup.warmupAll();

      expect(report.results).toHaveLength(2);
      expect(report.failed).toBe(1);
      expect(report.results.find((r) => r.name === 'bad')?.status).toBe('failed');
      expect(report.results.find((r) => r.name === 'bad')?.error).toBe('DB not available');
      expect(report.results.find((r) => r.name === 'good')?.status).toBe('completed');
    });
  });

  // ── Test 8: startScheduler / stopScheduler ────────────────────────────

  describe('scheduler', () => {
    it('dopo stopScheduler lo scheduler non è attivo', () => {
      warmup.startScheduler(1000);
      expect(warmup.isSchedulerActive).toBe(true); // sanity check

      warmup.stopScheduler();

      expect(warmup.isSchedulerActive).toBe(false);
    });
  });

  // ── Test 9: registerDefaultWarmupTasks ────────────────────────────────

  describe('registerDefaultWarmupTasks', () => {
    it('registra 5 task con nomi attesi', async () => {
      // registerDefaultWarmupTasks usa il singleton — chiamiamo la funzione
      registerDefaultWarmupTasks();

      const report = await cacheWarmup.warmupAll();

      const expectedNames = [
        'decisions-warmup',
        'scorecard-warmup',
        'agent-status-warmup',
        'sessions-warmup',
        'knowledge-warmup',
      ];

      expect(report.results).toHaveLength(5);

      const actualNames = report.results.map((r) => r.name).sort();
      expect(actualNames).toEqual(expectedNames.sort());
    });
  });

  // ── Test 10: Priority ordering ────────────────────────────────────────

  describe('priority ordering', () => {
    it('warmupAll esegue i task in ordine di priorità decrescente', async () => {
      const executionOrder: string[] = [];

      const low = makeTask('low', ['test'], 10);
      low.execute = jest.fn().mockImplementation(async () => {
        executionOrder.push('low');
      });

      const mid = makeTask('mid', ['test'], 50);
      mid.execute = jest.fn().mockImplementation(async () => {
        executionOrder.push('mid');
      });

      const high = makeTask('high', ['test'], 100);
      high.execute = jest.fn().mockImplementation(async () => {
        executionOrder.push('high');
      });

      warmup.register(low);
      warmup.register(mid);
      warmup.register(high);

      await warmup.warmupAll();

      expect(executionOrder).toEqual(['high', 'mid', 'low']);
    });
  });
});
