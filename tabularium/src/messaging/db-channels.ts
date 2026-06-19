/**
 * messaging/db-channels.ts
 * CRUD per la tabella channels del database SQLite.
 * Gestisce creazione, lettura e listing dei canali di comunicazione.
 *
 * @module messaging/db-channels
 */

import { getDatabase } from '../core/database.js';
import { randomUUID } from 'node:crypto';
import type { Channel, ChannelFilter } from './types.js';

// ---------------------------------------------------------------------------
// Channel CRUD
// ---------------------------------------------------------------------------

/**
 * Crea un nuovo canale di comunicazione.
 *
 * @param name - Nome del canale (deve essere unico, es. "#general" o "dm-vulcanus")
 * @param description - Descrizione opzionale del canale
 * @param createdBy - Nome dell'agente che crea il canale (o 'system')
 * @returns Il canale creato
 * @throws Error se il nome del canale esiste già
 */
export function createChannel(
  name: string,
  description: string,
  createdBy: string
): Channel {
  const db = getDatabase();

  const id = `ch_${randomUUID().replace(/-/g, '').substring(0, 10)}`;
  const now = new Date().toISOString();

  // Verifica se il canale esiste già prima di inserire
  const existing = db.prepare('SELECT id FROM channels WHERE name = ?').get(name);
  if (existing) {
    throw new Error(`CHANNEL_ALREADY_EXISTS: Channel '${name}' already exists.`);
  }

  db.prepare(`
    INSERT INTO channels (id, name, description, created_by, created_at, is_default)
    VALUES (?, ?, ?, ?, ?, 0)
  `).run(id, name, description, createdBy, now);

  const channel = getChannel(id);
  if (!channel) {
    throw new Error(`Failed to retrieve created channel '${name}'`);
  }

  return channel;
}

/**
 * Recupera tutti i canali, con filtri opzionali.
 *
 * @param filter - Filtri opzionali per search e limit
 * @returns Array di canali
 */
export function listChannels(filter?: ChannelFilter): Channel[] {
  const db = getDatabase();

  let sql = 'SELECT * FROM channels WHERE 1=1';
  const params: unknown[] = [];

  if (filter?.search) {
    sql += ' AND (name LIKE ? OR description LIKE ?)';
    const pattern = `%${filter.search}%`;
    params.push(pattern, pattern);
  }

  sql += ' ORDER BY is_default DESC, name ASC';

  if (filter?.limit) {
    sql += ' LIMIT ?';
    params.push(filter.limit);
  }

  const rows = db.prepare(sql).all(...params) as Record<string, unknown>[];
  return rows.map(mapRowToChannel);
}

/**
 * Recupera un canale per ID.
 *
 * @param id - ID del canale
 * @returns Il canale trovato o undefined
 */
export function getChannel(id: string): Channel | undefined {
  const db = getDatabase();

  const row = db.prepare('SELECT * FROM channels WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined;

  if (!row) return undefined;
  return mapRowToChannel(row);
}

/**
 * Recupera un canale per nome.
 * Utile per tool come agent_send che accettano channel_name.
 *
 * @param name - Nome del canale (es. "#general")
 * @returns Il canale trovato o undefined
 */
export function getChannelByName(name: string): Channel | undefined {
  const db = getDatabase();

  const row = db.prepare('SELECT * FROM channels WHERE name = ?').get(name) as
    | Record<string, unknown>
    | undefined;

  if (!row) return undefined;
  return mapRowToChannel(row);
}

/**
 * Elimina un canale (solo se non è un canale di default).
 *
 * @param id - ID del canale da eliminare
 * @returns true se eliminato, false se non trovato o è default
 */
export function deleteChannel(id: string): boolean {
  const db = getDatabase();

  const channel = getChannel(id);
  if (!channel) return false;
  if (channel.is_default === 1) {
    throw new Error('Cannot delete a default channel.');
  }

  const result = db.prepare('DELETE FROM channels WHERE id = ? AND is_default = 0').run(id);
  return result.changes > 0;
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

/**
 * Mappa una riga del database in un oggetto Channel.
 */
function mapRowToChannel(row: Record<string, unknown>): Channel {
  return {
    id: row.id as string,
    name: row.name as string,
    description: (row.description as string) ?? '',
    created_by: row.created_by as string,
    created_at: row.created_at as string,
    is_default: (row.is_default as number) ?? 0,
  };
}
