import { z } from 'zod';
import type { PostPayload, ValidationResult } from '../types.js';
import type { SocialPlugin } from '../plugins/social-plugin.js';

/**
 * Zod schema for validating the raw input of the social_publish MCP tool.
 * This ensures type-safe parsing before constructing a PostPayload.
 */
export const PublishInputSchema = z.object({
  platforms: z.array(z.string()).min(1).max(10),
  text: z.string().min(1).max(63206),
  mediaUrls: z.array(z.url()).max(10).optional(),
  scheduledAt: z.string().datetime().optional(),
  platformSpecific: z.record(z.unknown()).optional(),
});

/**
 * Pre-publish validator.
 * Checks: required fields, text length, media constraints per plugin, date format.
 */
export class Validator {
  /**
   * Validates a PostPayload against all provided plugins.
   * Returns a ValidationResult with errors and warnings.
   */
  async validatePost(payload: PostPayload, plugins: SocialPlugin[]): Promise<ValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];

    // --- Basic field validation ---

    if (!payload.text || payload.text.trim().length === 0) {
      errors.push('Post text is required');
    } else if (payload.text.length > 63206) {
      errors.push(`Text exceeds maximum length of 63206 characters (got ${payload.text.length})`);
    }

    // Media validation
    if (payload.mediaUrls && payload.mediaUrls.length > 0) {
      if (payload.mediaUrls.length > 10) {
        errors.push(`Maximum 10 media URLs allowed (got ${payload.mediaUrls.length})`);
      }
    }

    // scheduledAt validation
    if (payload.scheduledAt) {
      try {
        const date = new Date(payload.scheduledAt);
        if (isNaN(date.getTime())) {
          errors.push('Invalid scheduledAt: unable to parse as date');
        }
      } catch {
        errors.push('Invalid scheduledAt: unable to parse as date');
      }
    }

    // --- Per-plugin media constraints validation ---

    for (const plugin of plugins) {
      const name = plugin.getPlatformName();
      const constraints = plugin.getMediaConstraints();

      if (payload.mediaUrls && payload.mediaUrls.length > 0) {
        // Check max files per platform
        if (constraints.maxFiles !== undefined && payload.mediaUrls.length > constraints.maxFiles) {
          errors.push(
            `[${name}] Maximum ${constraints.maxFiles} media files allowed (got ${payload.mediaUrls.length})`,
          );
        }

        // Warn about supported types (cannot truly validate without fetching)
        if (constraints.supportedTypes.length > 0) {
          warnings.push(
            `[${name}] Media should be one of types: ${constraints.supportedTypes.join(', ')}`,
          );
        }

        // Warn about aspect ratio constraints
        if (constraints.aspectRatio) {
          warnings.push(
            `[${name}] Recommended aspect ratio: ${constraints.aspectRatio}`,
          );
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  }
}
