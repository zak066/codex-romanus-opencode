/**
 * Unit tests for TokenBucket and RateLimiterManager.
 *
 * Tests cover:
 *   - Token creation, consumption, refill mechanics
 *   - RateLimiterManager multi-platform orchestration
 *   - PLATFORM_RATE_LIMITS defaults
 */

import { TokenBucket, RateLimiterManager, PLATFORM_RATE_LIMITS } from '../../src/engine/rate-limiter.js';

// ─── TokenBucket ──────────────────────────────────────────────────────────

describe('TokenBucket', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('consume', () => {
    it('should return true when tokens are available', () => {
      const bucket = new TokenBucket({ maxTokens: 5, refillIntervalMs: 60_000 });
      expect(bucket.consume()).toBe(true);
    });

    it('should return false when all tokens are exhausted', () => {
      const bucket = new TokenBucket({ maxTokens: 2, refillIntervalMs: 60_000 });

      expect(bucket.consume()).toBe(true);  //  1 left
      expect(bucket.consume()).toBe(true);  //  0 left
      expect(bucket.consume()).toBe(false); // exhausted
    });
  });

  describe('getRemaining', () => {
    it('should start at maxTokens', () => {
      const bucket = new TokenBucket({ maxTokens: 10, refillIntervalMs: 60_000 });
      expect(bucket.getRemaining()).toBe(10);
    });

    it('should decrement correctly after each consume', () => {
      const bucket = new TokenBucket({ maxTokens: 10, refillIntervalMs: 60_000 });

      expect(bucket.getRemaining()).toBe(10);
      bucket.consume();
      expect(bucket.getRemaining()).toBe(9);
      bucket.consume();
      expect(bucket.getRemaining()).toBe(8);
    });

    it('should refill after refillInterval has elapsed (lazy refill)', () => {
      const bucket = new TokenBucket({ maxTokens: 3, refillIntervalMs: 1000 });

      bucket.consume(); // 2
      bucket.consume(); // 1
      expect(bucket.getRemaining()).toBe(1);

      // Advance past the refill window
      vi.advanceTimersByTime(1000);

      expect(bucket.getRemaining()).toBe(3);
    });

    it('should NOT refill before refillInterval has elapsed', () => {
      const bucket = new TokenBucket({ maxTokens: 3, refillIntervalMs: 5000 });

      bucket.consume(); // 2
      bucket.consume(); // 1

      // Advance only part of the interval
      vi.advanceTimersByTime(3000);

      expect(bucket.getRemaining()).toBe(1);
    });
  });

  describe('getResetTime', () => {
    it('should return the full refillIntervalMs when bucket is fresh', () => {
      const bucket = new TokenBucket({ maxTokens: 5, refillIntervalMs: 1000 });
      expect(bucket.getResetTime()).toBe(1000);
    });

    it('should return remaining milliseconds until next refill', () => {
      const bucket = new TokenBucket({ maxTokens: 5, refillIntervalMs: 1000 });

      vi.advanceTimersByTime(400);
      expect(bucket.getResetTime()).toBe(600);

      vi.advanceTimersByTime(400);
      expect(bucket.getResetTime()).toBe(200);
    });

    it('should reset after refill interval has elapsed', () => {
      const bucket = new TokenBucket({ maxTokens: 5, refillIntervalMs: 1000 });

      // At t=0: lastRefill = 0, resetTime = 1000 - 0 = 1000
      vi.advanceTimersByTime(500);
      // At t=500: no refill yet (500 < 1000), resetTime = 1000 - 500 = 500
      expect(bucket.getResetTime()).toBe(500);

      vi.advanceTimersByTime(501);
      // At t=1001: refill occurs (1001 >= 1000), lastRefill = 1001
      // resetTime = 1000 - (1001 - 1001) = 1000 (full interval)
      expect(bucket.getResetTime()).toBe(1000);
    });
  });

  describe('getStats', () => {
    it('should return a snapshot with remaining, total, and resetInMs', () => {
      const bucket = new TokenBucket({ maxTokens: 10, refillIntervalMs: 2000 });

      const stats = bucket.getStats();
      expect(stats).toEqual({
        remaining: 10,
        total: 10,
        resetInMs: 2000,
      });
    });

    it('should reflect consumed tokens', () => {
      const bucket = new TokenBucket({ maxTokens: 10, refillIntervalMs: 2000 });

      bucket.consume();
      bucket.consume();
      const stats = bucket.getStats();
      expect(stats.remaining).toBe(8);
      expect(stats.total).toBe(10);
    });
  });
});

// ─── RateLimiterManager ───────────────────────────────────────────────────

describe('RateLimiterManager', () => {
  let manager: RateLimiterManager;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    manager = new RateLimiterManager();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('getOrCreate', () => {
    it('should create a bucket for a known platform (facebook)', () => {
      const bucket = manager.getOrCreate('facebook');
      expect(bucket).toBeInstanceOf(TokenBucket);
      expect(bucket.getRemaining()).toBe(150);
    });

    it('should create a bucket for a known platform (instagram)', () => {
      const bucket = manager.getOrCreate('instagram');
      expect(bucket).toBeInstanceOf(TokenBucket);
      expect(bucket.getRemaining()).toBe(25);
    });

    it('should create a default bucket (60/h) for unknown platforms', () => {
      const bucket = manager.getOrCreate('unknown-platform');
      expect(bucket).toBeInstanceOf(TokenBucket);
      expect(bucket.getRemaining()).toBe(60);
    });

    it('should return the same instance on subsequent calls for the same platform', () => {
      const bucket1 = manager.getOrCreate('facebook');
      const bucket2 = manager.getOrCreate('facebook');
      expect(bucket1).toBe(bucket2);
    });
  });

  describe('consume', () => {
    it('should delegate to the correct bucket and consume a token', () => {
      // First call creates the bucket and consumes → 149 remaining
      expect(manager.consume('facebook')).toBe(true);
      expect(manager.getStats('facebook')!.remaining).toBe(149);
    });
  });

  describe('getRemaining', () => {
    it('should return 0 for a platform that has never been accessed', () => {
      // getRemaining only checks this.buckets, does NOT auto-create
      expect(manager.getRemaining('never-seen')).toBe(0);
    });

    it('should return correct count after consumes', () => {
      manager.consume('facebook');
      manager.consume('facebook');
      manager.consume('facebook');
      expect(manager.getRemaining('facebook')).toBe(147);
    });
  });

  describe('getStats', () => {
    it('should return null for a platform that has never been accessed', () => {
      expect(manager.getStats('ghost')).toBeNull();
    });

    it('should return stats after a bucket has been created via consume', () => {
      manager.consume('facebook');
      const stats = manager.getStats('facebook');

      expect(stats).not.toBeNull();
      expect(stats!.remaining).toBe(149);
      expect(stats!.total).toBe(150);
      expect(stats!.resetInMs).toBe(3_600_000);
    });
  });
});

// ─── PLATFORM_RATE_LIMITS ─────────────────────────────────────────────────

describe('PLATFORM_RATE_LIMITS', () => {
  it('should have facebook limit of 150 per hour', () => {
    expect(PLATFORM_RATE_LIMITS.facebook).toEqual({
      maxTokens: 150,
      refillIntervalMs: 3_600_000,
    });
  });

  it('should have instagram limit of 25 per 24h', () => {
    expect(PLATFORM_RATE_LIMITS.instagram).toEqual({
      maxTokens: 25,
      refillIntervalMs: 86_400_000,
    });
  });
});
