/**
 * FacebookPlugin — SocialPlugin implementation for Facebook Graph API (v22.0).
 *
 * Supports:
 *   - Text posts (POST /{pageId}/feed)
 *   - Photo posts (POST /{pageId}/photos with url, single media)
 *   - Link posts (POST /{pageId}/feed with link)
 *   - Post status retrieval (GET /{postId})
 *   - Draft / suppress-story via platformSpecific flags
 *
 * Error mapping (Facebook → Nuntius):
 *   code  4 (API rate limit)    → RateLimitError
 *   code 17 (user rate limit)   → RateLimitError
 *   code 32 (page rate limit)   → RateLimitError
 *   code 190 (OAuth)            → AuthError
 *   code 100 (invalid param)    → ValidationError
 *   any other error             → PlatformError
 *   network / timeout           → NetworkError
 *
 * @module @codex-romanus/nuntius/plugins/facebook
 */

import type { SocialPlugin } from '../social-plugin.js';
import type {
  PostPayload,
  PublishResult,
  PostStatusResult,
  ValidationResult,
  MediaConstraints,
} from '../../types.js';
import {
  AuthError,
  NetworkError,
  PlatformError,
  RateLimitError,
  ValidationError,
} from '../../errors.js';
import type { FacebookConfig, FacebookPostResponse, FacebookPhotoResponse, FacebookError } from './types.js';

/** Request timeout in milliseconds */
const REQUEST_TIMEOUT_MS = 15_000;

/** Default retry-after estimate for Facebook rate-limit errors */
const FALLBACK_RETRY_AFTER_MS = 60_000;

/** Base URL for Facebook Graph API — version is appended at runtime */
const GRAPH_API_BASE = 'https://graph.facebook.com';

export default class FacebookPlugin implements SocialPlugin {
  private config: FacebookConfig;

  constructor() {
    this.config = {
      pageId: process.env.FACEBOOK_PAGE_ID ?? '',
      accessToken: process.env.FACEBOOK_ACCESS_TOKEN ?? '',
      apiVersion: process.env.FACEBOOK_API_VERSION ?? 'v22.0',
    };
  }

  // ─── SocialPlugin interface ────────────────────────────────────────────

  getPlatformName(): string {
    return 'facebook';
  }

  getRequiredConfig(): string[] {
    return ['FACEBOOK_PAGE_ID', 'FACEBOOK_ACCESS_TOKEN'];
  }

  validateConfig(config: Record<string, unknown>): ValidationResult {
    const errors: string[] = [];

    if (!config.pageId || typeof config.pageId !== 'string' || config.pageId.trim().length === 0) {
      errors.push('pageId is required and must be a non-empty string');
    }

    if (!config.accessToken || typeof config.accessToken !== 'string' || config.accessToken.trim().length === 0) {
      errors.push('accessToken is required and must be a non-empty string');
    }

    return { valid: errors.length === 0, errors };
  }

