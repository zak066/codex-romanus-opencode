// ============================================================
// Praetorium — Advisory: Scraping + mapping dinamico dei modelli Go
// ============================================================
//
// Consolida scraping e matching in un unico file snello.
// Fetcha la lista modelli dinamicamente da GET https://opencode.ai/zen/go/v1/models
// e per ogni modello fetcha la pagina dedicata su Artificial Analysis
// con parsing a 3 livelli:
//   1. JSON-LD (tag <script type="application/ld+json">)
//   2. Regex su HTML (pattern JSON embedded)
//   3. Default (valori noti o generati, quando tutto fallisce)
// ============================================================

import type { LeaderboardModel, MatchedModel } from './types';

// ============================================================
// Costanti
// ============================================================

const AA_BASE_URL = 'https://artificialanalysis.ai/models';
const USER_AGENT = 'Praetorium-Advisory/1.0';
const CONCURRENCY = 3;
const TIMEOUT_MS = 15_000;
const ZEN_GO_API = 'https://opencode.ai/zen/go/v1/models';
const FETCH_TIMEOUT_MS = 10_000;

// ============================================================
// Tipi
// ============================================================

/** LeaderboardModel con slug AA generato dall'ID opencode */
export interface ScrapedModel extends LeaderboardModel {
  slug: string;
}

// ============================================================
// FALLBACK_MODELS — usati solo quando l'API non risponde
// ============================================================

const FALLBACK_MODELS: { id: string; slug: string }[] = [
  { id: 'deepseek-v4-pro', slug: 'deepseek-v4-pro' },
  { id: 'deepseek-v4-flash', slug: 'deepseek-v4-flash' },
  { id: 'glm-5', slug: 'glm-5' },
  { id: 'glm-5.1', slug: 'glm-5-1' },
  { id: 'hy3-preview', slug: 'hy3' },
  { id: 'kimi-k2.5', slug: 'kimi-k2-5' },
  { id: 'kimi-k2.6', slug: 'kimi-k2-6' },
  { id: 'minimax-m2.5', slug: 'minimax-m2-5' },
  { id: 'minimax-m2.7', slug: 'minimax-m2-7' },
  { id: 'mimo-v2-omni', slug: 'mimo-v2-omni' },
  { id: 'mimo-v2-pro', slug: 'mimo-v2-pro' },
  { id: 'mimo-v2.5', slug: 'mimo-v2-5-0424' },
  { id: 'mimo-v2.5-pro', slug: 'mimo-v2-5-pro' },
  { id: 'qwen3.5-plus', slug: 'qwen3-5-plus' },
  { id: 'qwen3.6-plus', slug: 'qwen3-6-plus' },
];

// ============================================================
// CREATOR_MAP — sovrascrittura creator per modelli noti
// ============================================================

/** Sovrascrittura creator per modelli dove AA non lo indica nei meta */
const CREATOR_MAP: Record<string, string> = {
  'DeepSeek V4 Pro (Max)': 'DeepSeek',
  'DeepSeek V4 Pro': 'DeepSeek',
  'DeepSeek V4 Flash (Max)': 'DeepSeek',
  'DeepSeek V4 Flash': 'DeepSeek',
  'GLM 5': 'Zhipu',
  'GLM 5.1': 'Zhipu',
  'Hy3-preview': 'Haiper',
  'Hy3 Preview': 'Haiper',
  'Kimi K2.5': 'Moonshot',
  'Kimi K2.6': 'Moonshot',
  'MiniMax M2.5': 'MiniMax',
  'MiniMax M2.7': 'MiniMax',
  'MiMo-V2-Pro': 'Xiaomi',
  'MiMo-V2-Omni': 'Xiaomi',
  'MiMo-V2.5-Pro': 'Xiaomi',
  'MiMo-V2.5': 'Xiaomi',
  'MiMo V2.5': 'Xiaomi',
  'Qwen 3.5 Plus': 'Alibaba',
  'Qwen 3.6 Plus': 'Alibaba',
};

// ============================================================
// DEFAULT_VALUES — fallback Livello 3 per modelli conosciuti
// ============================================================

