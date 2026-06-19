/**
 * messaging/heartbeat-monitor.ts
 * Heartbeat Monitor ciclico per il sistema di Messaging Real-Time (R1).
 *
 * Ogni 30 secondi controlla gli heartbeat degli agenti e marca come offline
 * quelli che non hanno inviato heartbeat per più di 3 minuti.
 * Emette eventi tramite EventBus per timeout e riprese.
 *
 * @module messaging/heartbeat-monitor
 */

import { getDatabase } from '../core/database.js';
import { emit } from './event-bus.js';
import type { MessagingEvent } from './event-bus.js';
import type { AgentHeartbeat } from './types.js';

// ---------------------------------------------------------------------------
// Costanti
// ---------------------------------------------------------------------------

/** Intervallo tra i cicli di controllo heartbeat (30 secondi) */
const CHECK_INTERVAL_MS = 30_000;

/** Timeout heartbeat: 3 minuti (3 miss × 60s heartbeat interval) */
const HEARTBEAT_TIMEOUT_MS = 180_000;

// ---------------------------------------------------------------------------
// Stato
// ---------------------------------------------------------------------------

/** Timer ID del setInterval */
let monitorTimer: ReturnType<typeof setInterval> | null = null;

/** Flag per stato running */
let running = false;

/**
 * Set di agenti che il monitor ha marcato come offline.
 * Usato per detectare quando un agente torna online (resume).
 * Un agente è in questo set se il monitor lo ha marcato offline.
 * Quando upsertHeartbeat (da tool handler) aggiorna lo status,
 * il prossimo ciclo del monitor lo rimuoverà e emetterà resume.
 */
const markedOffline: Set<string> = new Set();

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

/**
 * Avvia il monitor heartbeat.
 * Crea un setInterval che ogni 30 secondi controlla gli heartbeat.
 * Se già in esecuzione, non fa nulla.
 */
export function startHeartbeatMonitor(): void {
  if (running) {
    console.error('[heartbeat-monitor] Already running');
    return;
  }

  running = true;

  // Esegui un check immediato all'avvio
  try {
    performHeartbeatCheck();
  } catch (err) {
    console.error('[heartbeat-monitor] Error during initial check:', err);
  }

  monitorTimer = setInterval(() => {
    try {
      performHeartbeatCheck();
    } catch (err) {
      console.error('[heartbeat-monitor] Error during heartbeat check:', err);
    }
  }, CHECK_INTERVAL_MS);

  console.error(
    `[heartbeat-monitor] Started (interval: ${CHECK_INTERVAL_MS / 1000}s, timeout: ${HEARTBEAT_TIMEOUT_MS / 1000}s)`
  );
}

/**
 * Ferma il monitor heartbeat.
 * Pulisce il timer e resetta lo stato.
 * Le connessioni SSE e lo stato EventBus non vengono modificati.
 */
export function stopHeartbeatMonitor(): void {
  if (monitorTimer) {
    clearInterval(monitorTimer);
    monitorTimer = null;
  }
  running = false;
  markedOffline.clear();
  console.error('[heartbeat-monitor] Stopped');
}

/**
 * Indica se il monitor heartbeat è attualmente in esecuzione.
 *
 * @returns true se il monitor è attivo
 */
export function isHeartbeatMonitorRunning(): boolean {
  return running;
}

// ---------------------------------------------------------------------------
// Heartbeat check
// ---------------------------------------------------------------------------

/**
 * Esegue un ciclo completo di controllo heartbeat:
 *
 * 1. Trova agenti con timeout (status != offline, last_seen > 3 min fa)
 * 2. Per ciascuno: marca offline, emette evento timeout
 * 3. Trova agenti marcati offline che sono tornati online
 * 4. Per ciascuno: emette evento resume, rimuove dal set
 */
