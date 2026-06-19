/**
 * core/vector-store.ts
 * CRUD per vettori di embedding con supporto sqlite-vec e fallback in-memory.
 *
 * Architettura:
 * - Se sqlite-vec è disponibile e caricato: usa tabelle virtuali vec0 per ANN
 * - Altrimenti: carica tutti i vettori in memoria e calcola cosine similarity
 *   (per volumi < 1000 vettori è < 10ms)
 *
 * I vettori sono salvati come BLOB in colonne delle tabelle principali
 * (knowledge_entries, events, decision_rationale) + indicizzati in knowledge_vec.
 *
 * @module core/vector-store
 */

import { getDatabase } from './database.js';
import { type Embedder } from './embedder.js';

// ---------------------------------------------------------------------------
// Tipi
// ---------------------------------------------------------------------------

export type VectorType = 'knowledge' | 'event' | 'decision';

export interface SearchResult {
  id: string;
  type: VectorType | 'unknown';
  score: number;
  rowid?: number;
}

export interface StoredVector {
  id: string;
  type: VectorType;
  vector: number[];
  text: string;
}

// ---------------------------------------------------------------------------
// Stato sqlite-vec
// ---------------------------------------------------------------------------

/** Flag che indica se sqlite-vec è disponibile */
let _vecAvailable = false;

/**
 * Imposta la disponibilità di sqlite-vec.
 * Chiamato da memory-migrator.ts dopo il caricamento dell'estensione.
 */
export function setVecAvailable(available: boolean): void {
  _vecAvailable = available;
}

/**
 * Verifica se sqlite-vec è disponibile per query ANN.
 */
export function isVecAvailable(): boolean {
  return _vecAvailable;
}

// ---------------------------------------------------------------------------
// Cache in-memory per fallback
// ---------------------------------------------------------------------------

/** Cache in-memory dei vettori per cosine similarity fallback */
let _vectorCache: StoredVector[] | null = null;

/**
 * Invalida la cache in-memory.
 * Chiamato dopo scritture che modificano i vettori.
 */
export function invalidateVectorCache(): void {
  _vectorCache = null;
}

/**
 * Carica tutti i vettori dalla cache o dal DB.
 */
function loadAllVectors(): StoredVector[] {
  if (_vectorCache) return _vectorCache;

  const db = getDatabase();
  const vectors: StoredVector[] = [];

  try {
    // Carica da knowledge_entries
    const knowledgeRows = db.prepare(
      `SELECT id, embedding, title || ' ' || body AS text FROM knowledge_entries WHERE embedding IS NOT NULL`
    ).all() as Array<{ id: string; embedding: Buffer | null; text: string }>;

    for (const row of knowledgeRows) {
      if (row.embedding) {
        vectors.push({
          id: row.id,
          type: 'knowledge',
          vector: bufferToVector(row.embedding),
          text: row.text.substring(0, 500),
        });
      }
    }

    // Carica da decision_rationale
    const decisionRows = db.prepare(
      `SELECT id, embedding, adr_id || ' ' || notes AS text FROM decision_rationale WHERE embedding IS NOT NULL`
    ).all() as Array<{ id: string; embedding: Buffer | null; text: string }>;

    for (const row of decisionRows) {
      if (row.embedding) {
        vectors.push({
          id: row.id,
          type: 'decision',
          vector: bufferToVector(row.embedding),
          text: row.text.substring(0, 500),
        });
      }
    }

    // Carica da events
    const eventRows = db.prepare(
      `SELECT id, embedding, summary AS text FROM events WHERE embedding IS NOT NULL`
    ).all() as Array<{ id: string; embedding: Buffer | null; text: string }>;

    for (const row of eventRows) {
      if (row.embedding) {
        vectors.push({
          id: row.id,
          type: 'event',
          vector: bufferToVector(row.embedding),
          text: row.text.substring(0, 500),
        });
      }
    }
  } catch {
    // Tabella non ancora creata o colonna non presente
  }

  _vectorCache = vectors;
  return vectors;
}

// ---------------------------------------------------------------------------
// Pubbliche
// ---------------------------------------------------------------------------

