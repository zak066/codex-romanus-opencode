/**
 * ImageHandler — Servizio di processing immagini per Imago.
 *
 * Fornisce encoding, ridimensionamento e creazione di thumbnail WebP
 * a partire da buffer immagine grezzi (es. da ComfyUI getView).
 *
 * Dipende da `sharp` per tutto il processing.
 *
 * @module services/image-handler
 */

import sharp from 'sharp';

import { error as logError } from '../utils/logger.js';
import { ImageProcessingError } from '../utils/errors.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ImageProcessOptions {
  /** Larghezza massima (default: 1024) */
  maxWidth?: number;
  /** Altezza massima (default: 1024) */
  maxHeight?: number;
  /** Qualità WebP/JPEG 1–100 (default: 80) */
  quality?: number;
  /** Formato di output (default: 'webp') */
  format?: 'webp' | 'jpeg' | 'png';
}

export interface ProcessedImage {
  /** Buffer dell'immagine processata */
  data: Buffer;
  /** MIME type dell'immagine risultante */
  mimeType: string;
  /** Larghezza finale dopo processing */
  width: number;
  /** Altezza finale dopo processing */
  height: number;
  /** Larghezza originale */
  originalWidth: number;
  /** Altezza originale */
  originalHeight: number;
  /** Dimensione in bytes */
  size: number;
  /** Dimensione in kilobyte (arrotondata) */
  sizeKB: number;
}

// ─── Defaults ────────────────────────────────────────────────────────────────

const DEFAULT_OPTIONS: Required<ImageProcessOptions> = {
  maxWidth: 1024,
  maxHeight: 1024,
  quality: 80,
  format: 'webp',
};

/** Mappa formato → MIME type */
const FORMAT_MIME: Record<string, string> = {
  webp: 'image/webp',
  jpeg: 'image/jpeg',
  png: 'image/png',
};

// ─── ImageHandler ────────────────────────────────────────────────────────────

export class ImageHandler {
  private readonly _defaults: Required<ImageProcessOptions>;

  /**
   * @param options Opzioni di default per processImage().
   *                Se omesse, usa i valori predefiniti di sistema.
   */
  constructor(options?: ImageProcessOptions) {
    this._defaults = {
      maxWidth: options?.maxWidth ?? DEFAULT_OPTIONS.maxWidth,
      maxHeight: options?.maxHeight ?? DEFAULT_OPTIONS.maxHeight,
      quality: options?.quality ?? DEFAULT_OPTIONS.quality,
      format: options?.format ?? DEFAULT_OPTIONS.format,
    };
  }

  /**
   * Restituisce le opzioni di default correnti (sola lettura).
   */
  get defaults(): Required<ImageProcessOptions> {
    return { ...this._defaults };
  }

  // ─── processImage ─────────────────────────────────────────────

  /**
   * Processa un buffer immagine: ridimensiona + converti formato.
   *
   * 1. Legge i metadati originali via sharp
   * 2. Ridimensiona proporzionalmente (fit: 'inside', withoutEnlargement)
   * 3. Converte nel formato richiesto con la qualità specificata
   * 4. Restituisce ProcessedImage con tutte le dimensioni
   *
   * @param buffer  Buffer dell'immagine sorgente
   * @param options Opzioni che sovrascrivono i default del costruttore
   * @returns       ProcessedImage con dati e metadati
   * @throws        ImageProcessingError se il buffer è vuoto o il processing fallisce
   */
  async processImage(buffer: Buffer, options?: ImageProcessOptions): Promise<ProcessedImage> {
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
      throw new ImageProcessingError('Buffer immagine vuoto o non valido');
    }

    // Opzioni: merge defaults costruttore + override parametro
    const opts: Required<ImageProcessOptions> = {
      maxWidth: options?.maxWidth ?? this._defaults.maxWidth,
      maxHeight: options?.maxHeight ?? this._defaults.maxHeight,
      quality: options?.quality ?? this._defaults.quality,
      format: options?.format ?? this._defaults.format,
    };

