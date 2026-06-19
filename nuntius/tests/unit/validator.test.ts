/**
 * Unit tests for Validator and PublishInputSchema.
 *
 * Tests cover:
 *   - Zod schema validation (PublishInputSchema)
 *   - Validator.validatePost() with plugins
 *   - Media constraints violation detection
 *   - scheduledAt parsing
 */

import { PublishInputSchema, Validator } from '../../src/engine/validator.js';
import { createMockPlugin } from '../helpers.js';
import type { SocialPlugin } from '../../src/plugins/social-plugin.js';
import type { MediaConstraints } from '../../src/types.js';

// ─── PublishInputSchema (Zod) ─────────────────────────────────────────────

describe('PublishInputSchema', () => {
  const validInput = {
    platforms: ['facebook'],
    text: 'Hello, world!',
  };

  it('should accept a valid input with only required fields', () => {
    const result = PublishInputSchema.safeParse(validInput);
    expect(result.success).toBe(true);
  });

  it('should accept valid input with optional fields (mediaUrls, scheduledAt)', () => {
    const result = PublishInputSchema.safeParse({
      ...validInput,
      mediaUrls: ['https://example.com/photo.jpg'],
      scheduledAt: '2026-06-01T12:00:00.000Z',
      platformSpecific: { link: 'https://example.com' },
    });
    expect(result.success).toBe(true);
  });

  it('should reject empty platforms array', () => {
    const result = PublishInputSchema.safeParse({
      ...validInput,
      platforms: [],
    });
    expect(result.success).toBe(false);
  });

  it('should reject platforms exceeding max of 10', () => {
    const result = PublishInputSchema.safeParse({
      ...validInput,
      platforms: Array.from({ length: 11 }, (_, i) => `platform-${i}`),
    });
    expect(result.success).toBe(false);
  });

  it('should reject empty text', () => {
    const result = PublishInputSchema.safeParse({
      ...validInput,
      text: '',
    });
    expect(result.success).toBe(false);
  });

  it('should reject non-URL mediaUrls', () => {
    const result = PublishInputSchema.safeParse({
      ...validInput,
      mediaUrls: ['not-a-valid-url'],
    });
    expect(result.success).toBe(false);
  });

  it('should reject mediaUrls exceeding max of 10', () => {
    const result = PublishInputSchema.safeParse({
      ...validInput,
      mediaUrls: Array.from({ length: 11 }, (_, i) => `https://example.com/photo-${i}.jpg`),
    });
    expect(result.success).toBe(false);
  });

  it('should accept valid optional scheduledAt (ISO 8601 datetime)', () => {
    const result = PublishInputSchema.safeParse({
      ...validInput,
      scheduledAt: '2026-12-31T23:59:59.000Z',
    });
    expect(result.success).toBe(true);
  });

  it('should reject invalid datetime string', () => {
    const result = PublishInputSchema.safeParse({
      ...validInput,
      scheduledAt: 'not-a-date',
    });
    expect(result.success).toBe(false);
  });

  it('should reject text exceeding 63206 characters', () => {
    const result = PublishInputSchema.safeParse({
      ...validInput,
      text: 'x'.repeat(63207),
    });
    expect(result.success).toBe(false);
  });

  it('should accept text at exactly 63206 characters', () => {
    const result = PublishInputSchema.safeParse({
      ...validInput,
      text: 'x'.repeat(63206),
    });
    expect(result.success).toBe(true);
  });
});

// ─── Validator ────────────────────────────────────────────────────────────

