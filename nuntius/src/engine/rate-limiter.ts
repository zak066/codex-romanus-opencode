/**
 * Token Bucket Rate Limiter — pure TypeScript, zero dependencies.
 *
 * Each platform has its own bucket with configurable maxTokens and refillInterval.
 * Tokens are refilled on access when the interval has elapsed (lazy refill).
 */

export interface TokenBucketConfig {
  maxTokens: number;
  refillIntervalMs: number;
}

export class TokenBucket {
  private tokens: number;
  private lastRefill: number;

  constructor(private config: TokenBucketConfig) {
    this.tokens = config.maxTokens;
    this.lastRefill = Date.now();
  }

  /**
   * Consumes one token. Returns false if no tokens are available.
   */
  consume(): boolean {
    this.refill();
    if (this.tokens < 1) {
      return false;
    }
    this.tokens -= 1;
    return true;
  }

  /**
   * Returns the number of remaining tokens.
   */
  getRemaining(): number {
    this.refill();
    return this.tokens;
  }

  /**
   * Returns milliseconds until the next refill window.
   */
  getResetTime(): number {
    this.refill();
    const elapsed = Date.now() - this.lastRefill;
    const remainingMs = this.config.refillIntervalMs - elapsed;
    return Math.max(0, remainingMs);
  }

  /**
   * Returns a snapshot of current bucket stats.
   */
  getStats(): { remaining: number; total: number; resetInMs: number } {
    this.refill();
    return {
      remaining: this.tokens,
      total: this.config.maxTokens,
      resetInMs: this.getResetTime(),
    };
  }

  /**
   * Lazy refill: if the full interval has elapsed since last refill,
   * reset tokens to max. Otherwise, no-op.
   */
  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    if (elapsed >= this.config.refillIntervalMs) {
      this.tokens = this.config.maxTokens;
      this.lastRefill = now;
    }
  }
}

/**
 * Default rate limits per platform.
 * These are conservative estimates based on documented API limits:
 * - Facebook: 200 calls/hour per user token → 150/h to be safe
 * - Instagram: 25 posts/24h (hard limit documented by Meta)
 */
export const PLATFORM_RATE_LIMITS: Record<string, TokenBucketConfig> = {
  facebook:  { maxTokens: 150, refillIntervalMs: 3_600_000 },   // 150/hour
  instagram: { maxTokens: 25,  refillIntervalMs: 86_400_000 },  // 25/24h
};

/**
 * Manages a collection of per-platform TokenBucket instances.
 * Lazily creates buckets on first access.
 */
export class RateLimiterManager {
  private buckets: Map<string, TokenBucket> = new Map();

  /**
   * Gets or creates a TokenBucket for the given platform.
   * Unknown platforms get a default bucket (60 requests/hour).
   */
  getOrCreate(platform: string): TokenBucket {
    let bucket = this.buckets.get(platform);
    if (!bucket) {
      const config = PLATFORM_RATE_LIMITS[platform];
      if (config) {
        bucket = new TokenBucket(config);
      } else {
        // Default conservative rate limit for unknown platforms
        bucket = new TokenBucket({ maxTokens: 60, refillIntervalMs: 3_600_000 });
      }
      this.buckets.set(platform, bucket);
    }
    return bucket;
  }

  /**
   * Consumes one token for the given platform.
   * Returns false if the rate limit is exhausted.
   */
  consume(platform: string): boolean {
    return this.getOrCreate(platform).consume();
  }

  /**
   * Returns remaining tokens for a platform, or 0 if no bucket exists.
   */
  getRemaining(platform: string): number {
    const bucket = this.buckets.get(platform);
    return bucket ? bucket.getRemaining() : 0;
  }

  /**
   * Returns full stats for a platform, or null if no bucket exists.
   */
  getStats(platform: string): { remaining: number; total: number; resetInMs: number } | null {
    const bucket = this.buckets.get(platform);
    if (!bucket) return null;
    return bucket.getStats();
  }
}
