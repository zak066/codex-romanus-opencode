/**
 * core/semantic-search.ts
 * Ricerca semantica su memoria del team usando embedding vettoriali.
 *
 * Flusso:
 * 1. Testo query → embedding (tramite embedder)
 * 2. Embedding → vector search (tramite vector-store)
 * 3. Risultati arricchiti con snippet testuali
 *
 * Supporta anche ricerca ibrida (FTS5 + semantica combinata) per
 * ottenere il meglio di entrambi i mondi: precisione lessicale + flessibilità semantica.
 *
 * @module core/semantic-search
 */

import { createEmbedder, type Embedder } from './embedder.js';
import { searchSimilar, storeEmbedding, type VectorType } from './vector-store.js';
import { searchKnowledge } from './db-knowledge.js';
import { getDatabase } from './database.js';

// ---------------------------------------------------------------------------
// Tipi
// ---------------------------------------------------------------------------

export interface SemanticResult {
  id: string;
  type: string;
  score: number;
  snippet: string;
}

export interface HybridResult extends SemanticResult {
  ftsScore: number;
  semanticScore: number;
}

// ---------------------------------------------------------------------------
// Embedder lazy singleton
// ---------------------------------------------------------------------------

let _embedder: Embedder | null = null;

/**
 * Restituisce l'embedder (lazy init, singleton).
 */
async function getEmbedder(): Promise<Embedder> {
  if (!_embedder) {
    _embedder = await createEmbedder();
  }
  return _embedder;
}

/**
 * Resetta l'embedder (utile per test).
 */
export function resetEmbedder(): void {
  _embedder = null;
}

// ---------------------------------------------------------------------------
// Pubbliche
// ---------------------------------------------------------------------------

/**
 * Ricerca semantica: testo → embedding → vector search.
 *
 * @param query - Testo della query
 * @param type - Filtra per tipo ('knowledge', 'event', 'decision', 'all', opzionale)
 * @param limit - Numero massimo di risultati (default: 10)
 * @returns Array di risultati con ID, tipo, score, snippet
 */
export async function semanticSearch(
  query: string,
  type?: string,
  limit?: number
): Promise<SemanticResult[]> {
  const resolvedType = (type ?? 'all') as VectorType | 'all';
  const resolvedLimit = limit ?? 10;

  if (!query || !query.trim()) {
    return [];
  }

  const embedder = await getEmbedder();
  const embedding = await embedder.embed(query);

  // Cerca similarità
  const results = searchSimilar(embedding, resolvedType, resolvedLimit);

  if (results.length === 0) {
    return [];
  }

  // Arricchisci con snippet testuali
  return enrichResults(results);
}

/**
 * Ricerca ibrida: FTS5 + semantica combinati con score pesato.
 * Combina punteggio FTS (full-text search) con punteggio semantico.
 *
 * Formula: combinedScore = 0.4 * ftsScore + 0.6 * semanticScore
 *
 * @param query - Testo della query
 * @param limit - Numero massimo di risultati (default: 10)
 * @returns Array di risultati ibridi con score combinato
 */
export async function hybridSearch(
  query: string,
  limit?: number
): Promise<HybridResult[]> {
  const resolvedLimit = limit ?? 10;

  if (!query || !query.trim()) {
    return [];
  }

  const embedder = await getEmbedder();
  const embedding = await embedder.embed(query);

  // 1) Ricerca semantica
  const semanticResults = searchSimilar(embedding, 'knowledge', resolvedLimit * 2);

  // 2) Ricerca FTS5
  let ftsResults: Array<{ id: string; title: string; body: string; rank: number }> = [];
  try {
    ftsResults = searchKnowledge(query, undefined, resolvedLimit * 2) as unknown as Array<{
      id: string;
      title: string;
      body: string;
      rank: number;
    }>;
  } catch {
    // FTS5 potrebbe non essere disponibile
  }

  // 3) Combina risultati
  const combined = new Map<string, HybridResult>();

  // Dai punteggio FTS normalizzato
  const ftsMap = new Map<string, number>();
  if (ftsResults.length > 0) {
    // Normalizza FTS rank a [0, 1] — rank FTS5 è negativo (più vicino a 0 = meglio)
    const maxRank = Math.max(...ftsResults.map((r) => r.rank));
    const minRank = Math.min(...ftsResults.map((r) => r.rank));
    const range = maxRank - minRank || 1;

    for (const r of ftsResults) {
      const snippet = r.title
        ? `${r.title}: ${r.body.substring(0, 200)}`
        : r.body.substring(0, 200);
      const normalizedScore = (r.rank - minRank) / range; // [0, 1]
      combined.set(r.id, {
        id: r.id,
        type: 'knowledge',
        score: normalizedScore,
        snippet,
        ftsScore: normalizedScore,
        semanticScore: 0,
      });
      ftsMap.set(r.id, normalizedScore);
    }
  }

  // Aggiungi/fondi con risultati semantici
  const semMap = new Map<string, number>();
  for (const r of semanticResults) {
    semMap.set(r.id, r.score);
  }

  // Merge
  for (const [id, semScore] of semMap) {
    const existing = combined.get(id);
    if (existing) {
      existing.semanticScore = semScore;
      // Combined score: 40% FTS + 60% semantico
      existing.score = 0.4 * existing.ftsScore + 0.6 * semScore;
    } else {
      // Solo risultato semantico (non trovato da FTS)
      const snippet = await getSnippet(id);
      combined.set(id, {
        id,
        type: 'knowledge',
        score: semScore * 0.6, // Solo componente semantica pesata
        snippet: snippet ?? '',
        ftsScore: 0,
        semanticScore: semScore,
      });
    }
  }

  return Array.from(combined.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, resolvedLimit);
}

