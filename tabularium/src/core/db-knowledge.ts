/**
 * core/db-knowledge.ts
 * CRUD per la tabella knowledge_entries del database SQLite.
 * Gestisce creazione, lettura, ricerca full-text e aggiornamento delle
 * entry del knowledge base.
 *
 * @module core/db-knowledge
 */

import { getDatabase } from './database.js';
import { memoryKnowledgeCache } from './cache.js';
import type { KnowledgeEntry, KnowledgeCategory } from '../types/memory.js';
import { randomUUID } from 'node:crypto';

// ---------------------------------------------------------------------------
// Knowledge CRUD
// ---------------------------------------------------------------------------

/**
 * Crea una nuova entry nel knowledge base.
 *
 * @param title - Titolo dell'entry
 * @param body - Corpo del testo
 * @param category - Categoria (lesson, faq, pattern, tip, pitfall, tutorial)
 * @param sourceAgent - Agente che ha contribuito (opzionale)
 * @param tags - Array di tag (opzionale)
 * @param sourceTaskId - ID del task durante cui è stata creata (opzionale)
 * @returns La knowledge entry creata
 * @throws Error se il database non è inizializzato
 */
export function createKnowledgeEntry(
  title: string,
  body: string,
  category: KnowledgeCategory,
  sourceAgent?: string,
  tags?: string[],
  sourceTaskId?: string
): KnowledgeEntry {
  const db = getDatabase();

  const id = `k_${randomUUID().replace(/-/g, '').substring(0, 10)}`;
  const now = new Date().toISOString();
  const tagsJson = JSON.stringify(tags ?? []);

  db.prepare(`
    INSERT INTO knowledge_entries (id, created_at, updated_at, title, body, category, tags, source_agent, source_task_id, relevance_score, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'active')
  `).run(id, now, now, title, body, category, tagsJson, sourceAgent ?? null, sourceTaskId ?? null);

  // Sincronizza FTS
  syncFtsForEntry(db, id);

  // Invalida cache knowledge dopo scrittura
  memoryKnowledgeCache.clear();

  return {
    id,
    created_at: now,
    updated_at: now,
    title,
    body,
    category,
    tags: tags ?? [],
    source_agent: sourceAgent,
    source_task_id: sourceTaskId,
    relevance_score: 0,
    status: 'active',
  };
}

/**
 * Recupera una knowledge entry per ID.
 *
 * @param id - ID della knowledge entry
 * @returns La entry trovata o undefined
 */
export function getKnowledgeEntry(id: string): KnowledgeEntry | undefined {
  // Cache-aside: check cache first
  const cached = memoryKnowledgeCache.get(`knowledge:${id}`);
  if (cached !== undefined) return cached as KnowledgeEntry;

  const db = getDatabase();

  const row = db.prepare('SELECT * FROM knowledge_entries WHERE id = ?').get(id) as Record<string, unknown> | undefined;

  if (!row) return undefined;

  const result = mapRowToKnowledgeEntry(row);
  memoryKnowledgeCache.set(`knowledge:${id}`, result);
  return result;
}

/**
 * Cerca nel knowledge base usando FTS5 full-text search.
 * La ricerca viene effettuata su title e body.
 *
 * @param query - Testo da cercare
 * @param category - Filtro categoria opzionale
 * @param limit - Numero massimo di risultati (default: 10)
 * @returns Array di knowledge entries corrispondenti
 */
export function searchKnowledge(
  query: string,
  category?: KnowledgeCategory,
  limit?: number
): KnowledgeEntry[] {
  const db = getDatabase();

  const maxLimit = limit ?? 10;

  // Usa FTS5 per la ricerca full-text
  let sql = `
    SELECT ke.*
    FROM knowledge_entries ke
    INNER JOIN knowledge_fts fts ON ke.rowid = fts.rowid
    WHERE knowledge_fts MATCH ?
  `;
  const params: unknown[] = [escapeFtsQuery(query)];

  if (category) {
    sql += ' AND ke.category = ?';
    params.push(category);
  }

  sql += ' ORDER BY ke.relevance_score DESC, ke.updated_at DESC LIMIT ?';
  params.push(maxLimit);

  try {
    const rows = db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map(mapRowToKnowledgeEntry);
  } catch {
    // Fallback a LIKE search se FTS fallisce (es. query malformata)
    return searchKnowledgeLike(query, category, maxLimit);
  }
}

/**
 * Lista tutte le knowledge entries con filtri opzionali.
 *
 * @param filter - Filtri: category, status, limit
 * @returns Array di knowledge entries
 */
export function listKnowledge(
  filter?: { category?: KnowledgeCategory; status?: 'active' | 'archived' | 'draft'; limit?: number }
): KnowledgeEntry[] {
  // Cache-aside: chiave include parametri del filtro
  const cacheKey = `knowledge:list:${JSON.stringify(filter ?? {})}`;
  const cached = memoryKnowledgeCache.get(cacheKey);
  if (cached !== undefined) return cached as KnowledgeEntry[];

  const db = getDatabase();

  let sql = 'SELECT * FROM knowledge_entries WHERE 1=1';
  const params: unknown[] = [];

  if (filter?.category) {
    sql += ' AND category = ?';
    params.push(filter.category);
  }

  if (filter?.status) {
    sql += ' AND status = ?';
    params.push(filter.status);
  }

  sql += ' ORDER BY relevance_score DESC, updated_at DESC';

  if (filter?.limit) {
    sql += ' LIMIT ?';
    params.push(filter.limit);
  }

  const rows = db.prepare(sql).all(...params) as Record<string, unknown>[];

  const result = rows.map(mapRowToKnowledgeEntry);
  memoryKnowledgeCache.set(cacheKey, result);
  return result;
}

