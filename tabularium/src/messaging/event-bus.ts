/**
 * messaging/event-bus.ts
 * EventBus in-memory per il sistema di Messaging Real-Time (R1).
 * Permette ai componenti di emettere eventi e ai client SSE di ascoltarli.
 * Implementazione con Set<Listener> per O(1) unsubscribe, nessuna dipendenza esterna.
 *
 * @module messaging/event-bus
 */

import { randomUUID } from 'node:crypto';
import { getDatabase } from '../core/database.js';

// ---------------------------------------------------------------------------
// Tipi
// ---------------------------------------------------------------------------

/**
 * Tipi di eventi supportati dal sistema di messaging.
 */
export type MessagingEventType =
  | 'message_sent'
  | 'message_deleted'
  | 'channel_created'
  | 'agent_status_change'
  | 'agent_heartbeat_timeout'
  | 'mention'
  | 'agent_heartbeat_resume'
  | 'messages_read';

/**
 * Evento emesso dall'EventBus.
 * Ogni evento include tipo, payload, timestamp e filtri opzionali
 * per canale o agente (usati dal SSE server per routing).
 */
export interface MessagingEvent {
  type: MessagingEventType;
  payload: Record<string, unknown>;
  timestamp: string;
  /**
   * ID del canale associato all'evento (opzionale).
   * Usato per filtraggio: solo i listener interessati a questo canale
   * riceveranno l'evento.
   */
  channel_id?: string;

  /**
   * Nome dell'agente associato all'evento (opzionale).
   * Usato per filtraggio: solo i listener interessati a questo agente
   * riceveranno l'evento.
   */
  agent_name?: string;
}

/**
 * Callback per la ricezione degli eventi.
 */
type EventListener = (event: MessagingEvent) => void;

/**
 * Filtro opzionale per la sottoscrizione.
 * Se specificato, il listener riceve solo eventi che matchano TUTTI i criteri.
 */
interface EventFilter {
  /** Filtra per ID canale */
  channel_id?: string;
  /** Filtra per nome agente */
  agent_name?: string;
  /** Filtra per tipo di evento (uno o più tipi) */
  types?: Set<MessagingEventType>;
}

/**
 * Entry interna del listener registrato.
 * Contiene il callback, il filtro opzionale e un ID univoco.
 */
interface ListenerEntry {
  id: string;
  callback: EventListener;
  filter?: EventFilter;
}

// ---------------------------------------------------------------------------
// Stato
// ---------------------------------------------------------------------------

/**
 * Set di listener registrati.
 * Usiamo Set invece di array per garantire O(1) in inserimento e rimozione.
 * Questo previene memory leak quando molti client si connettono/disconnettono.
 */
const listeners: Set<ListenerEntry> = new Set();

/**
 * Contatore eventi emessi (utile per debugging e metriche).
 */
let eventCounter = 0;

// ---------------------------------------------------------------------------
// Prepared statement lazy (persistenza su DB)
// ---------------------------------------------------------------------------

/** Prepared statement riutilizzabile per INSERT in event_log (lazy-init) */
let insertStmt: import('better-sqlite3').Statement | null = null;

/**
 * Restituisce il prepared statement per l'inserimento in event_log.
 * Inizializzazione lazy: la prima chiamata ottiene il DB e prepara la query.
 * Se il database non è disponibile (es. in test), restituisce null senza crash.
 */
function getInsertStatement(): import('better-sqlite3').Statement | null {
  if (insertStmt) return insertStmt;

  try {
    const db = getDatabase();
    insertStmt = db.prepare(`
      INSERT INTO event_log (event_type, payload, channel_id, agent_name, event_timestamp)
      VALUES (@event_type, @payload, @channel_id, @agent_name, @event_timestamp)
    `);
    return insertStmt;
  } catch {
    // Database non inizializzato — skip persistenza (normale in test)
    return null;
  }
}

// ---------------------------------------------------------------------------
// Pubbliche
// ---------------------------------------------------------------------------

