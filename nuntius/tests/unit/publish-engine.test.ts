/**
 * Unit tests for PublishEngine.
 *
 * Tests cover:
 *   - publish flow (happy path, rate-limit exhaustion, missing plugin)
 *   - Retry mechanism (retryable vs non-retryable errors)
 *   - validate and getStatus delegation
 *   - Multi-platform publishing
 */

import { PublishEngine } from '../../src/engine/publish-engine.js';
import { PluginRegistry } from '../../src/engine/plugin-registry.js';
import { RateLimiterManager } from '../../src/engine/rate-limiter.js';
import { Validator } from '../../src/engine/validator.js';
import { createMockPlugin } from '../helpers.js';
import { ValidationError, AuthError, RateLimitError, NetworkError, PlatformError } from '../../src/errors.js';
import type { SocialPlugin } from '../../src/plugins/social-plugin.js';

// ─── Helpers ──────────────────────────────────────────────────────────────

/**
 * Creates a PublishEngine with a controlled RateLimiterManager,
 * using the real PluginRegistry and Validator.
 */
function createTestEngine(plugin: SocialPlugin): {
  engine: PublishEngine;
  registry: PluginRegistry;
  rateLimiter: RateLimiterManager;
} {
  const registry = new PluginRegistry();
  registry.register(plugin);

  const rateLimiter = new RateLimiterManager();
  const validator = new Validator();
  const engine = new PublishEngine(registry, rateLimiter, validator);

  return { engine, registry, rateLimiter };
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe('PublishEngine', () => {
  describe('publish', () => {
    describe('happy path', () => {
      it('should call plugin.publishPost and return PublishResult', async () => {
        const plugin = createMockPlugin('test-platform');
        const { engine } = createTestEngine(plugin);

        const results = await engine.publish(
          ['test-platform'],
          { text: 'Hello, world!' },
        );

        expect(results).toHaveLength(1);
        expect(results[0].platform).toBe('test-platform');
        expect(results[0].status).toBe('published');
        expect(results[0].externalId).toBe('mock-id-123');
        expect(plugin.publishPost).toHaveBeenCalledTimes(1);
        expect(plugin.publishPost).toHaveBeenCalledWith({ text: 'Hello, world!' });
      });

      it('should publish to multiple platforms', async () => {
        const fbPlugin = createMockPlugin('facebook');
        const igPlugin = createMockPlugin('instagram');
        const registry = new PluginRegistry();
        registry.register(fbPlugin);
        registry.register(igPlugin);

        const engine = new PublishEngine(registry, new RateLimiterManager(), new Validator());

        const results = await engine.publish(
          ['facebook', 'instagram'],
          { text: 'Multi-platform post' },
        );

        expect(results).toHaveLength(2);
        expect(results[0].platform).toBe('facebook');
        expect(results[1].platform).toBe('instagram');
        expect(fbPlugin.publishPost).toHaveBeenCalledTimes(1);
        expect(igPlugin.publishPost).toHaveBeenCalledTimes(1);
      });
    });

    describe('rate limit exhaustion', () => {
      it('should return a failed result when rate limit is exhausted', async () => {
        const plugin = createMockPlugin('test-platform');
        const { engine, rateLimiter } = createTestEngine(plugin);

        // Exhaust the default bucket (60 tokens for unknown default, but
        // 'test-platform' is NOT in PLATFORM_RATE_LIMITS, so it gets 60/h)
        for (let i = 0; i < 60; i++) {
          rateLimiter.consume('test-platform');
        }

        const results = await engine.publish(
          ['test-platform'],
          { text: 'Should fail' },
        );

        expect(results).toHaveLength(1);
        expect(results[0].status).toBe('failed');
        expect(results[0].externalId).toBe('');
        expect(results[0].metadata?.errorCode).toBe('RATE_LIMIT');
        expect(results[0].metadata?.error).toContain('exhausted');
        // Plugin should NOT have been called
        expect(plugin.publishPost).not.toHaveBeenCalled();
      });
    });

    describe('plugin not found', () => {
      it('should return a failed result when no plugin is registered for a platform', async () => {
        const plugin = createMockPlugin('facebook');
        const { engine } = createTestEngine(plugin);

        const results = await engine.publish(
          ['unknown-platform'],
          { text: 'Hello' },
        );

        expect(results).toHaveLength(1);
        expect(results[0].status).toBe('failed');
        expect(results[0].metadata?.errorCode).toBe('PLUGIN_NOT_FOUND');
        expect(results[0].metadata?.error).toContain('No plugin registered');
      });
    });

    describe('retry mechanism', () => {
      beforeEach(() => {
        vi.useFakeTimers();
        vi.spyOn(Math, 'random').mockReturnValue(0.5); // zero jitter
      });

      afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
      });

      it('should retry on NetworkError and eventually succeed', async () => {
        const plugin = createMockPlugin('retry-platform');
        const publishPost = vi.fn()
          .mockRejectedValueOnce(new NetworkError('Connection reset'))
          .mockResolvedValueOnce({
            platform: 'retry-platform',
            externalId: 'final-id',
            status: 'published' as const,
            publishedAt: new Date().toISOString(),
          });
        plugin.publishPost = publishPost;

        const { engine } = createTestEngine(plugin);
        const publishPromise = engine.publish(
          ['retry-platform'],
          { text: 'Retry test' },
        );

        // Advance by 1st retry delay: attempt 1 → 1s
        await vi.advanceTimersByTimeAsync(1000);

        const results = await publishPromise;

        expect(results).toHaveLength(1);
        expect(results[0].status).toBe('published');
        expect(results[0].externalId).toBe('final-id');
        expect(publishPost).toHaveBeenCalledTimes(2);
      });

      it('should retry on RateLimitError and eventually succeed', async () => {
        const plugin = createMockPlugin('retry-platform');
        const publishPost = vi.fn()
          .mockRejectedValueOnce(new RateLimitError('Too fast', 60_000))
          .mockResolvedValueOnce({
            platform: 'retry-platform',
            externalId: 'final-id',
            status: 'published' as const,
            publishedAt: new Date().toISOString(),
          });
        plugin.publishPost = publishPost;

        const { engine } = createTestEngine(plugin);
        const publishPromise = engine.publish(
          ['retry-platform'],
          { text: 'Rate limit retry' },
        );

        await vi.advanceTimersByTimeAsync(1000);

        const results = await publishPromise;

        expect(results[0].status).toBe('published');
        expect(publishPost).toHaveBeenCalledTimes(2);
      });

      it('should retry on PlatformError and eventually succeed', async () => {
        const plugin = createMockPlugin('retry-platform');
        const publishPost = vi.fn()
          .mockRejectedValueOnce(new PlatformError('Server hiccup'))
          .mockResolvedValueOnce({
            platform: 'retry-platform',
            externalId: 'final-id',
            status: 'published' as const,
            publishedAt: new Date().toISOString(),
          });
        plugin.publishPost = publishPost;

        const { engine } = createTestEngine(plugin);
        const publishPromise = engine.publish(
          ['retry-platform'],
          { text: 'Platform retry' },
        );

        await vi.advanceTimersByTimeAsync(1000);

        const results = await publishPromise;

        expect(results[0].status).toBe('published');
        expect(publishPost).toHaveBeenCalledTimes(2);
      });

      it('should NOT retry on ValidationError', async () => {
        const plugin = createMockPlugin('no-retry');
        const publishPost = vi.fn()
          .mockRejectedValue(new ValidationError('Invalid post content'));
        plugin.publishPost = publishPost;

        const { engine } = createTestEngine(plugin);

        const results = await engine.publish(
          ['no-retry'],
          { text: 'Bad post' },
        );

        expect(results[0].status).toBe('failed');
        expect(results[0].metadata?.error).toContain('Invalid post content');
        // Should only be called once — no retry
        expect(publishPost).toHaveBeenCalledTimes(1);
      });

      it('should NOT retry on AuthError', async () => {
        const plugin = createMockPlugin('no-retry');
        const publishPost = vi.fn()
          .mockRejectedValue(new AuthError('Token expired'));
        plugin.publishPost = publishPost;

        const { engine } = createTestEngine(plugin);

        const results = await engine.publish(
          ['no-retry'],
          { text: 'Expired token' },
        );

        expect(results[0].status).toBe('failed');
        expect(results[0].metadata?.errorCode).toBe('AuthError');
        expect(publishPost).toHaveBeenCalledTimes(1);
      });

      it('should exhaust retries and return failed result', async () => {
        const plugin = createMockPlugin('exhausted');
        const publishPost = vi.fn()
          .mockRejectedValue(new NetworkError('Always fails'));
        plugin.publishPost = publishPost;

        const { engine } = createTestEngine(plugin);
        const publishPromise = engine.publish(
          ['exhausted'],
          { text: 'Always failing' },
        );

        // Advance through all 3 retry delays: 1s + 2s + 4s = 7s
        await vi.advanceTimersByTimeAsync(7000);

        const results = await publishPromise;

        expect(results[0].status).toBe('failed');
        expect(results[0].metadata?.attempts).toBe(3);
        expect(results[0].metadata?.error).toContain('Failed after 3 attempts');
        expect(publishPost).toHaveBeenCalledTimes(3);
      });
    });
  });

  describe('validate', () => {
    it('should delegate to validator with the correct plugins', async () => {
      const plugin = createMockPlugin('test-platform');
      const { engine } = createTestEngine(plugin);

      const result = await engine.validate(
        ['test-platform'],
        { text: 'Hello' },
      );

      expect(result.valid).toBe(true);
    });

    it('should return error if no plugins match the specified platforms', async () => {
      const plugin = createMockPlugin('facebook');
      const { engine } = createTestEngine(plugin);

      const result = await engine.validate(
        ['ghost-platform'],
        { text: 'Hello' },
      );

      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('No registered plugins found');
    });
  });

  describe('getStatus', () => {
    it('should delegate to plugin.getPostStatus', async () => {
      const plugin = createMockPlugin('test-platform');
      const { engine } = createTestEngine(plugin);

      const result = await engine.getStatus('test-platform', 'post-123');

      expect(result.platform).toBe('test-platform');
      expect(result.externalId).toBe('mock-id-123');
      expect(plugin.getPostStatus).toHaveBeenCalledWith('post-123');
    });

    it('should throw if no plugin is registered for the platform', async () => {
      const plugin = createMockPlugin('facebook');
      const { engine } = createTestEngine(plugin);

      await expect(
        engine.getStatus('unknown', 'post-123'),
      ).rejects.toThrow('No plugin registered for platform: unknown');
    });
  });
});
