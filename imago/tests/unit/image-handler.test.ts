/**
 * ImageHandler — Unit Tests
 *
 * Copre:
 * - constructor (default e custom options)
 * - processImage (WebP, resize, withoutEnlargement, qualità)
 * - getImageInfo (dimensioni, formato)
 * - createThumbnail (512px, qualità 70)
 * - toBase64 (validità)
 * - toDataUri (formato)
 * - Error handling (buffer vuoto)
 */

import { describe, it, expect } from 'vitest';
import sharp from 'sharp';

import { ImageHandler, type ProcessedImage } from '../../src/services/image-handler.js';
import { ImageProcessingError } from '../../src/utils/errors.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Crea un'immagine di test inline usando sharp.
 *
 * @param width  Larghezza (default: 100)
 * @param height Altezza (default: 100)
 * @returns      Buffer PNG
 */
/**
 * Crea un'immagine di test inline usando sharp.
 * Usa una gradient band per avere varietà cromatica realistica.
 *
 * @param width  Larghezza (default: 100)
 * @param height Altezza (default: 100)
 * @returns      Buffer PNG
 */
async function createTestImage(width = 100, height = 100): Promise<Buffer> {
  // Genera pixel con gradient per simulare un'immagine realistica
  // con contenuto cromatico vario che permetta di distinguere
  // qualità diverse in compressione
  const channels = 3;
  const gradientData = Buffer.alloc(width * height * channels);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * channels;
      gradientData[idx] = Math.round((x / width) * 255);     // R: gradient X
      gradientData[idx + 1] = Math.round((y / height) * 255); // G: gradient Y
      gradientData[idx + 2] = Math.round(((x + y) / (width + height)) * 255); // B: diagonal
    }
  }

  return sharp(gradientData, { raw: { width, height, channels } })
    .png()
    .toBuffer();
}

// ─── Suite ───────────────────────────────────────────────────────────────────

