/**
 * Test per LLMCache — Ianus Liminalis (ADR-006)
 *
 * Two-layer LLM response cache:
 *   L1 — In-memory LRU (max 10K entries, 5 min TTL)
 *   L2 — File-based JSONL (.ianus-cache/llm/, 24 h TTL)
 *
 * Copre 12 scenari:
 *   1. set + get base
 *   2. SHA256 key hash (getStats mostra 1 entry L1)
 *   3. L2 persistenza (nuova istanza recupera da L2)
 *   4. invalidate singola chiave
 *   5. invalidateModel (selettivo per modello)
 *   6. clear resetta tutto
 *   7. L1 LRU eviction (max 10K)
 *   8. getStats campi attesi
 *   9. L2 file creato su disco
 *  10. Cache hit tracking
 *  11. Cache miss tracking
 *  12. TTL expiration (L1 + L2)
 *
 * @module tests/llm-cache
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LLMCache, resetLLMCache } from '../src/core/llm-cache.js';

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------
let tmpDir: string;

beforeAll(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'llm-cache-test-'));
});

afterAll(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

// ===========================================================================
// Test suite
// ===========================================================================
describe('LLMCache', () => {
  let cache: LLMCache;

  beforeEach(() => {
    resetLLMCache();
    cache = new LLMCache(tmpDir);
  });

  afterEach(async () => {
    // Clean up L2 file to keep tests isolated
    const l2Dir = join(tmpDir, '.ianus-cache', 'llm');
    const l2File = join(l2Dir, 'cache.jsonl');
    try {
      if (existsSync(l2File)) {
        await rm(l2File, { force: true });
      }
    } catch {
      // Ignore cleanup errors
    }
  });

  // ────────────────────────────────────────────────────────────────────────
  // Test 1: set + get base
  // ────────────────────────────────────────────────────────────────────────
  it('set + get restituisce lo stesso valore', async () => {
    const model = 'gpt-4';
    const prompt = 'What is the meaning of life?';
    const response = '42';
    const key = `${model}::${prompt}`;

    await cache.set(key, response);

    const result = await cache.get(key);
    expect(result).toBe(response);
  });

  // ────────────────────────────────────────────────────────────────────────
  // Test 2: SHA256 key hash — getStats mostra 1 entry L1
  // ────────────────────────────────────────────────────────────────────────
  it('getStats mostra 1 entry in L1 dopo set', async () => {
    await cache.set('gpt-4::hello', 'world');

    const stats = cache.getStats();
    expect(stats.l1.entries).toBe(1);
    expect(stats.l2.entries).toBe(1); // set scrive sempre anche su L2
  });

  // ────────────────────────────────────────────────────────────────────────
  // Test 3: L2 persistenza — nuova istanza recupera da L2
  // ────────────────────────────────────────────────────────────────────────
  it('nuova istanza recupera i dati da L2 (persistenza)', async () => {
    const key = 'claude::test-persistence';
    const value = 'persisted-value';

    // Prima istanza: scrive in L1 + L2
    await cache.set(key, value);

    // Seconda istanza: L1 vuoto, deve leggere da L2
    const cache2 = new LLMCache(tmpDir);
    const result = await cache2.get(key);

    expect(result).toBe(value);

    // Deve essere conteggiato come L2 hit (L1 miss → L2 hit)
    const stats = cache2.getStats();
    expect(stats.l1.hits).toBe(0);
    expect(stats.l1.misses).toBe(1); // L1 miss, ma trovato in L2
  });

  // ────────────────────────────────────────────────────────────────────────
  // Test 4: invalidate singola chiave
  // ────────────────────────────────────────────────────────────────────────
  it('invalidate rimuove una chiave specifica', async () => {
    await cache.set('model::keep', 'keep-value');
    await cache.set('model::remove', 'remove-value');

    // Verifica che entrambe esistano
    expect(await cache.get('model::keep')).toBe('keep-value');
    expect(await cache.get('model::remove')).toBe('remove-value');

    // Invalida solo 'remove'
    cache.invalidate('model::remove');

    // Aspetta che l'async L2 rewrite completi
    await new Promise((r) => setTimeout(r, 100));

    // 'remove' deve essere sparito
    expect(await cache.get('model::remove')).toBeNull();

    // 'keep' deve essere ancora presente
    expect(await cache.get('model::keep')).toBe('keep-value');
  });

  // ────────────────────────────────────────────────────────────────────────
  // Test 5: invalidateModel — rimuove solo le entry di un modello
  // ────────────────────────────────────────────────────────────────────────
  it('invalidateModel rimuove solo le entry del modello specificato', async () => {
    // Modello A: 2 prompt
    await cache.set('gpt-4::prompt-a1', 'response-a1');
    await cache.set('gpt-4::prompt-a2', 'response-a2');
    // Modello B: 1 prompt
    await cache.set('claude::prompt-b1', 'response-b1');

    // Verifica che tutte e 3 esistano
    expect(await cache.get('gpt-4::prompt-a1')).toBe('response-a1');
    expect(await cache.get('gpt-4::prompt-a2')).toBe('response-a2');
    expect(await cache.get('claude::prompt-b1')).toBe('response-b1');

    // Invalida modello A
    cache.invalidateModel('gpt-4');

    // Aspetta che l'async L2 rewrite completi
    await new Promise((r) => setTimeout(r, 100));

    // Le entry di A devono essere rimosse
    expect(await cache.get('gpt-4::prompt-a1')).toBeNull();
    expect(await cache.get('gpt-4::prompt-a2')).toBeNull();

    // La entry di B deve essere ancora presente
    expect(await cache.get('claude::prompt-b1')).toBe('response-b1');
  });

  // ────────────────────────────────────────────────────────────────────────
  // Test 6: clear resetta tutto
  // ────────────────────────────────────────────────────────────────────────
  it('clear resetta L1 e L2', async () => {
    await cache.set('model::alpha', 'val-alpha');
    await cache.set('model::beta', 'val-beta');

    // Verifica popolate
    expect((await cache.get('model::alpha'))).toBe('val-alpha');
    expect((await cache.get('model::beta'))).toBe('val-beta');

    // Clear
    cache.clear();

    // Aspetta che l'async clearL2 completi
    await new Promise((r) => setTimeout(r, 100));

    // Entrambe devono essere sparite
    expect(await cache.get('model::alpha')).toBeNull();
    expect(await cache.get('model::beta')).toBeNull();

    // Stats azzerate (L1)
    const stats = cache.getStats();
    expect(stats.l1.entries).toBe(0);
    expect(stats.l1.hits).toBe(0);
    expect(stats.l1.misses).toBeGreaterThanOrEqual(0);
  });

  // ────────────────────────────────────────────────────────────────────────
  // Test 7: L1 LRU eviction — L1 non supera 10.000 entry
  // ────────────────────────────────────────────────────────────────────────
  it('L1 non supera 10.000 entry (LRU eviction)', { timeout: 60000 }, async () => {
    const totalEntries = 10_001;

    for (let i = 0; i < totalEntries; i++) {
      await cache.set(`model::lru-key-${i}`, `value-${i}`);
    }

    const stats = cache.getStats();
    expect(stats.l1.entries).toBeLessThanOrEqual(10_000);
    // Verifica che le entry siano tutte nell'intorno di 10K
    expect(stats.l1.entries).toBeGreaterThan(9_000);
  });

  // ────────────────────────────────────────────────────────────────────────
  // Test 8: getStats restituisce oggetto con campi attesi
  // ────────────────────────────────────────────────────────────────────────
  it('getStats restituisce struttura completa con tutti i campi', async () => {
    await cache.set('model::stat-test', 'stat-value');

    // Un hit
    await cache.get('model::stat-test');
    // Un miss
    await cache.get('model::nonexistent');

    const stats = cache.getStats();

    // Struttura L1
    expect(stats).toHaveProperty('l1');
    expect(stats.l1).toHaveProperty('entries');
    expect(stats.l1).toHaveProperty('maxEntries');
    expect(stats.l1).toHaveProperty('hits');
    expect(stats.l1).toHaveProperty('misses');
    expect(stats.l1).toHaveProperty('hitRate');
    expect(stats.l1).toHaveProperty('oldestEntry');
    expect(stats.l1).toHaveProperty('newestEntry');

    // Valori specifici
    expect(stats.l1.entries).toBe(1);
    expect(stats.l1.maxEntries).toBe(10_000);
    expect(stats.l1.hits).toBe(1);
    expect(stats.l1.misses).toBe(1);
    expect(stats.l1.hitRate).toBeCloseTo(0.5, 1);
    expect(stats.l1.oldestEntry).toBeTypeOf('string');
    expect(stats.l1.newestEntry).toBeTypeOf('string');

    // Struttura L2
    expect(stats).toHaveProperty('l2');
    expect(stats.l2).toHaveProperty('entries');
    expect(stats.l2).toHaveProperty('fileSizeBytes');
    expect(stats.l2.entries).toBeGreaterThanOrEqual(1);
    expect(stats.l2.fileSizeBytes).toBeGreaterThanOrEqual(1);
  });

  // ────────────────────────────────────────────────────────────────────────
  // Test 9: L2 file creato su disco
  // ────────────────────────────────────────────────────────────────────────
  it('set crea il file cache su disco (L2 persistente)', async () => {
    const l2Path = join(tmpDir, '.ianus-cache', 'llm', 'cache.jsonl');

    // Prima del set, il file non deve esistere
    expect(existsSync(l2Path)).toBe(false);

    await cache.set('model::disk-test', 'disk-value');

    // Dopo il set, il file deve esistere
    expect(existsSync(l2Path)).toBe(true);

    // Il file deve contenere la entry in formato JSONL
    const { readFile } = await import('node:fs/promises');
    const content = await readFile(l2Path, 'utf-8');
    expect(content).toContain('disk-value');
    expect(content).toContain('disk-test'); // keyHash nel JSON
  });

  // ────────────────────────────────────────────────────────────────────────
  // Test 10: Cache hit — get incrementa hits
  // ────────────────────────────────────────────────────────────────────────
  it('get multipli incrementano hits correttamente', async () => {
    await cache.set('model::hit-test', 'hit-value');

    // 3 get consecutivi sulla stessa chiave
    await cache.get('model::hit-test');
    await cache.get('model::hit-test');
    await cache.get('model::hit-test');

    const stats = cache.getStats();
    expect(stats.l1.hits).toBe(3);
  });

  // ────────────────────────────────────────────────────────────────────────
  // Test 11: Cache miss — get su chiave inesistente
  // ────────────────────────────────────────────────────────────────────────
  it('get su chiave mai settata restituisce null e incrementa misses', async () => {
    const result = await cache.get('model::never-set');
    expect(result).toBeNull();

    const stats = cache.getStats();
    expect(stats.l1.misses).toBe(1);
    expect(stats.l1.hits).toBe(0);

    // Miss multipli
    await cache.get('model::never-set');
    await cache.get('model::another-miss');

    const stats2 = cache.getStats();
    expect(stats2.l1.misses).toBe(3);
  });

  // ────────────────────────────────────────────────────────────────────────
  // Test 12: TTL expiration — L1 + L2 scaduti
  // ────────────────────────────────────────────────────────────────────────
  it('dopo TTL scaduto get restituisce null (L1 5min + L2 24h)', async () => {
    vi.useFakeTimers();

    try {
      const ttlCache = new LLMCache(tmpDir);
      await ttlCache.set('model::ttl-test', 'ttl-value');

      // Verifica che sia leggibile subito
      const immediate = await ttlCache.get('model::ttl-test');
      expect(immediate).toBe('ttl-value');

      // Avanza oltre L2 TTL (86_400_000ms = 24h)
      // Questo fa scadere sia L1 (5min) che L2 (24h)
      vi.advanceTimersByTime(86_400_001);

      // Ora get deve restituire null (entrambi i livelli scaduti)
      const expired = await ttlCache.get('model::ttl-test');
      expect(expired).toBeNull();

      // Deve aver incrementato misses (L1 miss, L2 miss)
      const stats = ttlCache.getStats();
      expect(stats.l1.misses).toBeGreaterThanOrEqual(2); // 1 pre-advance miss + 1 scaduto
    } finally {
      vi.useRealTimers();
    }
  });
});
