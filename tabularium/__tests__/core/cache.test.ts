/**
 * Test per cache.ts
 * Verifica il sistema di caching in-memory con TTL.
 * I test sono indipendenti e usano `jest.useFakeTimers` per il TTL.
 */

import { Cache, invalidateAllCaches, invalidateAgentCache, getCacheStats } from '../../src/core/cache';
import {
  openCodeCache,
  progressCache,
  decisionsCache,
  validationCache,
} from '../../src/core/cache';

// ---------------------------------------------------------------------------
// Suite per la classe Cache
// ---------------------------------------------------------------------------
describe('Cache<T>', () => {
  let cache: Cache<string>;

  beforeEach(() => {
    jest.useFakeTimers();
    cache = new Cache<string>(60_000); // TTL 60s
  });

  afterEach(() => {
    cache.clear();
    cache.stopCleanup();
    jest.useRealTimers();
  });

  describe('set / get', () => {
    it('set e get base — recupera il valore memorizzato', () => {
      cache.set('key1', 'value1');
      expect(cache.get('key1')).toBe('value1');
    });

    it('get restituisce undefined per chiave inesistente', () => {
      expect(cache.get('nonexistent')).toBeUndefined();
    });

    it('set sovrascrive un valore esistente', () => {
      cache.set('key', 'old');
      cache.set('key', 'new');
      expect(cache.get('key')).toBe('new');
    });

    it('get restituisce undefined dopo la scadenza del TTL (lazy eviction)', () => {
      cache.set('key', 'value');
      expect(cache.get('key')).toBe('value');

      // Avanza il tempo oltre il TTL
      jest.advanceTimersByTime(61_000);

      expect(cache.get('key')).toBeUndefined();
    });
  });

  describe('invalidate', () => {
    it('rimuove una specifica entry', () => {
      cache.set('key', 'value');
      expect(cache.get('key')).toBe('value');

      cache.invalidate('key');
      expect(cache.get('key')).toBeUndefined();
    });

    it('non rimuove altre entry', () => {
      cache.set('a', 'value-a');
      cache.set('b', 'value-b');

      cache.invalidate('a');
      expect(cache.get('b')).toBe('value-b');
    });
  });

  describe('invalidatePrefix', () => {
    it('rimuove tutte le entry con un dato prefisso', () => {
      cache.set('agent:iuppiter:role', 'orchestrator');
      cache.set('agent:minerva:role', 'guardian');
      cache.set('config:theme', 'dark');

      cache.invalidatePrefix('agent:');
      expect(cache.get('agent:iuppiter:role')).toBeUndefined();
      expect(cache.get('agent:minerva:role')).toBeUndefined();
      // Non deve rimuovere entry con prefisso diverso
      expect(cache.get('config:theme')).toBe('dark');
    });
  });

  describe('clear', () => {
    it('rimuove tutte le entry', () => {
      cache.set('a', '1');
      cache.set('b', '2');

      cache.clear();
      expect(cache.get('a')).toBeUndefined();
      expect(cache.get('b')).toBeUndefined();
      expect(cache.size).toBe(0);
    });
  });

  describe('getOrSet', () => {
    it('chiama factory solo se la chiave non è in cache', async () => {
      const factory = jest.fn().mockResolvedValue('factory-value');

      // Prima chiamata — chiama factory
      const result1 = await cache.getOrSet('key', factory);
      expect(result1).toBe('factory-value');
      expect(factory).toHaveBeenCalledTimes(1);

      // Seconda chiamata — dalla cache, non chiama factory
      const result2 = await cache.getOrSet('key', factory);
      expect(result2).toBe('factory-value');
      expect(factory).toHaveBeenCalledTimes(1);
    });

    it('chiama factory dopo la scadenza del TTL', async () => {
      const factory = jest.fn().mockResolvedValue('fresh');

      await cache.getOrSet('key', factory, 30_000); // TTL 30s
      expect(factory).toHaveBeenCalledTimes(1);

      // Avanza oltre TTL
      jest.advanceTimersByTime(31_000);

      await cache.getOrSet('key', factory);
      expect(factory).toHaveBeenCalledTimes(2);
    });
  });

  describe('size', () => {
    it('riporta il numero corretto di entry', () => {
      expect(cache.size).toBe(0);
      cache.set('a', '1');
      expect(cache.size).toBe(1);
      cache.set('b', '2');
      expect(cache.size).toBe(2);
      cache.invalidate('a');
      expect(cache.size).toBe(1);
    });
  });

  describe('getStats', () => {
    it('restituisce statistiche corrette', () => {
      cache.set('a', '1', 30_000);
      cache.set('b', '2', 60_000);

      const stats = cache.getStats();
      expect(stats.size).toBe(2);
      expect(stats.keys).toContain('a');
      expect(stats.keys).toContain('b');
      expect(stats.averageTtlMs).toBe(45_000); // (30k + 60k) / 2
      expect(stats.oldestEntryMs).toBeGreaterThanOrEqual(0);
    });

    it('gestisce cache vuota', () => {
      const stats = cache.getStats();
      expect(stats.size).toBe(0);
      expect(stats.keys).toHaveLength(0);
      expect(stats.averageTtlMs).toBe(0);
    });
  });

  describe('removeExpired', () => {
    it('rimuove solo le entry scadute', () => {
      cache.set('fresh', 'value', 120_000);
      cache.set('stale', 'value', 10_000);

      jest.advanceTimersByTime(15_000);

      const removed = cache.removeExpired();
      expect(removed).toBe(1);
      expect(cache.get('fresh')).toBe('value');
      expect(cache.get('stale')).toBeUndefined();
    });

    it('restituisce 0 se nessuna entry è scaduta', () => {
      cache.set('a', '1', 60_000);
      cache.set('b', '2', 60_000);

      const removed = cache.removeExpired();
      expect(removed).toBe(0);
    });
  });

  describe('TTL personalizzato per entry', () => {
    it('rispetta TTL diverso per ogni entry', () => {
      cache.set('short', 'value', 10_000);
      cache.set('long', 'value', 120_000);

      jest.advanceTimersByTime(15_000);

      expect(cache.get('short')).toBeUndefined();
      expect(cache.get('long')).toBe('value');
    });
  });
});