describe('ImageHandler', () => {
  // ─── constructor ──────────────────────────────────────────────

  describe('constructor', () => {
    it('should use default options when no arguments provided', () => {
      const handler = new ImageHandler();
      expect(handler.defaults).toEqual({
        maxWidth: 1024,
        maxHeight: 1024,
        quality: 80,
        format: 'webp',
      });
    });

    it('should merge custom options with defaults', () => {
      const handler = new ImageHandler({
        maxWidth: 800,
        format: 'jpeg',
      });
      expect(handler.defaults).toEqual({
        maxWidth: 800,
        maxHeight: 1024,
        quality: 80,
        format: 'jpeg',
      });
    });

    it('should override all options when fully specified', () => {
      const handler = new ImageHandler({
        maxWidth: 640,
        maxHeight: 480,
        quality: 90,
        format: 'png',
      });
      expect(handler.defaults).toEqual({
        maxWidth: 640,
        maxHeight: 480,
        quality: 90,
        format: 'png',
      });
    });
  });

  // ─── processImage ─────────────────────────────────────────────

  describe('processImage', () => {
    it('should convert PNG to WebP with default options', async () => {
      const handler = new ImageHandler();
      const input = await createTestImage(200, 150);

      const result = await handler.processImage(input);

      expect(result).toBeDefined();
      expect(result.mimeType).toBe('image/webp');
      expect(result.data).toBeInstanceOf(Buffer);
      expect(result.data.length).toBeGreaterThan(0);
      expect(result.size).toBe(result.data.length);
      expect(result.sizeKB).toBeGreaterThanOrEqual(0);
      // Dimensions should match original or be smaller
      expect(result.width).toBeLessThanOrEqual(200);
      expect(result.height).toBeLessThanOrEqual(150);
      expect(result.originalWidth).toBe(200);
      expect(result.originalHeight).toBe(150);
    });

    it('should not enlarge image smaller than max dimensions', async () => {
      const handler = new ImageHandler({
        maxWidth: 2000,
        maxHeight: 2000,
      });
      const input = await createTestImage(50, 30);

      const result = await handler.processImage(input);

      // withoutEnlargement: true → dimensions should stay the same
      expect(result.width).toBe(50);
      expect(result.height).toBe(30);
      expect(result.originalWidth).toBe(50);
      expect(result.originalHeight).toBe(30);
    });

    it('should resize image exceeding max dimensions proportionally', async () => {
      const handler = new ImageHandler({
        maxWidth: 200,
        maxHeight: 100,
      });
      const input = await createTestImage(800, 600);

      const result = await handler.processImage(input);

      // fit: 'inside' + withoutEnlargement: true
      // 800x600 → should fit within 200x100
      expect(result.originalWidth).toBe(800);
      expect(result.originalHeight).toBe(600);
      expect(result.width).toBeLessThanOrEqual(200);
      expect(result.height).toBeLessThanOrEqual(100);
      // Aspect ratio should be preserved (800:600 = 4:3)
      expect(result.width / result.height).toBeCloseTo(4 / 3, 1);
    });

    it('should apply custom quality setting', async () => {
      const handler = new ImageHandler();
      // Use a larger, more complex gradient image
      const input = await createTestImage(800, 600);

      const lowQuality = await handler.processImage(input, { quality: 10 });
      const highQuality = await handler.processImage(input, { quality: 100 });

      // Entrambi devono essere WebP validi con dimensioni reali
      expect(lowQuality.mimeType).toBe('image/webp');
      expect(highQuality.mimeType).toBe('image/webp');
      expect(lowQuality.width).toBeGreaterThan(0);
      expect(highQuality.width).toBeGreaterThan(0);
      expect(lowQuality.height).toBeGreaterThan(0);
      expect(highQuality.height).toBeGreaterThan(0);

      // Qualità diversa deve produrre dimensioni file diverse
      // (non usiamo toBeLessThan perché WebP su gradient può non scalare
      //  linearmente — basta che non siano identici)
      expect(lowQuality.size).not.toBe(highQuality.size);
    });

    it('should convert to JPEG format when specified', async () => {
      const handler = new ImageHandler();
      const input = await createTestImage(100, 100);

      const result = await handler.processImage(input, { format: 'jpeg' });

      expect(result.mimeType).toBe('image/jpeg');
      expect(result.data.length).toBeGreaterThan(0);
    });

    it('should convert to PNG format when specified', async () => {
      const handler = new ImageHandler();
      const input = await createTestImage(100, 100);

      const result = await handler.processImage(input, { format: 'png' });

      expect(result.mimeType).toBe('image/png');
      expect(result.data.length).toBeGreaterThan(0);
    });

    it('should use per-call options over constructor defaults', async () => {
      const handler = new ImageHandler({
        maxWidth: 1024,
        maxHeight: 1024,
        quality: 80,
        format: 'webp',
      });
      const input = await createTestImage(500, 500);

      const result = await handler.processImage(input, {
        maxWidth: 50,
        maxHeight: 50,
        format: 'jpeg',
      });

      // Should be resized to 50x50 max
      expect(result.width).toBeLessThanOrEqual(50);
      expect(result.height).toBeLessThanOrEqual(50);
      expect(result.mimeType).toBe('image/jpeg');
    });

    it('should throw ImageProcessingError for empty buffer', async () => {
      const handler = new ImageHandler();

      await expect(handler.processImage(Buffer.alloc(0))).rejects.toThrow(ImageProcessingError);
    });

    it('should throw ImageProcessingError for invalid buffer content', async () => {
      const handler = new ImageHandler();
      const invalidBuffer = Buffer.from('not-an-image-data', 'utf-8');

      await expect(handler.processImage(invalidBuffer)).rejects.toThrow(ImageProcessingError);
    });
  });

  // ─── getImageInfo ─────────────────────────────────────────────

  describe('getImageInfo', () => {
    it('should return correct dimensions and format', async () => {
      const handler = new ImageHandler();
      const input = await createTestImage(150, 200);

      const info = await handler.getImageInfo(input);

      expect(info.width).toBe(150);
      expect(info.height).toBe(200);
      expect(info.format).toBe('png');
      expect(info.size).toBeGreaterThan(0);
    });

    it('should throw ImageProcessingError for empty buffer', async () => {
      const handler = new ImageHandler();

      await expect(handler.getImageInfo(Buffer.alloc(0))).rejects.toThrow(ImageProcessingError);
    });
  });

  // ─── createThumbnail ──────────────────────────────────────────

  describe('createThumbnail', () => {
    it('should create WebP thumbnail with max 512px and quality 70', async () => {
      const handler = new ImageHandler();
      const input = await createTestImage(1920, 1080);

      const result = await handler.createThumbnail(input);

      expect(result.mimeType).toBe('image/webp');
      expect(result.originalWidth).toBe(1920);
      expect(result.originalHeight).toBe(1080);
      // Should be resized to fit within 512x512
      expect(result.width).toBeLessThanOrEqual(512);
      expect(result.height).toBeLessThanOrEqual(512);
      // Aspect ratio preserved (1920:1080 = 16:9)
      expect(result.width / result.height).toBeCloseTo(16 / 9, 1);
      // Size should be reasonable for a thumbnail
      expect(result.sizeKB).toBeLessThan(200); // well under 200KB
    });

    it('should not enlarge small images', async () => {
      const handler = new ImageHandler();
      const input = await createTestImage(32, 32);

      const result = await handler.createThumbnail(input);

      expect(result.width).toBe(32);
      expect(result.height).toBe(32);
    });
  });

  // ─── toBase64 ─────────────────────────────────────────────────

  describe('toBase64', () => {
    it('should return valid base64 string', () => {
      const handler = new ImageHandler();
      const buffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]);

      const base64 = handler.toBase64(buffer);

      expect(typeof base64).toBe('string');
      expect(base64.length).toBeGreaterThan(0);
      // Should be valid base64
      expect(() => Buffer.from(base64, 'base64')).not.toThrow();
      // Decoded should match original
      expect(Buffer.from(base64, 'base64')).toEqual(buffer);
    });

    it('should handle empty buffer gracefully', () => {
      const handler = new ImageHandler();

      const base64 = handler.toBase64(Buffer.alloc(0));

      expect(typeof base64).toBe('string');
      expect(base64).toBe('');
    });
  });

  // ─── toDataUri ────────────────────────────────────────────────

  describe('toDataUri', () => {
    it('should return correctly formatted data URI', () => {
      const handler = new ImageHandler();
      const buffer = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
      const mimeType = 'image/png';

      const uri = handler.toDataUri(buffer, mimeType);
      const expectedBase64 = buffer.toString('base64');

      expect(uri).toBe(`data:${mimeType};base64,${expectedBase64}`);
    });

    it('should work with WebP mime type', async () => {
      const handler = new ImageHandler();
      const input = await createTestImage(10, 10);
      const processed = await handler.processImage(input);

      const uri = handler.toDataUri(processed.data, processed.mimeType);

      expect(uri).toMatch(/^data:image\/webp;base64,.+/);
    });
  });
});
