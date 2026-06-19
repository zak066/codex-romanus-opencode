/**
 * core/db-sessions.ts
 * CRUD per la tabella sessions del database SQLite.
 * Gestisce creazione, lettura, listaggio e chiusura delle sessioni.
 *
 * @module core/db-sessions
 */

import { getDatabase } from './database.js';
import { memorySessionsCache } from './cache.js';
import type { MemorySession, SessionStatus } from '../types/memory.js';
import { randomUUID } from 'node:crypto';

// ---------------------------------------------------------------------------
// Session CRUD
// ---------------------------------------------------------------------------

/**
 * Crea una nuova sessione per un agente.
 *
 * @param agentName - Nome dell'agente che avvia la sessione
 * @param focus - Area di focus opzionale (default: 'all')
 * @returns La sessione creata
 * @throws Error se il database non è inizializzato
 */
export function createSession(agentName: string, focus?: string): MemorySession {
  const db = getDatabase();

  const id = `ses_${randomUUID().replace(/-/g, '').substring(0, 10)}`;
  const startTime = new Date().toISOString();
  const sessionFocus = focus ?? 'all';

  const stmt = db.prepare(`
    INSERT INTO sessions (id, agent_name, start_time, focus, status, metadata)
    VALUES (?, ?, ?, ?, 'active', '{}')
  `);

  stmt.run(id, agentName, startTime, sessionFocus);

  // Invalida cache sessioni dopo scrittura
  memorySessionsCache.clear();

  return {
    id,
    agent_name: agentName,
    start_time: startTime,
    focus: sessionFocus,
    status: 'active' as SessionStatus,
    metadata: {},
  };
}

/**
 * Recupera una sessione per ID.
 *
 * @param id - ID della sessione
 * @returns La sessione trovata o undefined
 */
export function getSession(id: string): MemorySession | undefined {
  // Cache-aside: check cache first
  const cached = memorySessionsCache.get(`session:${id}`);
  if (cached !== undefined) return cached as MemorySession;

  const db = getDatabase();

  const row = db.prepare(`
    SELECT s.*,
           (SELECT COUNT(*) FROM events e WHERE e.session_id = s.id) as event_count
    FROM sessions s
    WHERE s.id = ?
  `).get(id) as Record<string, unknown> | undefined;

  if (!row) return undefined;

  const result = mapRowToSession(row);
  memorySessionsCache.set(`session:${id}`, result);
  return result;
}

/**
 * Lista le sessioni con filtri opzionali.
 *
 * @param filter - Filtri: agent, status, limit
 * @returns Array di sessioni
 */
export function listSessions(
  filter?: { agent?: string; status?: SessionStatus; limit?: number }
): MemorySession[] {
  // Cache-aside: chiave include i parametri del filtro
  const cacheKey = `sessions:${JSON.stringify(filter ?? {})}`;
  const cached = memorySessionsCache.get(cacheKey);
  if (cached !== undefined) return cached as MemorySession[];

  const db = getDatabase();

  let sql = `
    SELECT s.*,
           (SELECT COUNT(*) FROM events e WHERE e.session_id = s.id) as event_count
    FROM sessions s
    WHERE 1=1
  `;
  const params: unknown[] = [];

  if (filter?.agent) {
    sql += ' AND s.agent_name = ?';
    params.push(filter.agent);
  }

  if (filter?.status) {
    sql += ' AND s.status = ?';
    params.push(filter.status);
  }

  sql += ' ORDER BY s.start_time DESC';

  if (filter?.limit) {
    sql += ' LIMIT ?';
    params.push(filter.limit);
  }

  const rows = db.prepare(sql).all(...params) as Record<string, unknown>[];

  const result = rows.map(mapRowToSession);
  memorySessionsCache.set(cacheKey, result);
  return result;
}

/**
 * Chiude una sessione impostando end_time e status='completed'.
 *
 * @param id - ID della sessione da chiudere
 * @throws Error se la sessione non esiste
 */
export function closeSession(id: string): void {
  const db = getDatabase();

  const result = db.prepare(`
    UPDATE sessions
    SET end_time = ?, status = 'completed', updated_at = datetime('now')
    WHERE id = ?
  `).run(new Date().toISOString(), id);

  if (result.changes === 0) {
    throw new Error(`Session not found: ${id}`);
  }

  // Invalida cache sessioni dopo scrittura
  memorySessionsCache.clear();
}

/**
 * Aggiorna lo stato di una sessione.
 *
 * @param id - ID della sessione
 * @param status - Nuovo status
 * @param metadata - Metadata aggiuntivi (opzionale, merge con esistente)
 */
export function updateSessionStatus(
  id: string,
  status: SessionStatus,
  metadata?: Record<string, unknown>
): void {
  const db = getDatabase();

  if (metadata) {
    const existing = getSession(id);
    const mergedMeta = { ...(existing?.metadata ?? {}), ...metadata };
    db.prepare(`
      UPDATE sessions
      SET status = ?, metadata = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(status, JSON.stringify(mergedMeta), id);
  } else {
    db.prepare(`
      UPDATE sessions
      SET status = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(status, id);
  }

  // Invalida cache sessioni dopo scrittura
  memorySessionsCache.clear();
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

/**
 * Mappa una riga del database in un oggetto MemorySession.
 */
function mapRowToSession(row: Record<string, unknown>): MemorySession {
  const session: MemorySession = {
    id: row.id as string,
    agent_name: row.agent_name as string,
    start_time: row.start_time as string,
    status: row.status as SessionStatus,
    event_count: (row.event_count as number) ?? 0,
  };

  if (row.end_time) {
    session.end_time = row.end_time as string;
  }

  if (row.focus && row.focus !== 'all') {
    session.focus = row.focus as string;
  }

  if (row.metadata && (row.metadata as string) !== '{}') {
    try {
      session.metadata = JSON.parse(row.metadata as string) as Record<string, unknown>;
    } catch {
      session.metadata = {};
    }
  }

  return session;
}
