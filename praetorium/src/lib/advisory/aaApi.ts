// ============================================================
// Praetorium — Advisory: Artificial Analysis API Client (v2)
// ============================================================
//
// Sostituisce il vecchio goScraper.ts.
// Usa l'API ufficiale FREE di Artificial Analysis
// (https://artificialanalysis.ai/api/v2/data/llms/models)
// invece dello scraping HTML delle pagine modello.
//
// Flusso:
//   1. Fetcha la lista dei modelli Go da opencode API (fallback: FALLBACK_MODELS)
//   2. Fetcha la leaderboard da AA API (fallback: DEFAULT_VALUES)
//   3. Per ogni modello Go, cerca match nel dataset AA per slug
//   4. Se matcha: mappa i campi dall'API AA
//   5. Se non matcha: usa DEFAULT_VALUES
//   6. Applica CREATOR_MAP per sovrascrivere il creator
// ============================================================

import type { LeaderboardModel, MatchedModel } from './types';

// ============================================================
// Costanti
// ============================================================

const GO_MODELS_API = 'https://opencode.ai/zen/go/v1/models';
const AA_API_URL = 'https://artificialanalysis.ai/api/v2/data/llms/models';
const FETCH_TIMEOUT_MS = 10_000;

// ============================================================
// Tipi
// ============================================================

/** LeaderboardModel con slug AA generato dall'ID opencode */
export interface ScrapedModel extends LeaderboardModel {
  slug: string;
}

/** Entry della response AA API */
interface AAModelResponse {
  id: string;
  name: string;
  slug: string;
  model_creator: { id: string; name: string; slug: string };
  evaluations: {
    artificial_analysis_intelligence_index?: number;
  };
  pricing: {
    price_1m_blended_3_to_1?: number;
    price_1m_input_tokens?: number;
    price_1m_output_tokens?: number;
  };
  median_output_tokens_per_second?: number;
  median_time_to_first_token_seconds?: number;
  median_time_to_first_answer_token?: number;
}

interface AAResponse {
  status: number;
  data: AAModelResponse[];
}

interface GoModelsResponse {
  data: { id: string }[];
}

/** Entry modello Go con id + slug calcolato */
interface GoModelEntry {
  id: string;
  slug: string;
}

// ============================================================
// FALLBACK_MODELS — usati solo quando l'API opencode non risponde
// ============================================================

