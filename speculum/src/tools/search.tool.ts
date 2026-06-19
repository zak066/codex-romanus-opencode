/**
 * speculum-search — DuckDuckGo Lite HTML Search Tool (ULTIMO)
 *
 * Endpoint: GET https://lite.duckduckgo.com/lite/?q={query}&kl={region}&df={timeRange}
 *
 * Esegue ricerca web su DuckDuckGo tramite la versione Lite (HTML).
 * Usa cheerio per il parsing della tabella risultati.
 *
 * CARATTERISTICHE:
 * - Cache: 5 min TTL (300.000 ms), max 100 entry
 * - Rate-limiter: 20 req/min (TokenBucket)
 * - User-Agent: browser reale (Mozilla/5.0 Windows Chrome)
 * - Max risultati: 20
 * - Supporto region (kl) e timeRange (df: d/w/m/y)
 * - Decodifica URL proxati DDG (uddg parameter)
 *
 * @module tools/search
 */

import { fetchUrl } from '../core/http-fetcher.js';
import { LRUCache } from '../core/cache.js';
import { TokenBucket } from '../core/rate-limiter.js';
import * as cheerio from 'cheerio';
import type { SearchResult } from '../types.js';

// ─── Cache ─────────────────────────────────────────────────────
// TTL 5 min = 300_000 ms, max 100 entry (risultati di ricerca
// cambiano velocemente — meglio non cacheare troppo a lungo)
const CACHE_TTL = 300_000;
const searchCache = new LRUCache<SearchResult[]>(100, CACHE_TTL);

// ─── Rate Limiter ──────────────────────────────────────────────
// 20 richieste al minuto — DDG Lite non ha API key ma è bene
// non abusare della versione HTML gratuita
const rateLimiter = new TokenBucket({
  maxTokens: 20,
  refillRate: 20,
  refillInterval: 60_000, // 1 minuto
});

// ─── Costanti ──────────────────────────────────────────────────
const DDG_LITE_URL = 'https://lite.duckduckgo.com/lite/';
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const MAX_RESULTS_LIMIT = 20;
const SNIPPET_MAX_LENGTH = 500;

// ─── Helpers ───────────────────────────────────────────────────

/**
 * Decodifica un URL proxato da DuckDuckGo.
 *
 * DDG avvolge gli URL esterni in redirect URL del tipo:
 *   //duckduckgo.com/l/?uddg=URL_ENCODED&rut=...
 *
 * `uddg` contiene l'URL originale URL-encoded (NON base64).
 * `url.searchParams.get()` già decodifica la percent-encoding,
 * quindi restituiamo il valore così com'è.
 * Se l'URL non è proxato, lo restituisce così com'è (con https:
 * se protocollo-relativo).
 *
 * @param href - Attributo href dal tag <a>
 * @returns URL decodificato e assoluto
 */
function decodeDdgUrl(href: string): string {
  if (!href) return '';

  // DDG spesso usa URL protocollo-relativi: //duckduckgo.com/l/?uddg=...
  // o anche //www.example.com
  let urlStr = href.startsWith('//') ? `https:${href}` : href;

  try {
    const url = new URL(urlStr);

    // Verifica se è un redirect DDG con parametro uddg
    if (
      url.hostname.includes('duckduckgo.com') &&
      url.searchParams.has('uddg')
    ) {
      const uddgValue = url.searchParams.get('uddg') || '';
      if (uddgValue) {
        // uddg è URL-encoded — searchParams.get() ha già decodificato
        // la percent-encoding. Non è base64, restituiamo direttamente.
        return uddgValue;
      }
    }

    return urlStr;
  } catch {
    // Non parsabile come URL — restituisci l'originale
    return urlStr;
  }
}

/**
 * Pulisce uno snippet: rimuove tag HTML, normalizza whitespace,
 * tronca a SNIPPET_MAX_LENGTH caratteri.
 */
function cleanSnippet(text: string): string {
  return text
    .replace(/<[^>]*>/g, '') // rimuovi eventuali tag HTML residui
    .replace(/\s+/g, ' ') // normalizza spazi bianchi
    .replace(/^[\s\-·•]+/, '') // rimuovi separatori iniziali
    .trim();
}

