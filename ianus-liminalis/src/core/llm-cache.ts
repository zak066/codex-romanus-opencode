/**
 * llm-cache — Ianus Liminalis
 *
 * Two-layer LLM response cache (ADR-006):
 *   L1 — In-memory LRU (max 10K entries, 5min TTL)
 *   L2 — File-based JSONL (.ianus-cache/llm/, 24h TTL)
 *
 * Strategy:
 *   - L2 is cold storage: written when L1 evicts, read when L1 misses
 *   - set() always writes to both L1 + L2
 *   - get() checks L1 first, then L2 (promotes to L1 on hit)
 */

import { createHash } from 'node:crypto';
import { readFile, writeFile, appendFile, mkdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';

// ────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────

export interface LlmCacheStats {
  l1: {
    entries: number;
    maxEntries: number;
    hits: number;
    misses: number;
    hitRate: number;
    oldestEntry: string | null;
    newestEntry: string | null;
  };
  l2: {
    entries: number;
    fileSizeBytes: number;
  };
}

interface L1Entry {
  value: string;
  keyHash: string;
  model: string;
  createdAt: number;
  expiresAt: number;
  lastAccessed: number;
}

interface L2Entry {
  keyHash: string;
  value: string;
  model: string;
  createdAt: number;
  expiresAt: number;
}

// ────────────────────────────────────────────────────────────
// Configuration
// ────────────────────────────────────────────────────────────

const L1_MAX_ENTRIES = 10_000;
const L1_TTL_MS = 300_000;       // 5 minutes
const L2_TTL_MS = 86_400_000;     // 24 hours
const L2_FILE_NAME = 'cache.jsonl';

// ────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────

/**
 * Return the SHA-256 hex digest of a key string.
 */
function hashKey(key: string): string {
  return createHash('sha256').update(key, 'utf-8').digest('hex');
}

/**
 * Extract the model name from a key.
 * Convention: "model::rest" — the part before the first "::" is the model.
 * If no "::" separator is found, model defaults to "default".
 */
function extractModel(key: string): string {
  const idx = key.indexOf('::');
  if (idx > 0) return key.slice(0, idx);
  return 'default';
}

// ────────────────────────────────────────────────────────────
// LRU Map helper
// ────────────────────────────────────────────────────────────

/**
 * Thin wrapper over Map that tracks insertion order for LRU eviction.
 * `get()` and `set()` both move the key to the end (most-recently-used).
 */
class LRUMap<V> {
  private map = new Map<string, V>();

  get size(): number {
    return this.map.size;
  }

  has(key: string): boolean {
    return this.map.has(key);
  }

  get(key: string): V | undefined {
    const value = this.map.get(key);
    if (value !== undefined) {
      // Move to end (most recently used)
      this.map.delete(key);
      this.map.set(key, value);
    }
    return value;
  }

  set(key: string, value: V): void {
    // Delete first to ensure it moves to the end
    if (this.map.has(key)) {
      this.map.delete(key);
    }
    this.map.set(key, value);
  }

  delete(key: string): boolean {
    return this.map.delete(key);
  }

  /** Remove and return the least-recently-used entry. */
  popOldest(): { key: string; value: V } | null {
    const firstKey = this.map.keys().next().value;
    if (firstKey === undefined) return null;
    const value = this.map.get(firstKey)!;
    this.map.delete(firstKey);
    return { key: firstKey, value };
  }

  clear(): void {
    this.map.clear();
  }

  keys(): IterableIterator<string> {
    return this.map.keys();
  }
}

// ────────────────────────────────────────────────────────────
// LLM Cache
// ────────────────────────────────────────────────────────────

export class LLMCache {
  // L1: in-memory LRU
  private l1 = new LRUMap<L1Entry>();
  private modelIndex = new Map<string, Set<string>>(); // model → Set<keyHash>
  private l1Hits = 0;
  private l1Misses = 0;
  private l1OldestTimestamp = Infinity;
  private l1NewestTimestamp = 0;

  // L2: file-based (cold storage)
  private workspaceRoot: string;
  private cacheDir: string;
  private l2FileSize = 0;
  private l2EntryCount = 0;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
    this.cacheDir = join(workspaceRoot, '.ianus-cache', 'llm');
  }

  private get l2Path(): string {
    return join(this.cacheDir, L2_FILE_NAME);
  }

  // ═══════════════════════════════════════════════════════════
  //  L2 I/O
  // ═══════════════════════════════════════════════════════════

  private async ensureCacheDir(): Promise<void> {
    if (!existsSync(this.cacheDir)) {
      await mkdir(this.cacheDir, { recursive: true });
    }
  }

  /**
   * Append a single L2Entry as a JSON line to the cache file.
   */
  private async appendL2(entry: L2Entry): Promise<void> {
    await this.ensureCacheDir();
    const line = JSON.stringify(entry) + '\n';
    await appendFile(this.l2Path, line, 'utf-8');
    this.l2EntryCount++;
    this.l2FileSize += Buffer.byteLength(line, 'utf-8');
  }

  /**
   * Read all non-expired entries from the L2 JSONL file.
   * Scans linearly; acceptable for ~1000 entries.
   */
  private async readL2(): Promise<L2Entry[]> {
    if (!existsSync(this.l2Path)) return [];

    const content = await readFile(this.l2Path, 'utf-8');
    const lines = content.split('\n').filter(Boolean);
    const now = Date.now();
    const entries: L2Entry[] = [];
    let expired = 0;

    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as L2Entry;
        if (now < entry.expiresAt) {
          entries.push(entry);
        } else {
          expired++;
        }
      } catch {
        // Skip malformed lines
      }
    }

    this.l2EntryCount = entries.length;
    return entries;
  }

  /**
   * Rewrite the entire L2 file with the given entries.
   */
  private async writeL2(entries: L2Entry[]): Promise<void> {
    await this.ensureCacheDir();
    const lines = entries.map((e) => JSON.stringify(e)).join('\n');
    const content = lines.length > 0 ? lines + '\n' : '';
    await writeFile(this.l2Path, content, 'utf-8');
    this.l2EntryCount = entries.length;
    this.l2FileSize = Buffer.byteLength(content, 'utf-8');
  }

  // ═══════════════════════════════════════════════════════════
  //  L1 LRU eviction
  // ═══════════════════════════════════════════════════════════

  /**
   * Evict oldest entries from L1 until it fits within max.
   * Evicted entries are written to L2 (cold storage).
   */
  private async evictL1(): Promise<void> {
    const promoted: L2Entry[] = [];
    while (this.l1.size >= L1_MAX_ENTRIES) {
      const oldest = this.l1.popOldest();
      if (!oldest) break;

      const entry = oldest.value;

      // Stage for L2 write
      promoted.push({
        keyHash: entry.keyHash,
        value: entry.value,
        model: entry.model,
        createdAt: entry.createdAt,
        expiresAt: Date.now() + L2_TTL_MS,
      });

      // Remove from model index
      const modelSet = this.modelIndex.get(entry.model);
      if (modelSet) {
        modelSet.delete(oldest.key);
        if (modelSet.size === 0) this.modelIndex.delete(entry.model);
      }
    }

    // Batch-write to L2
    if (promoted.length > 0) {
      await this.ensureCacheDir();
      const lines = promoted.map((e) => JSON.stringify(e)).join('\n') + '\n';
      await appendFile(this.l2Path, lines, 'utf-8');
      this.l2EntryCount += promoted.length;
      this.l2FileSize += Buffer.byteLength(lines, 'utf-8');
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  Model index helpers
  // ═══════════════════════════════════════════════════════════

  private addToModelIndex(model: string, keyHash: string): void {
    let set = this.modelIndex.get(model);
    if (!set) {
      set = new Set();
      this.modelIndex.set(model, set);
    }
    set.add(keyHash);
  }

  private removeFromModelIndex(model: string, keyHash: string): void {
    const set = this.modelIndex.get(model);
    if (set) {
      set.delete(keyHash);
      if (set.size === 0) this.modelIndex.delete(model);
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  Public API
  // ═══════════════════════════════════════════════════════════

  /**
   * Look up a key in the cache.
   * Checks L1 first; on miss, falls through to L2.
   * L2 hits are promoted back to L1.
   */
  async get(key: string): Promise<string | null> {
    const keyHash = hashKey(key);
    const model = extractModel(key);
    const now = Date.now();

    // ── L1 lookup ──
    const l1Entry = this.l1.get(keyHash);
    if (l1Entry) {
      if (now < l1Entry.expiresAt) {
        this.l1Hits++;
        return l1Entry.value;
      }
      // Expired: remove from L1
      this.l1.delete(keyHash);
      this.removeFromModelIndex(model, keyHash);
    }

    // ── L2 lookup ──
    const l2Entries = await this.readL2();
    const l2Entry = l2Entries.find((e) => e.keyHash === keyHash);
    if (l2Entry && now < l2Entry.expiresAt) {
      this.l1Misses++; // L1 miss, L2 hit

      // Promote to L1
      const promoted: L1Entry = {
        value: l2Entry.value,
        keyHash: l2Entry.keyHash,
        model: l2Entry.model,
        createdAt: l2Entry.createdAt,
        expiresAt: now + L1_TTL_MS,
        lastAccessed: now,
      };
      this.l1.set(keyHash, promoted);
      this.addToModelIndex(model, keyHash);
      this.trackL1Timestamps(now);

      await this.evictL1();
      return l2Entry.value;
    }

    // ── Complete miss ──
    this.l1Misses++;
    return null;
  }

  /**
   * Store a key-value pair in both L1 and L2.
   */
  async set(key: string, value: string): Promise<void> {
    const keyHash = hashKey(key);
    const model = extractModel(key);
    const now = Date.now();

    // L2 write (durable)
    const l2Entry: L2Entry = {
      keyHash,
      value,
      model,
      createdAt: now,
      expiresAt: now + L2_TTL_MS,
    };
    await this.appendL2(l2Entry);

    // L1 write
    const l1Entry: L1Entry = {
      value,
      keyHash,
      model,
      createdAt: now,
      expiresAt: now + L1_TTL_MS,
      lastAccessed: now,
    };
    this.l1.set(keyHash, l1Entry);
    this.addToModelIndex(model, keyHash);
    this.trackL1Timestamps(now);

    await this.evictL1();
  }

  /**
   * Remove a specific key from the cache (L1 + L2 rewrite).
   */
  invalidate(key: string): void {
    const keyHash = hashKey(key);
    const model = extractModel(key);

    // Remove from L1
    this.l1.delete(keyHash);
    this.removeFromModelIndex(model, keyHash);

    // Remove from L2 (rewrite without the entry)
    this.removeFromL2(keyHash).catch(() => {});
  }

  /**
   * Remove all entries associated with a given model.
   */
  invalidateModel(model: string): void {
    // L1 via model index
    const modelSet = this.modelIndex.get(model);
    if (modelSet) {
      for (const keyHash of modelSet) {
        this.l1.delete(keyHash);
      }
      this.modelIndex.delete(model);
    }

    // L2 rewrite without the model
    this.removeModelFromL2(model).catch(() => {});
  }

  /**
   * Clear all cached data (L1 memory + L2 file).
   */
  clear(): void {
    // L1
    this.l1.clear();
    this.modelIndex.clear();
    this.l1Hits = 0;
    this.l1Misses = 0;
    this.l1OldestTimestamp = Infinity;
    this.l1NewestTimestamp = 0;

    // L2
    this.clearL2().catch(() => {});
  }

  /**
   * Return current cache statistics:
   *   L1: entries, max, hit/miss, hit rate, oldest/newest
   *   L2: entries, file size
   */
  getStats(): LlmCacheStats {
    const totalL1 = this.l1Hits + this.l1Misses;
    const l1HitRate = totalL1 > 0 ? this.l1Hits / totalL1 : 0;

    return {
      l1: {
        entries: this.l1.size,
        maxEntries: L1_MAX_ENTRIES,
        hits: this.l1Hits,
        misses: this.l1Misses,
        hitRate: Math.round(l1HitRate * 1000) / 1000,
        oldestEntry:
          this.l1OldestTimestamp < Infinity
            ? new Date(this.l1OldestTimestamp).toISOString()
            : null,
        newestEntry:
          this.l1NewestTimestamp > 0
            ? new Date(this.l1NewestTimestamp).toISOString()
            : null,
      },
      l2: {
        entries: this.l2EntryCount,
        fileSizeBytes: this.l2FileSize,
      },
    };
  }

  // ═══════════════════════════════════════════════════════════
  //  Internals
  // ═══════════════════════════════════════════════════════════

  private trackL1Timestamps(ts: number): void {
    if (ts < this.l1OldestTimestamp) this.l1OldestTimestamp = ts;
    if (ts > this.l1NewestTimestamp) this.l1NewestTimestamp = ts;
  }

  /**
   * Rewrite L2 file excluding the given keyHash.
   */
  private async removeFromL2(keyHash: string): Promise<void> {
    const entries = await this.readL2();
    const filtered = entries.filter((e) => e.keyHash !== keyHash);
    if (filtered.length < entries.length) {
      await this.writeL2(filtered);
    }
  }

  /**
   * Rewrite L2 file excluding all entries for the given model.
   */
  private async removeModelFromL2(model: string): Promise<void> {
    const entries = await this.readL2();
    const filtered = entries.filter((e) => e.model !== model);
    if (filtered.length < entries.length) {
      await this.writeL2(filtered);
    }
  }

  /**
   * Clear the L2 file completely.
   */
  private async clearL2(): Promise<void> {
    await this.ensureCacheDir();
    await writeFile(this.l2Path, '', 'utf-8');
    this.l2EntryCount = 0;
    this.l2FileSize = 0;
  }
}

// ═══════════════════════════════════════════════════════════════
//  Singleton access
// ═══════════════════════════════════════════════════════════════

let instance: LLMCache | null = null;

/**
 * Get or create the singleton LLMCache instance.
 * Requires workspaceRoot on first call.
 */
export function getLLMCache(workspaceRoot?: string): LLMCache {
  if (!instance) {
    if (!workspaceRoot) {
      throw new Error(
        'LLMCache not initialized: workspaceRoot is required on first call',
      );
    }
    instance = new LLMCache(workspaceRoot);
  }
  return instance;
}

/**
 * Reset the singleton (useful for testing).
 */
export function resetLLMCache(): void {
  instance = null;
}
