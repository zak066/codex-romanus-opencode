/**
 * __tests__/tools/seo.tool.test.ts
 * Test per tools/seo.tool.ts — SEO Tools (Fase 8 PANTHEON)
 *
 * Copertura:
 * - generate_sitemap: parametri mancanti → isError true
 * - generate_sitemap: parametri validi → XML valido con <loc> e <lastmod>
 * - validate_structured_data: JSON-LD valido → success
 * - validate_structured_data: JSON-LD invalido → errori
 * - validate_structured_data: jsonLd mancante → isError
 * - Tool handler registrato con nome corretto
 *
 * @module tests/tools/seo
 */

import {
  generateSitemapToolHandler,
  validateStructuredDataToolHandler,
} from '../../src/tools/seo.tool.js';

// ---------------------------------------------------------------------------
// Mock del modulo core
// ---------------------------------------------------------------------------

jest.mock('../../src/core/seo-builder.js', () => ({
  generateSitemap: jest.fn(),
  validateStructuredData: jest.fn(),
}));

import { generateSitemap, validateStructuredData } from '../../src/core/seo-builder.js';

const mockGenerateSitemap = generateSitemap as jest.MockedFunction<typeof generateSitemap>;
const mockValidateStructuredData = validateStructuredData as jest.MockedFunction<typeof validateStructuredData>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseResult(toolResult: { content: Array<{ type: string; text: string }>; isError?: boolean }): unknown {
  return JSON.parse(toolResult.content[0].text);
}

function fakeSitemapResult(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    count: 3,
    generatedAt: '2026-05-26T12:00:00.000Z',
    entries: [
      { loc: 'https://example.com/', lastmod: '2026-05-26', changefreq: 'daily', priority: 1.0 },
      { loc: 'https://example.com/about', lastmod: '2026-05-26', changefreq: 'weekly', priority: 0.8 },
      { loc: 'https://example.com/contact', lastmod: '2026-05-26', changefreq: 'weekly', priority: 0.8 },
    ],
    xml: '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url>\n    <loc>https://example.com/</loc>\n    <lastmod>2026-05-26</lastmod>\n    <changefreq>daily</changefreq>\n    <priority>1.0</priority>\n  </url>\n</urlset>',
    ...overrides,
  };
}

function fakeValidationResult(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    valid: true,
    errors: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Suite: generate_sitemap
// ---------------------------------------------------------------------------

describe('generateSitemapToolHandler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('ha il nome corretto', () => {
    expect(generateSitemapToolHandler.name).toBe('generate_sitemap');
  });

  it('restituisce isError true quando baseUrl manca', async () => {
    const result = await generateSitemapToolHandler.handler({
      paths: ['/', '/about'],
    });

    expect(result.isError).toBe(true);
    const parsed = parseResult(result) as { valid: boolean; errors: string[] };
    expect(parsed.errors.some((e) => e.toLowerCase().includes('baseurl'))).toBe(true);
  });

  it('restituisce isError true quando paths manca', async () => {
    const result = await generateSitemapToolHandler.handler({
      baseUrl: 'https://example.com',
    });

    expect(result.isError).toBe(true);
    const parsed = parseResult(result) as { valid: boolean; errors: string[] };
    expect(parsed.errors.some((e) => e.toLowerCase().includes('paths'))).toBe(true);
  });

  it('restituisce isError true quando paths è array vuoto', async () => {
    const result = await generateSitemapToolHandler.handler({
      baseUrl: 'https://example.com',
      paths: [],
    });

    expect(result.isError).toBe(true);
    const parsed = parseResult(result) as { valid: boolean; errors: string[] };
    expect(parsed.errors.some((e) => e.toLowerCase().includes('paths'))).toBe(true);
  });

  it('restituisce success con XML valido per parametri corretti', async () => {
    mockGenerateSitemap.mockReturnValue(fakeSitemapResult() as never);

    const result = await generateSitemapToolHandler.handler({
      baseUrl: 'https://example.com',
      paths: ['/', '/about', '/contact'],
    });

    expect(result.isError).toBeUndefined();
    const parsed = parseResult(result) as Record<string, unknown>;
    expect(parsed).toHaveProperty('count', 3);
    expect(parsed).toHaveProperty('xml');
    expect(parsed).toHaveProperty('entries');

    // Verifica che entries contengano loc e lastmod
    const entries = parsed.entries as Array<Record<string, unknown>>;
    expect(entries[0]).toHaveProperty('loc');
    expect(entries[0]).toHaveProperty('lastmod');

    // XML deve essere una stringa valida
    const xml = parsed.xml as string;
    expect(xml).toContain('<?xml version="1.0"');
    expect(xml).toContain('<urlset');
    expect(xml).toContain('<loc>');

    expect(mockGenerateSitemap).toHaveBeenCalledWith(
      'https://example.com',
      ['/', '/about', '/contact']
    );
  });

  it('restituisce isError true quando generateSitemap lancia errore', async () => {
    mockGenerateSitemap.mockImplementation(() => {
      throw new Error('Invalid URL');
    });

    const result = await generateSitemapToolHandler.handler({
      baseUrl: 'not-a-url',
      paths: ['/'],
    });

    expect(result.isError).toBe(true);
    const parsed = parseResult(result) as { valid: boolean; error: string };
    expect(parsed.error).toContain('Failed to generate sitemap');
  });
});

