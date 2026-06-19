/**
 * Unit tests for InstagramPlugin.
 *
 * Tests use global fetch mocking.
 * Covers: config, two-step publish flow, video polling,
 *         error mapping, getPostStatus, media constraints.
 *
 * IMPORTANT: Tests with fake timers must use vi.advanceTimersByTimeAsync
 * to properly resolve setTimeout-based delays in polling.
 */

import InstagramPlugin from '../../src/plugins/instagram/index.js';
import { createMockFetchResponse } from '../helpers.js';
import { ValidationError, NetworkError, RateLimitError, PlatformError } from '../../src/errors.js';

// ─── Helpers ──────────────────────────────────────────────────────────────

/** Helper to create a mock Instagram error response body. */
function instagramError(code: number, message: string, subcode?: number) {
  return {
    error: {
      message,
      type: 'IGApiException',
      code,
      error_subcode: subcode,
    },
  };
}

// ─── Setup ────────────────────────────────────────────────────────────────

let plugin: InstagramPlugin;

beforeEach(() => {
  process.env.INSTAGRAM_USER_ID = 'test-user-id';
  process.env.INSTAGRAM_ACCESS_TOKEN = 'test-access-token';
  process.env.INSTAGRAM_PAGE_ID = 'test-page-id';

  globalThis.fetch = vi.fn();
  plugin = new InstagramPlugin();
});

afterEach(() => {
  delete process.env.INSTAGRAM_USER_ID;
  delete process.env.INSTAGRAM_ACCESS_TOKEN;
  delete process.env.INSTAGRAM_PAGE_ID;
  vi.restoreAllMocks();
});

// ─── Basic interface ─────────────────────────────────────────────────────

