/**
 * core/knowledge-manager.ts
 * Business logic per la knowledge base intelligente.
 * Suggerisce knowledge entries rilevanti per contesto, agente o tag,
 * e suggerisce automaticamente categoria e tag per nuove entry.
 *
 * @module core/knowledge-manager
 */

import { getDatabase } from './database.js';
import type { KnowledgeEntry, KnowledgeCategory } from '../types/memory.js';

// ---------------------------------------------------------------------------
// Suggerimenti basati su contesto
// ---------------------------------------------------------------------------

/**
 * Suggerisce knowledge entries rilevanti dato un contesto (testo).
 * Cerca nel FTS5 usando il testo come query e ordina per relevance_score.
 *
 * @param context - Testo di contesto per la ricerca
 * @param limit - Numero massimo di risultati (default: 5)
 * @returns Array di knowledge entries rilevanti
 */
export function suggestKnowledge(context: string, limit?: number): KnowledgeEntry[] {
  const db = getDatabase();
  const maxLimit = limit ?? 5;

  if (!context || !context.trim()) {
    return [];
  }

  // Sanitizza la query per FTS5
  const sanitized = escapeFtsQuery(context);

  if (!sanitized) {
    return [];
  }

  // Usa FTS5 per la ricerca full-text nel contenuto
  const sql = `
    SELECT ke.*
    FROM knowledge_entries ke
    INNER JOIN knowledge_fts fts ON ke.rowid = fts.rowid
    WHERE knowledge_fts MATCH ?
      AND ke.status = 'active'
    ORDER BY ke.relevance_score DESC, ke.updated_at DESC
    LIMIT ?
  `;

  try {
    const rows = db.prepare(sql).all(sanitized, maxLimit) as Record<string, unknown>[];
    return rows.map(mapRowToKnowledgeEntry);
  } catch {
    // Fallback a LIKE search se FTS fallisce (es. query malformata)
    return fallbackSuggestKnowledge(context, maxLimit);
  }
}

/**
 * Suggerisce knowledge entries rilevanti per un agente specifico.
 * Cerca entry create dall'agente o con tag che lo menzionano.
 *
 * @param agentName - Nome dell'agente
 * @param limit - Numero massimo di risultati (default: 5)
 * @returns Array di knowledge entries rilevanti per l'agente
 */
export function suggestKnowledgeForAgent(agentName: string, limit?: number): KnowledgeEntry[] {
  const db = getDatabase();
  const maxLimit = limit ?? 5;

  if (!agentName || !agentName.trim()) {
    return [];
  }

  // Cerca entry che menzionano l'agente come source_agent o nei tag
  const rows = db.prepare(`
    SELECT * FROM knowledge_entries
    WHERE (
      source_agent = ?
      OR tags LIKE ?
      OR title LIKE ?
      OR body LIKE ?
    )
    AND status = 'active'
    ORDER BY relevance_score DESC, updated_at DESC
    LIMIT ?
  `).all(
    agentName,
    `%"${agentName}"%`,
    `%${agentName}%`,
    `%${agentName}%`,
    maxLimit
  ) as Record<string, unknown>[];

  return rows.map(mapRowToKnowledgeEntry);
}

// ---------------------------------------------------------------------------
// Correlazione per tag
// ---------------------------------------------------------------------------

/**
 * Trova knowledge entries correlate a uno o più tag.
 * Matching parziale: una entry è correlata se ha almeno uno dei tag specificati.
 *
 * @param tags - Array di tag da cercare
 * @param limit - Numero massimo di risultati (default: 10)
 * @returns Array di knowledge entries correlate
 */
