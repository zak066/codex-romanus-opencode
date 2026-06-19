/**
 * speculum-search — DuckDuckGo Autocomplete (Suggest) Tool
 *
 * Endpoint: GET https://duckduckgo.com/ac/?q={query}&type=list
 * Risposta: ["query", ["sugg1", "sugg2", ...]]
 *
 * Utilizza http-fetcher per la richiesta HTTP e cache LRU con TTL 1 ora.
 */

import { fetchUrl } from '../core/http-fetcher.js';
import { LRUCache } from '../core/cache.js';
import type { SuggestResult } from '../types.js';

// ─── Cache ─────────────────────────────────────────────────────
// TTL 1 ora = 3_600_000 ms, max 100 entry
const CACHE_TTL = 3_600_000;
const suggestCache = new LRUCache<SuggestResult>(100, CACHE_TTL);

// ─── Handler ───────────────────────────────────────────────────

/**
 * Esegue una richiesta di autocomplete a DuckDuckGo.
 *
 * @param params  Oggetto con `query` (stringa di ricerca)
 * @returns       MCP CallToolResult con JSON contenente query e suggestions
 */
export async function handleSuggest(params: { query: string }): Promise<{
  content: { type: 'text'; text: string }[];
  isError?: boolean;
}> {
  const { query } = params;

  // ── Validazione ────────────────────────────────────────────
  if (!query || typeof query !== 'string' || query.trim().length === 0) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ query: '', suggestions: [] } satisfies SuggestResult),
        },
      ],
    };
  }

  const trimmedQuery = query.trim();
  const cacheKey = `suggest:${trimmedQuery.toLowerCase()}`;

  // ── Cache check ────────────────────────────────────────────
  const cached = await suggestCache.get(cacheKey);
  if (cached) {
    return {
      content: [{ type: 'text', text: JSON.stringify(cached) }],
    };
  }

  // ── Richiesta HTTP ─────────────────────────────────────────
  const url = `https://duckduckgo.com/ac/?q=${encodeURIComponent(trimmedQuery)}&type=list`;

  try {
    const response = await fetchUrl(url, { timeout: 5_000 });

    if (!response.ok) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              query: trimmedQuery,
              suggestions: [],
            } satisfies SuggestResult),
          },
        ],
        isError: true,
      };
    }

    // La risposta DDG è un array JSON: ["query", ["sugg1","sugg2",...]]
    const data: [string, string[]] = JSON.parse(response.body);

    const result: SuggestResult = {
      query: data[0],
      suggestions: Array.isArray(data[1]) ? data[1] : [],
    };

    // ── Aggiorna cache ───────────────────────────────────────
    await suggestCache.set(cacheKey, result);

    return {
      content: [{ type: 'text', text: JSON.stringify(result) }],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            query: trimmedQuery,
            suggestions: [],
          } satisfies SuggestResult),
        },
      ],
      isError: true,
    };
  }
}
