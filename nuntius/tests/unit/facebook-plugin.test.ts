/**
 * Unit tests for FacebookPlugin.
 *
 * Tests use global fetch mocking.
 * Covers: config, publishPost (text + photo), error mapping,
 *         getPostStatus, media constraints.
 */

import FacebookPlugin from '../../src/plugins/facebook/index.js';
import { createMockFetchResponse } from '../helpers.js';
import { AuthError, NetworkError, RateLimitError, ValidationError, PlatformError } from '../../src/errors.js';

// ─── Setup ────────────────────────────────────────────────────────────────

let plugin: FacebookPlugin;

beforeEach(() => {
  // The FacebookPlugin constructor reads process.env
  process.env.FACEBOOK_PAGE_ID = 'test-page-id';
  process.env.FACEBOOK_ACCESS_TOKEN = 'test-access-token';
  process.env.FACEBOOK_API_VERSION = 'v22.0';

  globalThis.fetch = vi.fn();
  plugin = new FacebookPlugin();
});

afterEach(() => {
  delete process.env.FACEBOOK_PAGE_ID;
  delete process.env.FACEBOOK_ACCESS_TOKEN;
  delete process.env.FACEBOOK_API_VERSION;
  vi.restoreAllMocks();
});

// ─── Basic interface ─────────────────────────────────────────────────────

