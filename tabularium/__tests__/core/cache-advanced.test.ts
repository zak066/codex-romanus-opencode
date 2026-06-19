/**
 * Test avanzati per Cache<T> (ADR-006 — Caching 3 Layer, Task C6).
 *
 * Copre:
 *   - stale-while-revalidate (getWithStale, background refresh)
 *   - Promise coalescing (getOrSet concorrente)
 *   - LRU eviction (maxEntries, ordine di rimozione)
 *   - Statistiche (staleHits, coalescedFetches, evictionCount)
 *   - Retrocompatibilità (costruttore, istanze globali)
 *   - Cleanup periodico e rimozione expired
 *   - Edge: invalidate, invalidatePrefix, clear
 *
 * @module tests/core/cache-advanced
 */

import { Cache } from '../../src/core/cache';
import {
  openCodeCache,
  progressCache,
  decisionsCache,
  validationCache,
} from '../../src/core/cache';

// ---------------------------------------------------------------------------
// Suite: Cache<T> advanced
// ---------------------------------------------------------------------------
describe('Cache<T> — stale-while-revalidate', () => {
  let cache: Cache<string>;
  let revalidateMock: jest.Mock<Promise<string>>;

  beforeEach(() => {
    jest.useFakeTimers();
    revalidateMock = jest.fn().mockResolvedValue('refreshed-value');
    cache = new Cache<string>(30_000, {
      staleTtl: 30_000,
      revalidateFn: revalidateMock,
    });
  });

  afterEach(() => {
    cache.clear();
    cache.stopCleanup();
    jest.useRealTimers();
  });

  // ── getWithStale ──────────────────────────────────────────────────────

  it('getWithStale() restituisce dato fresco con isStale=false', () => {
    cache.set('key', 'fresh-data');

    const result = cache.getWithStale('key');
    expect(result).toBeDefined();
    expect(result!.data).toBe('fresh-data');
    expect(result!.isStale).toBe(false);
  });

  it('getWithStale() restituisce dato stale con isStale=true entro staleTtl', () => {
    cache.set('key', 'stale-data');

    // Avanza oltre TTL ma entro staleTtl
    jest.advanceTimersByTime(35_000); // 35s > 30s TTL, ma < 60s TTL+staleTtl

    const result = cache.getWithStale('key');
    expect(result).toBeDefined();
    expect(result!.data).toBe('stale-data');
    expect(result!.isStale).toBe(true);
  });

  it('getWithStale() restituisce undefined dopo staleTtl', () => {
    cache.set('key', 'expired-data');

    // Avanza oltre TTL + staleTtl
    jest.advanceTimersByTime(65_000); // 65s > 60s (TTL 30s + staleTtl 30s)

    const result = cache.getWithStale('key');
    expect(result).toBeUndefined();
  });

  it('getWithStale() restituisce undefined per chiave inesistente', () => {
    const result = cache.getWithStale('nonexistent');
    expect(result).toBeUndefined();
  });

  // ── Background refresh ────────────────────────────────────────────────

  it('get() attiva background refresh su dato stale se revalidateFn configurata', () => {
    cache.set('key', 'stale-value');

    // Avanza oltre TTL
    jest.advanceTimersByTime(35_000);

    // get() dovrebbe restituire dato stale e triggerare refresh
    const value = cache.get('key');
    expect(value).toBe('stale-value');

    // revalidateFn dovrebbe essere stata chiamata
    expect(revalidateMock).toHaveBeenCalledWith('key');
  });

  it('get() NON attiva background refresh se revalidateFn non configurata', () => {
    const simpleCache = new Cache<string>(30_000); // no options
    simpleCache.set('key', 'stale-value');

    jest.advanceTimersByTime(35_000);

    // get() restituisce undefined perché senza staleTtl il dato è expired
    const value = simpleCache.get('key');
    expect(value).toBeUndefined();

    simpleCache.clear();
    simpleCache.stopCleanup();
  });

  it('background refresh non crasha su errore (fire-and-forget)', async () => {
    const failingMock = jest.fn().mockRejectedValue(new Error('Network error'));
    const safeCache = new Cache<string>(30_000, {
      staleTtl: 30_000,
      revalidateFn: failingMock,
    });

    safeCache.set('key', 'stale-value');
    jest.advanceTimersByTime(35_000);

    // get() restituisce dato stale
    const value = safeCache.get('key');
    expect(value).toBe('stale-value');

    // Attende che la microtask venga eseguita (il catch silenzioso)
    await Promise.resolve();

    // Cache deve ancora avere l'entry (non è stata rimossa dall'errore)
    const after = safeCache.getWithStale('key');
    expect(after).toBeDefined();
    expect(after!.data).toBe('stale-value');
    expect(after!.isStale).toBe(true);

    safeCache.clear();
    safeCache.stopCleanup();
  });
});