// ---------------------------------------------------------------------------
// Suite: validate_structured_data
// ---------------------------------------------------------------------------

describe('validateStructuredDataToolHandler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('ha il nome corretto', () => {
    expect(validateStructuredDataToolHandler.name).toBe('validate_structured_data');
  });

  it('restituisce success per JSON-LD valido', async () => {
    mockValidateStructuredData.mockReturnValue(fakeValidationResult() as never);

    const result = await validateStructuredDataToolHandler.handler({
      jsonLd: '{"@context":"https://schema.org","@type":"WebSite"}',
    });

    expect(result.isError).toBeUndefined();
    const parsed = parseResult(result) as { valid: boolean; errors: string[] };
    expect(parsed.valid).toBe(true);
    expect(parsed.errors).toEqual([]);

    expect(mockValidateStructuredData).toHaveBeenCalledWith(
      '{"@context":"https://schema.org","@type":"WebSite"}'
    );
  });

  it('restituisce errori per JSON-LD invalido', async () => {
    mockValidateStructuredData.mockReturnValue({
      valid: false,
      errors: ['Missing required field: @context', 'Missing required field: @type'],
    } as never);

    const result = await validateStructuredDataToolHandler.handler({
      jsonLd: '{"name":"Test"}',
    });

    expect(result.isError).toBeUndefined();
    const parsed = parseResult(result) as { valid: boolean; errors: string[] };
    expect(parsed.valid).toBe(false);
    expect(parsed.errors.length).toBeGreaterThan(0);
  });

  it('restituisce isError true quando jsonLd manca', async () => {
    const result = await validateStructuredDataToolHandler.handler({});

    expect(result.isError).toBe(true);
    const parsed = parseResult(result) as { valid: boolean; errors: string[] };
    expect(parsed.errors.some((e) => e.toLowerCase().includes('jsonld'))).toBe(true);
  });

  it('restituisce isError true quando jsonLd non è stringa', async () => {
    const result = await validateStructuredDataToolHandler.handler({
      jsonLd: 123,
    });

    expect(result.isError).toBe(true);
    const parsed = parseResult(result) as { valid: boolean; errors: string[] };
    expect(parsed.errors.some((e) => e.toLowerCase().includes('jsonld'))).toBe(true);
  });

  it('restituisce isError true quando validateStructuredData lancia errore', async () => {
    mockValidateStructuredData.mockImplementation(() => {
      throw new Error('Unexpected error');
    });

    const result = await validateStructuredDataToolHandler.handler({
      jsonLd: '{"@context":"https://schema.org","@type":"WebSite"}',
    });

    expect(result.isError).toBe(true);
    const parsed = parseResult(result) as { valid: boolean; errors: string[] };
    expect(parsed.errors.some((e) => e.toLowerCase().includes('validation failed'))).toBe(true);
  });
});