describe('FacebookPlugin', () => {
  describe('getPlatformName', () => {
    it('should return "facebook"', () => {
      expect(plugin.getPlatformName()).toBe('facebook');
    });
  });

  describe('getRequiredConfig', () => {
    it('should list required environment variables', () => {
      const config = plugin.getRequiredConfig();
      expect(config).toContain('FACEBOOK_PAGE_ID');
      expect(config).toContain('FACEBOOK_ACCESS_TOKEN');
      expect(config).toHaveLength(2);
    });
  });

  describe('validateConfig', () => {
    it('should return valid=true when pageId and accessToken are present', () => {
      const result = plugin.validateConfig({
        pageId: '12345',
        accessToken: 'token-abc',
      });

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should return invalid when pageId is missing', () => {
      const result = plugin.validateConfig({
        accessToken: 'token-abc',
      });

      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('pageId');
    });

    it('should return invalid when pageId is empty string', () => {
      const result = plugin.validateConfig({
        pageId: '',
        accessToken: 'token-abc',
      });

      expect(result.valid).toBe(false);
    });

    it('should return invalid when accessToken is missing', () => {
      const result = plugin.validateConfig({
        pageId: '12345',
      });

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
      expect(constraints.maxFileSize).toBeGreaterThan(0);
      expect(constraints.maxFiles).toBe(1);
      expect(constraints.aspectRatio).toBeDefined();
    });
  });

  // ─── publishPost ──────────────────────────────────────────────────────

  describe('publishPost', () => {
    const textPost = { text: 'Hello from Nuntius!' };

    it('should POST to /{pageId}/feed for text-only posts', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        createMockFetchResponse({ id: 'fb-post-123' }),
      );

      const result = await plugin.publishPost(textPost);

      expect(result.externalId).toBe('fb-post-123');
      expect(result.status).toBe('published');
      expect(result.platform).toBe('facebook');

      // Verify the fetch URL contains /feed
      const fetchCall = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
      expect(fetchCall[0]).toContain('/feed');
      expect(fetchCall[1]?.method).toBe('POST');

      const body = JSON.parse(fetchCall[1]?.body as string);
      expect(body.message).toBe('Hello from Nuntius!');
      expect(body.access_token).toBe('test-access-token');
    });

    it('should POST to /{pageId}/photos when mediaUrls is present', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        createMockFetchResponse({ id: 'photo-456', post_id: 'fb-post-456' }),
      );

      const result = await plugin.publishPost({
        text: 'Photo post',
        mediaUrls: ['https://example.com/photo.jpg'],
      });

      expect(result.externalId).toBe('fb-post-456');
      expect(result.status).toBe('published');

      const fetchCall = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
      expect(fetchCall[0]).toContain('/photos');
      expect(fetchCall[1]?.method).toBe('POST');

      const body = JSON.parse(fetchCall[1]?.body as string);
      expect(body.url).toBe('https://example.com/photo.jpg');
      expect(body.message).toBe('Photo post');
    });

    it('should use photo id as externalId when post_id is not returned', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        createMockFetchResponse({ id: 'photo-789' }),
      );

      const result = await plugin.publishPost({
        text: 'Photo without post_id',
        mediaUrls: ['https://example.com/pic.jpg'],
      });

      expect(result.externalId).toBe('photo-789');
    });

    it('should include platformSpecific link parameter', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        createMockFetchResponse({ id: 'fb-post-link' }),
      );

      await plugin.publishPost({
        text: 'Link post',
        platformSpecific: { link: 'https://example.com/article' },
      });

      const fetchCall = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(fetchCall[1]?.body as string);
      expect(body.link).toBe('https://example.com/article');
    });

    it('should include published=false when platformSpecific.published is false', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        createMockFetchResponse({ id: 'fb-draft' }),
      );

      await plugin.publishPost({
        text: 'Draft post',
        platformSpecific: { published: false },
      });

      const fetchCall = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(fetchCall[1]?.body as string);
      expect(body.published).toBe('false');
    });

    it('should throw NetworkError on fetch timeout', async () => {
      // Simulate abort/AbortError
      vi.mocked(fetch).mockRejectedValue(
        Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }),
      );

      await expect(plugin.publishPost(textPost)).rejects.toThrow(NetworkError);
      await expect(plugin.publishPost(textPost)).rejects.toThrow(
        'Facebook API request timed out after 15s',
      );
    });

    it('should throw NetworkError on network failure', async () => {
      vi.mocked(fetch).mockRejectedValueOnce(new Error('ECONNRESET'));

      await expect(plugin.publishPost(textPost)).rejects.toThrow(NetworkError);
    });

    it('should throw RateLimitError for Facebook error code 4', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        createMockFetchResponse(
          {
            error: {
              message: 'Application request limit reached',
              type: 'OAuthException',
              code: 4,
              error_subcode: 0,
              fbtrace_id: 'ABC123',
            },
          },
          false,
          400,
        ),
      );

      await expect(plugin.publishPost(textPost)).rejects.toThrow(RateLimitError);
    });

    it('should throw RateLimitError for Facebook error code 32', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        createMockFetchResponse(
          {
            error: {
              message: 'Page rate limit hit',
              type: 'OAuthException',
              code: 32,
              error_subcode: 0,
              fbtrace_id: 'DEF456',
            },
          },
          false,
          400,
        ),
      );

      await expect(plugin.publishPost(textPost)).rejects.toThrow(RateLimitError);
    });

    it('should throw AuthError for Facebook error code 190', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        createMockFetchResponse(
          {
            error: {
              message: 'Invalid OAuth 2.0 Access Token',
              type: 'OAuthException',
              code: 190,
              error_subcode: 0,
              fbtrace_id: 'GHI789',
            },
          },
          false,
          400,
        ),
      );

      await expect(plugin.publishPost(textPost)).rejects.toThrow(AuthError);
    });

    it('should throw ValidationError for Facebook error code 100', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        createMockFetchResponse(
          {
            error: {
              message: 'Invalid parameter',
              type: 'GraphMethodException',
              code: 100,
              error_subcode: 0,
              fbtrace_id: 'JKL012',
            },
          },
          false,
          400,
        ),
      );

      await expect(plugin.publishPost(textPost)).rejects.toThrow(ValidationError);
    });

    it('should throw PlatformError for other error codes', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        createMockFetchResponse(
          {
            error: {
              message: 'Unknown error',
              type: 'GraphMethodException',
              code: 9999,
              error_subcode: 0,
              fbtrace_id: 'MNO345',
            },
          },
          false,
          500,
        ),
      );

      await expect(plugin.publishPost(textPost)).rejects.toThrow(PlatformError);
    });

    it('should throw PlatformError for unexpected non-Nuntius errors', async () => {
      // Non-facebook error that isn't caught by handleFacebookError
      // e.g. a JSON.parse error from response.json() would be unexpected
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockRejectedValue(new Error('Unexpected token in JSON')),
      } as unknown as Response);

      await expect(plugin.publishPost(textPost)).rejects.toThrow(PlatformError);
    });
  });

  // ─── getPostStatus ────────────────────────────────────────────────────

  describe('getPostStatus', () => {
    it('should GET post details and return PostStatusResult', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        createMockFetchResponse({
          id: 'fb-post-123',
          permalink_url: 'https://facebook.com/123',
          created_time: '2026-05-29T12:00:00+0000',
        }),
      );

      const result = await plugin.getPostStatus('fb-post-123');

      expect(result.platform).toBe('facebook');
      expect(result.externalId).toBe('fb-post-123');
      expect(result.status).toBe('published');
      expect(result.url).toBe('https://facebook.com/123');

      const fetchCall = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
      expect(fetchCall[0]).toContain('/fb-post-123');
    });
  });
});