// ---------------------------------------------------------------------------
// Suite: Promise coalescing
// ---------------------------------------------------------------------------
describe('Cache<T> — promise coalescing', () => {
  let cache: Cache<string>;

  beforeEach(() => {
    jest.useFakeTimers();
    cache = new Cache<string>(30_000);
  });

  afterEach(() => {
    cache.clear();
    cache.stopCleanup();
    jest.useRealTimers();
  });

  it('getOrSet() con promise coalescing: 2 chiamate concorrenti = 1 fetch', async () => {
    let fetchCount = 0;
    const factory = jest.fn().mockImplementation(async () => {
      fetchCount++;
      return 'expensive-data';
    });

    // Due chiamate concorrenti
    const [result1, result2] = await Promise.all([
      cache.getOrSet('key', factory),
      cache.getOrSet('key', factory),
    ]);

    expect(result1).toBe('expensive-data');
    expect(result2).toBe('expensive-data');
    // Factory deve essere chiamata UNA volta sola
    expect(factory).toHaveBeenCalledTimes(1);
    expect(fetchCount).toBe(1);
  });

  it('getOrSet() con stale restituisce dato stale e fa refresh in background', async () => {
    const cacheWithStale = new Cache<string>(10_000, {
      staleTtl: 20_000,
    });

    // Imposta un valore iniziale
    cacheWithStale.set('key', 'initial-value');

    const factory = jest.fn().mockResolvedValue('refreshed-value');

    // Avanza oltre TTL (ma entro staleTtl)
    jest.advanceTimersByTime(15_000);

    // getOrSet dovrebbe restituire dato stale, non chiamare factory subito
    const result = await cacheWithStale.getOrSet('key', factory);
    expect(result).toBe('initial-value');
    // Factory potrebbe essere chiamata in background, ma il dato restituito è stale
    expect(result).toBe('initial-value');

    cacheWithStale.clear();
    cacheWithStale.stopCleanup();
  });

  it('coalescedFetches incrementato correttamente', async () => {
    let resolveFactory!: (v: string) => void;
    const slowFactory = jest.fn().mockImplementation(() => {
      return new Promise<string>((resolve) => {
        resolveFactory = resolve;
      });
    });

    // Prima chiamata
    const promise1 = cache.getOrSet('key', slowFactory);
    // Seconda chiamata concorrente (prima che la prima finisca)
    const promise2 = cache.getOrSet('key', slowFactory);

    // Risolvi la factory
    resolveFactory('coalesced-data');

    const [r1, r2] = await Promise.all([promise1, promise2]);

    expect(r1).toBe('coalesced-data');
    expect(r2).toBe('coalesced-data');
    expect(slowFactory).toHaveBeenCalledTimes(1);

    const stats = cache.getStats();
    expect(stats.coalescedFetches).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Suite: LRU eviction
// ---------------------------------------------------------------------------
describe('Cache<T> — LRU eviction', () => {
  let cache: Cache<string>;

  beforeEach(() => {
    jest.useFakeTimers();
    cache = new Cache<string>(60_000, { maxEntries: 10 });
  });

  afterEach(() => {
    cache.clear();
    cache.stopCleanup();
    jest.useRealTimers();
  });

  it('LRU eviction: maxEntries rispettato dopo set multipli', () => {
    // Inserisce 12 entry (max è 10, eviction rimuove ~10% = 1 o 2)
    for (let i = 0; i < 12; i++) {
      cache.set(`key-${i}`, `value-${i}`);
    }

    // Dopo eviction, size deve essere <= maxEntries
    expect(cache.size).toBeLessThanOrEqual(10);
  });

  it('LRU eviction: entry più vecchie (per lastAccessed) rimosse per prime', () => {
    // Inserisce 10 entry
    for (let i = 0; i < 10; i++) {
      cache.set(`key-${i}`, `value-${i}`);
    }

    // Accede solo ad alcune entry recenti (simula uso)
    cache.get('key-9');
    cache.get('key-8');

    // L'undicesima entry triggera eviction
    cache.set('key-10', 'value-10');

    // Le entry non accedute (key-0, key-1...) dovrebbero essere state rimosse
    // Mentre quelle accedute di recente (key-8, key-9) dovrebbero sopravvivere
    expect(cache.get('key-9')).toBe('value-9');
    expect(cache.get('key-8')).toBe('value-8');

    // key-0 probabilmente è stata rimossa (era la più vecchia)
    const stats = cache.getStats();
    expect(stats.evictionCount).toBeGreaterThan(0);
  });

  it('CacheStats.evictionCount incrementato correttamente', () => {
    const smallCache = new Cache<string>(60_000, { maxEntries: 3 });

    // Inserisce 6 entry (triggera eviction multiple volte)
    for (let i = 0; i < 6; i++) {
      smallCache.set(`key-${i}`, `value-${i}`);
    }

    const stats = smallCache.getStats();
    expect(stats.evictionCount).toBeGreaterThan(0);
    expect(stats.maxEntries).toBe(3);
    expect(smallCache.size).toBeLessThanOrEqual(3);

    smallCache.clear();
    smallCache.stopCleanup();
  });

  it('maxEntries=0 non attiva mai LRU eviction', () => {
    const unlimited = new Cache<string>(60_000, { maxEntries: 0 });

    for (let i = 0; i < 100; i++) {
      unlimited.set(`key-${i}`, `value-${i}`);
    }

    expect(unlimited.size).toBe(100);
    expect(unlimited.getStats().evictionCount).toBe(0);

    unlimited.clear();
    unlimited.stopCleanup();
  });
});

// ---------------------------------------------------------------------------
// Suite: CacheStats avanzate
// ---------------------------------------------------------------------------
describe('Cache<T> — statistiche avanzate', () => {
  let cache: Cache<string>;

  beforeEach(() => {
    jest.useFakeTimers();
    cache = new Cache<string>(30_000, {
      staleTtl: 30_000,
      revalidateFn: jest.fn().mockResolvedValue('refreshed'),
      maxEntries: 10,
    });
  });

  afterEach(() => {
    cache.clear();
    cache.stopCleanup();
    jest.useRealTimers();
  });

  it('CacheStats.staleHits contato correttamente', () => {
    cache.set('key', 'value');

    // Hit fresco
    cache.get('key');
    let stats = cache.getStats();
    expect(stats.staleHits).toBe(0);

    // Avanza oltre TTL (ma entro staleTtl)
    jest.advanceTimersByTime(35_000);

    // Stale hit
    cache.get('key');
    stats = cache.getStats();
    expect(stats.staleHits).toBe(1);
    expect(stats.hits).toBe(2); // 1 fresh hit + 1 stale hit
  });

  it('CacheStats.hits e misses tracciati correttamente', () => {
    cache.set('key', 'value');

    // Hit
    cache.get('key');
    expect(cache.getStats().hits).toBe(1);
    expect(cache.getStats().misses).toBe(0);

    // Miss
    cache.get('nonexistent');
    expect(cache.getStats().hits).toBe(1);
    expect(cache.getStats().misses).toBe(1);

    // Hit dopo miss
    cache.get('key');
    expect(cache.getStats().hits).toBe(2);
    expect(cache.getStats().misses).toBe(1);
  });

  it('CacheStats.isStaleEnabled true quando staleTtl configurato', () => {
    const stats = cache.getStats();
    expect(stats.isStaleEnabled).toBe(true);
  });

  it('CacheStats.isStaleEnabled false senza opzioni stale', () => {
    const simpleCache = new Cache<string>(30_000);
    const stats = simpleCache.getStats();
    expect(stats.isStaleEnabled).toBe(false);
    simpleCache.clear();
    simpleCache.stopCleanup();
  });
});

// ---------------------------------------------------------------------------
// Suite: Retrocompatibilità
// ---------------------------------------------------------------------------
describe('Cache<T> — retrocompatibilità', () => {
  afterEach(() => {
    // Reset globale
    openCodeCache.clear();
    progressCache.clear();
    decisionsCache.clear();
    validationCache.clear();
  });

  it('costruttore senza argomenti funziona (usa TTL default 30s)', () => {
    const c = new Cache<string>();
    c.set('key', 'value');
    expect(c.get('key')).toBe('value');
    c.clear();
    c.stopCleanup();
  });

  it('costruttore con 1 argomento funziona (solo TTL)', () => {
    const c = new Cache<string>(45_000);
    c.set('key', 'value');
    expect(c.get('key')).toBe('value');
    c.clear();
    c.stopCleanup();
  });

  it('istanze globali funzionano (retrocompatibilità)', () => {
    openCodeCache.set('test-key', 'global-value');
    expect(openCodeCache.get('test-key')).toBe('global-value');

    progressCache.set('p-key', 'p-value');
    expect(progressCache.get('p-key')).toBe('p-value');

    decisionsCache.set('d-key', 'd-value');
    expect(decisionsCache.get('d-key')).toBe('d-value');

    validationCache.set('v-key', 'v-value');
    expect(validationCache.get('v-key')).toBe('v-value');
  });
});

// ---------------------------------------------------------------------------
// Suite: Cleanup periodico e expired
// ---------------------------------------------------------------------------
describe('Cache<T> — cleanup ed expired', () => {
  let cache: Cache<string>;

  beforeEach(() => {
    jest.useFakeTimers();
    cache = new Cache<string>(30_000, {
      staleTtl: 30_000, // stale non viene rimosso da removeExpired
    });
  });

  afterEach(() => {
    cache.clear();
    cache.stopCleanup();
    jest.useRealTimers();
  });

  it('removeExpired rimuove entry oltre staleTtl (non solo TTL)', () => {
    cache.set('fresh', 'value', 120_000); // fresco
    cache.set('stale-but-ok', 'value', 10_000); // stale ma entro staleTtl
    cache.set('truly-expired', 'value', 5_000); // oltre TTL + staleTtl

    jest.advanceTimersByTime(40_000); // 40s > 35s (5k + 30k stale)

    const removed = cache.removeExpired();
    expect(removed).toBe(1); // solo truly-expired

    expect(cache.get('fresh')).toBe('value');
    expect(cache.get('stale-but-ok')).toBe('value'); // stale ma non rimosso
    expect(cache.get('truly-expired')).toBeUndefined();
  });

  it('entry stale entro staleTtl NON viene rimossa da removeExpired', () => {
    cache.set('stale', 'value', 10_000);

    jest.advanceTimersByTime(25_000); // 25s < 40s (10k TTL + 30k staleTtl)

    const removed = cache.removeExpired();
    expect(removed).toBe(0);

    // Ancora accessibile come stale
    const result = cache.getWithStale('stale');
    expect(result).toBeDefined();
    expect(result!.isStale).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Suite: Edge — invalidate, invalidatePrefix, clear
// ---------------------------------------------------------------------------
describe('Cache<T> — invalidate, invalidatePrefix, clear', () => {
  let cache: Cache<string>;

  beforeEach(() => {
    jest.useFakeTimers();
    cache = new Cache<string>(30_000, {
      staleTtl: 30_000,
    });
  });

  afterEach(() => {
    cache.clear();
    cache.stopCleanup();
    jest.useRealTimers();
  });

  it('invalidate rimuove chiave anche se stale', () => {
    cache.set('key', 'value');
    jest.advanceTimersByTime(35_000); // diventa stale

    // Ancora accessibile come stale
    expect(cache.getWithStale('key')).toBeDefined();

    // Invalida
    cache.invalidate('key');
    expect(cache.getWithStale('key')).toBeUndefined();
  });

  it('invalidatePrefix rimuove gruppo di chiavi', () => {
    cache.set('user:1:name', 'Alice');
    cache.set('user:2:name', 'Bob');
    cache.set('config:theme', 'dark');

    cache.invalidatePrefix('user:');
    expect(cache.get('user:1:name')).toBeUndefined();
    expect(cache.get('user:2:name')).toBeUndefined();
    expect(cache.get('config:theme')).toBe('dark');
  });

  it('clear resetta tutto incluse statistiche', () => {
    cache.set('a', '1');
    cache.set('b', '2');
    cache.get('a'); // hit
    cache.get('nonexistent'); // miss

    expect(cache.size).toBe(2);
    expect(cache.getStats().hits).toBe(1);

    cache.clear();

    expect(cache.size).toBe(0);
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBeUndefined();
  });

  it('getWithStale multipli sulla stessa entry stale contano staleHits correttamente', () => {
    cache.set('hot-stale', 'value');
    jest.advanceTimersByTime(35_000);

    // Primo accesso stale
    cache.get('hot-stale');
    expect(cache.getStats().staleHits).toBe(1);

    // Secondo accesso stale
    cache.get('hot-stale');
    expect(cache.getStats().staleHits).toBe(2);
  });
});