    try {
      const metadata = await sharp(buffer).metadata();

      // Estrai dimensioni originali (con fallback a 0)
      const originalWidth = metadata.width ?? 0;
      const originalHeight = metadata.height ?? 0;

      // Ridimensiona proporzionalmente
      const resized = sharp(buffer)
        .resize({
          width: opts.maxWidth,
          height: opts.maxHeight,
          fit: 'inside',
          withoutEnlargement: true,
        });

      // Applica formato e qualità
      switch (opts.format) {
        case 'webp':
          resized.webp({ quality: opts.quality });
          break;
        case 'jpeg':
          resized.jpeg({ quality: opts.quality });
          break;
        case 'png':
          // PNG non ha qualità come parametro diretto, usiamo compressionLevel inverso
          // quality 1-100 → compressionLevel 9-1 (più qualità = meno compressione)
          resized.png({ compressionLevel: Math.max(1, Math.round((100 - opts.quality) / 11.11)) });
          break;
      }

      const data = await resized.toBuffer();

      // Ottieni dimensioni finali
      const finalMetadata = await sharp(data).metadata();

      return {
        data,
        mimeType: FORMAT_MIME[opts.format],
        width: finalMetadata.width ?? 0,
        height: finalMetadata.height ?? 0,
        originalWidth,
        originalHeight,
        size: data.length,
        sizeKB: Math.round(data.length / 1024),
      };
    } catch (err) {
      logError('Errore nel processing immagine', {
        error: (err as Error).message,
        bufferSize: buffer.length,
      });

      if (err instanceof ImageProcessingError) {
        throw err;
      }

      throw new ImageProcessingError(
        `Errore nel processing immagine: ${(err as Error).message}`,
        err,
      );
    }
  }

  // ─── getImageInfo ─────────────────────────────────────────────

  /**
   * Ottiene le informazioni sull'immagine senza processarla.
   *
   * @param buffer Buffer dell'immagine sorgente
   * @returns      { width, height, format, size }
   * @throws       ImageProcessingError se il buffer è vuoto o la lettura fallisce
   */
  async getImageInfo(buffer: Buffer): Promise<{
    width: number;
    height: number;
    format: string;
    size: number;
  }> {
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
      throw new ImageProcessingError('Buffer immagine vuoto o non valido');
    }

    try {
      const metadata = await sharp(buffer).metadata();
      return {
        width: metadata.width ?? 0,
        height: metadata.height ?? 0,
        format: metadata.format ?? 'unknown',
        size: buffer.length,
      };
    } catch (err) {
      logError('Errore nella lettura metadati immagine', {
        error: (err as Error).message,
        bufferSize: buffer.length,
      });

      throw new ImageProcessingError(
        `Impossibile leggere i metadati dell'immagine: ${(err as Error).message}`,
        err,
      );
    }
  }

  // ─── createThumbnail ──────────────────────────────────────────

  /**
   * Crea una thumbnail WebP veloce (max 512px, qualità 70).
   * Ideale per anteprime (~100KB).
   *
   * @param buffer Buffer dell'immagine sorgente
   * @returns      ProcessedImage con thumbnail
   */
  async createThumbnail(buffer: Buffer): Promise<ProcessedImage> {
    return this.processImage(buffer, {
      maxWidth: 512,
      maxHeight: 512,
      quality: 70,
      format: 'webp',
    });
  }

  // ─── toBase64 ─────────────────────────────────────────────────

  /**
   * Converte un buffer in stringa Base64.
   * Sicura per trasporto su stdio (MCP).
   *
   * @param buffer Buffer da convertire
   * @returns      Stringa Base64
   */
  toBase64(buffer: Buffer): string {
    return buffer.toString('base64');
  }

  // ─── toDataUri ────────────────────────────────────────────────

  /**
   * Crea un Data URI Base64 dall'immagine.
   *
   * Esempio output: `data:image/webp;base64,iVBORw0KGgo...`
   *
   * @param buffer  Buffer dell'immagine
   * @param mimeType MIME type (es. 'image/webp')
   * @returns       Data URI completo
   */
  toDataUri(buffer: Buffer, mimeType: string): string {
    const base64 = this.toBase64(buffer);
    return `data:${mimeType};base64,${base64}`;
  }
}