function performHeartbeatCheck(): void {
  const db = getDatabase();
  const threshold = new Date(Date.now() - HEARTBEAT_TIMEOUT_MS).toISOString();

  // ── 1. Agenti in timeout ─────────────────────
  // Agenti con status != 'offline' e last_seen più vecchio di 3 minuti
  const staleAgents = db.prepare(`
    SELECT agent_name, status, last_seen, current_task
    FROM agent_heartbeats
    WHERE status IN ('idle', 'busy', 'error')
      AND last_seen < ?
    ORDER BY last_seen ASC
  `).all(threshold) as Array<{
    agent_name: string;
    status: string;
    last_seen: string;
    current_task: string | null;
  }>;

  for (const agent of staleAgents) {
    // Marca come offline nel database
    db.prepare(`
      UPDATE agent_heartbeats
      SET status = 'offline', current_task = NULL
      WHERE agent_name = ?
    `).run(agent.agent_name);

    // Aggiungi al set degli offline marcati dal monitor
    markedOffline.add(agent.agent_name);

    // Emetti evento timeout
    const event: MessagingEvent = {
      type: 'agent_heartbeat_timeout',
      payload: {
        agent_name: agent.agent_name,
        previous_status: agent.status,
        last_seen: agent.last_seen,
        missing_heartbeats: 3,
        threshold_minutes: HEARTBEAT_TIMEOUT_MS / 60_000,
      },
      timestamp: new Date().toISOString(),
      agent_name: agent.agent_name,
    };
    emit(event);

    console.error(
      `[heartbeat-monitor] Agent '${agent.agent_name}' marked OFFLINE` +
      ` (was: ${agent.status}, last seen: ${agent.last_seen})`
    );
  }

  // ── 2. Agenti tornati online ──────────────────
  // Agenti che erano stati marcati offline dal monitor ma ora
  // hanno uno stato attivo (idle/busy/error) — significa che
  // hanno chiamato upsertHeartbeat tramite un tool handler
  if (markedOffline.size > 0) {
    const placeholders = [...markedOffline].map(() => '?').join(', ');

    const resumedAgents = db.prepare(`
      SELECT agent_name, status, last_seen, current_task
      FROM agent_heartbeats
      WHERE agent_name IN (${placeholders})
        AND status IN ('idle', 'busy', 'error')
    `).all(...markedOffline) as Array<{
      agent_name: string;
      status: string;
      last_seen: string;
      current_task: string | null;
    }>;

    for (const agent of resumedAgents) {
      // Rimuovi dal set degli offline
      markedOffline.delete(agent.agent_name);

      // Emetti evento resume
      const event: MessagingEvent = {
        type: 'agent_heartbeat_resume',
        payload: {
          agent_name: agent.agent_name,
          current_status: agent.status,
          current_task: agent.current_task,
          last_seen: agent.last_seen,
          offline_duration_seconds: calculateOfflineDuration(agent.last_seen),
        },
        timestamp: new Date().toISOString(),
        agent_name: agent.agent_name,
      };
      emit(event);

      console.error(
        `[heartbeat-monitor] Agent '${agent.agent_name}' RESUMED` +
        ` (status: ${agent.status}, task: ${agent.current_task ?? 'none'})`
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Resume notification (per external callers)
// ---------------------------------------------------------------------------

/**
 * Permette a codice esterno (es. tool handler agent_status) di notificare
 * che un agente è tornato online dopo essere stato offline.
 *
 * Utile quando upsertHeartbeat rileva una transizione offline → online
 * e vuole emettere subito l'evento resume senza attendere il prossimo
 * ciclo del monitor (latenza massima 30s).
 *
 * @param agentName - Nome dell'agente che è tornato online
 * @param newStatus - Nuovo stato (idle/busy/error)
 * @param currentTask - Task corrente (opzionale)
 */
export function notifyHeartbeatResume(
  agentName: string,
  newStatus: string,
  currentTask?: string
): void {
  // Se l'agente era nel set degli offline, rimuovilo
  markedOffline.delete(agentName);

  const event: MessagingEvent = {
    type: 'agent_heartbeat_resume',
    payload: {
      agent_name: agentName,
      current_status: newStatus,
      current_task: currentTask ?? null,
      last_seen: new Date().toISOString(),
      source: 'upsert',
    },
    timestamp: new Date().toISOString(),
    agent_name: agentName,
  };
  emit(event);

  console.error(
    `[heartbeat-monitor] Agent '${agentName}' RESUMED (via upsert, status: ${newStatus})`
  );
}

/**
 * Notifica che un agente ha aggiornato il proprio heartbeat.
 * Utile per tracciamento e metriche.
 *
 * @param agentName - Nome dell'agente
 * @param status - Nuovo stato
 */
export function notifyHeartbeatUpdate(
  agentName: string,
  status: string
): void {
  // Al momento è un no-op, ma può essere usato per metriche future
  // Esempio: tracciare heartbeat ricevuti, calcolare latenza media, ecc.
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

/**
 * Calcola quanti secondi sono passati da last_seen a ora.
 * Restituisce 0 se last_seen è nel futuro.
 *
 * @param lastSeen - Timestamp ISO 8601
 * @returns Secondi trascorsi
 */
function calculateOfflineDuration(lastSeen: string): number {
  const lastSeenMs = new Date(lastSeen).getTime();
  const nowMs = Date.now();
  return Math.max(0, Math.floor((nowMs - lastSeenMs) / 1000));
}