/**
 * Emette un evento a tutti i listener registrati.
 *
 * Ogni listener viene invocato solo se il suo filtro (se presente)
 * matcha l'evento. Se un listener lancia un'eccezione, viene loggata
 * su stderr e gli altri listener continuano a ricevere l'evento.
 *
 * Dopo il dispatch in-memory, l'evento viene persistito su database
 * (event_log) in modalità fire-and-forget. Se il DB non è disponibile,
 * la persistenza viene saltata senza crash.
 *
 * @param event - Evento da emettere
 */
export function emit(event: MessagingEvent): void {
  eventCounter++;

  // ── Dispatch in-memory (sempre) ──
  for (const entry of listeners) {
    if (matchesFilter(event, entry.filter)) {
      try {
        entry.callback(event);
      } catch (err) {
        console.error(
          `[event-bus] Error in listener '${entry.id}' for event '${event.type}':`,
          err
        );
      }
    }
  }

  // ── Persistenza su DB (fire-and-forget) ──
  try {
    const stmt = getInsertStatement();
    if (stmt) {
      stmt.run({
        event_type: event.type,
        payload: JSON.stringify(event.payload),
        channel_id: event.channel_id ?? null,
        agent_name: event.agent_name ?? null,
        event_timestamp: event.timestamp,
      });
    }
  } catch (err) {
    console.error('[event-bus] Failed to persist event:', err);
  }
}

/**
 * Registra un listener per ricevere eventi.
 *
 * @param callback - Funzione chiamata ad ogni evento匹配ante
 * @param filter - Filtro opzionale (se omesso, riceve TUTTI gli eventi)
 * @returns Funzione unsubscribe() per rimuovere il listener (O(1))
 *
 * @example
 * // Ascolta tutti gli eventi
 * const unsub = subscribe((event) => console.log(event));
 *
 * @example
 * // Ascolta solo eventi heartbeat per un agente specifico
 * const unsub = subscribe(
 *   (event) => handleTimeout(event),
 *   { agent_name: 'vulcanus-senior-dev', types: ['agent_heartbeat_timeout'] }
 * );
 */
export function subscribe(
  callback: EventListener,
  filter?: {
    channel_id?: string;
    agent_name?: string;
    types?: MessagingEventType[];
  }
): () => void {
  const id = randomUUID();

  const entry: ListenerEntry = {
    id,
    callback,
    filter: filter
      ? {
          channel_id: filter.channel_id,
          agent_name: filter.agent_name,
          types: filter.types ? new Set(filter.types) : undefined,
        }
      : undefined,
  };

  listeners.add(entry);

  // Restituisce unsubscribe: O(1) grazie a Set.delete per riferimento oggetto
  return () => {
    listeners.delete(entry);
  };
}

/**
 * Rimuove TUTTI i listener registrati.
 * Utile per shutdown/cleanup del server.
 */
export function clear(): void {
  listeners.clear();
  console.error(`[event-bus] Cleared all listeners (${listeners.size} remaining)`);
}

/**
 * Restituisce il numero di listener attualmente registrati.
 * Utile per metriche e health check.
 */
export function listenerCount(): number {
  return listeners.size;
}

/**
 * Restituisce il numero totale di eventi emessi da quando l'EventBus è attivo.
 */
export function totalEventsEmitted(): number {
  return eventCounter;
}

// ---------------------------------------------------------------------------
// Privato
// ---------------------------------------------------------------------------

/**
 * Verifica se un evento matcha un filtro.
 * Se il filtro è undefined, tutti gli eventi sono accettati.
 * Se il filtro ha più criteri, TUTTI devono matchare (AND logico).
 *
 * @param event - Evento da verificare
 * @param filter - Filtro da applicare (opzionale)
 * @returns true se l'evento matcha il filtro
 */
function matchesFilter(event: MessagingEvent, filter?: EventFilter): boolean {
  if (!filter) return true;

  if (filter.channel_id !== undefined && event.channel_id !== filter.channel_id) {
    return false;
  }

  if (filter.agent_name !== undefined && event.agent_name !== filter.agent_name) {
    return false;
  }

  if (filter.types !== undefined && !filter.types.has(event.type)) {
    return false;
  }

  return true;
}
