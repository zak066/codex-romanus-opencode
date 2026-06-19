// ============================================================
// Praetorium — GET /api/advisory
// ============================================================
//
// Restituisce le raccomandazioni di modelli per tutti i 12 agenti
// di Codex Romanus, basate sui dati dei 15 modelli opencode Go
// da Artificial Analysis e sui profili di esigenza di ciascun agente.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import fs from 'node:fs/promises';
import type { AdvisoryResponse, AdvisoryCacheEntry, AdvisoryMode } from '@/lib/advisory/types';
import { fetchGoModels, toMatchedModels } from '@/lib/advisory/aaApi';
import { scoreModels, getAgentProfile } from '@/lib/advisory/scorer';
import { AGENT_PROFILES } from '@/lib/advisory/profiles';
import {
  readCache,
  writeCache,
  getCacheAgeSeconds,
  CACHE_TTL,
  CACHE_FILE,
} from '@/lib/advisory/cache';

// ============================================================
// Schema di validazione query params
// ============================================================

const QuerySchema = z.object({
  mode: z.enum(['high', 'budget']).default('high'),
  refresh: z
    .string()
    .optional()
    .transform((v) => v === 'true'),
  agent: z.string().optional(),
});

// ============================================================
// Handler GET
// ============================================================

export async function GET(request: NextRequest) {
  // --- Validazione query params ---
  const rawParams = Object.fromEntries(request.nextUrl.searchParams.entries());

  const parsed = QuerySchema.safeParse({
    mode: rawParams.mode || 'high',
    refresh: rawParams.refresh || 'false',
    agent: rawParams.agent || undefined,
  });

  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'invalid_parameters',
        message: 'Parametri non validi',
        details: parsed.error.flatten().fieldErrors,
        validModes: ['high', 'budget'],
      },
      { status: 400 },
    );
  }

  const { mode, refresh, agent: agentFilter } = parsed.data;

  // --- Validazione agent filter ---
  if (agentFilter && !AGENT_PROFILES[agentFilter]) {
    return NextResponse.json(
      {
        error: 'invalid_agent',
        message: `Agente '${agentFilter}' non valido`,
        validAgents: Object.keys(AGENT_PROFILES),
      },
      { status: 400 },
    );
  }

  try {
    // --- Step 1: Controlla cache (se !refresh) ---
    if (!refresh) {
      const cached = await readCache();
      if (cached) {
        const age = getCacheAgeSeconds(cached.cachedAt);
        const response = buildResponse(cached, mode, agentFilter);
        return NextResponse.json(response, {
          headers: {
            'X-Cache': 'HIT',
            'X-Cache-Age': String(age),
            'Cache-Control': 'public, max-age=3600',
          },
        });
      }
    }

    // --- Step 2: Esegui la pipeline ---
    console.log(`[Praetorium] Avvio pipeline advisory (mode=${mode}, refresh=${!!refresh})`);

    // 2a. Scraping dei 15 modelli Go da Artificial Analysis
    let leaderboardModels;
    try {
      leaderboardModels = await fetchGoModels();
    } catch (err) {
      // Se lo scraping fallisce, prova a servire cache stale
      if (!refresh) {
        const stale = await readStaleCache();
        if (stale) {
          const age = getCacheAgeSeconds(stale.cachedAt);
          const response = buildResponse(stale, mode, agentFilter);
          return NextResponse.json(response, {
            headers: {
              'X-Cache': 'STALE',
              'X-Cache-Age': String(age),
              'X-Warning': 'using stale cache, scraping failed',
            },
          });
        }
      }

      return NextResponse.json(
        {
          error: 'advisory_unavailable',
          message: 'Scraping dei modelli Go fallito e nessuna cache disponibile',
          detail: (err as Error).message,
          retryAfter: 300,
        },
        { status: 503 },
      );
    }

    // 2b. Matching statico → MatchedModel[]
    const matchedModels = toMatchedModels(leaderboardModels);

    if (matchedModels.length === 0) {
      return NextResponse.json(
        {
          error: 'no_models_matched',
          message: 'Nessun modello Go disponibile per lo scoring',
          matched: 0,
          total: leaderboardModels.length,
        },
        { status: 422 },
      );
    }

    // 2c. Scoring per entrambe le modalità
    const scoresHigh = scoreModels(matchedModels, 'high');
    const scoresBudget = scoreModels(matchedModels, 'budget');

    // 2d. Salva in cache
    const cacheEntry: AdvisoryCacheEntry = {
      cachedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + CACHE_TTL).toISOString(),
      sourceUrl: 'https://artificialanalysis.ai/models (15 Go models)',
      modelsCount: leaderboardModels.length,
      data: {
        high: scoresHigh,
        budget: scoresBudget,
      },
    };

    await writeCache(cacheEntry);

    // --- Step 3: Costruisci e restituisci la response ---
    const response = buildResponse(cacheEntry, mode, agentFilter);

    return NextResponse.json(response, {
      headers: {
        'X-Cache': 'MISS',
        'X-Cache-Age': '0',
        'Cache-Control': 'public, max-age=3600',
      },
    });
  } catch (err) {
    console.error('[Praetorium] Errore inatteso nella pipeline advisory:', err);
    return NextResponse.json(
      {
        error: 'internal_error',
        message: 'Errore interno durante la generazione delle raccomandazioni',
        detail: (err as Error).message,
      },
      { status: 500 },
    );
  }
}

// ============================================================
// Helper
// ============================================================

/**
 * Costruisce l'oggetto AdvisoryResponse a partire dalla cache
 * e dalla modalità/agente richiesti.
 */
function buildResponse(
  cached: AdvisoryCacheEntry,
  mode: AdvisoryMode,
  agentFilter?: string,
): AdvisoryResponse {
  const data = cached.data[mode];
  const agentIds = agentFilter
    ? [agentFilter]
    : Object.keys(data);

  const agents = agentIds.map((agentId) => {
    const recommendations = data[agentId] || [];
    const agentProfile = getAgentProfile(agentId);
    return {
      agentId,
      agentName: agentProfile?.name || agentId,
      mode,
      recommendations,
    };
  });

  // Conta il numero di modelli unici valutati
  const modelIds = new Set<string>();
  for (const scores of Object.values(data)) {
    for (const s of scores) {
      modelIds.add(s.model.opencodeId);
    }
  }

  return {
    mode,
    generatedAt: cached.cachedAt,
    modelsEvaluated: modelIds.size,
    agents,
  };
}

/**
 * Tenta di leggere la cache anche se scaduta (per fallback stale).
 * Ignora il TTL e restituisce i dati se il file esiste.
 */
async function readStaleCache(): Promise<AdvisoryCacheEntry | null> {
  try {
    const raw = await fs.readFile(CACHE_FILE, 'utf-8');
    const entry = JSON.parse(raw) as AdvisoryCacheEntry;

    if (
      !entry.cachedAt ||
      !entry.expiresAt ||
      !entry.data ||
      !entry.data.high ||
      !entry.data.budget
    ) {
      return null;
    }

    console.log('[Praetorium] Cache advisory: servita stale');
    return entry;
  } catch {
    return null;
  }
}