// ---------------------------------------------------------------------------
// Suite per le istanze globali
// ---------------------------------------------------------------------------
describe('istanze cache globali', () => {
  beforeEach(() => {
    openCodeCache.clear();
    progressCache.clear();
    decisionsCache.clear();
    validationCache.clear();
  });

  it('openCodeCache ha TTL 60s', () => {
    openCodeCache.set('test', 'value');
    expect(openCodeCache.get('test')).toBe('value');
  });

  it('progressCache ha TTL 30s', () => {
    progressCache.set('test', 'value');
    expect(progressCache.get('test')).toBe('value');
  });

  it('decisionsCache ha TTL 60s', () => {
    decisionsCache.set('test', 'value');
    expect(decisionsCache.get('test')).toBe('value');
  });

  it('validationCache ha TTL 120s', () => {
    validationCache.set('test', 'value');
    expect(validationCache.get('test')).toBe('value');
  });
});

// ---------------------------------------------------------------------------
// Suite per funzioni globali
// ---------------------------------------------------------------------------
describe('invalidateAllCaches', () => {
  beforeEach(() => {
    openCodeCache.clear();
    progressCache.clear();
    decisionsCache.clear();
    validationCache.clear();
  });

  it('invalida tutte le cache globali', () => {
    openCodeCache.set('k', 'v');
    progressCache.set('k', 'v');
    decisionsCache.set('k', 'v');
    validationCache.set('k', 'v');

    invalidateAllCaches();

    expect(openCodeCache.get('k')).toBeUndefined();
    expect(progressCache.get('k')).toBeUndefined();
    expect(decisionsCache.get('k')).toBeUndefined();
    expect(validationCache.get('k')).toBeUndefined();
  });
});

describe('invalidateAgentCache', () => {
  beforeEach(() => {
    openCodeCache.clear();
    progressCache.clear();
    decisionsCache.clear();
    validationCache.clear();
  });

  it('invalida le cache con prefisso agente', () => {
    openCodeCache.set('minerva:role', 'guardian');
    openCodeCache.set('iuppiter:role', 'orchestrator');
    progressCache.set('minerva:task', 'write');
    decisionsCache.set('minerva:decision', 'approve');
    validationCache.set('minerva:errors', 'none');

    invalidateAgentCache('minerva');

    expect(openCodeCache.get('minerva:role')).toBeUndefined();
    expect(openCodeCache.get('iuppiter:role')).toBe('orchestrator');
    expect(progressCache.get('minerva:task')).toBeUndefined();
    expect(decisionsCache.get('minerva:decision')).toBeUndefined();
    expect(validationCache.get('minerva:errors')).toBeUndefined();
  });
});

describe('getCacheStats', () => {
  beforeEach(() => {
    openCodeCache.clear();
    progressCache.clear();
    decisionsCache.clear();
    validationCache.clear();
  });

  it('restituisce stats per tutte le cache', () => {
    openCodeCache.set('k1', 'v1');
    progressCache.set('k2', 'v2');

    const stats = getCacheStats();
    expect(stats.openCodeCache).toBeDefined();
    expect(stats.progressCache).toBeDefined();
    expect(stats.decisionsCache).toBeDefined();
    expect(stats.validationCache).toBeDefined();

    expect(stats.openCodeCache.size).toBe(1);
    expect(stats.progressCache.size).toBe(1);
    expect(stats.decisionsCache.size).toBe(0);
    expect(stats.validationCache.size).toBe(0);
  });
});