/**
 * Genera e salva embedding per una entry.
 * Da chiamare dopo createKnowledgeEntry, insertEvent, insertDecisionRationale, etc.
 *
 * @param type - Tipo di entry
 * @param id - ID della entry
 * @param text - Testo da embeddare
 */
export async function embedAndStore(
  type: VectorType,
  id: string,
  text: string
): Promise<void> {
  if (!text || !text.trim()) return;

  try {
    const embedder = await getEmbedder();
    const embedding = await embedder.embed(text);
    storeEmbedding(type, id, embedding);
  } catch (err) {
    console.error(`[semantic-search] Failed to embed and store for ${type}/${id}:`, err);
  }
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

/**
 * Recupera uno snippet testuale per un ID dalla knowledge base o decision_rationale.
 */
async function getSnippet(id: string): Promise<string | null> {
  try {
    const db = getDatabase();

    // Prova knowledge_entries
    const knowledge = db.prepare(
      `SELECT title, body FROM knowledge_entries WHERE id = ?`
    ).get(id) as { title: string; body: string } | undefined;

    if (knowledge) {
      return knowledge.title
        ? `${knowledge.title}: ${knowledge.body.substring(0, 200)}`
        : knowledge.body.substring(0, 200);
    }

    // Prova decision_rationale
    const decision = db.prepare(
      `SELECT adr_id, notes FROM decision_rationale WHERE id = ?`
    ).get(id) as { adr_id: string; notes: string } | undefined;

    if (decision) {
      return `[${decision.adr_id}] ${decision.notes.substring(0, 200)}`;
    }

    // Prova events
    const event = db.prepare(
      `SELECT summary FROM events WHERE id = ?`
    ).get(id) as { summary: string } | undefined;

    if (event) {
      return event.summary;
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Arricchisce risultati del vector search con snippet di testo.
 */
function enrichResults(results: Array<{ id: string; type: string; score: number }>): SemanticResult[] {
  return results.map((r) => {
    // Cerca snippet sincrono (cache)
    const db = getDatabase();
    let snippet = '';

    try {
      if (r.type === 'knowledge') {
        const row = db.prepare(
          `SELECT title, body FROM knowledge_entries WHERE id = ?`
        ).get(r.id) as { title: string; body: string } | undefined;
        if (row) {
          snippet = row.title
            ? `${row.title}: ${row.body.substring(0, 200)}`
            : row.body.substring(0, 200);
        }
      } else if (r.type === 'decision') {
        const row = db.prepare(
          `SELECT adr_id, notes FROM decision_rationale WHERE id = ?`
        ).get(r.id) as { adr_id: string; notes: string } | undefined;
        if (row) {
          snippet = `[${row.adr_id}] ${row.notes.substring(0, 200)}`;
        }
      } else if (r.type === 'event') {
        const row = db.prepare(
          `SELECT summary FROM events WHERE id = ?`
        ).get(r.id) as { summary: string } | undefined;
        if (row) {
          snippet = row.summary;
        }
      }
    } catch {
      snippet = '';
    }

    return {
      id: r.id,
      type: r.type,
      score: r.score,
      snippet,
    };
  });
}