const FALLBACK_MODELS: GoModelEntry[] = [
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

const CREATOR_MAP: Record<string, string> = {
  'DeepSeek V4 Pro (Max)': 'DeepSeek',
  'DeepSeek V4 Pro': 'DeepSeek',
  'DeepSeek V4 Flash (Max)': 'DeepSeek',
  'DeepSeek V4 Flash': 'DeepSeek',
  'GLM 5': 'Zhipu',
  'GLM 5.1': 'Zhipu',
  'Hy3 Preview': 'Haiper',
  'Kimi K2.5': 'Moonshot',
  'Kimi K2.6': 'Moonshot',
  'MiniMax M2.5': 'MiniMax',
  'MiniMax M2.7': 'MiniMax',
  'MiMo-V2-Pro': 'Xiaomi',
  'MiMo-V2-Omni': 'Xiaomi',
  'MiMo V2.5 Pro': 'Xiaomi',
  'MiMo-V2.5': 'Xiaomi',
  'MiMo V2.5': 'Xiaomi',
  'Qwen 3.5 Plus': 'Alibaba',
  'Qwen 3.6 Plus': 'Alibaba',
};

// ============================================================
// DEFAULT_VALUES — fallback per modelli senza match su AA API
// ============================================================

const DEFAULT_VALUES: Record<string, Omit<ScrapedModel, 'slug'>> = {
  'deepseek-v4-pro': {
    name: 'DeepSeek V4 Pro (Max)',
    creator: 'DeepSeek',
    intelligence: 55,
    price: 0.18,
    speed: 80,
    latency: 2.0,
    totalResponseTime: 10,
    contextWindow: 128000,
  },
  'deepseek-v4-flash': {
    name: 'DeepSeek V4 Flash (Max)',
    creator: 'DeepSeek',
    intelligence: 42,
    price: 0.02,
    speed: 180,
    latency: 0.5,
    totalResponseTime: 3,
    contextWindow: 128000,
  },
  'glm-5': {
    name: 'GLM 5',
    creator: 'Zhipu',
    intelligence: 38,
    price: 0.04,
    speed: 70,
    latency: 1.5,
    totalResponseTime: 8,
    contextWindow: 128000,
  },
  'glm-5-1': {
    name: 'GLM 5.1',
    creator: 'Zhipu',
    intelligence: 45,
    price: 0.05,
    speed: 65,
    latency: 1.3,
    totalResponseTime: 7,
    contextWindow: 128000,
  },
  'hy3': {
    name: 'Hy3 Preview',
    creator: 'Haiper',
    intelligence: 25,
    price: 0.01,
    speed: 200,
    latency: 0.3,
    totalResponseTime: 2,
    contextWindow: 32000,
  },
  'kimi-k2-5': {
    name: 'Kimi K2.5',
    creator: 'Moonshot',
    intelligence: 48,
    price: 0.06,
    speed: 75,
    latency: 1.2,
    totalResponseTime: 6,
    contextWindow: 128000,
  },
  'kimi-k2-6': {
    name: 'Kimi K2.6',
    creator: 'Moonshot',
    intelligence: 52,
    price: 0.08,
    speed: 70,
    latency: 1.0,
    totalResponseTime: 6,
    contextWindow: 128000,
  },
  'minimax-m2-5': {
    name: 'MiniMax M2.5',
    creator: 'MiniMax',
    intelligence: 35,
    price: 0.03,
    speed: 90,
    latency: 0.8,
    totalResponseTime: 5,
    contextWindow: 128000,
  },
  'minimax-m2-7': {
    name: 'MiniMax M2.7',
    creator: 'MiniMax',
    intelligence: 50,
    price: 0.07,
    speed: 85,
    latency: 0.9,
    totalResponseTime: 5,
    contextWindow: 128000,
  },
  'mimo-v2-pro': {
    name: 'MiMo-V2-Pro',
    creator: 'Xiaomi',
    intelligence: 35,
    price: 0.05,
    speed: 60,
    latency: 1.2,
    totalResponseTime: 7,
    contextWindow: 32000,
  },
  'mimo-v2-omni': {
    name: 'MiMo-V2-Omni',
    creator: 'Xiaomi',
    intelligence: 30,
    price: 0.08,
    speed: 50,
    latency: 1.5,
    totalResponseTime: 8,
    contextWindow: 32000,
  },
  'mimo-v2-5-pro': {
    name: 'MiMo V2.5 Pro',
    creator: 'Xiaomi',
    intelligence: 40,
    price: 0.06,
    speed: 65,
    latency: 1.0,
    totalResponseTime: 6,
    contextWindow: 128000,
  },
  'mimo-v2-5-0424': {
    name: 'MiMo-V2.5',
    creator: 'Xiaomi',
    intelligence: 32,
    price: 0.03,
    speed: 90,
    latency: 0.8,
    totalResponseTime: 5,
    contextWindow: 128000,
  },
  'qwen3-5-plus': {
    name: 'Qwen 3.5 Plus',
    creator: 'Alibaba',
    intelligence: 44,
    price: 0.04,
    speed: 95,
    latency: 0.7,
    totalResponseTime: 4,
    contextWindow: 128000,
  },
  'qwen3-6-plus': {
    name: 'Qwen 3.6 Plus',
    creator: 'Alibaba',
    intelligence: 50,
    price: 0.06,
    speed: 90,
    latency: 0.6,
    totalResponseTime: 4,
    contextWindow: 128000,
  },
};

// ============================================================
// Helper privati
// ============================================================

/** Converte un ID opencode in slug AA (sostituisce '.' con '-', lowercase) */
function slugFromId(id: string): string {
  return id.replace(/\./g, '-').toLowerCase();
}

/** Calcola il prezzo blended 3:1 da input e output prices */
function calcBlendedPrice(
  inputPrice: number | undefined,
  outputPrice: number | undefined,
): number | undefined {
  if (inputPrice === undefined || outputPrice === undefined) return undefined;
  return (3 * inputPrice + outputPrice) / 4;
}

/** True solo per modelli con capacità di reasoning */
function hasReasoning(slug: string): boolean {
  return /deepseek-v4-pro|kimi-k2|minimax-m2-7|glm-5-1|qwen3-6/i.test(slug);
}

// ============================================================
// Fetch della lista modelli Go
// ============================================================

/**
 * Fetcha la lista dei modelli Go dall'API opencode.
 * In caso di errore, timeout (10s) o risposta vuota, usa FALLBACK_MODELS.
 */
async function fetchGoModelIds(): Promise<GoModelEntry[]> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const response = await fetch(GO_MODELS_API, {
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      console.warn(
        `[Praetorium] API Go models returned ${response.status}, usando fallback conosciuti`,
      );
      return FALLBACK_MODELS;
    }

    const json: GoModelsResponse = await response.json();
    const models = json?.data || [];

    if (models.length === 0) {
      console.warn('[Praetorium] API Go models: lista vuota, usando fallback');
      return FALLBACK_MODELS;
    }

    return models.map((m) => ({
      id: m.id,
      slug: slugFromId(m.id),
    }));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(
      `[Praetorium] Errore fetch API Go models: ${message}, usando fallback`,
    );
    return FALLBACK_MODELS;
  }
}