export function findRelatedByTags(tags: string[], limit?: number): KnowledgeEntry[] {
  const db = getDatabase();
  const maxLimit = limit ?? 10;

  if (!tags || tags.length === 0) {
    return [];
  }

  // Costruisce condizioni OR per ogni tag (LIKE sul JSON array)
  const conditions = tags.map(() => "tags LIKE ?");
  const sql = `
    SELECT * FROM knowledge_entries
    WHERE (${conditions.join(' OR ')})
      AND status = 'active'
    ORDER BY relevance_score DESC, updated_at DESC
    LIMIT ?
  `;

  const params: unknown[] = tags.map(t => `%"${escapeLike(t)}"%`);
  params.push(maxLimit);

  try {
    const rows = db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map(mapRowToKnowledgeEntry);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Suggerimento automatico di categoria e tag
// ---------------------------------------------------------------------------

/**
 * Pattern di keyword per ogni categoria.
 */
const CATEGORY_KEYWORDS: Record<KnowledgeCategory, string[]> = {
  lesson: ['bug', 'error', 'fix', 'issue', 'crash', 'failure', 'errore', 'risolto'],
  faq: ['come', 'how to', 'how do', 'what is', 'cos\'è', 'guida', 'tutorial', 'faq'],
  pattern: ['pattern', 'strategy', 'template', 'schema', 'architettura', 'design', 'pattern'],
  tip: ['tip', 'consiglio', 'suggerimento', 'best practice', 'raccomandazione', 'suggeriamo'],
  pitfall: ['pitfall', 'attenzione', 'warning', 'caution', 'pericolo', 'evita', 'attenzione'],
  tutorial: ['tutorial', 'guida', 'passo passo', 'step by step', 'come fare', 'procedura'],
};

/**
 * Suggerisce automaticamente categoria e tag per una nuova knowledge entry.
 * Usa euristiche semplici basate su keyword matching nel titolo e body.
 *
 * @param title - Titolo della knowledge entry
 * @param body - Corpo della knowledge entry
 * @returns Oggetto con categoria suggerita e array di tag suggeriti
 */
export function suggestCategoryAndTags(
  title: string,
  body: string
): { category: KnowledgeCategory; tags: string[] } {
  const combined = (title + ' ' + body).toLowerCase();

  // Determina categoria via keyword matching
  let category: KnowledgeCategory = 'lesson';
  let maxScore = 0;

  for (const [cat, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    const score = keywords.reduce((acc, kw) => {
      return acc + (combined.includes(kw.toLowerCase()) ? 1 : 0);
    }, 0);
    if (score > maxScore) {
      maxScore = score;
      category = cat as KnowledgeCategory;
    }
  }

  // Estrai tag da titolo e body (parole significative)
  const tags = extractKeyTerms(title + ' ' + body);

  return { category, tags };
}

// ---------------------------------------------------------------------------
// Helper privati
// ---------------------------------------------------------------------------

/**
 * Escape di una query per FTS5 (previene errori su caratteri speciali).
 */
function escapeFtsQuery(query: string): string {
  return query
    .replace(/[^\w\s\-_*"()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Escape per LIKE (previene % e _ come wildcard).
 */
function escapeLike(value: string): string {
  return value.replace(/[%_]/g, '\\$&');
}

/**
 * Fallback a LIKE search quando FTS5 non è disponibile o fallisce.
 */
function fallbackSuggestKnowledge(query: string, limit: number): KnowledgeEntry[] {
  const db = getDatabase();
  const sanitized = query.replace(/[%_]/g, '\\$&');
  const likePattern = `%${sanitized}%`;

  const rows = db.prepare(`
    SELECT * FROM knowledge_entries
    WHERE (title LIKE ? OR body LIKE ?)
      AND status = 'active'
    ORDER BY relevance_score DESC, updated_at DESC
    LIMIT ?
  `).all(likePattern, likePattern, limit) as Record<string, unknown>[];

  return rows.map(mapRowToKnowledgeEntry);
}

/**
 * Mappa una riga del database in un oggetto KnowledgeEntry.
 */
function mapRowToKnowledgeEntry(row: Record<string, unknown>): KnowledgeEntry {
  const entry: KnowledgeEntry = {
    id: row.id as string,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
    title: row.title as string,
    body: row.body as string,
    category: row.category as KnowledgeCategory,
    relevance_score: (row.relevance_score as number) ?? 0,
    status: (row.status as KnowledgeEntry['status']) ?? 'active',
  };

  if (row.tags && (row.tags as string) !== '[]') {
    try {
      entry.tags = JSON.parse(row.tags as string) as string[];
    } catch {
      entry.tags = [];
    }
  }

  if (row.source_agent) {
    entry.source_agent = row.source_agent as string;
  }

  if (row.source_task_id) {
    entry.source_task_id = row.source_task_id as string;
  }

  return entry;
}

/**
 * Estrae termini significativi da un testo per usarli come tag.
 * Filtra stop words e termini troppo corti.
 */
function extractKeyTerms(text: string): string[] {
  const stopWords = new Set([
    'the', 'a', 'an', 'in', 'on', 'at', 'to', 'for', 'of', 'and', 'or',
    'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had',
    'do', 'does', 'did', 'will', 'would', 'can', 'could', 'shall', 'should',
    'may', 'might', 'il', 'lo', 'la', 'le', 'gli', 'un', 'una', 'uno',
    'del', 'dello', 'della', 'dei', 'degli', 'delle', 'al', 'allo', 'alla',
    'ai', 'agli', 'alle', 'con', 'per', 'tra', 'fra', 'che', 'chi', 'cui',
    'non', 'è', 'e', 'di', 'da', 'in', 'su', 'come', 'più', 'meno',
  ]);

  const words = text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 3 && !stopWords.has(w))
    .slice(0, 8); // massimo 8 tag

  // Deduplica mantenendo l'ordine
  return [...new Set(words)];
}
