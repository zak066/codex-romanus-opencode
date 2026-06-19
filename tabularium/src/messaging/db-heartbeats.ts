/**
 * messaging/db-heartbeats.ts
 * CRUD per la tabella agent_heartbeats del database SQLite.
 * Gestisce il monitoraggio dello stato e heartbeat degli agenti.
 *
 * @module messaging/db-heartbeats
 */

import { getDatabase } from '../core/database.js';
import type { AgentHeartbeat } from './types.js';

// ---------------------------------------------------------------------------
// Heartbeat CRUD
// ---------------------------------------------------------------------------

/**
 * Aggiorna (upsert) l'heartbeat di un agente.
 * Crea una nuova riga se l'agente non esiste, altrimenti aggiorna i campi
 * e imposta last_seen al timestamp corrente.
 *
 * @param agentName - Nome dell'agente
 * @param status - Stato corrente: idle, busy, error, offline
 * @param currentTask - Descrizione del task corrente (opzionale)
 * @param metadata - Metadati opzionali JSON-serializzabili
 * @returns L'heartbeat aggiornato
 */
export function upsertHeartbeat(
  agentName: string,
  status: AgentHeartbeat['status'],
  currentTask?: string,
  metadata?: Record<string, unknown>
): AgentHeartbeat {
  const db = getDatabase();

  const now = new Date().toISOString();
  const metadataJson = JSON.stringify(metadata ?? {});

  db.prepare(`
    INSERT INTO agent_heartbeats (agent_name, status, last_seen, current_task, metadata)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(agent_name) DO UPDATE SET
      status = excluded.status,
      last_seen = excluded.last_seen,
      current_task = excluded.current_task,
      metadata = excluded.metadata
  `).run(agentName, status, now, currentTask ?? null, metadataJson);

  const heartbeat = getHeartbeat(agentName);
  if (!heartbeat) {
    throw new Error(`Failed to retrieve heartbeat for agent '${agentName}'`);
  }

  return heartbeat;
}

/**
 * Recupera l'heartbeat di un agente specifico.
 *
 * @param agentName - Nome dell'agente
 * @returns L'heartbeat trovato o undefined
 */
export function getHeartbeat(agentName: string): AgentHeartbeat | undefined {
  const db = getDatabase();

  const row = db.prepare('SELECT * FROM agent_heartbeats WHERE agent_name = ?').get(agentName) as
    | Record<string, unknown>
    | undefined;

  if (!row) return undefined;
  return mapRowToAgentHeartbeat(row);
}

/**
 * Recupera gli heartbeat di tutti gli agenti.
 * Utile per dashboard e tool agent_list_agents.
 *
 * @returns Array di heartbeat di tutti gli agenti
 */
export function listHeartbeats(): AgentHeartbeat[] {
  const db = getDatabase();

  const rows = db.prepare(`
    SELECT * FROM agent_heartbeats
    ORDER BY
      CASE
        WHEN status IN ('idle', 'busy') THEN 0
        ELSE 1
      END,
      last_seen DESC
  `).all() as Record<string, unknown>[];

  return rows.map(mapRowToAgentHeartbeat);
}

/**
 * Trova gli agenti che non hanno inviato heartbeat da N minuti.
 * Utile per il heartbeat monitor che marca gli agenti come offline.
 *
 * @param timeoutMinutes - Numero di minuti di timeout (default: 3)
 * @returns Array di heartbeat degli agenti offline per timeout
 */
export function getOfflineAgents(timeoutMinutes: number = 3): AgentHeartbeat[] {
  const db = getDatabase();

  const threshold = new Date(Date.now() - timeoutMinutes * 60 * 1000).toISOString();

  const rows = db.prepare(`
    SELECT * FROM agent_heartbeats
    WHERE status IN ('idle', 'busy', 'error')
      AND last_seen < ?
    ORDER BY last_seen ASC
  `).all(threshold) as Record<string, unknown>[];

  return rows.map(mapRowToAgentHeartbeat);
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

/**
 * Mappa una riga del database in un oggetto AgentHeartbeat.
 */
function mapRowToAgentHeartbeat(row: Record<string, unknown>): AgentHeartbeat {
  return {
    agent_name: row.agent_name as string,
    status: (row.status as AgentHeartbeat['status']) ?? 'offline',
    last_seen: row.last_seen as string,
    current_task: (row.current_task as string) ?? null,
    metadata: (() => {
      const raw = row.metadata as string | null;
      if (!raw) return undefined;
      try {
        const parsed = JSON.parse(raw);
        if (Object.keys(parsed).length === 0) return undefined;
        return parsed;
      } catch { return undefined; }
    })(),
  };
}
