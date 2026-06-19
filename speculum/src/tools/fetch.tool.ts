/**
 * speculum-search — Web Fetch & Readability Extraction Tool
 *
 * Esegue una richiesta HTTP GET a un URL e opzionalmente estrae
 * il contenuto pulito con @mozilla/readability + JSDOM.
 *
 * Utilizza:
 * - http-fetcher per la richiesta HTTP con timeout e retry
 * - Cache LRU con TTL 1 ora
 * - Readability per estrarre title, content, excerpt dall'HTML
 *
 * @module tools/fetch
 */

import { fetchUrl } from '../core/http-fetcher.js';
import { LRUCache } from '../core/cache.js';
import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import type { FetchResult } from '../types.js';

// ─── Cache ─────────────────────────────────────────────────────
// TTL 1 ora = 3_600_000 ms, max 200 entry
const CACHE_TTL = 3_600_000;
const fetchCache = new LRUCache<FetchResult>(200, CACHE_TTL);

// ─── URL Validation ────────────────────────────────────────────

/**
 * Verifica che una stringa sia un URL valido con protocollo HTTP/HTTPS.
 *
 * @param url  URL da validare
 * @returns    `true` se l'URL è valido e usa http/https
 */
function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

// ─── Readability Extraction ────────────────────────────────────

/**
 * Estrae il contenuto pulito da un HTML usando Readability + JSDOM.
 *
 * @param html      HTML raw della pagina
 * @param pageUrl   URL della pagina (per risolvere path relativi)
 * @returns         Oggetto con title, content, excerpt oppure null se fallisce
 */
function extractContent(
  html: string,
  pageUrl: string,
): { title: string; content: string; excerpt: string } | null {
  try {
    const dom = new JSDOM(html, { url: pageUrl });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();

    if (!article) {
      return null;
    }

    return {
      title: article.title || '',
      content: article.textContent || '',
      excerpt: article.excerpt || '',
    };
  } catch (error) {
    // Logga ma non blocca — lanciamo errore al chiamante
    console.error(`[fetch.tool] Readability parse error for ${pageUrl}:`, error);
    return null;
  }
}

// ─── Handler ───────────────────────────────────────────────────

/**
 * Esegue una richiesta HTTP GET a un URL e (opzionalmente) estrae
 * il contenuto usando Readability.
 *
 * @param params  Oggetto con `url` (URL da fetchare) e `extract?` (default true)
 * @returns       MCP CallToolResult con JSON conforme a FetchResult
 */
export async function handleFetch(params: {
  url: string;
  extract?: boolean;
}): Promise<{
  content: { type: 'text'; text: string }[];
  isError?: boolean;
}> {
  const { url, extract = true } = params;

  // ── Validazione URL ─────────────────────────────────────────
  if (!url || typeof url !== 'string' || url.trim().length === 0) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            title: '',
            url: '',
            content: 'Error: URL is required',
          } satisfies FetchResult),
        },
      ],
      isError: true,
    };
  }

  const trimmedUrl = url.trim();

  if (!isValidUrl(trimmedUrl)) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            title: '',
            url: trimmedUrl,
            content: `Error: Invalid URL — "${trimmedUrl}". Only HTTP and HTTPS URLs are supported.`,
          } satisfies FetchResult),
        },
      ],
      isError: true,
    };
  }

  const cacheKey = `fetch:${trimmedUrl}:extract=${extract}`;

  // ── Cache check ────────────────────────────────────────────
  try {
    const cached = await fetchCache.get(cacheKey);
    if (cached) {
      return {
        content: [{ type: 'text', text: JSON.stringify(cached) }],
      };
    }
  } catch {
    // Se la cache fallisce, continuiamo con fetch diretto
    console.error('[fetch.tool] Cache read error, proceeding with fetch');
  }

  // ── Richiesta HTTP ─────────────────────────────────────────
  try {
    const response = await fetchUrl(trimmedUrl, {
      timeout: 15_000,       // 15 secondi per pagine lente
      retries: 1,            // 2 tentativi totali
      maxSize: 512_000,      // 500 KB per pagine più grandi
    });

    if (!response.ok) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              title: '',
              url: trimmedUrl,
              content: `Error: HTTP ${response.status} ${response.status >= 500 ? 'Server error' : response.status >= 400 ? 'Client error' : ''}`,
            } satisfies FetchResult),
          },
        ],
        isError: true,
      };
    }

    const html = response.body;
    const finalUrl = response.url; // Potrebbe essere cambiato dopo redirect

    let result: FetchResult;

    if (extract) {
      // ── Estrazione con Readability ─────────────────────────
      const extracted = extractContent(html, finalUrl);

      if (extracted) {
        result = {
          title: extracted.title,
          url: finalUrl,
          content: extracted.content,
          excerpt: extracted.excerpt,
        };
      } else {
        // Fallback: se Readability fallisce, restituisci l'HTML raw
        // ma accorciato a 100KB per non intasare la risposta
        const truncatedContent = html.length > 102_400
          ? html.slice(0, 102_400) + '\n\n[Content truncated — Readability failed to parse]'
          : html;

        result = {
          title: '',
          url: finalUrl,
          content: truncatedContent,
          excerpt: 'Readability could not parse this page. Showing raw HTML (truncated).',
        };
      }
    } else {
      // ── HTML raw ───────────────────────────────────────────
      // Tronca a 500KB per sicurezza
      const truncatedContent = html.length > 512_000
        ? html.slice(0, 512_000) + '\n\n[Content truncated to 500KB]'
        : html;

      // Tentativo di estrarre un title dall'HTML anche senza Readability
      let title = '';
      try {
        const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
        if (titleMatch && titleMatch[1]) {
          title = titleMatch[1].trim();
        }
      } catch {
        // Ignora — title rimane vuoto
      }

      result = {
        title,
        url: finalUrl,
        content: truncatedContent,
      };
    }

    // ── Aggiorna cache ───────────────────────────────────────
    try {
      await fetchCache.set(cacheKey, result);
    } catch {
      // Cache write failure non è bloccante
      console.error('[fetch.tool] Cache write error, response sent anyway');
    }

    return {
      content: [{ type: 'text', text: JSON.stringify(result) }],
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            title: '',
            url: trimmedUrl,
            content: `Error fetching URL: ${errorMessage}`,
          } satisfies FetchResult),
        },
      ],
      isError: true,
    };
  }
}
