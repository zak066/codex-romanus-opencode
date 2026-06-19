/**
 * Test per speculum_web_fetch (HTTP fetch + Readability extraction)
 *
 * Copre:
 * - URL valido con extract=true → contenuto pulito (Readability)
 * - URL valido con extract=false → HTML raw con title
 * - URL invalido → errore con isError
 * - URL vuoto → errore con isError
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Mock http-fetcher ---
vi.mock('../../src/core/http-fetcher.js', () => ({
  fetchUrl: vi.fn(),
}));

// --- Stato condiviso per controllare Readability nei test ---
// vi.hoisted() permette di creare variabili prima dei mock
const { readabilityState } = vi.hoisted(() => {
  const state: { result: Record<string, string> | null } = { result: null };
  return { readabilityState: state };
});

// --- Mock JSDOM — class (costruibile con `new`) ---
vi.mock('jsdom', () => ({
  JSDOM: class {
    window: { document: Record<string, unknown> };

    constructor(_html: string, _options: { url: string }) {
      this.window = { document: {} };
    }
  },
}));

// --- Mock Readability — class (costruibile con `new`) ---
vi.mock('@mozilla/readability', () => ({
  Readability: class {
    parse() {
      return readabilityState.result;
    }
  },
}));

import { handleFetch } from '../../src/tools/fetch.tool.js';
import { fetchUrl } from '../../src/core/http-fetcher.js';

describe('speculum_web_fetch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset Readability state per ogni test
    readabilityState.result = null;
  });

  it('dovrebbe restituire contenuto pulito con extract=true', async () => {
    // Arrange
    vi.mocked(fetchUrl).mockResolvedValue({
      ok: true,
      status: 200,
      body: '<html><body><article><h1>Test Article</h1><p>Readable content here.</p></article></body></html>',
      url: 'https://example.com/article',
    });

    // Configura Readability per restituire un articolo valido
    readabilityState.result = {
      title: 'Test Article',
      textContent: 'Readable content here.',
      excerpt: 'Readable content here...',
    };

    // Act
    const result = await handleFetch({ url: 'https://example.com/article', extract: true });
    const data = JSON.parse(result.content[0].text);

    // Assert
    expect(result.isError).toBeUndefined();
    expect(data.title).toBe('Test Article');
    expect(data.url).toBe('https://example.com/article');
    expect(data.content).toBe('Readable content here.');
    expect(data.excerpt).toBe('Readable content here...');
  });

  it('dovrebbe restituire HTML raw con title per extract=false', async () => {
    // Arrange
    vi.mocked(fetchUrl).mockResolvedValue({
      ok: true,
      status: 200,
      body: '<html><head><title>Raw Page Title</title></head><body><h1>Hello World</h1><p>Raw HTML content</p></body></html>',
      url: 'https://example.com/raw',
    });

    // Act
    const result = await handleFetch({ url: 'https://example.com/raw', extract: false });
    const data = JSON.parse(result.content[0].text);

    // Assert
    expect(result.isError).toBeUndefined();
    expect(data.title).toBe('Raw Page Title');
    expect(data.url).toBe('https://example.com/raw');
    expect(data.content).toContain('<html>');
    expect(data.content).toContain('<h1>Hello World</h1>');
    expect(data.content).toContain('Raw HTML content');
    // excerpt non dovrebbe essere presente con extract=false
    expect(data.excerpt).toBeUndefined();
  });

  it('dovrebbe restituire errore per URL invalido', async () => {
    // Act
    const result = await handleFetch({ url: 'not-a-valid-url' });
    const data = JSON.parse(result.content[0].text);

    // Assert
    expect(result.isError).toBe(true);
    expect(data.title).toBe('');
    expect(data.content).toContain('Error');
    expect(data.content).toContain('Invalid URL');
    // fetchUrl non dovrebbe essere chiamato per URL invalidi
    expect(fetchUrl).not.toHaveBeenCalled();
  });

  it('dovrebbe restituire errore per URL vuoto', async () => {
    // Act
    const result = await handleFetch({ url: '' });
    const data = JSON.parse(result.content[0].text);

    // Assert
    expect(result.isError).toBe(true);
    expect(data.content).toContain('Error');
    expect(data.content).toContain('URL is required');
  });
});
