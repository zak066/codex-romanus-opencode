import type { PostPayload, PublishResult, PostStatusResult, ValidationResult, MediaConstraints } from '../types.js';

/**
 * Interface that every social media plugin must implement.
 * Follows the Strategy Pattern: each platform has its own implementation
 * of publish, status check, and media constraints.
 */
export interface SocialPlugin {
  /** Unique platform name (e.g. "facebook", "instagram") */
  getPlatformName(): string;

  /** Declares required environment variable names (e.g. ["FACEBOOK_ACCESS_TOKEN"]) */
  getRequiredConfig(): string[];

  /** Validates runtime configuration (token, page-id, etc.) */
  validateConfig(config: Record<string, unknown>): ValidationResult;

  /** Publishes a post. Media URLs are expected to be already hosted. */
  publishPost(post: PostPayload): Promise<PublishResult>;

  /** Retrieves the status of a previously published post */
  getPostStatus(externalId: string): Promise<PostStatusResult>;

  /** Returns media constraints (formats, max dimensions, etc.) */
  getMediaConstraints(): MediaConstraints;
}
