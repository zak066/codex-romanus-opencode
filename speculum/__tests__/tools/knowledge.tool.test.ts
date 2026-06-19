/**
 * Test per speculum_knowledge (DuckDuckGo Instant Answer)
 *
 * Copre:
 * - Type A (Article) → Abstract, Entity, Infobox, Image, URL
 * - Type D (Disambiguation) → RelatedTopics
 * - Nessun risultato → campi vuoti
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock http-fetcher
vi.mock('../../src/core/http-fetcher.js', () => ({
  fetchUrl: vi.fn(),
}));

// Mock rate-limiter — usa class (non arrow function) per funzionare con `new`
vi.mock('../../src/core/rate-limiter.js', () => ({
  TokenBucket: class {
    async consume() {
      return true;
    }
  },
}));

import { handleKnowledge } from '../../src/tools/knowledge.tool.js';
import { fetchUrl } from '../../src/core/http-fetcher.js';

describe('speculum_knowledge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('dovrebbe restituire Abstract, Entity e Infobox per Type A (article)', async () => {
    // Arrange
    const ddgResponse = {
      Type: 'A',
      Abstract:
        'TypeScript is a free and open-source high-level programming language developed by Microsoft.',
      AbstractText: 'TypeScript is a free and open-source high-level programming language.',
      AbstractSource: 'Wikipedia',
      AbstractURL: 'https://en.wikipedia.org/wiki/TypeScript',
      Entity: 'TypeScript',
      Heading: 'TypeScript',
      Image:
        'https://upload.wikimedia.org/wikipedia/commons/thumb/4/4c/Typescript_logo_2020.svg/1200px-Typescript_logo_2020.svg.png',
      Infobox: {
        paradigm: 'Multi-paradigm: functional, generic, imperative, object-oriented',
        designed_by: 'Microsoft',
        first_appeared: '2012',
      },
      RelatedTopics: [
        {
          Text: 'JavaScript — High-level programming language',
          FirstURL: 'https://en.wikipedia.org/wiki/JavaScript',
        },
      ],
    };

    vi.mocked(fetchUrl).mockResolvedValue({
      ok: true,
      status: 200,
      body: JSON.stringify(ddgResponse),
      url: 'https://api.duckduckgo.com/?q=TypeScript&format=json&no_html=1&skip_disambig=1',
    });

    // Act
    const result = await handleKnowledge({ query: 'TypeScript' });
    const data = JSON.parse(result.content[0].text);

    // Assert
    expect(result.isError).toBeUndefined();
    expect(data.abstract).toBe(ddgResponse.Abstract);
    expect(data.entity).toBe('TypeScript');
    expect(data.heading).toBe('TypeScript');
    expect(data.infobox).toEqual(ddgResponse.Infobox);
    expect(data.image).toBe(ddgResponse.Image);
    expect(data.url).toBe(ddgResponse.AbstractURL);
    expect(data.relatedTopics).toBeDefined();
    expect(data.relatedTopics!.length).toBe(1);
    expect(data.relatedTopics![0].name).toBe('JavaScript');
  });

  it('dovrebbe restituire RelatedTopics per Type D (disambiguation)', async () => {
    // Arrange
    const ddgResponse = {
      Type: 'D',
      Entity: 'Python',
      Heading: 'Python',
      RelatedTopics: [
        {
          Name: 'Programming',
          Topics: [
            {
              Text: 'Python (programming language) — Interpreted high-level programming language',
              FirstURL: 'https://en.wikipedia.org/wiki/Python_(programming_language)',
            },
          ],
        },
        {
          Name: 'Mythology',
          Topics: [
            {
              Text: 'Python (mythology) — Serpent in Greek mythology',
              FirstURL: 'https://en.wikipedia.org/wiki/Python_(mythology)',
            },
          ],
        },
        {
          Text: 'Python (Monty Pythons) — British comedy group',
          FirstURL: 'https://en.wikipedia.org/wiki/Monty_Python',
        },
      ],
    };

    vi.mocked(fetchUrl).mockResolvedValue({
      ok: true,
      status: 200,
      body: JSON.stringify(ddgResponse),
      url: 'https://api.duckduckgo.com/?q=Python&format=json&no_html=1&skip_disambig=1',
    });

    // Act
    const result = await handleKnowledge({ query: 'Python' });
    const data = JSON.parse(result.content[0].text);

    // Assert
    expect(result.isError).toBeUndefined();
    expect(data.abstract).toBe('');
    expect(data.relatedTopics).toBeDefined();
    expect(data.relatedTopics!.length).toBe(3);
    // Deve appiattire sia i topic flat che quelli annidati in categorie
    const names = data.relatedTopics!.map((t: { name: string }) => t.name);
    expect(names).toContain('Python (programming language)');
    expect(names).toContain('Python (mythology)');
    expect(names).toContain('Python (Monty Pythons)');
  });

  it('dovrebbe restituire campi vuoti per query senza risultati', async () => {
    // Arrange
    const ddgResponse = {
      Type: '',
      Abstract: '',
      AbstractText: '',
      Entity: '',
      Heading: '',
      RelatedTopics: [],
    };

    vi.mocked(fetchUrl).mockResolvedValue({
      ok: true,
      status: 200,
      body: JSON.stringify(ddgResponse),
      url: 'https://api.duckduckgo.com/?q=asdfgh12345nonexistent&format=json&no_html=1&skip_disambig=1',
    });

    // Act
    const result = await handleKnowledge({ query: 'asdfgh12345nonexistent' });
    const data = JSON.parse(result.content[0].text);

    // Assert
    expect(result.isError).toBeUndefined();
    expect(data.abstract).toBe('');
    expect(data.entity).toBe('');
    expect(data.heading).toBe('');
    expect(data.infobox).toBeUndefined();
    expect(data.image).toBeUndefined();
    expect(data.url).toBeUndefined();
    expect(data.relatedTopics).toBeUndefined();
  });
});