  async publishPost(post: PostPayload): Promise<PublishResult> {
    const { pageId, accessToken, apiVersion } = this.config;
    const baseUrl = `${GRAPH_API_BASE}/${apiVersion}`;
    const startTime = Date.now();

    const hasMedia = post.mediaUrls !== undefined && post.mediaUrls.length > 0;

    try {
      if (hasMedia) {
        return await this.publishPhoto(baseUrl, pageId, accessToken, post, startTime);
      }

      return await this.publishFeed(baseUrl, pageId, accessToken, post, startTime);
    } catch (err) {
      // Re-throw known Nuntius errors as-is
      if (
        err instanceof AuthError ||
        err instanceof RateLimitError ||
        err instanceof ValidationError ||
        err instanceof NetworkError ||
        err instanceof PlatformError
      ) {
        throw err;
      }

      // Wrap unexpected errors
      throw new PlatformError(
        `Facebook plugin error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async getPostStatus(externalId: string): Promise<PostStatusResult> {
    const { accessToken, apiVersion } = this.config;
    const url =
      `${GRAPH_API_BASE}/${apiVersion}/${externalId}` +
      `?fields=id,permalink_url,created_time&access_token=${accessToken}`;
    const startTime = Date.now();

    const response = await this.fetchWithTimeout(url);
    const latency = Date.now() - startTime;

    if (!response.ok) {
      const fbError: FacebookError = await response.json() as FacebookError;
      console.error(
        `[nuntius:facebook] GET /${externalId} status=${response.status} latency=${latency}ms error=${fbError.error.message}`,
      );
      this.handleFacebookError(fbError);
    }

    const data = await response.json() as Record<string, unknown>;
    console.error(
      `[nuntius:facebook] GET /${externalId} status=${response.status} latency=${latency}ms`,
    );

    return {
      platform: 'facebook',
      externalId: String(data.id ?? externalId),
      status: 'published',
      url: typeof data.permalink_url === 'string' ? data.permalink_url : undefined,
      metadata: {
        created_time: data.created_time,
      },
    };
  }

  getMediaConstraints(): MediaConstraints {
    return {
      supportedTypes: ['image/jpeg', 'image/png', 'image/gif', 'video/mp4'],
      maxFileSize: 100 * 1024 * 1024, // 100 MB
      maxFiles: 1, // v1: single media upload
      aspectRatio: '1.91:1 to 1:1',
    };
  }

  // ─── Internal helpers ──────────────────────────────────────────────────

  /**
   * Posts a text/link message to the page's feed.
   */
  private async publishFeed(
    baseUrl: string,
    pageId: string,
    accessToken: string,
    post: PostPayload,
    startTime: number,
  ): Promise<PublishResult> {
    const url = `${baseUrl}/${pageId}/feed`;

    const body: Record<string, string> = {
      access_token: accessToken,
    };

    if (post.text && post.text.length > 0) {
      body.message = post.text;
    }

    // platformSpecific.link — attach a link to the post
    if (post.platformSpecific?.link && typeof post.platformSpecific.link === 'string') {
      body.link = post.platformSpecific.link;
    }

    // platformSpecific.published — if false, save as draft
    if (post.platformSpecific?.published === false) {
      body.published = 'false';
    }

    // platformSpecific.noStory — suppress news feed story
    if (post.platformSpecific?.noStory === true) {
      body.no_story = 'true';
    }

    const response = await this.fetchWithTimeout(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    return this.handleFeedResponse(response, startTime);
  }

  /**
   * Posts a photo with an optional message to the page.
   * Uses only the first URL from `mediaUrls`.
   */
  private async publishPhoto(
    baseUrl: string,
    pageId: string,
    accessToken: string,
    post: PostPayload,
    startTime: number,
  ): Promise<PublishResult> {
    const url = `${baseUrl}/${pageId}/photos`;

    const body: Record<string, string> = {
      url: post.mediaUrls![0],
      access_token: accessToken,
    };

    if (post.text && post.text.length > 0) {
      body.message = post.text;
    }

    // platformSpecific.published — if false, save as draft
    if (post.platformSpecific?.published === false) {
      body.published = 'false';
    }

    // platformSpecific.noStory — suppress news feed story
    if (post.platformSpecific?.noStory === true) {
      body.no_story = 'true';
    }

    const response = await this.fetchWithTimeout(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    return this.handlePhotoResponse(response, startTime);
  }

  /**
   * Parses a successful feed POST response into a PublishResult.
   */
  private async handleFeedResponse(
    response: Response,
    startTime: number,
  ): Promise<PublishResult> {
    const latency = Date.now() - startTime;

    if (!response.ok) {
      const fbError: FacebookError = await response.json() as FacebookError;
      console.error(
        `[nuntius:facebook] POST /feed status=${response.status} latency=${latency}ms error=${fbError.error.message}`,
      );
      this.handleFacebookError(fbError);
    }

    const data: FacebookPostResponse = await response.json() as FacebookPostResponse;
    console.error(
      `[nuntius:facebook] POST /feed status=${response.status} latency=${latency}ms id=${data.id}`,
    );

    return {
      platform: 'facebook',
      externalId: data.id,
      status: 'published',
      publishedAt: new Date().toISOString(),
    };
  }

  /**
   * Parses a successful photo POST response into a PublishResult.
   * Uses post_id (when available) or photo id as the external identifier.
   */
  private async handlePhotoResponse(
    response: Response,
    startTime: number,
  ): Promise<PublishResult> {
    const latency = Date.now() - startTime;

    if (!response.ok) {
      const fbError: FacebookError = await response.json() as FacebookError;
      console.error(
        `[nuntius:facebook] POST /photos status=${response.status} latency=${latency}ms error=${fbError.error.message}`,
      );
      this.handleFacebookError(fbError);
    }

    const data: FacebookPhotoResponse = await response.json() as FacebookPhotoResponse;
    const externalId = data.post_id ?? data.id;
    console.error(
      `[nuntius:facebook] POST /photos status=${response.status} latency=${latency}ms id=${data.id}`,
    );

    return {
      platform: 'facebook',
      externalId,
      status: 'published',
      publishedAt: new Date().toISOString(),
    };
  }

  /**
   * Performs a fetch() request with an AbortController timeout.
   * On timeout or network failure, throws NetworkError.
   */
  private async fetchWithTimeout(url: string, options: RequestInit = {}): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      return await fetch(url, {
        ...options,
        signal: controller.signal,
      });
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new NetworkError('Facebook API request timed out after 15s');
      }
      throw new NetworkError(
        `Facebook API request failed: ${err instanceof Error ? err.message : String(err)}`,
        err instanceof Error ? err : undefined,
      );
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Maps a Facebook API error response to the corresponding Nuntius error
   * and throws it.
   *
   * Reference: https://developers.facebook.com/docs/graph-api/guides/error-handling
   */
  private handleFacebookError(fbError: FacebookError): never {
    const { code, error_subcode, message } = fbError.error;

    // ── Rate limits ──────────────────────────────────────────────────
    // code 4: API rate limit reached
    // code 17: user-level rate limit
    // code 32: page-level rate limit
    // error_subcode 1349192: memristive rate limit (Meta internal)
    if (code === 4 || code === 17 || code === 32 || error_subcode === 1_349_192) {
      throw new RateLimitError(
        `Facebook rate limit exceeded: ${message}`,
        FALLBACK_RETRY_AFTER_MS,
      );
    }

    // ── Authentication / authorization ────────────────────────────────
    // code 190: invalid/expired OAuth token
    if (code === 190) {
      throw new AuthError(`Facebook auth error: ${message}`);
    }

    // ── Validation ────────────────────────────────────────────────────
    // code 100: invalid parameter
    if (code === 100) {
      throw new ValidationError(`Facebook validation error: ${message}`);
    }

    // ── Other platform errors ─────────────────────────────────────────
    throw new PlatformError(
      `Facebook API error (${code}): ${message}`,
      String(code),
    );
  }
}