/**
 * Valori di default per i 15 modelli Go conosciuti.
 * Usati come fallback Livello 3 quando JSON-LD e regex falliscono.
 */
const DEFAULT_VALUES: Record<string, Partial<LeaderboardModel>> = {
  'deepseek-v4-pro': {
    name: 'DeepSeek V4 Pro (Max)', creator: 'DeepSeek',
    intelligence: 55, price: 0.18, speed: 80,
    latency: 2.0, totalResponseTime: 10, contextWindow: 128000,
  },
  'deepseek-v4-flash': {
    name: 'DeepSeek V4 Flash (Max)', creator: 'DeepSeek',
    intelligence: 42, price: 0.02, speed: 180,
    latency: 0.5, totalResponseTime: 3, contextWindow: 128000,
  },
  'glm-5': {
    name: 'GLM 5', creator: 'Zhipu',
    intelligence: 38, price: 0.04, speed: 70,
    latency: 1.5, totalResponseTime: 8, contextWindow: 128000,
  },
  'glm-5-1': {
    name: 'GLM 5.1', creator: 'Zhipu',
    intelligence: 45, price: 0.05, speed: 65,
    latency: 1.3, totalResponseTime: 7, contextWindow: 128000,
  },
  'hy3': {
    name: 'Hy3 Preview', creator: 'Haiper',
    intelligence: 25, price: 0.01, speed: 200,
    latency: 0.3, totalResponseTime: 2, contextWindow: 32000,
  },
  'kimi-k2-5': {
    name: 'Kimi K2.5', creator: 'Moonshot',
    intelligence: 48, price: 0.06, speed: 75,
    latency: 1.2, totalResponseTime: 6, contextWindow: 128000,
  },
  'kimi-k2-6': {
    name: 'Kimi K2.6', creator: 'Moonshot',
    intelligence: 52, price: 0.08, speed: 70,
    latency: 1.0, totalResponseTime: 6, contextWindow: 128000,
  },
  'minimax-m2-5': {
    name: 'MiniMax M2.5', creator: 'MiniMax',
    intelligence: 35, price: 0.03, speed: 90,
    latency: 0.8, totalResponseTime: 5, contextWindow: 128000,
  },
  'minimax-m2-7': {
    name: 'MiniMax M2.7', creator: 'MiniMax',
    intelligence: 50, price: 0.07, speed: 85,
    latency: 0.9, totalResponseTime: 5, contextWindow: 128000,
  },
  'mimo-v2-pro': {
    name: 'MiMo-V2-Pro', creator: 'Xiaomi',
    intelligence: 35, price: 0.05, speed: 60,
    latency: 1.2, totalResponseTime: 7, contextWindow: 32000,
  },
  'mimo-v2-omni': {
    name: 'MiMo-V2-Omni', creator: 'Xiaomi',
    intelligence: 30, price: 0.08, speed: 50,
    latency: 1.5, totalResponseTime: 8, contextWindow: 32000,
  },
  'mimo-v2-5-pro': {
    name: 'MiMo V2.5 Pro', creator: 'Xiaomi',
    intelligence: 40, price: 0.06, speed: 65,
    latency: 1.0, totalResponseTime: 6, contextWindow: 128000,
  },
  'mimo-v2-5-0424': {
    name: 'MiMo-V2.5', creator: 'Xiaomi',
    intelligence: 32, price: 0.03, speed: 90,
    latency: 0.8, totalResponseTime: 5, contextWindow: 128000,
  },
  'qwen3-5-plus': {
    name: 'Qwen 3.5 Plus', creator: 'Alibaba',
    intelligence: 44, price: 0.04, speed: 95,
    latency: 0.7, totalResponseTime: 4, contextWindow: 128000,
  },
  'qwen3-6-plus': {
    name: 'Qwen 3.6 Plus', creator: 'Alibaba',
    intelligence: 50, price: 0.06, speed: 90,
    latency: 0.6, totalResponseTime: 4, contextWindow: 128000,
  },
};

// ============================================================
// Funzioni esportate
// ============================================================

