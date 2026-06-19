import type { PostPayload, PublishResult, PostStatusResult, ValidationResult } from '../types.js';
import type { SocialPlugin } from '../plugins/social-plugin.js';
import { PluginRegistry } from './plugin-registry.js';
import { RateLimiterManager } from './rate-limiter.js';
import { Validator } from './validator.js';
import { PlatformError } from '../errors.js';

/**
 * PublishEngine — orchestrates the publishing workflow.
 *
 * For each platform:
 * 1. Check rate limiter (exhausted → failed result with retryAfter)
 * 2. Look up the plugin (not found → failed result)
 * 3. Publish with exponential backoff retry (3 attempts: 1s, 2s, 4s + jitter ±20%)
 *    - Retry only on 5xx / rate limit / network errors
 *    - 4xx (auth, validation) are NOT retried
 */
export class PublishEngine {
  constructor(
    private registry: PluginRegistry,
    private rateLimiter: RateLimiterManager,
    private validator: Validator,
  ) {}

  /**
   * Publishes a post on one or more platforms.
   * Each platform is handled independently; a failure on one does not
   * affect the others.
   */
  async publish(platforms: string[], post: PostPayload): Promise<PublishResult[]> {
    const results: PublishResult[] = [];

    for (const platform of platforms) {
      const startTime = Date.now();

      try {
        // Step 1: Rate limit check
        if (!this.rateLimiter.consume(platform)) {
          const stats = this.rateLimiter.getStats(platform);
          const publishedAt = new Date().toISOString();
          console.error(
            `[nuntius] publish:${platform} rate_limit_exhausted remaining=0 latency=${Date.now() - startTime}ms`,
          );
          results.push({
            platform,
            externalId: '',
            status: 'failed',
            publishedAt,
            metadata: {
              error: `Rate limit exhausted for ${platform}`,
              retryAfterMs: stats?.resetInMs ?? 0,
              errorCode: 'RATE_LIMIT',
            },
          });
          continue;
        }

        // Step 2: Get the plugin
        const plugin = this.registry.getPlugin(platform);
        if (!plugin) {
          const publishedAt = new Date().toISOString();
          console.error(
            `[nuntius] publish:${platform} plugin_not_found latency=${Date.now() - startTime}ms`,
          );
          results.push({
            platform,
            externalId: '',
            status: 'failed',
            publishedAt,
            metadata: {
              error: `No plugin registered for platform: ${platform}`,
              errorCode: 'PLUGIN_NOT_FOUND',
            },
          });
          continue;
        }

        // Step 3: Publish with retry
        const result = await this.publishWithRetry(plugin, post);
        console.error(
          `[nuntius] publish:${platform} status=${result.status} id=${result.externalId} latency=${Date.now() - startTime}ms`,
        );
        results.push(result);
      } catch (err) {
        const publishedAt = new Date().toISOString();
        console.error(
          `[nuntius] publish:${platform} error="${String(err)}" latency=${Date.now() - startTime}ms`,
        );
        const attempts = (err as Record<string, unknown>).attempts;
        results.push({
          platform,
          externalId: '',
          status: 'failed',
          publishedAt,
          metadata: {
            error: String(err),
            errorCode: err instanceof Error ? err.name : 'UNKNOWN',
            ...(attempts != null ? { attempts: attempts as number } : {}),
          },
        });
      }
    }

    return results;
  }

  /**
   * Calls plugin.publishPost with exponential backoff retry.
   *
   * Retry strategy:
   * - Up to `maxRetries` attempts
   * - Base delays: 1s, 2s, 4s (powers of 2)
   * - ±20% jitter to avoid thundering herd
   * - Only retries on: RateLimitError, NetworkError, PlatformError (5xx only)
   * - Does NOT retry on: AuthError, ValidationError, PlatformError (non-5xx)
   * - On last failure the error is re-thrown (propagates to caller)
   */
  private async publishWithRetry(
    plugin: SocialPlugin,
    post: PostPayload,
    maxRetries = 3,
  ): Promise<PublishResult> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await plugin.publishPost(post);
      } catch (err) {
        lastError = err;

        if (this.isRetryable(err) && attempt < maxRetries) {
          // Exponential backoff: 1s, 2s, 4s
          const baseDelay = 1000 * Math.pow(2, attempt - 1);
          // Jitter: ±20%
          const jitter = 1 + (Math.random() * 2 - 1) * 0.2;
          const delay = Math.round(baseDelay * jitter);

          console.error(
            `[nuntius] Retry ${attempt}/${maxRetries} for ${plugin.getPlatformName()} in ${delay}ms — error: ${err instanceof Error ? err.message : String(err)}`,
          );

          await new Promise((resolve) => setTimeout(resolve, delay));
        } else {
          // Non-retryable errors (AuthError, ValidationError) propagate immediately.
          // Retryable errors on the last attempt: enrich with attempt count.
          if (this.isRetryable(err)) {
            const message = `Failed after ${attempt} attempts` +
              (err instanceof Error ? `: ${err.message}` : `: ${String(err)}`);
            const enriched = new Error(message);
            enriched.name = err instanceof Error ? err.name : 'Error';
            (enriched as unknown as Record<string, unknown>).attempts = attempt;
            throw enriched;
          }
          throw err;
        }
      }
    }

    // Unreachable: the loop always throws or returns before reaching here.
    throw lastError ?? new Error('publishWithRetry exhausted without error');
  }

  /**
   * Determines if an error is retryable.
   * - Retry: RateLimitError, NetworkError, PlatformError (5xx only), unknown errors
   * - Do NOT retry: AuthError, ValidationError, PlatformError (non-5xx)
   */
  private isRetryable(err: unknown): boolean {
    if (err instanceof Error) {
      const name = err.name;
      // Never retry auth or validation errors
      if (name === 'AuthError' || name === 'ValidationError') return false;
      // Retry on rate limit or network errors
      if (name === 'RateLimitError' || name === 'NetworkError') return true;
      // PlatformError: only retry on 5xx server errors (e.g. 500, 502, 503),
      // or on PlatformError without a specific code (treat as general server error)
      if (name === 'PlatformError') {
        if (err instanceof PlatformError && err.platformCode != null) {
          return /^5\d{2}$/.test(err.platformCode);
        }
        return true; // PlatformError without a specific code → retry (unknown server error)
      }
    }
    // Default: retry (covers 5xx, timeouts, etc.)
    return true;
  }

  /**
   * Validates a post against the given platforms without publishing.
   */
  async validate(platforms: string[], post: PostPayload): Promise<ValidationResult> {
    const plugins: SocialPlugin[] = [];

    for (const platform of platforms) {
      const plugin = this.registry.getPlugin(platform);
      if (plugin) {
        plugins.push(plugin);
      }
    }

    if (plugins.length === 0) {
      return {
        valid: false,
        errors: [`No registered plugins found for platforms: ${platforms.join(', ')}`],
      };
    }

    return this.validator.validatePost(post, plugins);
  }

  /**
   * Gets the status of a previously published post on a specific platform.
   */
  async getStatus(platform: string, externalId: string): Promise<PostStatusResult> {
    const plugin = this.registry.getPlugin(platform);
    if (!plugin) {
      throw new Error(`No plugin registered for platform: ${platform}`);
    }

    return plugin.getPostStatus(externalId);
  }
}