/**
 * Tronca uno snippet se supera la lunghezza massima,
 * aggiungendo "..." se necessario.
 */
function truncateSnippet(snippet: string): string {
  if (snippet.length <= SNIPPET_MAX_LENGTH) return snippet;
  return snippet.slice(0, SNIPPET_MAX_LENGTH - 3) + '...';
}

/**
 * Costruisce l'URL per la richiesta a DDG Lite con i parametri
 * di query, regione e time range.
 *
 * @param query     - Testo della ricerca
 * @param region    - Parametro kl (es. "it-it", "us-en")
 * @param timeRange - Parametro df ("d"=giorno, "w"=settimana, "m"=mese, "y"=anno)
 * @returns URL completo per la richiesta GET
 */
function buildSearchUrl(
  query: string,
  region?: string,
  timeRange?: string,
): string {
  const params = new URLSearchParams();
  params.set('q', query);

  if (region) params.set('kl', region);
  if (timeRange) params.set('df', timeRange);

  return `${DDG_LITE_URL}?${params.toString()}`;
}

// ─── Parser HTML ───────────────────────────────────────────────

/**
 * Analizza il HTML restituito da DDG Lite per estrarre i risultati
 * di ricerca.
 *
 * La struttura HTML di DDG Lite è una tabella semplice:
 * ```html
 * <table>
 *   <tr>
 *     <td class="result-snippet">
 *       <a rel="nofollow" href="URL">Titolo</a>
 *       <span class="snippet">Descrizione...</span>
 *     </td>
 *   </tr>
 *   ...
 * </table>
 * ```
 *
 * Due strategie di parsing:
 * 1. Primaria: cerca nella prima <table> le righe con <a rel="nofollow">
 * 2. Fallback: cerca globalmente tutti i link rel="nofollow"
 *
 * @param html       - HTML grezzo della pagina DDG Lite
 * @param maxResults - Numero massimo di risultati da estrarre
 * @returns Array di SearchResult
 */
function parseSearchResults(html: string, maxResults: number): SearchResult[] {
  const $ = cheerio.load(html);
  const results: SearchResult[] = [];
  const fetchedAt = new Date().toISOString();

  // ── Strategia 1: Parsing tabellare ──────────────────────────
  // La pagina DDG Lite ha una <table> che contiene i risultati.
  // Ogni riga <tr> ha un <td> contenente link + snippet.
  const $table = $('table').first();

  if ($table.length > 0) {
    $table.find('tr').each((_rowIdx, row) => {
      if (results.length >= maxResults) return false; // break

      const $row = $(row);
      const $link = $row.find('a[rel="nofollow"]').first();

      if ($link.length === 0) return; // skip righe senza link risultato

      const title = $link.text().trim();
      const rawUrl = $link.attr('href') || '';

      if (!title || !rawUrl) return;

      const url = decodeDdgUrl(rawUrl);

      // Estrai snippet: tutto il testo del td/genitore escludendo il link
      const $td = $row.is('td') ? $row : $row.find('td').first();
      const fullText = $td.text().trim();
      let snippet = fullText;

      // Rimuovi il titolo dallo snippet (è contenuto nel link)
      if (title && snippet.startsWith(title)) {
        snippet = snippet.slice(title.length).trim();
      } else {
        // Cerca e rimuovi il titolo ovunque nello snippet
        const titleIdx = snippet.indexOf(title);
        if (titleIdx >= 0) {
          snippet =
            snippet.slice(0, titleIdx) +
            snippet.slice(titleIdx + title.length);
        }
      }

      snippet = truncateSnippet(cleanSnippet(snippet));

      results.push({
        title,
        url,
        snippet,
        source: 'duckduckgo',
        fetchedAt,
      });
    });
  }

  // ── Strategia 2: Fallback globale ───────────────────────────
  // Se la strategia tabellare non ha prodotto risultati, cerca
  // qualsiasi link rel="nofollow" nella pagina (struttura alternativa).
  if (results.length === 0) {
    $('a[rel="nofollow"]').each((_linkIdx, link) => {
      if (results.length >= maxResults) return false; // break

      const $link = $(link);
      const title = $link.text().trim();
      const rawUrl = $link.attr('href') || '';

      if (!title || !rawUrl) return;

      // Evita duplicati (controllo su URL normalizzato)
      const url = decodeDdgUrl(rawUrl);
      const isDuplicate = results.some((r) => r.url === url);
      if (isDuplicate) return;

      // Snippet dal testo del genitore escludendo il link
      const $parent = $link.parent();
      const parentText = $parent.text().trim();
      let snippet = parentText.replace(title, '').trim();

      snippet = truncateSnippet(cleanSnippet(snippet));

      results.push({
        title,
        url,
        snippet,
        source: 'duckduckgo',
        fetchedAt,
      });
    });
  }

  return results.slice(0, maxResults);
}