/**
 * Fetcha i dati dei modelli Go da Artificial Analysis.
 * Ottiene la lista modelli dinamicamente dall'API opencode,
 * poi visita ogni pagina modello con concurrency limit (3),
 * timeout 15s, e parsing a 3 livelli.
 */
export async function fetchGoModels(): Promise<ScrapedModel[]> {
  const modelEntries = await fetchGoModelIds();
  const results: ScrapedModel[] = [];

  for (let i = 0; i < modelEntries.length; i += CONCURRENCY) {
    const batch = modelEntries.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map((entry) =>
        scrapeModel(entry.slug).then((m) =>
          m ? { ...m, slug: entry.slug } : null,
        ),
      ),
    );
    for (const r of batchResults) {
      if (r) results.push(r);
    }
  }

  console.log(
    `[Praetorium] fetchGoModels: ${results.length}/${modelEntries.length} modelli estratti (API: ${modelEntries.length} modelli)`,
  );
  return results;
}

/**
 * Converte un array di ScrapedModel in MatchedModel
 * applicando il mapping opencode (opencodeId, provider, hasReasoning).
 */
export function toMatchedModels(models: ScrapedModel[]): MatchedModel[] {
  return models.map((m) => {
    const { opencodeId, provider } = opencodeIdFromSlug(m.slug);
    return {
      ...m,
      opencodeId,
      provider,
      hasReasoning: hasReasoning(m.slug),
    };
  });
}

// ============================================================
// Fetch API modelli Go
// ============================================================

/**
 * Fetcha la lista dei modelli Go dall'API opencode.
 * In caso di errore o risposta vuota, usa FALLBACK_MODELS.
 */
async function fetchGoModelIds(): Promise<{ id: string; slug: string }[]> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const response = await fetch(ZEN_GO_API, {
      headers: { 'User-Agent': USER_AGENT },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      console.warn(
        `[Praetorium] API Go models returned ${response.status}, usando fallback conosciuti`,
      );
      return FALLBACK_MODELS;
    }

    const json = await response.json();
    const models: { id: string }[] = json?.data || [];

    if (models.length === 0) {
      console.warn('[Praetorium] API Go models: lista vuota, usando fallback');
      return FALLBACK_MODELS;
    }

    return models.map((m) => ({
      id: m.id,
      slug: slugFromId(m.id),
    }));
  } catch (err) {
    console.warn(
      `[Praetorium] Errore fetch API Go models: ${(err as Error).message}, usando fallback`,
    );
    return FALLBACK_MODELS;
  }
}

// ============================================================
// Helper di conversione slug/id
// ============================================================

/** Converte un ID opencode (es. "mimo-v2.5") in slug AA (es. "mimo-v2-5") */
function slugFromId(id: string): string {
  return id.replace(/\./g, '-').replace(/\s+/g, '-').toLowerCase();
}

/** Converte uno slug AA in ID opencode (al momento coincidono dopo slugFromId) */
function idFromSlug(slug: string): string {
  return slug;
}

/**
 * Genera valori di default per un modello.
 * Per modelli conosciuti usa DEFAULT_VALUES, per quelli nuovi genera valori safe.
 */
function generateDefaults(id: string, slug: string): Partial<LeaderboardModel> {
  // Se abbiamo DEFAULT_VALUES per questo slug, usali
  if (DEFAULT_VALUES[slug]) return DEFAULT_VALUES[slug];

  // Altrimenti genera valori safe basati sull'ID
  const name = id
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
  return {
    name,
    creator: 'Unknown',
    intelligence: 30,
    price: 0.05,
    speed: 80,
    latency: 1.0,
    totalResponseTime: 6,
    contextWindow: 128000,
  };
}

// ============================================================
// Helper di conversione metriche
// ============================================================

/** Converte un valore in number, restituendo null se non valido */
function toNumber(val: unknown): number | null {
  if (typeof val === 'number' && !isNaN(val)) return val;
  if (typeof val === 'string') {
    const cleaned = val.replace(/[$€£,\s]/g, '').replace(/[^\d.]/g, '');
    const num = parseFloat(cleaned);
    return isNaN(num) ? null : num;
  }
  return null;
}

