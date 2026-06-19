/**
 * InstagramPlugin — implements SocialPlugin for the Instagram Graph API
 * (Content Publishing API, v22.0).
 *
 * Two-step publishing flow:
 *   1. POST /{ig-user-id}/media          → creates a content container
 *   2. POST /{ig-user-id}/media_publish   → publishes the container
 *
 * For video/REELS containers, polls status_code until FINISHED (max 150s).
 *
 * Environment variables:
 *   INSTAGRAM_USER_ID       — Instagram Business Account IG User ID
 *   INSTAGRAM_ACCESS_TOKEN  — Long-lived Page Access Token with instagram_basic,
 *                             instagram_content_publish, pages_show_list permissions
 *   INSTAGRAM_PAGE_ID       — (optional) Facebook Page ID linked to the IG account
 */

import type { SocialPlugin } from '../social-plugin.js';
import type {
  InstagramMediaContainerResponse,
  InstagramMediaPublishResponse,
  InstagramMediaStatusResponse,
  InstagramError,
  InstagramConfig,
} from './types.js';
import type {
  PostPayload,
  PublishResult,
  PostStatusResult,
  ValidationResult,
  MediaConstraints,
} from '../../types.js';
import {
  SocialError,
  AuthError,
  RateLimitError,
  ValidationError,
  NetworkError,
  PlatformError,
} from '../../errors.js';

// ─── Constants ───────────────────────────────────────────────────────────

const BASE_URL = 'https://graph.facebook.com/v22.0';

/** Per-request timeout (Instagram video processing can be slow) */
const REQUEST_TIMEOUT_MS = 30_000;

/** Video/reel container polling */
const POLL_MAX_ATTEMPTS = 30;
const POLL_INTERVAL_MS = 5_000;

/** Max caption length documented by Instagram */
const INSTAGRAM_CAPTION_MAX_LENGTH = 2_200;

type MediaType = 'IMAGE' | 'VIDEO' | 'REELS' | 'STORIES' | 'CAROUSEL';

const VALID_MEDIA_TYPES = new Set<string>([
  'IMAGE',
  'VIDEO',
  'REELS',
  'STORIES',
  'CAROUSEL',
]);

const VIDEO_EXTENSIONS: string[] = [
  '.mp4',
  '.mov',
  '.avi',
  '.m4v',
  '.webm',
  '.mkv',
  '.3gp',
];

// ─── Helpers ─────────────────────────────────────────────────────────────

/**
 * Reads Instagram configuration from environment variables.
 * This avoids coupling the plugin to a constructor pattern, since
 * PluginRegistry instantiates plugins with `new mod.default()` (no args).
 */
function getConfig(): InstagramConfig {
  return {
    userId: process.env.INSTAGRAM_USER_ID || '',
    accessToken: process.env.INSTAGRAM_ACCESS_TOKEN || '',
    pageId: process.env.INSTAGRAM_PAGE_ID || '',
  };
}

/** Promise-based sleep for polling intervals. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Determines the Instagram MediaType from a media URL and optional explicit type.
 *
 * Priority:
 *   1. Explicit `platformSpecific.mediaType`
 *   2. URL file extension heuristics (video extensions → VIDEO)
 *   3. Default: IMAGE
 */
function inferMediaType(url: string, explicitType?: string): MediaType {
  if (explicitType && VALID_MEDIA_TYPES.has(explicitType)) {
    return explicitType as MediaType;
  }

  const urlLower = url.toLowerCase();
  for (const ext of VIDEO_EXTENSIONS) {
    if (urlLower.endsWith(ext)) return 'VIDEO';
  }

  return 'IMAGE';
}

// ─── Instagram API Error Mapping ───────────────────────────────────────
//
// Common Instagram Graph API error codes:
//   190       — Invalid OAuth 2.0 Access Token
//   9001      — Rate limit reached
//   9007      — Container not yet processed
//   2207026   — Unsupported media type / format
//   100       — Invalid parameter

