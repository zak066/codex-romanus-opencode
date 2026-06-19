/**
 * fs_cache — Ianus Liminalis
 *
 * Cache layer in-memory per letture frequenti.
 * Riduce I/O su file acceduti spesso con TTL configurabile.
 * Cache non persiste tra riavvii del server.
 *
 * Supporta LRU eviction (max 10.000 entries), hit/miss tracking per entry,
 * e azioni di debugging come peek ed evict manuale.
 */

import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { minimatch } from 'minimatch';
import { stats as serverStats } from '../core/stats.js';
import { toolRegistry } from './registry.js';
import type { ToolDeps } from './types.js';

// ────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────

const MAX_ENTRIES = 10000;

// ────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────

interface CacheEntry {
  data: Buffer;
  mtime: number;        // When the data was cached
  expiresAt: number;    // Timestamp when this entry expires
  accessCount: number;  // How many times this entry has been accessed (hit)
  lastAccessed: number; // Timestamp of the most recent access
}

interface CacheStats {
  action: 'stats';
  entries: number;
  totalSize: number;
  hits: number;
  misses: number;
  hitRate: number;
  oldestEntry?: string;
  newestEntry?: string;
  maxEntries: number;
  evictionCount: number;
  topKeys: string[];
}

// ────────────────────────────────────────────────────────────
// Cache Store
// ────────────────────────────────────────────────────────────

class MemoryCache {
  static readonly MAX_ENTRIES = MAX_ENTRIES;

  private store = new Map<string, CacheEntry>();
  private hits = 0;
  private misses = 0;
  private oldestTimestamp = Infinity;
  private newestTimestamp = 0;

  /** Tracks the last access timestamp per key for LRU eviction ordering. */
  private accessTimestamps = new Map<string, number>();
  /** Total number of evictions performed (auto + manual). */
  private evictionCount = 0;

  // ── Public API ─────────────────────────────────────────────

  get(key: string): { data: Buffer; size: number; ttlRemaining: number } | null {
    const entry = this.store.get(key);
    if (!entry) {
      this.misses++;
      return null;
    }

    const now = Date.now();
    if (now > entry.expiresAt) {
      // Expired — remove and return null
      this.store.delete(key);
      this.accessTimestamps.delete(key);
      this.misses++;
      return null;
    }

    this.hits++;
    entry.accessCount++;
    entry.lastAccessed = now;
    this.accessTimestamps.set(key, now);

    return {
      data: entry.data,
      size: entry.data.length,
      ttlRemaining: Math.round((entry.expiresAt - now) / 1000),
    };
  }

  set(key: string, data: Buffer, ttlSeconds: number): void {
    const now = Date.now();
    const expiresAt = now + ttlSeconds * 1000;

    this.store.set(key, {
      data,
      mtime: now,
      expiresAt,
      accessCount: 0,
      lastAccessed: now,
    });
    this.accessTimestamps.set(key, now);

    if (now < this.oldestTimestamp) this.oldestTimestamp = now;
    if (now > this.newestTimestamp) this.newestTimestamp = now;

    // LRU eviction: if over limit, evict 20% oldest entries
    if (this.store.size > MAX_ENTRIES) {
      this.evictInternal();
    }
  }

  invalidate(pattern?: string): number {
    if (!pattern) {
      const key = this.store.keys().next().value;
      if (key !== undefined) {
        this.store.delete(key);
        this.accessTimestamps.delete(key);
        return 1;
      }
      return 0;
    }

    let count = 0;
    for (const key of this.store.keys()) {
      if (minimatch(key, pattern, { dot: true })) {
        this.store.delete(key);
        this.accessTimestamps.delete(key);
        count++;
      }
    }
    return count;
  }

  clear(): number {
    const count = this.store.size;
    this.store.clear();
    this.accessTimestamps.clear();
    this.hits = 0;
    this.misses = 0;
    this.oldestTimestamp = Infinity;
    this.newestTimestamp = 0;
    this.evictionCount = 0;
    return count;
  }

  /**
   * Read an entry without incrementing any counters.
   * Useful for debugging / introspection.
   */
  peek(key: string): { data: Buffer; size: number; ttlRemaining: number } | null {
    const entry = this.store.get(key);
    if (!entry) return null;

    const now = Date.now();
    if (now > entry.expiresAt) {
      this.store.delete(key);
      this.accessTimestamps.delete(key);
      return null;
    }

    return {
      data: entry.data,
      size: entry.data.length,
      ttlRemaining: Math.round((entry.expiresAt - now) / 1000),
    };
  }

  /**
   * Force eviction of the oldest entries.
   * If count is omitted, evicts 20% of MAX_ENTRIES (2000).
   */
  evict(count?: number): number {
    return this.evictInternal(count);
  }

  getStats(): CacheStats {
    const entries = this.store.size;
    let totalSize = 0;
    for (const entry of this.store.values()) {
      totalSize += entry.data.length;
    }

    const totalRequests = this.hits + this.misses;
    const hitRate = totalRequests > 0 ? this.hits / totalRequests : 0;

    // Top 10 keys by access count
    const accessCounts = new Map<string, number>();
    for (const [key, entry] of this.store.entries()) {
      accessCounts.set(key, entry.accessCount);
    }
    const topKeys = [...accessCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([key]) => key);

    return {
      action: 'stats',
      entries,
      totalSize,
      hits: this.hits,
      misses: this.misses,
      hitRate: Math.round(hitRate * 1000) / 1000,
      oldestEntry: this.oldestTimestamp < Infinity
        ? new Date(this.oldestTimestamp).toISOString()
        : undefined,
      newestEntry: this.newestTimestamp > 0
        ? new Date(this.newestTimestamp).toISOString()
        : undefined,
      maxEntries: MAX_ENTRIES,
      evictionCount: this.evictionCount,
      topKeys,
    };
  }

