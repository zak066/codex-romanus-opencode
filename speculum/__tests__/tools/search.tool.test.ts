/**
 * Test per speculum_web_search (DuckDuckGo Lite HTML)
 *
 * Copre:
 * - Query valida → risultati con URL decodificate
 * - Query con region → risultati localizzati (parametro kl)
 * - Query vuota → array vuoto
 * - URL proxati DDG decodificati correttamente (uddg)
 * - Limite maxResults
 * - Errore HTTP → isError + array vuoto
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock http-fetcher
vi.mock('../../src/core/http-fetcher.js', () => ({
  fetchUrl: vi.fn(),
}));

// Mock rate-limiter — class (non arrow function) per funzionare con `new`
vi.mock('../../src/core/rate-limiter.js', () => ({
  TokenBucket: class {
    async consume() {
      return true;
    }
  },
}));

import { handleSearch } from '../../src/tools/search.tool.js';
import { fetchUrl } from '../../src/core/http-fetcher.js';

/**
 * Genera HTML finto simile a quello di DDG Lite.
 * La struttura di DDG Lite è una <table> con righe contenenti
 * <a rel="nofollow" href="URL"> + snippet.
 */
function createMockDdgHtml(
  results: { title: string; href: string; snippet: string }[],
): string {
  const rows = results
    .map(
      (r) => `
    <tr>
      <td class="result-snippet">
        <a rel="nofollow" href="${r.href}">${r.title}</a>
        <span class="snippet">${r.snippet}</span>
      </td>
    </tr>`,
    )
    .join('\n');

  return `
<html>
<body>
  <form action="/lite/" method="GET">
    <input name="q" value="test" />
  </form>
  <table>
    <tr class="result-header">
      <th>Results</th>
    </tr>
${rows}
  </table>
</body>
</html>`;
}

describe('speculum_web_search', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('dovrebbe restituire risultati con URL valide per una query', async () => {
    // Arrange
    const mockHtml = createMockDdgHtml([
      {
        title: 'TypeScript: JavaScript With Syntax For Types',
        href: 'https://www.typescriptlang.org/',
        snippet: 'TypeScript extends JavaScript by adding types to the language.',
      },
      {
        title: 'GitHub: microsoft/TypeScript',
        href: 'https://github.com/microsoft/TypeScript',
        snippet:
          'TypeScript is a superset of JavaScript that compiles to clean JavaScript output.',
      },
    ]);

    vi.mocked(fetchUrl).mockResolvedValue({
      ok: true,
      status: 200,
      body: mockHtml,
      url: 'https://lite.duckduckgo.com/lite/?q=typescript',
    });

    // Act
    const result = await handleSearch({ query: 'typescript' });
    const data = JSON.parse(result.content[0].text);

    // Assert
    expect(result.isError).toBeUndefined();
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBe(2);

    expect(data[0].title).toBe('TypeScript: JavaScript With Syntax For Types');
    expect(data[0].url).toBe('https://www.typescriptlang.org/');
    expect(data[0].snippet).toBe(
      'TypeScript extends JavaScript by adding types to the language.',
    );
    expect(data[0].source).toBe('duckduckgo');
    expect(data[0].fetchedAt).toBeDefined();

    expect(data[1].title).toBe('GitHub: microsoft/TypeScript');
    expect(data[1].url).toBe('https://github.com/microsoft/TypeScript');
  });

  it('dovrebbe passare il parametro region (kl) nella URL di ricerca', async () => {
    // Arrange
    const mockHtml = createMockDdgHtml([
      {
        title: 'ANSA.it',
        href: 'https://www.ansa.it/',
        snippet: 'Agenzia ANSA: ultime notizie italiane e internazionali.',
      },
    ]);

    vi.mocked(fetchUrl).mockResolvedValue({
      ok: true,
      status: 200,
      body: mockHtml,
      url: 'https://lite.duckduckgo.com/lite/?q=notizie&kl=it-it',
    });

    // Act
    const result = await handleSearch({ query: 'notizie', region: 'it-it' });
    const data = JSON.parse(result.content[0].text);

    // Assert
    expect(result.isError).toBeUndefined();
    expect(data.length).toBeGreaterThan(0);
    // Verifica che la URL costruita contenga kl=it-it
    expect(vi.mocked(fetchUrl)).toHaveBeenCalledWith(
      expect.stringContaining('kl=it-it'),
      expect.anything(),
    );
  });

  it('dovrebbe restituire array vuoto per query vuota', async () => {
    // Act
    const result = await handleSearch({ query: '' });
    const data = JSON.parse(result.content[0].text);

    // Assert
    expect(result.isError).toBeUndefined();
    expect(data).toEqual([]);
    expect(vi.mocked(fetchUrl)).not.toHaveBeenCalled();
  });

  it('dovrebbe decodificare correttamente URL proxati da DDG (uddg parameter)', async () => {
    // Arrange — DDG avvolge gli URL esterni in redirect con parametro uddg
    const mockHtml = createMockDdgHtml([
      {
        title: 'Encoded Link Example',
        href:
          '//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fpath%3Ffoo%3Dbar%26baz%3Dqux&rut=abc123',
        snippet: 'This URL is proxied through DDG redirect.',
      },
      {
        title: 'Protocol-Relative Link',
        href: '//www.example.org/page',
        snippet: 'Protocol-relative URL without uddg.',
      },
    ]);

    vi.mocked(fetchUrl).mockResolvedValue({
      ok: true,
      status: 200,
      body: mockHtml,
      url: 'https://lite.duckduckgo.com/lite/?q=test',
    });

    // Act
    const result = await handleSearch({ query: 'test' });
    const data = JSON.parse(result.content[0].text);

    // Assert
    expect(result.isError).toBeUndefined();
    expect(data.length).toBe(2);

    // URL proxato con uddg deve essere decodificato
    expect(data[0].url).toBe('https://example.com/path?foo=bar&baz=qux');
    // URL protocollo-relativo deve essere reso assoluto con https:
    expect(data[1].url).toBe('https://www.example.org/page');
  });

  it('dovrebbe rispettare il limite maxResults', async () => {
    // Arrange — generiamo 5 risultati ma ne chiediamo solo 3
    const results = Array.from({ length: 5 }, (_, i) => ({
      title: `Result ${i + 1}`,
      href: `https://example.com/page${i + 1}`,
      snippet: `This is result number ${i + 1}.`,
    }));

    const mockHtml = createMockDdgHtml(results);

    vi.mocked(fetchUrl).mockResolvedValue({
      ok: true,
      status: 200,
      body: mockHtml,
      url: 'https://lite.duckduckgo.com/lite/?q=test',
    });

    // Act
    const result = await handleSearch({ query: 'test', maxResults: 3 });
    const data = JSON.parse(result.content[0].text);

    // Assert
    expect(data.length).toBe(3);
    expect(data[0].title).toBe('Result 1');
    expect(data[1].title).toBe('Result 2');
    expect(data[2].title).toBe('Result 3');
  });

  it('dovrebbe gestire errore HTTP con isError=true', async () => {
    // Arrange
    vi.mocked(fetchUrl).mockResolvedValue({
      ok: false,
      status: 503,
      body: '',
      url: 'https://lite.duckduckgo.com/lite/?q=error',
    });

    // Act
    const result = await handleSearch({ query: 'error' });
    const data = JSON.parse(result.content[0].text);

    // Assert
    expect(result.isError).toBe(true);
    expect(data).toEqual([]);
  });
});