// ─── Handler ───────────────────────────────────────────────────

/**
 * Esegue una ricerca web su DuckDuckGo tramite la versione Lite HTML.
 *
 * Flusso:
 * 1. Validazione parametri (query obbligatoria, maxResults normalizzato)
 * 2. Cache check (TTL 5 min)
 * 3. Rate limiter (20 req/min)
 * 4. Richiesta HTTP GET a DDG Lite
 * 5. Parsing HTML con cheerio
 * 6. Cache update
 * 7. Restituzione risultati come JSON
 *
 * @param params - Parametri della ricerca
 * @param params.query      - Testo da cercare (obbligatorio)
 * @param params.maxResults - Risultati massimi (default 10, max 20)
 * @param params.region     - Regione/lingua (parametro kl, es. "it-it", "us-en")
 * @param params.timeRange  - Filtro temporale ("d"=giorno, "w"=settimana, "m"=mese, "y"=anno)
 * @returns MCP CallToolResult con JSON array di SearchResult
 */
export async function handleSearch(params: {
  query: string;
  maxResults?: number;
  region?: string;
  timeRange?: 'd' | 'w' | 'm' | 'y';
}): Promise<{
  content: { type: 'text'; text: string }[];
  isError?: boolean;
}> {
  const { query, region, timeRange } = params;
  let { maxResults = 10 } = params;

  // ── Validazione ────────────────────────────────────────────
  if (!query || typeof query !== 'string' || query.trim().length === 0) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify([] satisfies SearchResult[]),
        },
      ],
    };
  }

  // Normalizza maxResults: clamp tra 1 e MAX_RESULTS_LIMIT
  maxResults = Math.max(1, Math.min(MAX_RESULTS_LIMIT, maxResults ?? 10));

  const trimmedQuery = query.trim();

  // Chiave cache include tutti i parametri per evitare collisioni
  const cacheKey = [
    'search',
    trimmedQuery.toLowerCase(),
    region ?? '',
    timeRange ?? '',
    String(maxResults),
  ].join(':');

  // ── Cache check ────────────────────────────────────────────
  const cached = await searchCache.get(cacheKey);
  if (cached) {
    return {
      content: [{ type: 'text', text: JSON.stringify(cached) }],
    };
  }

  // ── Rate limiter ───────────────────────────────────────────
  try {
    await rateLimiter.consume(1);
  } catch {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify([] satisfies SearchResult[]),
        },
      ],
      isError: true,
    };
  }

  // ── Richiesta HTTP ─────────────────────────────────────────
  const url = buildSearchUrl(trimmedQuery, region, timeRange);

  try {
    const response = await fetchUrl(url, {
      timeout: 10_000,
      userAgent: USER_AGENT,
      headers: {
        'Accept-Language': 'en-US,en;q=0.9,it;q=0.8',
      },
    });

    if (!response.ok) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify([] satisfies SearchResult[]),
          },
        ],
        isError: true,
      };
    }

    // ── Parsing HTML con cheerio ─────────────────────────────
    const results = parseSearchResults(response.body, maxResults);

    // ── Aggiorna cache ───────────────────────────────────────
    await searchCache.set(cacheKey, results);

    return {
      content: [{ type: 'text', text: JSON.stringify(results) }],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify([] satisfies SearchResult[]),
        },
      ],
      isError: true,
    };
  }
}