// ============================================================
// Fetch della leaderboard AA
// ============================================================

/**
 * Fetcha la leaderboard completa da Artificial Analysis API v2.
 * Richiede ARTIFICIAL_ANALYSIS_API_KEY in process.env.
 * Timeout 10s via AbortController.
 * Restituisce null se la chiave non è configurata o la chiamata fallisce.
 */
async function fetchAAData(): Promise<AAModelResponse[] | null> {
  const apiKey = process.env.ARTIFICIAL_ANALYSIS_API_KEY;

  if (!apiKey) {
    console.warn(
      '[Praetorium] ARTIFICIAL_ANALYSIS_API_KEY non configurata, uso DEFAULT_VALUES',
    );
    return null;
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const response = await fetch(AA_API_URL, {
      headers: {
        'x-api-key': apiKey,
        Accept: 'application/json',
      },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      console.warn(
        `[Praetorium] AA API returned ${response.status} (${response.statusText}), uso DEFAULT_VALUES`,
      );
      return null;
    }

    const json: AAResponse = await response.json();
    const models = json?.data || [];

    if (models.length === 0) {
      console.warn('[Praetorium] AA API: lista vuota, uso DEFAULT_VALUES');
      return null;
    }

    console.log(
      `[Praetorium] AA API: ${models.length} modelli ricevuti con successo`,
    );
    return models;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(
      `[Praetorium] Errore fetch AA API: ${message}, uso DEFAULT_VALUES`,
    );
    return null;
  }
}

// ============================================================
// Mapping modello AA → ScrapedModel
// ============================================================

/**
 * Mappa un modello dalla response AA API in ScrapedModel.
 *
 * - Prezzo blended: usa price_1m_blended_3_to_1 se presente,
 *   altrimenti calcola blended 3:1 da input+output.
 * - Creator: CREATOR_MAP ha la priorità, poi model_creator.name da AA.
 * - Contesto: default 128000 (non fornito dall'API AA).
 */
function mapFromAAModel(aaModel: AAModelResponse, slug: string): ScrapedModel {
  const blendedPrice =
    aaModel.pricing?.price_1m_blended_3_to_1 ??
    calcBlendedPrice(
      aaModel.pricing?.price_1m_input_tokens,
      aaModel.pricing?.price_1m_output_tokens,
    ) ??
    DEFAULT_VALUES[slug]?.price ??
    0;

  const model: ScrapedModel = {
    name: aaModel.name || DEFAULT_VALUES[slug]?.name || slug,
    creator:
      CREATOR_MAP[aaModel.name] ||
      aaModel.model_creator?.name ||
      DEFAULT_VALUES[slug]?.creator ||
      'Unknown',
    intelligence:
      aaModel.evaluations?.artificial_analysis_intelligence_index ??
      DEFAULT_VALUES[slug]?.intelligence ??
      0,
    price: blendedPrice,
    speed:
      aaModel.median_output_tokens_per_second ??
      DEFAULT_VALUES[slug]?.speed ??
      0,
    latency:
      aaModel.median_time_to_first_token_seconds ??
      DEFAULT_VALUES[slug]?.latency ??
      0,
    totalResponseTime:
      aaModel.median_time_to_first_answer_token ??
      DEFAULT_VALUES[slug]?.totalResponseTime ??
      0,
    contextWindow: DEFAULT_VALUES[slug]?.contextWindow ?? 128000,
    slug,
  };

  return model;
}

// ============================================================
// Funzioni esportate
// ============================================================

/**
 * Fetcha i dati dei modelli Go da Artificial Analysis API.
 *
 * 1. Ottiene la lista modelli Go da opencode API (fallback: FALLBACK_MODELS)
 * 2. Fetcha la leaderboard AA via API ufficiale (fallback: DEFAULT_VALUES)
 * 3. Per ogni modello Go, cerca match nel dataset AA per slug
 * 4. Se matcha: mappa i campi dall'API AA
 * 5. Se non matcha: usa DEFAULT_VALUES
 *
 * @returns Promise con array di ScrapedModel
 */
export async function fetchGoModels(): Promise<ScrapedModel[]> {
  const goModels = await fetchGoModelIds();
  const aaData = await fetchAAData();

  // Se AA API non disponibile, usa DEFAULT_VALUES per tutti i modelli
  if (!aaData) {
    const results: ScrapedModel[] = [];
    for (const gm of goModels) {
      const defaults = DEFAULT_VALUES[gm.slug];
      if (defaults) {
        results.push({ ...defaults, slug: gm.slug });
      } else {
        // Modello sconosciuto — genera valori safe
        results.push(generateSafeModel(gm));
      }
    }
    console.log(
      `[Praetorium] fetchGoModels: ${results.length} modelli (default, AA non disponibile)`,
    );
    return results;
  }

  // AA API disponibile — matcha ogni modello Go nel dataset AA
  const results: ScrapedModel[] = [];
  for (const gm of goModels) {
    const aaMatch = aaData.find((a) => a.slug === gm.slug);

    if (aaMatch) {
      const model = mapFromAAModel(aaMatch, gm.slug);
      results.push(model);
      console.log(
        `[Praetorium] Matchato "${model.name}" (${gm.slug}) → intel=${model.intelligence}, price=${model.price}, speed=${model.speed}`,
      );
    } else {
      // Modello non presente su AA API — usa DEFAULT_VALUES
      const defaults = DEFAULT_VALUES[gm.slug];
      if (defaults) {
        results.push({ ...defaults, slug: gm.slug });
        console.log(
          `[Praetorium] Default per "${gm.id}" (${gm.slug}) — non trovato su AA API`,
        );
      } else {
        // Fallback estremo — genera valori safe
        results.push(generateSafeModel(gm));
        console.warn(
          `[Praetorium] Modello sconosciuto "${gm.id}" (${gm.slug}), generati valori safe`,
        );
      }
    }
  }

  console.log(
    `[Praetorium] fetchGoModels: ${results.length}/${goModels.length} modelli processati`,
  );
  return results;
}

/**
 * Converte un array di ScrapedModel in MatchedModel
 * applicando il mapping opencode (opencodeId, provider, hasReasoning).
 */
export function toMatchedModels(models: ScrapedModel[]): MatchedModel[] {
  return models.map((m) => ({
    ...m,
    opencodeId: `opencode-go/${m.slug}`,
    provider: 'go',
    hasReasoning: hasReasoning(m.slug),
  }));
}

// ============================================================
// Generazione valori safe per modelli sconosciuti
// ============================================================

/**
 * Genera un modello con valori safe per modelli non presenti
 * in DEFAULT_VALUES né su AA API.
 */
function generateSafeModel(entry: GoModelEntry): ScrapedModel {
  const name = entry.id
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
  return {
    name,
    creator: 'Unknown',
    intelligence: 30,
    price: 0.05,
    speed: 80,
    latency: 1.0,
    totalResponseTime: 6,
    contextWindow: 128000,
    slug: entry.slug,
  };
}