describe('InstagramPlugin', () => {
  describe('getPlatformName', () => {
    it('should return "instagram"', () => {
      expect(plugin.getPlatformName()).toBe('instagram');
    });
  });

  describe('getRequiredConfig', () => {
    it('should list required environment variables', () => {
      const config = plugin.getRequiredConfig();
      expect(config).toContain('INSTAGRAM_USER_ID');
      expect(config).toContain('INSTAGRAM_ACCESS_TOKEN');
      expect(config).toHaveLength(2);
    });
  });

  describe('validateConfig', () => {
    it('should return valid=true when userId and accessToken are present', () => {
      const result = plugin.validateConfig({
        userId: '12345',
        accessToken: 'token-abc',
      });

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should return invalid when userId is missing', () => {
      const result = plugin.validateConfig({ accessToken: 'token-abc' });

      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('userId');
    });

    it('should return invalid when userId is empty', () => {
      const result = plugin.validateConfig({
        userId: '',
        accessToken: 'token-abc',
      });

      expect(result.valid).toBe(false);
    });

    it('should return invalid when accessToken is missing', () => {
      const result = plugin.validateConfig({ userId: '12345' });

      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('accessToken');
    });

    it('should return invalid when both fields are missing', () => {
      const result = plugin.validateConfig({});

      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(2);
    });
  });

  describe('getMediaConstraints', () => {
    it('should return valid constraints object', () => {
      const constraints = plugin.getMediaConstraints();

      expect(constraints.supportedTypes).toContain('image/jpeg');
      expect(constraints.maxFileSize).toBe(100 * 1024 * 1024);
      expect(constraints.maxFiles).toBe(1);
      expect(constraints.minWidth).toBe(320);
      expect(constraints.minHeight).toBe(320);
      expect(constraints.aspectRatio).toContain('1:1');
    });
  });

  // ─── publishPost: pre-validation ──────────────────────────────────────

  describe('publishPost (pre-validation)', () => {
    it('should throw ValidationError for text-only posts (no media URL)', async () => {
      await expect(
        plugin.publishPost({ text: 'Text only' }),
      ).rejects.toThrow(ValidationError);

      await expect(
        plugin.publishPost({ text: 'Text only' }),
      ).rejects.toThrow(
        'Instagram requires at least one media URL',
      );
    });

    it('should throw ValidationError for more than one media URL', async () => {
      await expect(
        plugin.publishPost({
          text: 'Two photos',
          mediaUrls: ['https://example.com/a.jpg', 'https://example.com/b.jpg'],
        }),
      ).rejects.toThrow(ValidationError);

      await expect(
        plugin.publishPost({
          text: 'Two photos',
          mediaUrls: ['https://example.com/a.jpg', 'https://example.com/b.jpg'],
        }),
      ).rejects.toThrow(/single media URL/);
    });
  });

  // ─── publishPost: two-step image flow ──────────────────────────────────

  describe('publishPost (image, two-step flow)', () => {
    it('should create container then publish for image posts', async () => {
      vi.mocked(fetch)
        // Step 1: POST /media → container created
        .mockResolvedValueOnce(
          createMockFetchResponse({ id: 'container-123' }),
        )
        // Step 2: POST /media_publish → media published
        .mockResolvedValueOnce(
          createMockFetchResponse({ id: 'media-456', media_product_type: 'IMAGE' }),
        );

      const result = await plugin.publishPost({
        text: 'My first Instagram post!',
        mediaUrls: ['https://example.com/photo.jpg'],
      });

      expect(result.platform).toBe('instagram');
      expect(result.externalId).toBe('media-456');
      expect(result.status).toBe('published');
      expect(result.metadata?.containerId).toBe('container-123');

      // Verify fetch calls
      const calls = vi.mocked(fetch).mock.calls;
      expect(calls).toHaveLength(2);

      // First call: create media container
      const firstUrl = calls[0][0] as string;
      expect(firstUrl).toContain('/test-user-id/media');
      const firstBody = JSON.parse((calls[0][1] as RequestInit).body as string);
      expect(firstBody.image_url).toBe('https://example.com/photo.jpg');
      expect(firstBody.media_type).toBe('IMAGE');
      expect(firstBody.caption).toBe('My first Instagram post!');

      // Second call: publish container
      const secondUrl = calls[1][0] as string;
      expect(secondUrl).toContain('/test-user-id/media_publish');
      const secondBody = JSON.parse((calls[1][1] as RequestInit).body as string);
      expect(secondBody.creation_id).toBe('container-123');
    });

    it('should detect IMAGE type from extension (no explicit mediaType)', async () => {
      vi.mocked(fetch)
        .mockResolvedValueOnce(createMockFetchResponse({ id: 'container-img' }))
        .mockResolvedValueOnce(createMockFetchResponse({ id: 'media-img', media_product_type: 'IMAGE' }));

      const result = await plugin.publishPost({
        text: 'PNG photo',
        mediaUrls: ['https://example.com/photo.png'],
      });

      expect(result.externalId).toBe('media-img');
    });
  });

  // ─── publishPost: video with polling ───────────────────────────────────

  describe('publishPost (video, polling flow)', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should poll video container until FINISHED then publish', async () => {
      // Fetch call sequence:
      // 1. POST /media → { id: 'container-vid' }
      // 2. GET /container-vid?fields=status_code → IN_PROGRESS
      // 3. GET /container-vid?fields=status_code → IN_PROGRESS
      // 4. GET /container-vid?fields=status_code → FINISHED
      // 5. POST /media_publish → { id: 'media-vid' }
      vi.mocked(fetch)
        .mockResolvedValueOnce(createMockFetchResponse({ id: 'container-vid' }))
        .mockResolvedValueOnce(createMockFetchResponse({ id: 'container-vid', status_code: 'IN_PROGRESS' }))
        .mockResolvedValueOnce(createMockFetchResponse({ id: 'container-vid', status_code: 'IN_PROGRESS' }))
        .mockResolvedValueOnce(createMockFetchResponse({ id: 'container-vid', status_code: 'FINISHED' }))
        .mockResolvedValueOnce(createMockFetchResponse({ id: 'media-vid' }));

      const publishPromise = plugin.publishPost({
        text: 'My video!',
        mediaUrls: ['https://example.com/video.mp4'],
      });

      // Advance through the 2 polling delays (2 × 5000ms)
      await vi.advanceTimersByTimeAsync(10_000);

      const result = await publishPromise;

      expect(result.status).toBe('published');
      expect(result.externalId).toBe('media-vid');
      // 1 create + 3 get status + 1 publish = 5 fetch calls
      expect(vi.mocked(fetch)).toHaveBeenCalledTimes(5);
    });

    it('should timeout when container never finishes processing', async () => {
      // 1 POST /media + 30 GET polls (all IN_PROGRESS) = 31 calls
      vi.mocked(fetch)
        .mockResolvedValueOnce(createMockFetchResponse({ id: 'container-timeout' }));

      for (let i = 0; i < 30; i++) {
        vi.mocked(fetch).mockResolvedValueOnce(
          createMockFetchResponse({ id: 'container-timeout', status_code: 'IN_PROGRESS' }),
        );
      }

      const publishPromise = plugin.publishPost({
        text: 'Will timeout',
        mediaUrls: ['https://example.com/slow-video.mp4'],
      });

      // Attach a catch handler BEFORE advancing timers to prevent the
      // unhandled rejection that would otherwise fire during timer processing,
      // before the test has a chance to await the promise.
      publishPromise.catch(() => {});

      // Advance through all 29 polling delays (29 × 5000ms)
      await vi.advanceTimersByTimeAsync(145_000);

      await expect(publishPromise).rejects.toThrow(PlatformError);
      await expect(publishPromise).rejects.toThrow(/timed out/);
    });

    it('should throw PlatformError when container expires', async () => {
      vi.mocked(fetch)
        .mockResolvedValueOnce(createMockFetchResponse({ id: 'container-exp' }))
        .mockResolvedValueOnce(createMockFetchResponse({ id: 'container-exp', status_code: 'EXPIRED' }));

      // No need for fake timers here — EXPIRED error is immediate
      await expect(
        plugin.publishPost({
          text: 'Expired',
          mediaUrls: ['https://example.com/vid.mp4'],
        }),
      ).rejects.toThrow(PlatformError);
    });

    it('should throw PlatformError when container has ERROR status', async () => {
      vi.mocked(fetch)
        .mockResolvedValueOnce(createMockFetchResponse({ id: 'container-err' }))
        .mockResolvedValueOnce(createMockFetchResponse({ id: 'container-err', status_code: 'ERROR' }));

      await expect(
        plugin.publishPost({
          text: 'Error',
          mediaUrls: ['https://example.com/vid.mp4'],
        }),
      ).rejects.toThrow(PlatformError);
    });
  });

  // ─── publishPost: stories ──────────────────────────────────────────────

  describe('publishPost (stories)', () => {
    it('should create image story correctly', async () => {
      vi.mocked(fetch)
        .mockResolvedValueOnce(createMockFetchResponse({ id: 'container-story' }))
        .mockResolvedValueOnce(createMockFetchResponse({ id: 'media-story' }));

      const result = await plugin.publishPost({
        text: 'Story time',
        mediaUrls: ['https://example.com/story.jpg'],
        platformSpecific: { mediaType: 'STORIES' },
      });

      expect(result.status).toBe('published');

      const firstBody = JSON.parse(
        ((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string),
      );
      expect(firstBody.media_type).toBe('STORIES');
      expect(firstBody.image_url).toBe('https://example.com/story.jpg');
    });

    it('should create video story correctly', async () => {
      vi.mocked(fetch)
        .mockResolvedValueOnce(createMockFetchResponse({ id: 'container-video-story' }))
        .mockResolvedValueOnce(createMockFetchResponse({ id: 'media-video-story' }));

      const result = await plugin.publishPost({
        text: 'Video story',
        mediaUrls: ['https://example.com/story.mp4'],
        platformSpecific: { mediaType: 'STORIES' },
      });

      expect(result.status).toBe('published');

      const firstBody = JSON.parse(
        ((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string),
      );
      expect(firstBody.media_type).toBe('STORIES');
      expect(firstBody.video_url).toBe('https://example.com/story.mp4');
    });
  });

  // ─── publishPost: REELS ───────────────────────────────────────────────

  describe('publishPost (REELS)', () => {
    it('should poll reels container then publish', async () => {
      vi.useFakeTimers();

      vi.mocked(fetch)
        .mockResolvedValueOnce(createMockFetchResponse({ id: 'container-reel' }))
        .mockResolvedValueOnce(createMockFetchResponse({ id: 'container-reel', status_code: 'FINISHED' }))
        .mockResolvedValueOnce(createMockFetchResponse({ id: 'media-reel' }));

      const publishPromise = plugin.publishPost({
        text: 'My reel!',
        mediaUrls: ['https://example.com/reel.mp4'],
        platformSpecific: { mediaType: 'REELS' },
      });

      await vi.advanceTimersByTimeAsync(5000);

      const result = await publishPromise;
      expect(result.status).toBe('published');
      expect(result.externalId).toBe('media-reel');

      vi.useRealTimers();
    });
  });

  // ─── publishPost: error mapping ────────────────────────────────────────

  describe('publishPost (error mapping)', () => {
    it('should throw NetworkError on request timeout', async () => {
      vi.mocked(fetch).mockRejectedValueOnce(
        Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }),
      );

      await expect(
        plugin.publishPost({
          text: 'Timeout',
          mediaUrls: ['https://example.com/photo.jpg'],
        }),
      ).rejects.toThrow(NetworkError);
    });

    it('should throw NetworkError on network failure', async () => {
      vi.mocked(fetch).mockRejectedValueOnce(new Error('ECONNREFUSED'));

      await expect(
        plugin.publishPost({
          text: 'No connection',
          mediaUrls: ['https://example.com/photo.jpg'],
        }),
      ).rejects.toThrow(NetworkError);
    });

    it('should throw RateLimitError on HTTP 429', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        createMockFetchResponse(instagramError(9001, 'Rate limit'), false, 429),
      );

      await expect(
        plugin.publishPost({
          text: 'Rate limited',
          mediaUrls: ['https://example.com/photo.jpg'],
        }),
      ).rejects.toThrow(RateLimitError);
    });

    it('should throw RateLimitError on code 9001 with different status', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        createMockFetchResponse(instagramError(9001, 'Limit'), false, 400),
      );

      await expect(
        plugin.publishPost({
          text: 'Rate limited',
          mediaUrls: ['https://example.com/photo.jpg'],
        }),
      ).rejects.toThrow(RateLimitError);
    });

    it('should throw ValidationError on unsupported media (code 2207026)', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        createMockFetchResponse(instagramError(2207026, 'Unsupported format'), false, 400),
      );

      await expect(
        plugin.publishPost({
          text: 'Bad format',
          mediaUrls: ['https://example.com/image.bmp'],
        }),
      ).rejects.toThrow(ValidationError);
    });

    it('should throw ValidationError on invalid parameter (code 100)', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        createMockFetchResponse(instagramError(100, 'Invalid field'), false, 400),
      );

      await expect(
        plugin.publishPost({
          text: 'Bad param',
          mediaUrls: ['https://example.com/photo.jpg'],
        }),
      ).rejects.toThrow(ValidationError);
    });

    it('should throw PlatformError for container not ready (code 9007)', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        createMockFetchResponse(instagramError(9007, 'Not ready'), false, 400),
      );

      await expect(
        plugin.publishPost({
          text: 'Not ready',
          mediaUrls: ['https://example.com/photo.jpg'],
        }),
      ).rejects.toThrow(PlatformError);
    });

    it('should throw PlatformError for generic API errors', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        createMockFetchResponse(instagramError(9999, 'Something broke'), false, 500),
      );

      await expect(
        plugin.publishPost({
          text: 'Server error',
          mediaUrls: ['https://example.com/photo.jpg'],
        }),
      ).rejects.toThrow(PlatformError);
    });
  });

  // ─── getPostStatus ─────────────────────────────────────────────────────

  describe('getPostStatus', () => {
    it('should return PostStatusResult with permalink', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        createMockFetchResponse({
          id: 'ig-media-123',
          permalink: 'https://instagram.com/p/ABC123/',
          media_type: 'IMAGE',
          caption: 'Great shot!',
        }),
      );

      const result = await plugin.getPostStatus('ig-media-123');

      expect(result.platform).toBe('instagram');
      expect(result.externalId).toBe('ig-media-123');
      expect(result.status).toBe('published');
      expect(result.url).toBe('https://instagram.com/p/ABC123/');
      expect(result.metadata?.mediaType).toBe('IMAGE');
    });

    it('should return failed status when API call errors', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        createMockFetchResponse(
          { error: { message: 'Not found', type: 'IGApiException', code: 100 } },
          false,
          400,
        ),
      );

      const result = await plugin.getPostStatus('non-existent');

      expect(result.status).toBe('failed');
      expect(result.externalId).toBe('non-existent');
      expect(result.metadata?.error).toBeDefined();
    });

    it('should return failed status on network error', async () => {
      vi.mocked(fetch).mockRejectedValueOnce(new Error('Network timeout'));

      const result = await plugin.getPostStatus('id-with-error');

      expect(result.status).toBe('failed');
      expect(result.metadata?.errorCode).toBe('NETWORK_ERROR');
    });
  });
});
