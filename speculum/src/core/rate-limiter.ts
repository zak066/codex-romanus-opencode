/**
 * speculum-search — Rate Limiter (S3)
 *
 * Token bucket rate limiter.
 * - maxTokens: capacità massima del bucket (default: 10)
 * - refillRate: token rigenerati per intervallo (default: 10/min)
 * - refillInterval: intervallo di refill in ms (default: 60000 = 1 minuto)
 *
 * consume() aspetta se non ci sono token disponibili.
 */

export interface RateLimiterConfig {
  maxTokens?: number;       // default 10
  refillRate?: number;      // default 10 (token al minuto)
  refillInterval?: number;  // default 60000 (ms)
}

export interface RateLimiterStats {
  available: number;
  maxTokens: number;
  waitTime: number; // ms di attesa stimata per 1 token
}

export class TokenBucket {
  private maxTokens: number;
  private refillRate: number;
  private refillInterval: number;

  private tokens: number;
  private lastRefill: number;

  constructor(config?: RateLimiterConfig) {
    this.maxTokens = config?.maxTokens ?? 10;
    this.refillRate = config?.refillRate ?? 10;
    this.refillInterval = config?.refillInterval ?? 60_000; // 1 minuto
    this.tokens = this.maxTokens;
    this.lastRefill = Date.now();
  }

  // ─── Public API ─────────────────────────────────────────────

  /**
   * Consuma `tokens` (default 1) dal bucket.
   * Se non ci sono abbastanza token, aspetta fino al prossimo refill.
   *
   * @returns Promise<true> quando il token è concesso
   */
  async consume(tokens: number = 1): Promise<boolean> {
    this.refill();

    if (this.tokens >= tokens) {
      this.tokens -= tokens;
      return true;
    }

    // Token insufficienti — calcola tempo di attesa
    const deficit = tokens - this.tokens;
    const waitTime = Math.ceil((deficit / this.refillRate) * this.refillInterval);

    console.error(
      `[rate-limiter] Attesa ${waitTime}ms per ${tokens} token ` +
      `(disponibili: ${this.tokens.toFixed(2)})`,
    );

    await this.sleep(waitTime);

    // Dopo l'attesa, riprova (refill è chiamato dentro)
    return this.consume(tokens);
  }

  /**
   * Statistiche correnti del bucket.
   */
  getStats(): RateLimiterStats {
    this.refill();

    const waitForOne =
      this.tokens >= 1
        ? 0
        : Math.ceil(((1 - this.tokens) / this.refillRate) * this.refillInterval);

    return {
      available: Math.round(this.tokens * 100) / 100,
      maxTokens: this.maxTokens,
      waitTime: waitForOne,
    };
  }

  // ─── Private ────────────────────────────────────────────────

  /**
   * Rifornisce il bucket in base al tempo trascorso dall'ultimo refill.
   */
  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefill;

    if (elapsed < 100) return; // Evita ricalcoli inutili

    const tokensToAdd = (elapsed / this.refillInterval) * this.refillRate;
    this.tokens = Math.min(this.maxTokens, this.tokens + tokensToAdd);
    this.lastRefill = now;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
