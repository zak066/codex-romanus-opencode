/**
 * core/similarity-linker.ts
 * Collega automaticamente decisioni correlate e trova contesti simili
 * usando similarity coseno tra embedding vettoriali.
 *
 * Utilità:
 * - Scoprire relazioni implicite tra ADR (es. ADR-005 ↔ ADR-006 se parlano di Arae)
 * - Arricchire il contesto corrente con decisioni passate pertinenti
 * - Suggerire ADR da consultare prima di prendere nuove decisioni
 *
 * @module core/similarity-linker
 */

import { createEmbedder, type Embedder } from './embedder.js';
import { searchSimilar, cosineSimilarity } from './vector-store.js';
import { getDatabase } from './database.js';

// ---------------------------------------------------------------------------
// Tipi
// ---------------------------------------------------------------------------

export interface DecisionLink {
  from: string;      // ID della decisione sorgente
  to: string;        // ID della decisione target
  score: number;     // Cosine similarity (0..1)
  fromAdr?: string;  // ADR ID sorgente
  toAdr?: string;    // ADR ID target
}

export interface SimilarContext {
  id: string;
  content: string;
  score: number;
  type: 'knowledge' | 'decision' | 'event';
}

// ---------------------------------------------------------------------------
// Embedder lazy singleton
// ---------------------------------------------------------------------------

let _embedder: Embedder | null = null;

async function getEmbedder(): Promise<Embedder> {
  if (!_embedder) {
    _embedder = await createEmbedder();
  }
  return _embedder;
}

/**
 * Resetta il linker (utile per test).
 */
export function resetLinker(): void {
  _embedder = null;
}

// ---------------------------------------------------------------------------
// Pubbliche
// ---------------------------------------------------------------------------

/**
 * Collega automaticamente decisioni correlate.
 *
 * Processo:
 * 1. Carica tutte le decision_rationale che hanno embedding
 * 2. Per ogni coppia, calcola cosine similarity
 * 3. Restituisce coppie con score > soglia (default: 0.3)
 *
 * Complessità: O(n²) — ma tipicamente n < 50 decisioni
 *
 * @param threshold - Soglia di similarità minima (default: 0.3)
 * @returns Array di link tra decisioni correlate
 */
export async function linkRelatedDecisions(
  threshold: number = 0.3
): Promise<DecisionLink[]> {
  const db = getDatabase();
  const links: DecisionLink[] = [];

  try {
    // Carica tutte le decisioni con embedding
    const decisions = db.prepare(
      `SELECT id, adr_id, embedding, notes || ' ' || alternatives AS text
       FROM decision_rationale
       WHERE embedding IS NOT NULL`
    ).all() as Array<{
      id: string;
      adr_id: string;
      embedding: Buffer | null;
      text: string;
    }>;

    if (decisions.length < 2) return [];

    // Converti embedding
    const vectors: Array<{
      id: string;
      adrId: string;
      vector: number[];
    }> = [];

    for (const d of decisions) {
      if (!d.embedding) continue;
      const floatArray = new Float32Array(d.embedding.buffer, d.embedding.byteOffset, d.embedding.byteLength / 4);
      vectors.push({
        id: d.id,
        adrId: d.adr_id,
        vector: Array.from(floatArray),
      });
    }

    if (vectors.length < 2) return [];

    // Calcola similarità per ogni coppia (evita duplicati: i < j)
    for (let i = 0; i < vectors.length; i++) {
      for (let j = i + 1; j < vectors.length; j++) {
        if (vectors[i].adrId === vectors[j].adrId) continue; // Stesso ADR
        const sim = cosineSimilarity(vectors[i].vector, vectors[j].vector);
        if (sim >= threshold) {
          links.push({
            from: vectors[i].id,
            to: vectors[j].id,
            fromAdr: vectors[i].adrId,
            toAdr: vectors[j].adrId,
            score: Math.round(sim * 1000) / 1000, // Arrotonda a 3 decimali
          });
        }
      }
    }

    // Ordina per score decrescente
    return links.sort((a, b) => b.score - a.score);
  } catch (err) {
    console.error('[similarity-linker] Failed to link decisions:', err);
    return [];
  }
}

/**
 * Trova contesti (knowledge, decisioni, eventi) simili a una decisione specifica.
 *
 * @param adrId - ID dell'ADR (es. "ADR-005")
 * @param limit - Numero massimo di risultati (default: 5)
 * @returns Array di contesti simili con score
 */
export async function findSimilarContexts(
  adrId: string,
  limit: number = 5
): Promise<SimilarContext[]> {
  const db = getDatabase();
  const results: SimilarContext[] = [];

  try {
    // Trova la decision_rationale per questo ADR
    const decision = db.prepare(
      `SELECT id, embedding, notes FROM decision_rationale WHERE adr_id = ? AND embedding IS NOT NULL`
    ).get(adrId) as { id: string; embedding: Buffer | null; notes: string } | undefined;

    if (!decision || !decision.embedding) return [];

    // Converti embedding
    const floatArray = new Float32Array(
      decision.embedding.buffer,
      decision.embedding.byteOffset,
      decision.embedding.byteLength / 4
    );
    const queryVector = Array.from(floatArray);

    // 1) Cerca knowledge simili
    try {
      const knowledgeRows = db.prepare(
        `SELECT id, embedding, title, body FROM knowledge_entries WHERE embedding IS NOT NULL`
      ).all() as Array<{
        id: string;
        embedding: Buffer | null;
        title: string;
        body: string;
      }>;

      const embedder = await getEmbedder();
      const queryEmbedding = await embedder.embed(decision.notes || adrId);

      const knowledgeSimilar = searchSimilar(queryEmbedding, 'knowledge', limit);
      for (const ks of knowledgeSimilar) {
        const row = db.prepare('SELECT title, body FROM knowledge_entries WHERE id = ?').get(ks.id) as
          { title: string; body: string } | undefined;
        if (row) {
          results.push({
            id: ks.id,
            content: `${row.title}: ${row.body.substring(0, 300)}`,
            score: ks.score,
            type: 'knowledge',
          });
        }
      }
    } catch {
      // Fallback silenzioso
    }

    // 2) Cerca altre decisioni simili
    try {
      const decisionRows = db.prepare(
        `SELECT id, adr_id, embedding, notes FROM decision_rationale
         WHERE embedding IS NOT NULL AND id != ?`
      ).all(decision.id) as Array<{
        id: string;
        adr_id: string;
        embedding: Buffer | null;
        notes: string;
      }>;

      for (const dr of decisionRows) {
        if (!dr.embedding) continue;
        const drFloatArray = new Float32Array(
          dr.embedding.buffer,
          dr.embedding.byteOffset,
          dr.embedding.byteLength / 4
        );
        const drVector = Array.from(drFloatArray);
        const sim = cosineSimilarity(queryVector, drVector);
        if (sim >= 0.3) {
          results.push({
            id: dr.id,
            content: `[${dr.adr_id}] ${dr.notes.substring(0, 300)}`,
            score: sim,
            type: 'decision',
          });
        }
      }
    } catch {
      // Fallback silenzioso
    }

    // Ordina per score decrescente e limita
    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  } catch (err) {
    console.error('[similarity-linker] Failed to find similar contexts:', err);
    return [];
  }
}