/** True solo per modelli con capacità di reasoning */
function hasReasoning(slug: string): boolean {
  return /deepseek-v4-pro|kimi-k2|minimax-m2-7|glm-5-1|qwen3-6/i.test(slug);
}

/** Mapping slug AA → opencodeId e provider */
function opencodeIdFromSlug(slug: string): { opencodeId: string; provider: 'go' } {
  return { opencodeId: `opencode-go/${slug}`, provider: 'go' };
}

// ============================================================
// Fetch pagina singola
// ============================================================

/**
 * Fetcha una pagina modello su AA con timeout e User-Agent.
 * Restituisce il HTML o null in caso di errore.
 */
async function fetchPage(slug: string): Promise<string | null> {
  const url = `${AA_BASE_URL}/${slug}`;
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const response = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      console.warn(`[Praetorium] HTTP ${response.status} per "${slug}", skip`);
      return null;
    }

    return await response.text();
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      console.warn(`[Praetorium] Timeout "${slug}" (${TIMEOUT_MS}ms), skip`);
    } else {
      console.warn(`[Praetorium] Errore fetch "${slug}": ${(err as Error).message}`);
    }
    return null;
  }
}

// ============================================================
// Scraping + merge a 3 livelli
// ============================================================

/**
 * Esegue il parsing completo di una pagina modello.
 * Mergea i 3 livelli: JSON-LD > Regex HTML > Default.
 * Se la pagina AA non è raggiungibile, restituisce valori di default.
 */
async function scrapeModel(slug: string): Promise<LeaderboardModel> {
  const html = await fetchPage(slug);

  if (!html) {
    // Pagina non raggiungibile: genera defaults per non perdere il modello
    const defaults = generateDefaults(idFromSlug(slug), slug);
    console.log(
      `[Praetorium] "${slug}" non raggiungibile su AA, usando valori di default/generati`,
    );
    return defaults as LeaderboardModel;
  }

  const defaults = generateDefaults(idFromSlug(slug), slug);
  const regexData = extractFromHtml(html);
  const jsonLdData = extractFromJsonLd(html, slug);

  // Merge: JSON-LD sovrascrive regex, che sovrascrive default
  const model: LeaderboardModel = {
    name:
      jsonLdData?.name || regexData?.name || defaults.name || '',
    creator:
      CREATOR_MAP[jsonLdData?.name || regexData?.name || defaults.name || ''] ||
      jsonLdData?.creator ||
      regexData?.creator ||
      defaults.creator ||
      'Unknown',
    intelligence:
      jsonLdData?.intelligence ?? regexData?.intelligence ?? defaults.intelligence ?? 0,
    price:
      jsonLdData?.price ?? regexData?.price ?? defaults.price ?? 0,
    speed:
      jsonLdData?.speed ?? regexData?.speed ?? defaults.speed ?? 0,
    latency:
      jsonLdData?.latency ?? regexData?.latency ?? defaults.latency ?? 0,
    totalResponseTime:
      jsonLdData?.totalResponseTime ??
      regexData?.totalResponseTime ??
      defaults.totalResponseTime ??
      0,
    contextWindow:
      jsonLdData?.contextWindow ??
      regexData?.contextWindow ??
      defaults.contextWindow ??
      0,
  };

  console.log(
    `[Praetorium] Scraped "${model.name}" (intel=${model.intelligence}, price=${model.price}, speed=${model.speed})`,
  );
  return model;
}

// ============================================================
// Livello 1 — Parsing JSON-LD
// ============================================================

/**
 * Estrae i dati del modello dai tag <script type="application/ld+json">.
 * Cerca Dataset con array `data` e matcha l'entry per `detailsUrl`.
 */
