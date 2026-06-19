/**
 * AssetRegistry — Unit Tests
 *
 * Copre:
 * - registerAsset (UUID, expiresAt, identity)
 * - getAsset per ID (found / not found, accessCount, lastAccessed)
 * - getAssetByIdentity (stable identity, case-sensitivity, accessCount)
 * - listAssets (tutti, per type, con limit, con since/until, sorted)
 * - getAssetMetadata (campi, età, ttl, null per inesistente)
 * - cleanupExpired (TTL, expired vs active, empty registry)
 * - maxSize eviction (LRU-like per createdAt)
 * - getStats (total, active, expired, oldest/newest)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { AssetRegistry } from '../../src/services/asset-registry.js';
import type { AssetInfo, AssetFilter, Provenance } from '../../src/services/asset-registry.js';
import type { AssetIdentity } from '../../src/comfyui/types.js';

// ─── Suite ───────────────────────────────────────────────────────────────────

describe('AssetRegistry', () => {
  let registry: AssetRegistry;

  beforeEach(() => {
    registry = new AssetRegistry();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ─── registerAsset ───────────────────────────────────────────

  describe('registerAsset', () => {
    it('should create asset with UUID and calculated expiresAt', () => {
      const info: AssetInfo = {
        filename: 'comfy_output.png',
        subfolder: '2025/01/15',
        type: 'output',
      };

      const asset = registry.registerAsset(info);

      expect(asset).toBeDefined();
      // UUID v4: 36 chars, 4 hyphens, hex digits
      expect(asset.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
      expect(asset.identity.filename).toBe('comfy_output.png');
      expect(asset.identity.subfolder).toBe('2025/01/15');
      expect(asset.identity.type).toBe('output');
      expect(asset.createdAt).toBeInstanceOf(Date);
      expect(asset.expiresAt).toBeInstanceOf(Date);
      // Default TTL = 24h
      expect(asset.expiresAt.getTime() - asset.createdAt.getTime()).toBe(24 * 60 * 60 * 1000);
      expect(asset.accessCount).toBe(0);
      expect(asset.lastAccessed).toBeInstanceOf(Date);
    });

    it('should accept optional provenance', () => {
      const provenance: Provenance = {
        workflowId: 'wf-1',
        promptId: 'prompt-abc',
        modelName: 'sd_xl_base_1.0.safetensors',
        seed: 42,
        createdAt: new Date(),
      };

      const asset = registry.registerAsset(
        { filename: 'img.png', subfolder: '', type: 'output' },
        provenance,
      );

      expect(asset.provenance).toBeDefined();
      expect(asset.provenance!.workflowId).toBe('wf-1');
      expect(asset.provenance!.promptId).toBe('prompt-abc');
      expect(asset.provenance!.modelName).toBe('sd_xl_base_1.0.safetensors');
      expect(asset.provenance!.seed).toBe(42);
    });

    it('should set custom TTL via constructor', () => {
      const customRegistry = new AssetRegistry({ ttlMs: 5000 });
      const asset = customRegistry.registerAsset(
        { filename: 'a.png', subfolder: '', type: 'temp' },
      );

      expect(asset.expiresAt.getTime() - asset.createdAt.getTime()).toBe(5000);
    });
  });

  // ─── getAsset ─────────────────────────────────────────────────

  describe('getAsset', () => {
    it('should return asset by ID', () => {
      const asset = registry.registerAsset(
        { filename: 'test.png', subfolder: 'sub', type: 'output' },
      );

      const found = registry.getAsset(asset.id);

      expect(found).not.toBeNull();
      expect(found!.id).toBe(asset.id);
      expect(found!.identity.filename).toBe('test.png');
    });

    it('should return null for unknown ID', () => {
      const result = registry.getAsset('00000000-0000-0000-0000-000000000000');
      expect(result).toBeNull();
    });

    it('should update lastAccessed on getAsset', () => {
      vi.useFakeTimers();
      const asset = registry.registerAsset(
        { filename: 'a.png', subfolder: '', type: 'output' },
      );
      const originalLastAccessed = asset.lastAccessed.getTime();

      vi.advanceTimersByTime(1000);
      registry.getAsset(asset.id);

      expect(asset.lastAccessed.getTime()).toBeGreaterThan(originalLastAccessed);
      vi.useRealTimers();
    });
  });

  // ─── getAssetByIdentity ───────────────────────────────────────

  describe('getAssetByIdentity', () => {
    it('should lookup by stable identity (filename + subfolder + type)', () => {
      const asset = registry.registerAsset(
        { filename: 'output.png', subfolder: 'subdir', type: 'output' },
      );

      const identity: AssetIdentity = {
        filename: 'output.png',
        subfolder: 'subdir',
        type: 'output',
      };

      const found = registry.getAssetByIdentity(identity);
      expect(found).not.toBeNull();
      expect(found!.id).toBe(asset.id);
    });

    it('should be case-sensitive (different case → no match)', () => {
      registry.registerAsset(
        { filename: 'Output.png', subfolder: 'Sub', type: 'output' },
      );

      const identity: AssetIdentity = {
        filename: 'output.png',
        subfolder: 'sub',
        type: 'output',
      };

      const found = registry.getAssetByIdentity(identity);
      expect(found).toBeNull();
    });

    it('should return null for non-existent identity', () => {
      const identity: AssetIdentity = {
        filename: 'nonexistent.png',
        subfolder: '',
        type: 'output',
      };

      const found = registry.getAssetByIdentity(identity);
      expect(found).toBeNull();
    });

    it('should return null when type differs', () => {
      registry.registerAsset(
        { filename: 'img.png', subfolder: '', type: 'output' },
      );

      const identity: AssetIdentity = {
        filename: 'img.png',
        subfolder: '',
        type: 'temp', // different type
      };

      const found = registry.getAssetByIdentity(identity);
      expect(found).toBeNull();
    });
  });

  // ─── listAssets ───────────────────────────────────────────────

  describe('listAssets', () => {
    it('should return all registered assets', () => {
      registry.registerAsset({ filename: 'a.png', subfolder: '', type: 'output' });
      registry.registerAsset({ filename: 'b.png', subfolder: '', type: 'output' });
      registry.registerAsset({ filename: 'c.png', subfolder: '', type: 'temp' });

      const all = registry.listAssets();
      expect(all).toHaveLength(3);
    });

    it('should filter by type', () => {
      registry.registerAsset({ filename: 'a.png', subfolder: '', type: 'output' });
      registry.registerAsset({ filename: 'b.png', subfolder: '', type: 'output' });
      registry.registerAsset({ filename: 'c.png', subfolder: '', type: 'temp' });

      const outputs = registry.listAssets({ type: 'output' });
      expect(outputs).toHaveLength(2);
      outputs.forEach((a) => expect(a.identity.type).toBe('output'));

      const temps = registry.listAssets({ type: 'temp' });
      expect(temps).toHaveLength(1);
      expect(temps[0].identity.filename).toBe('c.png');
    });

    it('should limit results and return newest first', () => {
      vi.useFakeTimers();
      registry.registerAsset({ filename: 'a.png', subfolder: '', type: 'output' });
      vi.advanceTimersByTime(10);
      registry.registerAsset({ filename: 'b.png', subfolder: '', type: 'output' });
      vi.advanceTimersByTime(10);
      registry.registerAsset({ filename: 'c.png', subfolder: '', type: 'output' });

      const limited = registry.listAssets({ limit: 2 });
      expect(limited).toHaveLength(2);
      expect(limited[0].identity.filename).toBe('c.png'); // newest first
      expect(limited[1].identity.filename).toBe('b.png');

      vi.useRealTimers();
    });

    it('should filter by promptId in provenance', () => {
      registry.registerAsset(
        { filename: 'a.png', subfolder: '', type: 'output', promptId: 'p1' },
        { promptId: 'p1', createdAt: new Date() },
      );
      registry.registerAsset(
        { filename: 'b.png', subfolder: '', type: 'output', promptId: 'p2' },
        { promptId: 'p2', createdAt: new Date() },
      );
      registry.registerAsset(
        { filename: 'c.png', subfolder: '', type: 'output' },
      );

      const forPrompt1 = registry.listAssets({ promptId: 'p1' });
      expect(forPrompt1).toHaveLength(1);
      expect(forPrompt1[0].identity.filename).toBe('a.png');

      const forUnknown = registry.listAssets({ promptId: 'p_unknown' });
      expect(forUnknown).toHaveLength(0);
    });

    it('should return empty array when no assets match', () => {
      const result = registry.listAssets({ type: 'temp' });
      expect(result).toEqual([]);
    });

    it('should sort by createdAt descending', () => {
      vi.useFakeTimers();
      registry.registerAsset({ filename: 'old.png', subfolder: '', type: 'output' });
      vi.advanceTimersByTime(50);
      registry.registerAsset({ filename: 'mid.png', subfolder: '', type: 'output' });
      vi.advanceTimersByTime(50);
      registry.registerAsset({ filename: 'new.png', subfolder: '', type: 'output' });

      const all = registry.listAssets();
      expect(all).toHaveLength(3);
      expect(all[0].identity.filename).toBe('new.png');
      expect(all[1].identity.filename).toBe('mid.png');
      expect(all[2].identity.filename).toBe('old.png');

      vi.useRealTimers();
    });
  });

  // ─── cleanupExpired ───────────────────────────────────────────

  describe('cleanupExpired', () => {
    it('should remove only expired assets', () => {
      vi.useFakeTimers();
      const shortTtlRegistry = new AssetRegistry({ ttlMs: 10 });

      shortTtlRegistry.registerAsset({ filename: 'a.png', subfolder: '', type: 'output' });

      // Not expired yet (0ms passed, TTL=10ms)
      expect(shortTtlRegistry.cleanupExpired()).toBe(0);
      expect(shortTtlRegistry.listAssets()).toHaveLength(1);

      // Advance past TTL
      vi.advanceTimersByTime(15);

      expect(shortTtlRegistry.cleanupExpired()).toBe(1);
      expect(shortTtlRegistry.listAssets()).toHaveLength(0);

      vi.useRealTimers();
    });

    it('should keep non-expired assets and remove only expired ones', () => {
      vi.useFakeTimers();
      const shortTtlRegistry = new AssetRegistry({ ttlMs: 50 });

      shortTtlRegistry.registerAsset({ filename: 'expired.png', subfolder: '', type: 'output' });
      vi.advanceTimersByTime(30);
      shortTtlRegistry.registerAsset({ filename: 'active.png', subfolder: '', type: 'output' });
      vi.advanceTimersByTime(30); // total 60ms — first expired, second still alive

      expect(shortTtlRegistry.cleanupExpired()).toBe(1);
      const remaining = shortTtlRegistry.listAssets();
      expect(remaining).toHaveLength(1);
      expect(remaining[0].identity.filename).toBe('active.png');

      vi.useRealTimers();
    });

    it('should return 0 for empty registry', () => {
      expect(registry.cleanupExpired()).toBe(0);
    });
  });

  // ─── maxSize Eviction ─────────────────────────────────────────

  describe('maxSize eviction', () => {
    it('should evict oldest asset when maxSize is exceeded', () => {
      vi.useFakeTimers();
      const smallRegistry = new AssetRegistry({ maxSize: 2 });

      const first = smallRegistry.registerAsset(
        { filename: 'first.png', subfolder: '', type: 'output' },
      );
      vi.advanceTimersByTime(10);
      const second = smallRegistry.registerAsset(
        { filename: 'second.png', subfolder: '', type: 'output' },
      );
      expect(smallRegistry.listAssets()).toHaveLength(2);

      vi.advanceTimersByTime(10);
      const third = smallRegistry.registerAsset(
        { filename: 'third.png', subfolder: '', type: 'output' },
      );

      // First (oldest) should be evicted
      expect(smallRegistry.listAssets()).toHaveLength(2);
      expect(smallRegistry.getAsset(first.id)).toBeNull();
      expect(smallRegistry.getAsset(second.id)).not.toBeNull();
      expect(smallRegistry.getAsset(third.id)).not.toBeNull();

      vi.useRealTimers();
    });

    it('should also remove evicted asset from identity index', () => {
      vi.useFakeTimers();
      const smallRegistry = new AssetRegistry({ maxSize: 1 });

      const first = smallRegistry.registerAsset(
        { filename: 'a.png', subfolder: '', type: 'output' },
      );
      const firstIdentity: AssetIdentity = { filename: 'a.png', subfolder: '', type: 'output' };

      vi.advanceTimersByTime(10);
      smallRegistry.registerAsset(
        { filename: 'b.png', subfolder: '', type: 'output' },
      );

      // First asset should no longer be findable by identity
      expect(smallRegistry.getAssetByIdentity(firstIdentity)).toBeNull();
      expect(smallRegistry.getAsset(first.id)).toBeNull();

      vi.useRealTimers();
    });
  });

  // ─── accessCount ──────────────────────────────────────────────

  describe('accessCount', () => {
    it('should increment on getAsset', () => {
      const asset = registry.registerAsset(
        { filename: 'a.png', subfolder: '', type: 'output' },
      );

      expect(asset.accessCount).toBe(0);

      registry.getAsset(asset.id);
      expect(asset.accessCount).toBe(1);

      registry.getAsset(asset.id);
      expect(asset.accessCount).toBe(2);
    });

    it('should increment on getAssetByIdentity', () => {
      const asset = registry.registerAsset(
        { filename: 'a.png', subfolder: '', type: 'output' },
      );
      const identity: AssetIdentity = { filename: 'a.png', subfolder: '', type: 'output' };

      expect(asset.accessCount).toBe(0);

      registry.getAssetByIdentity(identity);
      expect(asset.accessCount).toBe(1);

      registry.getAssetByIdentity(identity);
      expect(asset.accessCount).toBe(2);
    });

    it('should NOT increment on getAssetMetadata', () => {
      const asset = registry.registerAsset(
        { filename: 'a.png', subfolder: '', type: 'output' },
      );

      registry.getAssetMetadata(asset.id);
      expect(asset.accessCount).toBe(0);
    });
  });

  // ─── getAssetMetadata ─────────────────────────────────────────

  describe('getAssetMetadata', () => {
    it('should return correct metadata fields (id, identity, age, ttlRemaining)', () => {
      vi.useFakeTimers();
      const metaRegistry = new AssetRegistry({ ttlMs: 10000 });

      const asset = metaRegistry.registerAsset(
        { filename: 'image.png', subfolder: 'results', type: 'output' },
      );

      vi.advanceTimersByTime(1000); // 1 second passed

      const meta = metaRegistry.getAssetMetadata(asset.id);

      expect(meta).not.toBeNull();
      expect(meta!.id).toBe(asset.id);
      expect(meta!.identity.filename).toBe('image.png');
      expect(meta!.identity.subfolder).toBe('results');
      expect(meta!.identity.type).toBe('output');
      expect(meta!.age).toBe(1000);        // 1s since creation
      expect(meta!.ttlRemaining).toBe(9000); // 10s - 1s
      expect(meta!.accessCount).toBe(0);    // not incremented

      vi.useRealTimers();
    });

    it('should return null for unknown asset ID', () => {
      const meta = registry.getAssetMetadata('nonexistent-id');
      expect(meta).toBeNull();
    });

    it('should include provenance in metadata when available', () => {
      const asset = registry.registerAsset(
        { filename: 'a.png', subfolder: '', type: 'output' },
        {
          promptId: 'p-123',
          prompt: 'a beautiful landscape',
          modelName: 'sd_xl.safetensors',
          seed: 42,
          createdAt: new Date(),
        },
      );

      const meta = registry.getAssetMetadata(asset.id);
      expect(meta!.provenance).toBeDefined();
      expect(meta!.provenance!.promptId).toBe('p-123');
      expect(meta!.provenance!.prompt).toBe('a beautiful landscape');
      expect(meta!.provenance!.modelName).toBe('sd_xl.safetensors');
      expect(meta!.provenance!.seed).toBe(42);
    });

    it('should omit provenance from metadata when asset has none', () => {
      const asset = registry.registerAsset(
        { filename: 'bare.png', subfolder: '', type: 'temp' },
      );

      const meta = registry.getAssetMetadata(asset.id);
      expect(meta!.provenance).toBeUndefined();
    });
  });

  // ─── getStats ─────────────────────────────────────────────────

  describe('getStats', () => {
    it('should return zero counts for empty registry', () => {
      const stats = registry.getStats();

      expect(stats.totalAssets).toBe(0);
      expect(stats.activeCount).toBe(0);
      expect(stats.expiredCount).toBe(0);
      expect(stats.oldestAsset).toBeNull();
      expect(stats.newestAsset).toBeNull();
    });

    it('should return correct totalAssets, activeCount and expiredCount', () => {
      vi.useFakeTimers();
      const statsRegistry = new AssetRegistry({ ttlMs: 100 });

      statsRegistry.registerAsset({ filename: 'a.png', subfolder: '', type: 'output' });

      let stats = statsRegistry.getStats();
      expect(stats.totalAssets).toBe(1);
      expect(stats.activeCount).toBe(1);
      expect(stats.expiredCount).toBe(0);

      // Advance past TTL
      vi.advanceTimersByTime(150);

      stats = statsRegistry.getStats();
      expect(stats.totalAssets).toBe(1);
      expect(stats.activeCount).toBe(0);
      expect(stats.expiredCount).toBe(1);

      vi.useRealTimers();
    });

    it('should identify oldest and newest asset', () => {
      vi.useFakeTimers();

      const firstAsset = registry.registerAsset(
        { filename: 'first.png', subfolder: '', type: 'output' },
      );
      vi.advanceTimersByTime(50);
      const midAsset = registry.registerAsset(
        { filename: 'mid.png', subfolder: '', type: 'output' },
      );
      vi.advanceTimersByTime(50);
      const lastAsset = registry.registerAsset(
        { filename: 'last.png', subfolder: '', type: 'output' },
      );

      const stats = registry.getStats();
      expect(stats.oldestAsset).toBe(firstAsset.id);
      expect(stats.newestAsset).toBe(lastAsset.id);

      vi.useRealTimers();
    });

    it('should include ttlMs and maxSize in stats', () => {
      const customRegistry = new AssetRegistry({ ttlMs: 5000, maxSize: 50 });
      const stats = customRegistry.getStats();

      expect(stats.ttlMs).toBe(5000);
      expect(stats.maxSize).toBe(50);
    });

    it('should provide a memoryEstimate string', () => {
      registry.registerAsset({ filename: 'test.png', subfolder: 'sub', type: 'output' });
      const stats = registry.getStats();

      expect(stats.memoryEstimate).toMatch(/^~\d+ KB$/);
    });
  });

  // ─── Integration / Edge Cases ─────────────────────────────────

  describe('edge cases', () => {
    it('should handle custom TTL and maxSize in constructor', () => {
      const custom = new AssetRegistry({ ttlMs: 60_000, maxSize: 5 });
      expect(custom).toBeInstanceOf(AssetRegistry);
    });

    it('should use defaults when options are undefined', () => {
      const defaultRegistry = new AssetRegistry();
      // Register 1001 assets — the 1001st should evict the 1st
      for (let i = 0; i < 1001; i++) {
        defaultRegistry.registerAsset({
          filename: `img-${i}.png`,
          subfolder: '',
          type: 'output',
        });
      }
      expect(defaultRegistry.listAssets()).toHaveLength(1000);
    });

    it('should handle rapid consecutive registrations without crash', () => {
      for (let i = 0; i < 100; i++) {
        registry.registerAsset({
          filename: `batch-${i}.png`,
          subfolder: '',
          type: 'output',
        });
      }
      expect(registry.listAssets()).toHaveLength(100);
    });

    it('should return independent asset references (no shared mutation)', () => {
      const assetA = registry.registerAsset(
        { filename: 'a.png', subfolder: '', type: 'output' },
      );
      const assetB = registry.registerAsset(
        { filename: 'b.png', subfolder: '', type: 'output' },
      );

      registry.getAsset(assetA.id);
      expect(assetA.accessCount).toBe(1);
      expect(assetB.accessCount).toBe(0);
    });
  });
});