function mapInstagramError(errorBody: InstagramError, statusCode: number): SocialError {
  const err = errorBody.error;

  // Authentication / token errors
  if (statusCode === 401 || err.code === 190) {
    return new AuthError(`Instagram authentication failed: ${err.message}`);
  }

  // Rate limiting
  if (statusCode === 429 || err.code === 9001 || err.error_subcode === 9001) {
    return new RateLimitError(
      `Instagram rate limit exceeded: ${err.message}`,
      86_400_000, // 24h default reset
    );
  }

  // Validation errors
  if (err.code === 2207026) {
    return new ValidationError(`Instagram unsupported media format: ${err.message}`);
  }

  if (err.code === 100) {
    return new ValidationError(`Instagram invalid parameter: ${err.message}`);
  }

  // Container not ready (retryable)
  if (err.code === 9007) {
    return new PlatformError(
      `Instagram container not ready: ${err.message}`,
      String(err.code),
    );
  }

  // Other 4xx
  if (statusCode >= 400 && statusCode < 500) {
    return new PlatformError(
      `Instagram client error (${err.code}): ${err.message}`,
      String(err.code),
    );
  }

  // 5xx or unknown
  return new PlatformError(
    `Instagram API error (HTTP ${statusCode}, code ${err.code}): ${err.message}`,
    String(err.code),
  );
}

// ─── HTTP Utilities ──────────────────────────────────────────────────────

/**
 * Performs a POST request against the Instagram Graph API.
 * Expects `body` to already include `access_token`, `access_token`, etc.
 * Logs request outcome via console.error in the format:
 *   [nuntius:instagram] POST /{path} status=200 latency=450ms
 */