/**
 * Incrementa il relevance_score di una knowledge entry.
 * Chiamato quando una entry viene citata o utilizzata.
 *
 * @param id - ID della knowledge entry
 */
export function incrementRelevance(id: string): void {
  const db = getDatabase();

  db.prepare(`
    UPDATE knowledge_entries
    SET relevance_score = relevance_score + 1, updated_at = ?
    WHERE id = ?
  `).run(new Date().toISOString(), id);

  // Invalida cache knowledge dopo scrittura
  memoryKnowledgeCache.clear();
}

/**
 * Aggiorna una knowledge entry esistente.
 *
 * @param id - ID della entry
 * @param updates - Campi da aggiornare
 * @returns La entry aggiornata o undefined se non trovata
 */
export function updateKnowledgeEntry(
  id: string,
  updates: {
    title?: string;
    body?: string;
    category?: KnowledgeCategory;
    tags?: string[];
    status?: 'active' | 'archived' | 'draft';
  }
): KnowledgeEntry | undefined {
  const db = getDatabase();

  const existing = getKnowledgeEntry(id);
  if (!existing) return undefined;

  const now = new Date().toISOString();
  const title = updates.title ?? existing.title;
  const body = updates.body ?? existing.body;
  const category = updates.category ?? existing.category;
  const tags = updates.tags ?? existing.tags ?? [];
  const status = updates.status ?? existing.status;

  db.prepare(`
    UPDATE knowledge_entries
    SET title = ?, body = ?, category = ?, tags = ?, status = ?, updated_at = ?
    WHERE id = ?
  `).run(title, body, category, JSON.stringify(tags), status, now, id);

  // Risincronizza FTS
  syncFtsForEntry(db, id);

  // Invalida cache knowledge dopo scrittura prima della rilettura
  memoryKnowledgeCache.clear();

  return getKnowledgeEntry(id);
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

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
 * Sincronizza una entry specifica con la tabella FTS.
 */
function syncFtsForEntry(db: ReturnType<typeof getDatabase>, id: string): void {
  try {
    const entry = db.prepare('SELECT rowid, title, body FROM knowledge_entries WHERE id = ?').get(id) as
      | { rowid: number; title: string; body: string }
      | undefined;
    if (entry) {
      db.prepare('INSERT OR REPLACE INTO knowledge_fts (rowid, title, body) VALUES (?, ?, ?)').run(
        entry.rowid,
        entry.title,
        entry.body
      );
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`[db-knowledge] FTS5 sync warning for entry ${id}: ${errMsg}`);

    // Auto-repair: rebuild FTS index se corrotto
    if (errMsg.includes('SQLITE_CORRUPT_VTAB')) {
      try {
        console.error('[db-knowledge] Attempting FTS rebuild...');
        db.exec("INSERT INTO knowledge_fts(knowledge_fts) VALUES('rebuild')");
        // Riprova l'inserimento
        const retryEntry = db.prepare('SELECT rowid, title, body FROM knowledge_entries WHERE id = ?').get(id) as
          | { rowid: number; title: string; body: string }
          | undefined;
        if (retryEntry) {
          db.prepare('INSERT OR REPLACE INTO knowledge_fts (rowid, title, body) VALUES (?, ?, ?)').run(
            retryEntry.rowid,
            retryEntry.title,
            retryEntry.body
          );
        }
        console.error('[db-knowledge] FTS rebuild and re-sync successful');
      } catch (rebuildErr) {
        console.error('[db-knowledge] FTS rebuild failed:', rebuildErr instanceof Error ? rebuildErr.message : String(rebuildErr));
      }
    }
  }
}



/**
 * Escape di una query per FTS5 (previene errori su caratteri speciali).
 */
function escapeFtsQuery(query: string): string {
  // FTS5 usa * per wildcard, " per phrase, ^ per prefix
  // Rimuoviamo caratteri potenzialmente problematici
  return query
    .replace(/[^\w\s\-_*"()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Fallback a LIKE search se FTS non è disponibile o fallisce.
 */
function searchKnowledgeLike(
  query: string,
  category?: KnowledgeCategory,
  limit?: number
): KnowledgeEntry[] {
  const db = getDatabase();

  const maxLimit = limit ?? 10;
  const sanitized = query.replace(/[%_]/g, '\\$&');
  const likePattern = `%${sanitized}%`;

  let sql = `
    SELECT * FROM knowledge_entries
    WHERE (title LIKE ? OR body LIKE ?)
  `;
  const params: unknown[] = [likePattern, likePattern];

  if (category) {
    sql += ' AND category = ?';
    params.push(category);
  }

  sql += ' ORDER BY relevance_score DESC, updated_at DESC LIMIT ?';
  params.push(maxLimit);

  const rows = db.prepare(sql).all(...params) as Record<string, unknown>[];
  return rows.map(mapRowToKnowledgeEntry);
}