  // ── Internal helpers ───────────────────────────────────────

  /**
   * Internal eviction: removes the oldest entries by last-accessed timestamp.
   * @param count  Number of entries to evict. Defaults to 20% of MAX_ENTRIES.
   * @returns The number of entries actually evicted.
   */
  private evictInternal(count?: number): number {
    const target = count ?? Math.ceil(MAX_ENTRIES * 0.2); // 2000 by default
    const sorted = [...this.accessTimestamps.entries()]
      .sort((a, b) => a[1] - b[1]) // oldest first
      .slice(0, Math.min(target, this.store.size));

    for (const [key] of sorted) {
      this.store.delete(key);
      this.accessTimestamps.delete(key);
    }

    this.evictionCount += sorted.length;
    return sorted.length;
  }
}

// Singleton cache instance
const globalCache = new MemoryCache();

// ────────────────────────────────────────────────────────────
// Action Handlers
// ────────────────────────────────────────────────────────────

function handleGet(args: Record<string, unknown>) {
  const key = args.key as string | undefined;
  if (!key) {
    return {
      content: [{ type: 'text', text: 'Missing required parameter: "key"' }],
      isError: true,
    };
  }

  const result = globalCache.get(key);
  if (!result) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ action: 'get', key, hit: false }),
        },
      ],
    };
  }

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          action: 'get',
          key,
          hit: true,
          size: result.size,
          ttlRemaining: result.ttlRemaining,
        }),
      },
    ],
  };
}

function handleSet(args: Record<string, unknown>) {
  const key = args.key as string | undefined;
  const ttl = (args.ttl as number) ?? 60;

  if (!key) {
    return {
      content: [{ type: 'text', text: 'Missing required parameter: "key"' }],
      isError: true,
    };
  }

  // data must be provided as a string (we'll store it as Buffer)
  const dataRaw = args.data as string | undefined;
  if (!dataRaw) {
    return {
      content: [{ type: 'text', text: 'Missing required parameter: "data" (string content to cache)' }],
      isError: true,
    };
  }

  const data = Buffer.from(dataRaw, 'utf-8');
  globalCache.set(key, data, ttl);

  const expiresAt = new Date(Date.now() + ttl * 1000).toISOString();

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          action: 'set',
          key,
          size: data.length,
          ttl,
          expiresAt,
        }),
      },
    ],
  };
}

function handleInvalidate(args: Record<string, unknown>) {
  const path = args.path as string | undefined;
  const key = args.key as string | undefined;

  if (key) {
    const count = globalCache.invalidate(key);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ action: 'invalidate', invalidated: count }),
        },
      ],
    };
  }

  // If no key, use path as glob pattern
  const pattern = path || '*';
  const count = globalCache.invalidate(pattern);

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({ action: 'invalidate', invalidated: count }),
      },
    ],
  };
}

function handleClear() {
  const count = globalCache.clear();
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({ action: 'clear', cleared: count }),
      },
    ],
  };
}

function handleStats() {
  const stats = globalCache.getStats();
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(stats),
      },
    ],
  };
}

function handleEvict(args: Record<string, unknown>) {
  const count = args.count as number | undefined;
  const evicted = globalCache.evict(count);
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({ action: 'evict', evicted }),
      },
    ],
  };
}

function handlePeek(args: Record<string, unknown>) {
  const key = args.key as string | undefined;
  if (!key) {
    return {
      content: [{ type: 'text', text: 'Missing required parameter: "key"' }],
      isError: true,
    };
  }

  const result = globalCache.peek(key);
  if (!result) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ action: 'peek', key, hit: false }),
        },
      ],
    };
  }

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          action: 'peek',
          key,
          hit: true,
          size: result.size,
          ttlRemaining: result.ttlRemaining,
        }),
      },
    ],
  };
}

// ────────────────────────────────────────────────────────────
// Tool Registration
// ────────────────────────────────────────────────────────────

export function registerCache(_server: Server, _deps: ToolDeps): void {
  toolRegistry.register({
    name: 'fs_cache',
    description:
      'In-memory cache layer for frequent file reads. ' +
      'Supports get/set/invalidate/clear/stats/evict/peek operations with TTL. ' +
      'Cache is lost on server restart. ' +
      'Useful for reducing I/O on frequently-accessed files.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['get', 'set', 'invalidate', 'clear', 'stats', 'evict', 'peek'],
          description: 'Cache action to perform',
        },
        key: {
          type: 'string',
          description: 'Cache key (typically file path). Used for get/set/invalidate/peek.',
        },
        data: {
          type: 'string',
          description: 'String data to cache (required for set)',
        },
        ttl: {
          type: 'number',
          default: 60,
          description: 'TTL in seconds (default: 60, used for set)',
        },
        path: {
          type: 'string',
          description: 'Glob pattern for invalidation (alternative to key)',
        },
        count: {
          type: 'number',
          description: 'Number of entries to evict (optional, for evict action)',
        },
      },
      required: ['action'],
    },
    handler: async (args) => {
      const action = args.action as string;

      switch (action) {
        case 'get':
          return handleGet(args);
        case 'set':
          return handleSet(args);
        case 'invalidate':
          return handleInvalidate(args);
        case 'clear':
          return handleClear();
        case 'stats':
          return handleStats();
        case 'evict':
          return handleEvict(args);
        case 'peek':
          return handlePeek(args);
        default:
          return {
            content: [{ type: 'text', text: `Unknown cache action: "${action}". Use: get, set, invalidate, clear, stats, evict, peek` }],
            isError: true,
          };
      }
    },
  });
}
