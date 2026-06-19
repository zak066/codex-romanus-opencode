/**
 * core/db-events.ts
 * CRUD per la tabella events del database SQLite.
 * Gestisce inserimento e query degli eventi di sessione.
 *
 * @module core/db-events
 */

import { getDatabase } from './database.js';
import { memoryEventsCache } from './cache.js';
import type { MemoryEvent, EventType } from '../types/memory.js';
import { randomUUID } from 'node:crypto';

// ---------------------------------------------------------------------------
// Event CRUD
// ---------------------------------------------------------------------------

/**
 * Inserisce un nuovo evento in una sessione.
 *
 * @param sessionId - ID della sessione a cui appartiene l'evento
 * @param agentName - Nome dell'agente che genera l'evento
 * @param eventType - Tipo di evento
 * @param summary - Riepilogo breve (max 280 char)
 * @param details - Dati strutturati aggiuntivi (opzionale)
 * @param tags - Array di tag (opzionale)
 * @returns L'evento creato
 * @throws Error se il database non è inizializzato
 */
export function insertEvent(
  sessionId: string,
  agentName: string,
  eventType: EventType,
  summary: string,
  details?: Record<string, unknown>,
  tags?: string[]
): MemoryEvent {
  const db = getDatabase();

  const id = `evt_${randomUUID().replace(/-/g, '').substring(0, 10)}`;
  const timestamp = new Date().toISOString();
  const detailsJson = JSON.stringify(details ?? {});
  const tagsJson = JSON.stringify(tags ?? []);

  db.prepare(`
    INSERT INTO events (id, session_id, timestamp, agent_name, event_type, summary, details, tags)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, sessionId, timestamp, agentName, eventType, summary, detailsJson, tagsJson);

  // Invalida cache eventi dopo scrittura
  memoryEventsCache.clear();

  return {
    id,
    session_id: sessionId,
    timestamp,
    agent_name: agentName,
    event_type: eventType,
    summary,
    details: details ?? {},
    tags: tags ?? [],
  };
}

/**
 * Recupera gli eventi di una sessione con filtro e paginazione.
 *
 * @param sessionId - ID della sessione
 * @param filter - Filtri: type, limit, offset
 * @returns Oggetto con array di eventi e conteggio totale
 */
export function getEventsBySession(
  sessionId: string,
  filter?: { type?: EventType; limit?: number; offset?: number }
): { events: MemoryEvent[]; total: number } {
  // Cache-aside: chiave include i parametri del filtro
  const cacheKey = `events:session:${sessionId}:${JSON.stringify(filter ?? {})}`;
  const cached = memoryEventsCache.get(cacheKey);
  if (cached !== undefined) return cached as { events: MemoryEvent[]; total: number };

  const db = getDatabase();

  // Query per il conteggio totale
  let countSql = 'SELECT COUNT(*) as total FROM events WHERE session_id = ?';
  const countParams: unknown[] = [sessionId];

  if (filter?.type) {
    countSql += ' AND event_type = ?';
    countParams.push(filter.type);
  }

  const total = (db.prepare(countSql).get(...countParams) as { total: number }).total;

  // Query per i dati
  let dataSql = 'SELECT * FROM events WHERE session_id = ?';
  const dataParams: unknown[] = [sessionId];

  if (filter?.type) {
    dataSql += ' AND event_type = ?';
    dataParams.push(filter.type);
  }

  dataSql += ' ORDER BY timestamp DESC';

  const limit = filter?.limit ?? 50;
  const offset = filter?.offset ?? 0;
  dataSql += ' LIMIT ? OFFSET ?';
  dataParams.push(limit, offset);

  const rows = db.prepare(dataSql).all(...dataParams) as Record<string, unknown>[];

  const result = {
    events: rows.map(mapRowToEvent),
    total,
  };
  memoryEventsCache.set(cacheKey, result);
  return result;
}

/**
 * Recupera gli eventi più recenti per un agente.
 *
 * @param agentName - Nome dell'agente
 * @param limit - Numero massimo di eventi (default: 20)
 * @returns Array di eventi
 */
export function getEventsByAgent(agentName: string, limit?: number): MemoryEvent[] {
  // Cache-aside: chiave include nome agente e limite
  const cacheKey = `events:agent:${agentName}:${limit ?? 20}`;
  const cached = memoryEventsCache.get(cacheKey);
  if (cached !== undefined) return cached as MemoryEvent[];

  const db = getDatabase();

  const maxLimit = limit ?? 20;
  const rows = db.prepare(`
    SELECT * FROM events
    WHERE agent_name = ?
    ORDER BY timestamp DESC
    LIMIT ?
  `).all(agentName, maxLimit) as Record<string, unknown>[];

  const result = rows.map(mapRowToEvent);
  memoryEventsCache.set(cacheKey, result);
  return result;
}

/**
 * Recupera eventi di un certo tipo in un intervallo di tempo.
 *
 * @param eventType - Tipo di evento
 * @param since - Data ISO 8601 di inizio intervallo
 * @param until - Data ISO 8601 di fine intervallo (opzionale)
 * @param limit - Numero massimo di eventi (default: 50)
 * @returns Array di eventi
 */
export function getEventsByType(
  eventType: EventType,
  since: string,
  until?: string,
  limit?: number
): MemoryEvent[] {
  const db = getDatabase();

  let sql = 'SELECT * FROM events WHERE event_type = ? AND timestamp >= ?';
  const params: unknown[] = [eventType, since];

  if (until) {
    sql += ' AND timestamp <= ?';
    params.push(until);
  }

  sql += ' ORDER BY timestamp DESC LIMIT ?';
  params.push(limit ?? 50);

  const rows = db.prepare(sql).all(...params) as Record<string, unknown>[];

  return rows.map(mapRowToEvent);
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

/**
 * Mappa una riga del database in un oggetto MemoryEvent.
 */
function mapRowToEvent(row: Record<string, unknown>): MemoryEvent {
  const event: MemoryEvent = {
    id: row.id as string,
    session_id: row.session_id as string,
    timestamp: row.timestamp as string,
    agent_name: row.agent_name as string,
    event_type: row.event_type as EventType,
    summary: row.summary as string,
  };

  if (row.details && (row.details as string) !== '{}') {
    try {
      event.details = JSON.parse(row.details as string) as Record<string, unknown>;
    } catch {
      event.details = {};
    }
  }

  if (row.tags && (row.tags as string) !== '[]') {
    try {
      event.tags = JSON.parse(row.tags as string) as string[];
    } catch {
      event.tags = [];
    }
  }

  return event;
}