describe('Validator', () => {
  let validator: Validator;
  let mockPlugin: SocialPlugin;

  beforeEach(() => {
    validator = new Validator();
    mockPlugin = createMockPlugin('test-platform');
  });

  describe('validatePost', () => {
    it('should return valid=true for a correct payload', async () => {
      const result = await validator.validatePost(
        { text: 'Hello, world!' },
        [mockPlugin],
      );

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should detect missing text', async () => {
      const result = await validator.validatePost(
        { text: '' },
        [mockPlugin],
      );

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Post text is required');
    });

    it('should detect whitespace-only text as missing', async () => {
      const result = await validator.validatePost(
        { text: '   ' },
        [mockPlugin],
      );

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Post text is required');
    });

    it('should detect text exceeding 63206 characters', async () => {
      const result = await validator.validatePost(
        { text: 'x'.repeat(63207) },
        [mockPlugin],
      );

      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        'Text exceeds maximum length of 63206 characters (got 63207)',
      );
    });

    it('should detect too many media URLs (>10)', async () => {
      const result = await validator.validatePost(
        {
          text: 'Hello',
          mediaUrls: Array.from({ length: 11 }, (_, i) => `https://example.com/img-${i}.jpg`),
        },
        [mockPlugin],
      );

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Maximum 10 media URLs allowed (got 11)');
    });

    it('should reject invalid scheduledAt', async () => {
      const result = await validator.validatePost(
        {
          text: 'Hello',
          scheduledAt: 'not-a-valid-date',
        },
        [mockPlugin],
      );

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Invalid scheduledAt: unable to parse as date');
    });

    it('should accept valid optional scheduledAt', async () => {
      const result = await validator.validatePost(
        {
          text: 'Hello',
          scheduledAt: '2026-06-15T10:00:00.000Z',
        },
        [mockPlugin],
      );

      expect(result.valid).toBe(true);
    });
  });

  describe('media constraints per plugin', () => {
    it('should report error when media URLs exceed plugin maxFiles', async () => {
      // Plugin allows only 1 file
      mockPlugin.getMediaConstraints = vi.fn().mockReturnValue({
        supportedTypes: ['image/jpeg'],
        maxFiles: 1,
      } as MediaConstraints);

      const result = await validator.validatePost(
        {
          text: 'Hello',
          mediaUrls: ['https://example.com/a.jpg', 'https://example.com/b.jpg'],
        },
        [mockPlugin],
      );

      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        '[test-platform] Maximum 1 media files allowed (got 2)',
      );
    });

    it('should add warning for supported types when media is present', async () => {
      mockPlugin.getMediaConstraints = vi.fn().mockReturnValue({
        supportedTypes: ['image/jpeg', 'image/png'],
        maxFiles: 5,
      } as MediaConstraints);

      const result = await validator.validatePost(
        {
          text: 'Hello',
          mediaUrls: ['https://example.com/photo.jpg'],
        },
        [mockPlugin],
      );

      expect(result.warnings).toBeDefined();
      expect(result.warnings![0]).toContain('Media should be one of types');
    });

    it('should add warning for aspect ratio when media is present', async () => {
      mockPlugin.getMediaConstraints = vi.fn().mockReturnValue({
        supportedTypes: ['image/jpeg'],
        maxFiles: 5,
        aspectRatio: '1:1 (min 320px)',
      } as MediaConstraints);

      const result = await validator.validatePost(
        {
          text: 'Hello',
          mediaUrls: ['https://example.com/photo.jpg'],
        },
        [mockPlugin],
      );

      expect(result.warnings).toBeDefined();
      expect(result.warnings!.some((w) => w.includes('aspect ratio'))).toBe(true);
    });

    it('should not add warnings when no media is provided', async () => {
      const result = await validator.validatePost(
        { text: 'Hello' },
        [mockPlugin],
      );

      expect(result.warnings).toBeUndefined();
    });

    it('should handle multiple plugins with different constraints', async () => {
      const fbPlugin = createMockPlugin('facebook');
      fbPlugin.getMediaConstraints = vi.fn().mockReturnValue({
        supportedTypes: ['image/jpeg'],
        maxFiles: 1,
      } as MediaConstraints);

      const igPlugin = createMockPlugin('instagram');
      igPlugin.getMediaConstraints = vi.fn().mockReturnValue({
        supportedTypes: ['image/jpeg', 'image/png'],
        maxFiles: 1,
      } as MediaConstraints);

      const result = await validator.validatePost(
        {
          text: 'Hello',
          mediaUrls: ['https://example.com/a.jpg', 'https://example.com/b.jpg'],
        },
        [fbPlugin, igPlugin],
      );

      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(2);
      expect(result.errors).toContain('[facebook] Maximum 1 media files allowed (got 2)');
      expect(result.errors).toContain('[instagram] Maximum 1 media files allowed (got 2)');
    });
  });
});