/**
 * Salva un embedding per una entry nel database.
 * Scrive il BLOB nella tabella corrispondente e, se sqlite-vec è disponibile,
 * inserisce il vettore nella tabella knowledge_vec.
 *
 * @param type - Tipo di entry
 * @param id - ID della entry
 * @param embedding - Vettore embedding (number[])
 */
export function storeEmbedding(type: VectorType, id: string, embedding: number[]): void {
  const db = getDatabase();
  const blob = vectorToBuffer(embedding);

  switch (type) {
    case 'knowledge':
      db.prepare('UPDATE knowledge_entries SET embedding = ? WHERE id = ?').run(blob, id);
      break;
    case 'event':
      db.prepare('UPDATE events SET embedding = ? WHERE id = ?').run(blob, id);
      break;
    case 'decision':
      db.prepare('UPDATE decision_rationale SET embedding = ? WHERE id = ?').run(blob, id);
      break;
  }

  // Se sqlite-vec è disponibile, inserisci anche nella tabella vettoriale
  if (_vecAvailable) {
    try {
      const floatArray = new Float32Array(embedding);
      const vecBuffer = Buffer.from(floatArray.buffer);
      // Usa rowid della tabella knowledge_entries per lookup
      const rowId = getRowId(type, id);
      if (rowId !== null) {
        db.prepare('INSERT OR REPLACE INTO knowledge_vec(rowid, embedding) VALUES (?, ?)').run(rowId, vecBuffer);
      }
    } catch (err) {
      console.error('[vector-store] Failed to insert into vec0 table:', err);
    }
  }

  // Invalida cache in-memory
  invalidateVectorCache();
}

/**
 * Cerca vettori simili usando cosine similarity.
 * Usa sqlite-vec se disponibile, altrimenti fallback in-memory.
 *
 * @param embedding - Vettore query
 * @param type - Filtra per tipo ('knowledge', 'event', 'decision', 'all')
 * @param limit - Numero massimo di risultati (default: 10)
 * @returns Array di risultati ordinati per score decrescente
 */
export function searchSimilar(
  embedding: number[],
  type: VectorType | 'all' = 'all',
  limit: number = 10
): SearchResult[] {
  if (_vecAvailable) {
    return searchSimilarVec(embedding, type, limit);
  }
  return searchSimilarInMemory(embedding, type, limit);
}

/**
 * Elimina l'embedding per una entry.
 *
 * @param type - Tipo di entry
 * @param id - ID della entry
 */
export function deleteEmbedding(type: VectorType, id: string): void {
  const db = getDatabase();

  switch (type) {
    case 'knowledge':
      db.prepare('UPDATE knowledge_entries SET embedding = NULL WHERE id = ?').run(id);
      break;
    case 'event':
      db.prepare('UPDATE events SET embedding = NULL WHERE id = ?').run(id);
      break;
    case 'decision':
      db.prepare('UPDATE decision_rationale SET embedding = NULL WHERE id = ?').run(id);
      break;
  }

  // Rimuovi anche dalla tabella vettoriale se disponibile
  if (_vecAvailable) {
    try {
      const rowId = getRowId(type, id);
      if (rowId !== null) {
        db.prepare('DELETE FROM knowledge_vec WHERE rowid = ?').run(rowId);
      }
    } catch {
      // Ignora errori su tabella vettoriale
    }
  }

  invalidateVectorCache();
}

// ---------------------------------------------------------------------------
// Cosine Similarity
// ---------------------------------------------------------------------------

/**
 * Calcola la cosine similarity tra due vettori.
 * Valori: 1.0 = identici, 0.0 = ortogonali, -1.0 = opposti.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
  if (magnitude < 1e-10) return 0;

  return dotProduct / magnitude;
}

// ---------------------------------------------------------------------------
// Privato — in-memory fallback
// ---------------------------------------------------------------------------

/**
 * Cerca similarità in-memory: carica tutti i vettori e calcola cosine similarity.
 * Per volumi < 1000 vettori è tipicamente < 10ms.
 */
