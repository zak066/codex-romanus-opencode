/**
 * Test helpers for Nuntius test suite.
 *
 * Provides:
 *   - createMockPlugin() — a fully functional SocialPlugin mock
 *   - createMockFetchResponse() — a minimal Response stub for fetch mocking
 */

import type { SocialPlugin } from '../src/plugins/social-plugin.js';
import type {
  PostPayload,
  PublishResult,
  PostStatusResult,
  ValidationResult,
  MediaConstraints,
} from '../src/types.js';

/**
 * Creates a minimal SocialPlugin mock with vi.fn() methods.
 *
 * All methods have sensible defaults. Override specific methods after creation:
 *
 *   const plugin = createMockPlugin('twitter');
 *   plugin.publishPost = vi.fn().mockResolvedValue({ ... });
 */
export function createMockPlugin(name = 'mock-platform'): SocialPlugin {
  return {
    getPlatformName: vi.fn<[], string>().mockReturnValue(name),

    getRequiredConfig: vi.fn<[], string[]>().mockReturnValue([]),

    validateConfig: vi.fn<[Record<string, unknown>], ValidationResult>().mockReturnValue({
      valid: true,
      errors: [],
    }),

    publishPost: vi.fn<[PostPayload], Promise<PublishResult>>().mockResolvedValue({
      platform: name,
      externalId: 'mock-id-123',
      status: 'published',
      publishedAt: new Date().toISOString(),
    }),

    getPostStatus: vi.fn<[string], Promise<PostStatusResult>>().mockResolvedValue({
      platform: name,
      externalId: 'mock-id-123',
      status: 'published',
    }),

    getMediaConstraints: vi.fn<[], MediaConstraints>().mockReturnValue({
      supportedTypes: ['image/jpeg', 'image/png', 'video/mp4'],
      maxFileSize: 100 * 1024 * 1024,
      maxFiles: 5,
      aspectRatio: '16:9',
      minWidth: 320,
      minHeight: 320,
    }),
  };
}

/**
 * Creates a minimal Response-like object for mocking `fetch()` return values.
 *
 * Usage:
 *   globalThis.fetch = vi.fn()
 *     .mockResolvedValueOnce(createMockFetchResponse({ id: 'abc' }))
 *     .mockResolvedValueOnce(createMockFetchResponse({ error: { ... } }, false, 400));
 */
export function createMockFetchResponse(
  data: unknown,
  ok = true,
  status = 200,
): Response {
  const jsonFn = vi.fn<[], Promise<unknown>>().mockResolvedValue(data);

  return {
    ok,
    status,
    statusText: ok ? 'OK' : 'Error',
    headers: new Headers(),
    redirected: false,
    type: 'basic' as ResponseType,
    url: '',
    json: jsonFn,
    clone: vi.fn(),
    body: null,
    bodyUsed: false,
    arrayBuffer: vi.fn(),
    blob: vi.fn(),
    formData: vi.fn(),
    text: vi.fn(),
  } as unknown as Response;
}
