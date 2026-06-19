/**
 * Test per speculum_suggest (DuckDuckGo Autocomplete)
 *
 * Copre:
 * - Query valida → suggerimenti
 * - Query vuota → array vuoto (nessun errore)
 * - Errore HTTP → isError + array vuoto
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock http-fetcher prima di importare il tool
vi.mock('../../src/core/http-fetcher.js', () => ({
  fetchUrl: vi.fn(),
}));

import { handleSuggest } from '../../src/tools/suggest.tool.js';
import { fetchUrl } from '../../src/core/http-fetcher.js';

describe('speculum_suggest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('dovrebbe restituire suggerimenti per una query valida', async () => {
    // Arrange
    const mockResponse = {
      ok: true,
      status: 200,
      body: JSON.stringify([
        'typescript',
        [
          'typescript tutorial',
          'typescript handbook',
          'typescript compiler',
          'typescript definition',
        ],
      ]),
      url: 'https://duckduckgo.com/ac/?q=typescript&type=list',
    };
    vi.mocked(fetchUrl).mockResolvedValue(mockResponse);

    // Act
    const result = await handleSuggest({ query: 'typescript' });
    const data = JSON.parse(result.content[0].text);

    // Assert
    expect(result.isError).toBeUndefined();
    expect(data.query).toBe('typescript');
    expect(data.suggestions).toEqual([
      'typescript tutorial',
      'typescript handbook',
      'typescript compiler',
      'typescript definition',
    ]);
  });

  it('dovrebbe restituire array vuoto per query vuota (senza errori)', async () => {
    // Arrange & Act
    const result = await handleSuggest({ query: '' });
    const data = JSON.parse(result.content[0].text);

    // Assert
    expect(result.isError).toBeUndefined();
    expect(data.query).toBe('');
    expect(data.suggestions).toEqual([]);
    // fetchUrl non dovrebbe essere chiamato per query vuota
    expect(vi.mocked(fetchUrl)).not.toHaveBeenCalled();
  });

  it('dovrebbe gestire errore HTTP con isError=true', async () => {
    // Arrange
    const mockError = {
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      body: '',
      url: 'https://duckduckgo.com/ac/?q=test&type=list',
    };
    vi.mocked(fetchUrl).mockResolvedValue(mockError);

    // Act
    const result = await handleSuggest({ query: 'test' });
    const data = JSON.parse(result.content[0].text);

    // Assert
    expect(result.isError).toBe(true);
    expect(data.query).toBe('test');
    expect(data.suggestions).toEqual([]);
  });
});
