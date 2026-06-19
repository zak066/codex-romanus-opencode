/**
 * speculum-search — DuckDuckGo Instant Answer (Knowledge) Tool
 *
 * Endpoint: GET https://api.duckduckgo.com/?q={query}&format=json&no_html=1&skip_disambig=1
 *
 * La risposta JSON contiene un campo `Type`:
 *   - "A" = article — contiene Abstract, Heading, Entity, Infobox, Image
 *   - "D" = disambiguation — contiene solo RelatedTopics
 *   - ""  = vuoto — nessun risultato
 *
 * Utilizza http-fetcher per la richiesta HTTP, cache LRU con TTL 24 ore
 * e rate-limiter token bucket per evitare abusi.
 */

import { fetchUrl } from '../core/http-fetcher.js';
import { LRUCache } from '../core/cache.js';
import { TokenBucket } from '../core/rate-limiter.js';
import type { KnowledgeResult } from '../types.js';

// ─── Cache ─────────────────────────────────────────────────────
// TTL 24 ore = 86_400_000 ms, max 200 entry
const CACHE_TTL = 86_400_000;
const knowledgeCache = new LRUCache<KnowledgeResult>(200, CACHE_TTL);

// ─── Rate Limiter ──────────────────────────────────────────────
// 10 richieste al minuto per DDG Instant Answer API
const rateLimiter = new TokenBucket({
  maxTokens: 10,
  refillRate: 10,
  refillInterval: 60_000, // 1 minuto
});

// ─── DDG API Response Types ────────────────────────────────────

/** Singolo topic nel formato DDG */
interface DdgTopic {
  Text?: string;
  FirstURL?: string;
  Result?: string;
  Icon?: { URL?: string; Height?: number; Width?: number };
}

/** Categoria che racchiude un array di topics */
interface DdgCategory {
  Name?: string;
  Topics?: DdgTopic[];
}

/** Struttura della risposta DDG Instant Answer */
interface DdgInstantAnswer {
  Abstract?: string;
  AbstractText?: string;
  AbstractSource?: string;
  AbstractURL?: string;
  Answer?: string;
  AnswerType?: string;
  Definition?: string;
  DefinitionSource?: string;
  DefinitionURL?: string;
  Entity?: string;
  Heading?: string;
  Image?: string;
  ImageHeight?: number;
  ImageWidth?: number;
  Infobox?: Record<string, unknown>;
  Redirect?: string;
  RelatedTopics?: (DdgTopic | DdgCategory)[];
  Results?: DdgTopic[];
  Type?: string;
}

// ─── Helpers ───────────────────────────────────────────────────

/**
 * Determina se un oggetto DdgTopic ha la forma di una categoria
 * (contiene `Topics` annidati anziché `Text` diretto).
 */
function isCategory(topic: DdgTopic | DdgCategory): topic is DdgCategory {
  return 'Topics' in topic && Array.isArray((topic as DdgCategory).Topics);
}

/**
 * Estrae un topic flat (nome, url) da un oggetto DdgTopic.
 * Il campo `Text` contiene "nome — descrizione", estraiamo solo il nome.
 */
function extractTopic(
  topic: DdgTopic,
): { name: string; url: string } | null {
  const rawText = topic.Text ?? '';
  const rawUrl = topic.FirstURL ?? '';

  if (!rawText && !rawUrl) return null;

  // Il formato DDG è "Titolo — descrizione" nel campo Text
  const name = rawText.split(' — ')[0]?.trim() || rawText.trim();

  return { name, url: rawUrl };
}

/**
 * Appiattisce l'array RelatedTopics (che può contenere sia topic
 * flat che categorie con topics annidati) in una lista flat di
 * { name, url }.
 */
function flattenRelatedTopics(
  topics: (DdgTopic | DdgCategory)[] | undefined,
): { name: string; url: string }[] {
  if (!Array.isArray(topics)) return [];

  const result: { name: string; url: string }[] = [];

  for (const entry of topics) {
    if (isCategory(entry) && entry.Topics) {
      // Categoria con topics annidati
      for (const sub of entry.Topics) {
        const flat = extractTopic(sub);
        if (flat) result.push(flat);
      }
    } else if (!isCategory(entry)) {
      const flat = extractTopic(entry);
      if (flat) result.push(flat);
    }
  }

  return result;
}

// ─── Handler ───────────────────────────────────────────────────

/**
 * Esegue una richiesta Instant Answer a DuckDuckGo.
 *
 * @param params  Oggetto con `query` (stringa di ricerca)
 * @returns       MCP CallToolResult con JSON conforme a KnowledgeResult
 */
export async function handleKnowledge(params: {
  query: string;
}): Promise<{
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
          text: JSON.stringify({
            abstract: '',
            entity: '',
            heading: '',
          } satisfies KnowledgeResult),
        },
      ],
    };
  }

  const trimmedQuery = query.trim();
  const cacheKey = `knowledge:${trimmedQuery.toLowerCase()}`;

  // ── Cache check ────────────────────────────────────────────
  const cached = await knowledgeCache.get(cacheKey);
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
          text: JSON.stringify({
            abstract: '',
            entity: '',
            heading: '',
          } satisfies KnowledgeResult),
        },
      ],
      isError: true,
    };
  }

  // ── Richiesta HTTP ─────────────────────────────────────────
  const url =
    `https://api.duckduckgo.com/` +
    `?q=${encodeURIComponent(trimmedQuery)}` +
    `&format=json&no_html=1&skip_disambig=1`;

  try {
    const response = await fetchUrl(url, { timeout: 10_000 });

    if (!response.ok) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              abstract: '',
              entity: '',
              heading: '',
            } satisfies KnowledgeResult),
          },
        ],
        isError: true,
      };
    }

    // Parsing della risposta JSON
    const data: DdgInstantAnswer = JSON.parse(response.body);
    const answerType = data.Type ?? '';

    let result: KnowledgeResult;

    if (answerType === 'A' && data.Abstract) {
      // ── Type A: Article ──────────────────────────────────
      result = {
        abstract: data.Abstract ?? '',
        entity: data.Entity ?? '',
        heading: data.Heading ?? '',
        infobox: data.Infobox ?? undefined,
        image: data.Image ?? undefined,
        url: data.AbstractURL ?? undefined,
        relatedTopics:
          flattenRelatedTopics(data.RelatedTopics).length > 0
            ? flattenRelatedTopics(data.RelatedTopics)
            : undefined,
      };
    } else if (answerType === 'D') {
      // ── Type D: Disambiguation ───────────────────────────
      const topics = flattenRelatedTopics(data.RelatedTopics);
      result = {
        abstract: '',
        entity: data.Entity ?? '',
        heading: data.Heading ?? '',
        relatedTopics: topics.length > 0 ? topics : undefined,
      };
    } else {
      // ── Empty / No result ────────────────────────────────
      result = {
        abstract: '',
        entity: '',
        heading: '',
      };
    }

    // ── Aggiorna cache ───────────────────────────────────────
    await knowledgeCache.set(cacheKey, result);

    return {
      content: [{ type: 'text', text: JSON.stringify(result) }],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            abstract: '',
            entity: '',
            heading: '',
          } satisfies KnowledgeResult),
        },
      ],
      isError: true,
    };
  }
}
