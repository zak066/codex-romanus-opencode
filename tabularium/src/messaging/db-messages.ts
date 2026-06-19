/**
 * messaging/db-messages.ts
 * CRUD per la tabella messages del database SQLite.
 * Gestisce invio, lettura, paginazione, read/unread tracking e
 * ricerca full-text dei messaggi tra agenti.
 *
 * @module messaging/db-messages
 */

import { getDatabase } from '../core/database.js';
import { randomUUID } from 'node:crypto';
import type { Message, MessagePagination } from './types.js';
import { getChannel, getChannelByName } from './db-channels.js';

// ---------------------------------------------------------------------------
// Message CRUD
// ---------------------------------------------------------------------------

/**
 * Invia un messaggio in un canale.
 *
 * @param channelId - ID del canale di destinazione
 * @param sender - Nome dell'agente mittente
 * @param content - Corpo del messaggio (testo plain)
 * @param metadata - Metadati opzionali JSON-serializzabili
 * @returns Il messaggio creato
 * @throws Error se il canale non esiste
 */
export function sendMessage(
  channelId: string,
  sender: string,
  content: string,
  metadata?: Record<string, unknown>
): Message {
  const db = getDatabase();

  // Verifica che il canale esista
  const channel = getChannel(channelId);
  if (!channel) {
    throw new Error(`CHANNEL_NOT_FOUND: Channel '${channelId}' not found.`);
  }

  const id = `msg_${randomUUID()}`;
  const now = new Date().toISOString();
  const metadataJson = JSON.stringify(metadata ?? {});

  db.prepare(`
    INSERT INTO messages (id, channel_id, sender, content, created_at, metadata)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, channelId, sender, content, now, metadataJson);

  const message = getMessage(id);
  if (!message) {
    throw new Error(`Failed to retrieve created message '${id}'`);
  }

  return message;
}

/**
 * Recupera i messaggi di un canale con paginazione cursor-based.
 * Ordinati per created_at DESC (dal più recente al più vecchio).
 *
 * @param channelId - ID del canale
 * @param limit - Numero massimo di messaggi (default: 50, max: 100)
 * @param before - ID dell'ultimo messaggio già visto (cursor pagination)
 * @returns Array di messaggi
 * @throws Error se il canale non esiste
 */
export function getMessages(
  channelId: string,
  limit?: number,
  before?: string
): Message[] {
  const db = getDatabase();

  // Verifica che il canale esista
  const channel = getChannel(channelId);
  if (!channel) {
    throw new Error(`CHANNEL_NOT_FOUND: Channel '${channelId}' not found.`);
  }

  const maxLimit = Math.min(limit ?? 50, 100);

  let sql = 'SELECT * FROM messages WHERE channel_id = ?';
  const params: unknown[] = [channelId];

  if (before) {
    // Cursor-based pagination: messaggi prima (piu vecchi) di questo ID
    sql += ' AND created_at < (SELECT created_at FROM messages WHERE id = ?)';
    params.push(before);
  }

  sql += ' ORDER BY created_at DESC, rowid DESC LIMIT ?';
  params.push(maxLimit);

  const rows = db.prepare(sql).all(...params) as Record<string, unknown>[];
  return rows.map(mapRowToMessage);
}

/**
 * Recupera i messaggi nella DM inbox di un agente.
 * Convenzione: il canale DM per un agente si chiama "dm-{agentName}".
 *
 * @param agentName - Nome dell'agente
 * @param limit - Numero massimo di messaggi (default: 20, max: 100)
 * @returns Array di messaggi nella DM dell'agente
 */
export function getInbox(agentName: string, limit?: number): Message[] {
  const db = getDatabase();

  const dmChannelName = `dm-${agentName}`;
  const channel = getChannelByName(dmChannelName);

  if (!channel) return [];

  const maxLimit = Math.min(limit ?? 20, 100);

  const rows = db.prepare(`
    SELECT * FROM messages
    WHERE channel_id = ?
    ORDER BY created_at DESC, rowid DESC
    LIMIT ?
  `).all(channel.id, maxLimit) as Record<string, unknown>[];

  return rows.map(mapRowToMessage);
}

/**
 * Recupera un singolo messaggio per ID.
 *
 * @param id - ID del messaggio
 * @returns Il messaggio trovato o undefined
 */
export function getMessage(id: string): Message | undefined {
  const db = getDatabase();

  const row = db.prepare('SELECT * FROM messages WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined;

  if (!row) return undefined;
  return mapRowToMessage(row);
}

/**
 * Elimina un messaggio per ID.
 *
 * @param id - ID del messaggio da eliminare
 * @returns true se eliminato, false se non trovato
 */
export function deleteMessage(id: string): boolean {
  const db = getDatabase();

  const result = db.prepare('DELETE FROM messages WHERE id = ?').run(id);
  return result.changes > 0;
}

// ---------------------------------------------------------------------------
// Read/Unread Tracking (GAP-02 — R2.3)
// ---------------------------------------------------------------------------

/**
 * Mark a single DM message as read by setting its read_at timestamp.
 *
 * @param messageId - ID of the message to mark as read
 * @param agentName - Agent marking it as read (validates authorization)
 * @returns true if marked, false if message not found or unauthorized
 */
export function markMessageRead(messageId: string, agentName: string): boolean {
  const db = getDatabase();
  const message = getMessage(messageId);
  if (!message) return false;

  // Only the recipient of a DM can mark as read
  // DM channels are named dm-{agentName}
  const channel = getChannel(message.channel_id);
  if (!channel) return false;

  // Allow marking if the channel is a DM for this agent
  const isDmForAgent = channel.name === `dm-${agentName}`;
  if (!isDmForAgent && message.sender !== agentName) {
    return false; // Not authorized to mark this message as read
  }

  const now = new Date().toISOString();
  const result = db.prepare('UPDATE messages SET read_at = ? WHERE id = ?').run(now, messageId);
  return result.changes > 0;
}

/**
 * Mark ALL unread DM messages in an agent's inbox as read.
 *
 * @param agentName - Agent whose DM messages to mark as read
 * @returns number of messages marked as read
 */
export function markAllDmMessagesRead(agentName: string): number {
  const db = getDatabase();
  const dmChannelName = `dm-${agentName}`;
  const channel = getChannelByName(dmChannelName);
  if (!channel) return 0;

  const now = new Date().toISOString();
  const result = db.prepare(`
    UPDATE messages SET read_at = ?
    WHERE channel_id = ? AND read_at IS NULL
  `).run(now, channel.id);
  return result.changes;
}

/**
 * Get the count of unread DM messages for an agent.
 *
 * @param agentName - Name of the agent
 * @returns Number of unread messages in the agent's DM inbox
 */
export function getUnreadCount(agentName: string): number {
  const db = getDatabase();
  const dmChannelName = `dm-${agentName}`;
  const channel = getChannelByName(dmChannelName);
  if (!channel) return 0;

  const result = db.prepare(
    'SELECT COUNT(*) as count FROM messages WHERE channel_id = ? AND read_at IS NULL'
  ).get(channel.id) as { count: number };
  return result.count;
}

// ---------------------------------------------------------------------------
// FTS5 Search
// ---------------------------------------------------------------------------

/**
 * Risultato di una ricerca full-text su messaggi.
 * Estende Message con channel_name e rank FTS5.
 */
export interface MessageSearchResult {
  id: string;
  channel_id: string;
  channel_name: string;
  sender: string;
  content: string;
  created_at: string;
  metadata: Record<string, unknown> | undefined;
  rank: number;
}

/**
 * Cerca messaggi usando l'indice FTS5.
 *
 * Supporta:
 *   - Query FTS5 con sintassi completa (AND, OR, NOT, phrase, prefix)
 *   - Filtri opzionali per canale e mittente
 *   - Limite risultati (default: 20, max: 100)
 *   - Ordinamento per rank (rilevanza)
 *
 * @param query - Query di ricerca in sintassi FTS5 (es. 'hello world', '"exact phrase"')
 * @param limit - Numero massimo di risultati (default: 20, max: 100)
 * @param channelFilter - ID del canale per filtrare (opzionale)
 * @param senderFilter - Nome del mittente per filtrare (opzionale)
 * @returns Array di risultati ordinati per rilevanza
 */
export function searchMessages(
  query: string,
  limit?: number,
  channelFilter?: string,
  senderFilter?: string
): MessageSearchResult[] {
  const db = getDatabase();
  const maxLimit = Math.min(limit ?? 20, 100);

  let sql = `
    SELECT m.id, m.channel_id, c.name as channel_name, m.sender, m.content, m.created_at, m.metadata, fts.rank
    FROM messages_fts fts
    JOIN messages m ON m.rowid = fts.rowid
    LEFT JOIN channels c ON c.id = m.channel_id
    WHERE messages_fts MATCH ?
  `;
  const params: unknown[] = [query];

  if (channelFilter) {
    sql += ' AND m.channel_id = ?';
    params.push(channelFilter);
  }
  if (senderFilter) {
    sql += ' AND m.sender = ?';
    params.push(senderFilter);
  }

  sql += ' ORDER BY fts.rank LIMIT ?';
  params.push(maxLimit);

  const rows = db.prepare(sql).all(...params) as Record<string, unknown>[];
  return rows.map(mapRowToSearchResult);
}

/**
 * Mappa una riga del database in un oggetto MessageSearchResult.
 */
function mapRowToSearchResult(row: Record<string, unknown>): MessageSearchResult {
  return {
    id: row.id as string,
    channel_id: row.channel_id as string,
    channel_name: (row.channel_name as string) ?? '',
    sender: row.sender as string,
    content: row.content as string,
    created_at: row.created_at as string,
    metadata: (() => {
      const raw = row.metadata as string | null;
      if (!raw) return undefined;
      try {
        const parsed = JSON.parse(raw);
        if (Object.keys(parsed).length === 0) return undefined;
        return parsed;
      } catch { return undefined; }
    })(),
    rank: (row.rank as number) ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

/**
 * Mappa una riga del database in un oggetto Message.
 */
function mapRowToMessage(row: Record<string, unknown>): Message {
  return {
    id: row.id as string,
    channel_id: row.channel_id as string,
    sender: row.sender as string,
    content: row.content as string,
    created_at: row.created_at as string,
    read_at: (row.read_at as string) ?? undefined,
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
