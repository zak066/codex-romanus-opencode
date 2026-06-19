/**
 * messaging/types.ts
 * Tipi condivisi per il sistema di Messaging Real-Time (R1).
 * Definisce le interfacce per canali, messaggi e heartbeat degli agenti.
 *
 * @module messaging/types
 */

/**
 * Canale di comunicazione tematico.
 * I canali di default (is_default=1) non sono eliminabili.
 */
export interface Channel {
  id: string;
  name: string;
  description: string;
  created_by: string;
  created_at: string;
  is_default: number;
}

/**
 * Messaggio inviato in un canale.
 * read_at indica quando il messaggio è stato letto dal destinatario (NULL = non letto).
 * metadata contiene JSON opzionale con: type, priority, reply_to, ecc.
 */
export interface Message {
  id: string;
  channel_id: string;
  sender: string;
  content: string;
  created_at: string;
  read_at: string | undefined;
  metadata: Record<string, unknown> | undefined;
}

/**
 * Stato heartbeat di un agente.
 * heartbeat viene aggiornato ogni ~60s dagli agenti attivi.
 */
export interface AgentHeartbeat {
  agent_name: string;
  status: 'idle' | 'busy' | 'error' | 'offline';
  last_seen: string;
  current_task: string | null;
  metadata: Record<string, unknown> | undefined;
}

/**
 * Filtri per la paginazione dei messaggi.
 */
export interface MessagePagination {
  /** ID dell'ultimo messaggio già visto (cursor-based pagination) */
  before?: string;
  /** Numero massimo di messaggi da restituire (default: 50, max: 100) */
  limit?: number;
}

/**
 * Filtri per la ricerca canali.
 */
export interface ChannelFilter {
  /** Cerca per nome/descrizione (LIKE query) */
  search?: string;
  /** Numero massimo di risultati (default: 50) */
  limit?: number;
}