function extractFromJsonLd(
  html: string,
  slug: string,
): Partial<LeaderboardModel> | null {
  const ldRegex =
    /<script\s+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi;
  const datasets: { name?: string; data?: { label?: string; detailsUrl?: string; [k: string]: unknown }[] }[] = [];
  let match: RegExpExecArray | null;

  while ((match = ldRegex.exec(html)) !== null) {
    try {
      const parsed = JSON.parse(match[1].trim());
      if (parsed?.['@type'] === 'Dataset' && Array.isArray(parsed.data)) {
        datasets.push(parsed);
      }
    } catch {
      // JSON malformato — skip silenzioso
    }
  }

  if (datasets.length === 0) return null;

  const targetUrl = `/models/${slug}`.toLowerCase();
  const result: Partial<LeaderboardModel> = {};

  for (const ds of datasets) {
    const entry = (ds.data || []).find(
      (e) =>
        typeof e.detailsUrl === 'string' &&
        e.detailsUrl.toLowerCase() === targetUrl,
    );
    if (!entry) continue;

    // Nome dal primo dataset che matcha
    if (!result.name && typeof entry.label === 'string' && entry.label) {
      result.name = entry.label;
    }

    // Mappatura metriche per dataset name
    const name = ds.name || '';
    switch (name) {
      case 'Intelligence':
      case 'Artificial Analysis Intelligence Index': {
        const v = toNumber(entry.artificialAnalysisIntelligenceIndex ?? entry.intelligenceIndex);
        if (v !== null) result.intelligence = v;
        break;
      }
      case 'Price': {
        const v = toNumber(entry.pricePerMillionTokens);
        if (v !== null) result.price = v;
        break;
      }
      case 'Speed':
      case 'Output Speed': {
        const v = toNumber(entry.medianOutputSpeed ?? entry.outputSpeed);
        if (v !== null) result.speed = v;
        break;
      }
      case 'Context Window': {
        const v = toNumber(entry.contextWindowTokens);
        if (v !== null) result.contextWindow = v;
        break;
      }
      case 'Latency: Time To First Answer Token': {
        const input = toNumber(entry.inputTime);
        const reasoning = toNumber(entry.reasoningTime);
        if (input !== null || reasoning !== null) {
          result.latency = (input ?? 0) + (reasoning ?? 0);
        }
        break;
      }
      case 'End-to-End Response Time': {
        const input = toNumber(entry.inputTime);
        const reasoning = toNumber(entry.reasoningTime);
        const answer = toNumber(entry.answerTime);
        if (input !== null || reasoning !== null || answer !== null) {
          result.totalResponseTime =
            (input ?? 0) + (reasoning ?? 0) + (answer ?? 0);
        }
        break;
      }
    }
  }

  return Object.keys(result).length > 0 ? result : null;
}

// ============================================================
// Livello 2 — Regex su HTML
// ============================================================

/**
 * Estrae dati dal HTML usando regex su pattern JSON embedded.
 * Fallback quando JSON-LD non è presente o non matcha.
 */
function extractFromHtml(html: string): Partial<LeaderboardModel> | null {
  const result: Partial<LeaderboardModel> = {};

  const patterns: [RegExp, keyof LeaderboardModel][] = [
    [/"intelligenceIndex"\s*:\s*([\d.]+)/, 'intelligence'],
    [/"artificialAnalysisIntelligenceIndex"\s*:\s*([\d.]+)/, 'intelligence'],
    [/"pricePerMillionTokens"\s*:\s*([\d.]+)/, 'price'],
    [/"medianOutputSpeed"\s*:\s*([\d.]+)/, 'speed'],
    [/"outputSpeed"\s*:\s*([\d.]+)/, 'speed'],
    [/"contextWindowTokens"\s*:\s*([\d.]+)/, 'contextWindow'],
  ];

  for (const [pattern, field] of patterns) {
    const m = html.match(pattern);
    if (m?.[1]) {
      const num = parseFloat(m[1]);
      if (!isNaN(num)) {
        (result as Record<string, unknown>)[field] = num;
      }
    }
  }

  // Creator dal meta description
  const creatorMatch = html.match(
    /<meta[^>]*name="description"[^>]*content="Analysis of\s+(\w+(?:'\w+)?)/,
  );
  if (creatorMatch) result.creator = creatorMatch[1];

  // Nome dal title tag (prima parte prima di "|")
  const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/);
  if (titleMatch) {
    const title = titleMatch[1].split('|')[0]?.trim() || '';
    if (title) result.name = title;
  }

  return Object.keys(result).length > 0 ? result : null;
}