async function apiPost<T>(
  path: string,
  body: Record<string, string>,
): Promise<T> {
  const url = `${BASE_URL}${path}`;
  const startTime = Date.now();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const latency = Date.now() - startTime;
    console.error(
      `[nuntius:instagram] POST ${path} status=${response.status} latency=${latency}ms`,
    );

    const data: unknown = await response.json();

    if (!response.ok) {
      throw mapInstagramError(data as InstagramError, response.status);
    }

    return data as T;
  } catch (err) {
    if (err instanceof SocialError) throw err;
    if ((err as Error).name === 'AbortError') {
      throw new NetworkError('Instagram API POST request timed out after 30s');
    }
    throw new NetworkError(
      `Instagram network error on POST: ${(err as Error).message}`,
      err as Error,
    );
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Performs a GET request against the Instagram Graph API.
 * Automatically appends `access_token` as a query parameter.
 * Logs request outcome via console.error.
 */
async function apiGet<T>(path: string, accessToken: string): Promise<T> {
  const separator = path.includes('?') ? '&' : '?';
  const url = `${BASE_URL}${path}${separator}access_token=${accessToken}`;
  const startTime = Date.now();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });

    const latency = Date.now() - startTime;
    console.error(
      `[nuntius:instagram] GET ${path} status=${response.status} latency=${latency}ms`,
    );

    const data: unknown = await response.json();

    if (!response.ok) {
      throw mapInstagramError(data as InstagramError, response.status);
    }

    return data as T;
  } catch (err) {
    if (err instanceof SocialError) throw err;
    if ((err as Error).name === 'AbortError') {
      throw new NetworkError('Instagram API GET request timed out after 30s');
    }
    throw new NetworkError(
      `Instagram network error on GET: ${(err as Error).message}`,
      err as Error,
    );
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Polls the status of a media container (video/reels) until it is ready
 * for publishing or a terminal state is reached.
 *
 * Terminal states:
 *   FINISHED  → ready to publish
 *   PUBLISHED → already published (edge case)
 *   EXPIRED   → container expired, must re-create
 *   ERROR     → processing failed
 *
 * Throws PlatformError on terminal failure or timeout after 150s.
 */
async function pollContainerStatus(
  containerId: string,
  accessToken: string,
): Promise<void> {
  for (let attempt = 1; attempt <= POLL_MAX_ATTEMPTS; attempt++) {
    const data = await apiGet<InstagramMediaStatusResponse>(
      `/${containerId}?fields=status_code`,
      accessToken,
    );

    switch (data.status_code) {
      case 'FINISHED':
      case 'PUBLISHED':
        return;
      case 'EXPIRED':
        throw new PlatformError(
          `Instagram media container ${containerId} expired — recreate and try again`,
        );
      case 'ERROR':
        throw new PlatformError(
          `Instagram media container ${containerId} processing error`,
        );
      case 'IN_PROGRESS':
        if (attempt < POLL_MAX_ATTEMPTS) {
          console.error(
            `[nuntius:instagram] Container ${containerId} still processing ` +
              `(attempt ${attempt}/${POLL_MAX_ATTEMPTS})`,
          );
          await delay(POLL_INTERVAL_MS);
        }
        break;
    }
  }

  const totalTimeoutSec = (POLL_MAX_ATTEMPTS * POLL_INTERVAL_MS) / 1000;
  throw new PlatformError(
    `Instagram container ${containerId} processing timed out after ${totalTimeoutSec}s`,
  );
}

// ─── Plugin ──────────────────────────────────────────────────────────────

export default class InstagramPlugin implements SocialPlugin {
  getPlatformName(): string {
    return 'instagram';
  }

  getRequiredConfig(): string[] {
    return ['INSTAGRAM_USER_ID', 'INSTAGRAM_ACCESS_TOKEN'];
  }

  validateConfig(config: Record<string, unknown>): ValidationResult {
    const errors: string[] = [];

    if (
      !config.userId ||
      typeof config.userId !== 'string' ||
      config.userId.trim().length === 0
    ) {
      errors.push('Instagram userId is required and must be a non-empty string');
    }

    if (
      !config.accessToken ||
      typeof config.accessToken !== 'string' ||
      config.accessToken.trim().length === 0
    ) {
      errors.push('Instagram accessToken is required and must be a non-empty string');
    }

    return { valid: errors.length === 0, errors };
  }

  async publishPost(post: PostPayload): Promise<PublishResult> {
    const { userId, accessToken } = getConfig();
    const publishedAt = new Date().toISOString();

    // ── Pre-validation ──────────────────────────────────────────────

    // Instagram does NOT support text-only posts.
    if (!post.mediaUrls || post.mediaUrls.length === 0) {
      throw new ValidationError(
        'Instagram requires at least one media URL (text-only posts are not supported)',
      );
    }

    // v1: single media only (carousel support planned for v2).
    if (post.mediaUrls.length > 1) {
      throw new ValidationError(
        'Instagram supports only a single media URL per post in the current version (carousel not yet supported)',
      );
    }

    // Instagram caption limit: 2,200 characters.
    if (post.text && post.text.length > INSTAGRAM_CAPTION_MAX_LENGTH) {
      console.error(
        `[nuntius:instagram] Caption truncated from ${post.text.length} to ${INSTAGRAM_CAPTION_MAX_LENGTH} characters`,
      );
    }

    // ── Step 1: Determine media type ────────────────────────────────

    const mediaUrl = post.mediaUrls[0];
    const explicitType = post.platformSpecific?.mediaType as string | undefined;
    const mediaType = inferMediaType(mediaUrl, explicitType);

    // Build the container creation body.
    // `media_type` must be explicitly set for non-IMAGE types.
    const createBody: Record<string, string> = {
      caption: post.text.slice(0, INSTAGRAM_CAPTION_MAX_LENGTH),
      access_token: accessToken,
    };

    switch (mediaType) {
      case 'VIDEO':
        createBody.video_url = mediaUrl;
        createBody.media_type = 'VIDEO';
        break;
      case 'REELS':
        createBody.video_url = mediaUrl;
        createBody.media_type = 'REELS';
        break;
      case 'STORIES': {
        // Stories can be either image or video.
        if (VIDEO_EXTENSIONS.some((ext) => mediaUrl.toLowerCase().endsWith(ext))) {
          createBody.video_url = mediaUrl;
        } else {
          createBody.image_url = mediaUrl;
        }
        createBody.media_type = 'STORIES';
        break;
      }
      default: {
        // IMAGE (default)
        createBody.image_url = mediaUrl;
        createBody.media_type = 'IMAGE';
        break;
      }
    }

    // ── Step 2: Create media container ──────────────────────────────
    //
    // POST /v22.0/{ig-user-id}/media
    // Body: { image_url, caption, media_type, access_token }
    // Response: { id: "container-id" }

    const containerResponse = await apiPost<InstagramMediaContainerResponse>(
      `/${userId}/media`,
      createBody,
    );

    const containerId = containerResponse.id;
    console.error(`[nuntius:instagram] Container created: ${containerId} for type=${mediaType}`);

    // ── Step 3: Poll container status (video/reels only) ────────────
    //
    // Video containers require processing before they can be published.
    // GET /v22.0/{container-id}?fields=status_code

    const needsPolling = mediaType === 'VIDEO' || mediaType === 'REELS';
    if (needsPolling) {
      console.error(`[nuntius:instagram] Polling container ${containerId} status...`);
      await pollContainerStatus(containerId, accessToken);
      console.error(`[nuntius:instagram] Container ${containerId} is ready for publishing`);
    }

    // ── Step 4: Publish container ───────────────────────────────────
    //
    // POST /v22.0/{ig-user-id}/media_publish
    // Body: { creation_id, access_token }
    // Response: { id: "media-id", media_product_type?: string }

    const publishResponse = await apiPost<InstagramMediaPublishResponse>(
      `/${userId}/media_publish`,
      {
        creation_id: containerId,
        access_token: accessToken,
      },
    );

    const externalId = publishResponse.id;
    console.error(`[nuntius:instagram] Published media ID: ${externalId}`);

    return {
      platform: 'instagram',
      externalId,
      status: 'published',
      publishedAt,
      metadata: {
        mediaType,
        containerId,
        mediaProductType: publishResponse.media_product_type,
        captionLength: post.text.length,
      },
    };
  }

  async getPostStatus(externalId: string): Promise<PostStatusResult> {
    const { accessToken } = getConfig();

    try {
      // GET /v22.0/{media-id}?fields=id,permalink,media_type,caption
      const data = await apiGet<{
        id: string;
        permalink?: string;
        media_type?: string;
        caption?: string;
      }>(`/${externalId}?fields=id,permalink,media_type,caption`, accessToken);

      return {
        platform: 'instagram',
        externalId: data.id,
        status: 'published',
        url: data.permalink,
        metadata: {
          mediaType: data.media_type,
          caption: data.caption,
        },
      };
    } catch (err) {
      // Post inaccessible or not found → report as failed
      return {
        platform: 'instagram',
        externalId,
        status: 'failed',
        metadata: {
          error: err instanceof Error ? err.message : String(err),
          errorCode: err instanceof SocialError ? err.code : 'UNKNOWN',
        },
      };
    }
  }

  getMediaConstraints(): MediaConstraints {
    return {
      // Instagram Graph API accepts JPEG, PNG, and WEBP for images;
      // MP4, MOV for video/reels.
      supportedTypes: [
        'image/jpeg',
        'image/png',
        'image/webp',
        'video/mp4',
        'video/mov',
        'video/quicktime',
      ],
      // 100 MB to cover both images (8 MB typical) and videos.
      maxFileSize: 100 * 1024 * 1024,
      // v1: single media (carousel support planned).
      maxFiles: 1,
      // Square is recommended; minimum 320×320.
      aspectRatio: '1:1 (min 320px)',
      minWidth: 320,
      minHeight: 320,
    };
  }
}