function searchSimilarInMemory(
  queryEmbedding: number[],
  type: VectorType | 'all',
  limit: number
): SearchResult[] {
  const allVectors = loadAllVectors();

  // Filtra per tipo
  const filtered = type === 'all'
    ? allVectors
    : allVectors.filter((v) => v.type === type);

  // Calcola cosine similarity per ogni vettore
  const scored = filtered.map((v) => ({
    id: v.id,
    type: v.type as VectorType | 'unknown',
    score: cosineSimilarity(queryEmbedding, v.vector),
  }));

  // Ordina per score decrescente e prendi i top N
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

// ---------------------------------------------------------------------------
// Privato — sqlite-vec
// ---------------------------------------------------------------------------

/**
 * Cerca similarità usando sqlite-vec vec0 tabella vettoriale.
 * Usa la funzione di distanza coseno di sqlite-vec.
 */
function searchSimilarVec(
  queryEmbedding: number[],
  type: VectorType | 'all',
  limit: number
): SearchResult[] {
  const db = getDatabase();

  try {
    // Converti embedding in Float32Array per sqlite-vec
    const floatArray = new Float32Array(queryEmbedding);
    const vecBuffer = Buffer.from(floatArray.buffer);

    // Query ANN usando vec0
    const rows = db.prepare(
      `SELECT rowid, distance FROM knowledge_vec WHERE embedding MATCH ? ORDER BY distance LIMIT ?`
    ).all(vecBuffer, limit * 3) as Array<{ rowid: number; distance: number }>; // Prendi più risultati per filter

    if (rows.length === 0) return [];

    // Resolve rowid → type + id
    const typeFilter = type !== 'all' ? `AND type = ?` : '';
    const resolved = db.prepare(
      `SELECT rowid, 'knowledge' AS type, id FROM knowledge_entries WHERE rowid = ? ${typeFilter}`
    );

    const results: SearchResult[] = [];

    for (const row of rows) {
      // Prova prima knowledge_entries
      const knowledge = resolved.get(row.rowid, type !== 'all' ? type : undefined) as
        { rowid: number; type: string; id: string } | undefined;

      if (knowledge) {
        results.push({
          id: knowledge.id,
          type: knowledge.type as VectorType | 'unknown',
          score: 1 - row.distance, // distance → similarity
        });
        if (results.length >= limit) break;
        continue;
      }

      // Non trovato in knowledge_entries — skip (vec0 può contenere solo knowledge)
      // In futuro si potrebbe estendere con più tabelle vettoriali
    }

    return results;
  } catch (err) {
    console.error('[vector-store] sqlite-vec search failed, falling back to in-memory:', err);
    return searchSimilarInMemory(queryEmbedding, type, limit);
  }
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

const VECTOR_DIMENSIONS = 384;

/**
 * Converte un array di number in Buffer (Float32Array serializzato).
 * Ogni float32 occupa 4 byte → 384 * 4 = 1536 bytes.
 */
function vectorToBuffer(vector: number[]): Buffer {
  const floatArray = new Float32Array(vector);
  return Buffer.from(floatArray.buffer);
}

/**
 * Converte un Buffer in array di number.
 * Assume Float32Array serializzato.
 */
function bufferToVector(buffer: Buffer): number[] {
  const floatArray = new Float32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 4);
  return Array.from(floatArray);
}

/**
 * Ottiene il rowid SQLite di una entry dato il tipo e l'UUID.
 */
function getRowId(type: VectorType, id: string): number | null {
  try {
    const db = getDatabase();
    switch (type) {
      case 'knowledge':
        return (db.prepare('SELECT rowid FROM knowledge_entries WHERE id = ?').get(id) as { rowid: number } | undefined)?.rowid ?? null;
      case 'event':
        return (db.prepare('SELECT rowid FROM events WHERE id = ?').get(id) as { rowid: number } | undefined)?.rowid ?? null;
      case 'decision':
        return (db.prepare('SELECT rowid FROM decision_rationale WHERE id = ?').get(id) as { rowid: number } | undefined)?.rowid ?? null;
    }
  } catch {
    return null;
  }
}
