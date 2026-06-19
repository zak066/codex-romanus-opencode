/**
 * core/db-contexts.ts
 * CRUD per la tabella contexts del database SQLite.
 * Gestisce salvataggio e recupero dei contesti di sessione.
 *
 * @module core/db-contexts
 */

import { getDatabase } from './database.js';
import { memoryContextsCache } from './cache.js';
import type { MemoryContext, ContextType } from '../types/memory.js';
import { randomUUID } from 'node:crypto';

// ---------------------------------------------------------------------------
// Context CRUD
// ---------------------------------------------------------------------------

/**
 * Salva un contesto per una sessione.
 *
 * @param sessionId - ID della sessione
 * @param agentName - Nome dell'agente
 * @param contextType - Tipo di contesto
 * @param content - Corpo del contesto
 * @param source - Origine del contesto (default: 'auto')
 * @param metadata - Metadata aggiuntivi (opzionale)
 * @returns Il contesto creato
 * @throws Error se il database non è inizializzato
 */
export function saveContext(
  sessionId: string,
  agentName: string,
  contextType: ContextType,
  content: string,
  source?: string,
  metadata?: Record<string, unknown>
): MemoryContext {
  const db = getDatabase();

  const id = `ctx_${randomUUID().replace(/-/g, '').substring(0, 10)}`;
  const createdAt = new Date().toISOString();
  const sourceValue = source ?? 'auto';
  const metadataJson = JSON.stringify(metadata ?? {});

  db.prepare(`
    INSERT INTO contexts (id, session_id, agent_name, created_at, context_type, content, source, metadata)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, sessionId, agentName, createdAt, contextType, content, sourceValue, metadataJson);

  memoryContextsCache.clear();

  return {
    id,
    session_id: sessionId,
    agent_name: agentName,
    created_at: createdAt,
    context_type: contextType,
    content,
    source: sourceValue as MemoryContext['source'],
    metadata: metadata ?? {},
  };
}

/**
 * Recupera il contesto più recente per un agente.
 *
 * @param agentName - Nome dell'agente
 * @param contextType - Tipo di contesto opzionale per filtrare
 * @returns Il contesto più recente o undefined
 */
export function getLatestContext(
  agentName: string,
  contextType?: ContextType
): MemoryContext | undefined {
  // Cache-aside: chiave include agente e tipo di contesto
  const cacheKey = `context:latest:${agentName}:${contextType ?? ''}`;
  const cached = memoryContextsCache.get(cacheKey);
  if (cached !== undefined) return cached as MemoryContext;

  const db = getDatabase();

  let sql = 'SELECT * FROM contexts WHERE agent_name = ?';
  const params: unknown[] = [agentName];

  if (contextType) {
    sql += ' AND context_type = ?';
    params.push(contextType);
  }

  sql += ' ORDER BY created_at DESC LIMIT 1';

  const row = db.prepare(sql).get(...params) as Record<string, unknown> | undefined;

  if (!row) return undefined;

  const result = mapRowToContext(row);
  memoryContextsCache.set(cacheKey, result);
  return result;
}

/**
 * Recupera tutti i contesti per una sessione.
 *
 * @param sessionId - ID della sessione
 * @param limit - Numero massimo di contesti (default: 10)
 * @returns Array di contesti
 */
export function getContextsBySession(sessionId: string, limit?: number): MemoryContext[] {
  const db = getDatabase();

  const rows = db.prepare(`
    SELECT * FROM contexts
    WHERE session_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(sessionId, limit ?? 10) as Record<string, unknown>[];

  return rows.map(mapRowToContext);
}

/**
 * Recupera l'ultimo contesto per ogni agente.
 *
 * @param contextType - Tipo di contesto opzionale per filtrare
 * @returns Array di contesti, uno per agente
 */
export function getLatestContextPerAgent(contextType?: ContextType): MemoryContext[] {
  const db = getDatabase();

  let sql = `
    SELECT c.* FROM contexts c
    INNER JOIN (
      SELECT agent_name, MAX(created_at) as max_created
      FROM contexts
  `;

  const params: unknown[] = [];

  if (contextType) {
    sql += ' WHERE context_type = ?';
    params.push(contextType);
  }

  sql += `
      GROUP BY agent_name
    ) latest ON c.agent_name = latest.agent_name AND c.created_at = latest.max_created
    ORDER BY c.agent_name
  `;

  const rows = db.prepare(sql).all(...params) as Record<string, unknown>[];

  return rows.map(mapRowToContext);
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

/**
 * Mappa una riga del database in un oggetto MemoryContext.
 */
function mapRowToContext(row: Record<string, unknown>): MemoryContext {
  const context: MemoryContext = {
    id: row.id as string,
    session_id: row.session_id as string,
    agent_name: row.agent_name as string,
    created_at: row.created_at as string,
    context_type: row.context_type as ContextType,
    content: row.content as string,
    source: (row.source as MemoryContext['source']) ?? 'auto',
  };

  if (row.metadata && (row.metadata as string) !== '{}') {
    try {
      context.metadata = JSON.parse(row.metadata as string) as Record<string, unknown>;
    } catch {
      context.metadata = {};
    }
  }

  return context;
}
