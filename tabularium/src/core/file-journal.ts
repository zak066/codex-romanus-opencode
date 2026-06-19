/**
 * core/file-journal.ts
 * File Change Journal per tracciare ogni modifica ai file del progetto (Fase 7 FABRICA).
 *
 * Stesso pattern di bug-tracker.ts e alert-manager.ts:
 *   - better-sqlite3 con prepared statements
 *   - Cache-aside con Cache<T> e TTL 30 secondi
 *   - Prefisso ID: fc_{uuid}
 *
 * @module core/file-journal
 */

import crypto from 'node:crypto';
import { getDatabase } from './database.js';
import { Cache } from './cache.js';

// ---------------------------------------------------------------------------
// Tipi pubblici
// ---------------------------------------------------------------------------

/** Tipo di modifica */
export type ChangeType = 'created' | 'modified' | 'deleted' | 'renamed';

/** Record completo di una modifica a un file (corrisponde a una riga della tabella file_changes) */
export interface FileChangeRecord {
  id: string;
  file_path: string;
  agent: string;
  session_id?: string;
  task_id?: string;
  change_type: ChangeType;
  summary: string;
  diff?: string;
  created_at: string;
}

/** Parametri per la registrazione di una modifica */
export interface LogChangeParams {
  file_path: string;
  agent: string;
  change_type: string;
  summary: string;
  session_id?: string;
  task_id?: string;
  diff?: string;
}

/** Filtri per queryChanges */
export interface QueryChangesParams {
  file_path?: string;
  agent?: string;
  task_id?: string;
  change_type?: string;
  limit?: number;
  offset?: number;
}

/** Risultato di queryChanges */
export interface QueryChangesResult {
  changes: FileChangeRecord[];
  total: number;
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

/**
 * Cache per file journal — TTL 30 secondi.
 * Le modifiche vengono registrate frequentemente, quindi un TTL breve
 * garantisce dati freschi senza impattare le performance.
 */
const journalCache = new Cache<unknown>(30_000);

/** Prefisso per chiavi cache */
const CACHE_PREFIX = 'journal:';

// ---------------------------------------------------------------------------
// Tipi di modifica validi
// ---------------------------------------------------------------------------

const VALID_CHANGE_TYPES: ChangeType[] = ['created', 'modified', 'deleted', 'renamed'];

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

/**
 * Crea la tabella `file_changes` e gli indici se non esistono.
 * Chiamata all'avvio del server o al primo utilizzo per garantire
 * che lo schema sia presente (fallback se la migration non è ancora passata).
 *
 * Usa `CREATE TABLE IF NOT EXISTS` e `CREATE INDEX IF NOT EXISTS`
 * per essere idempotente.
 */
export function ensureFileJournalSchema(): void {
  const db = getDatabase();

  db.exec(`
    CREATE TABLE IF NOT EXISTS file_changes (
      id          TEXT PRIMARY KEY,
      file_path   TEXT NOT NULL,
      agent       TEXT NOT NULL,
      session_id  TEXT,
      task_id     TEXT,
      change_type TEXT NOT NULL CHECK(change_type IN ('created', 'modified', 'deleted', 'renamed')),
      summary     TEXT NOT NULL,
      diff        TEXT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.exec('CREATE INDEX IF NOT EXISTS idx_file_changes_file_path ON file_changes(file_path)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_file_changes_agent ON file_changes(agent)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_file_changes_task_id ON file_changes(task_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_file_changes_created_at ON file_changes(created_at)');
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

/**
 * Registra una modifica a un file nel journal.
 *
 * @param params - Parametri per la registrazione della modifica
 * @returns La modifica appena registrata
 *
 * @example
 * ```ts
 * const entry = logChange({
 *   file_path: 'src/core/file-journal.ts',
 *   agent: 'vulcanus-senior-dev',
 *   change_type: 'created',
 *   summary: 'Creato modulo File Change Journal',
 *   task_id: 'task_fabrica_7',
 * });
 * ```
 */
export function logChange(params: LogChangeParams): FileChangeRecord {
  const db = getDatabase();

  // Validazione change_type
  const changeType = params.change_type.toLowerCase() as ChangeType;
  if (!VALID_CHANGE_TYPES.includes(changeType)) {
    throw new Error(
      `Invalid change_type '${params.change_type}'. Supported values: ${VALID_CHANGE_TYPES.join(', ')}`
    );
  }

  const id = `fc_${crypto.randomUUID()}`;

  db.prepare(`
    INSERT INTO file_changes (id, file_path, agent, session_id, task_id, change_type, summary, diff)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    params.file_path,
    params.agent,
    params.session_id ?? null,
    params.task_id ?? null,
    changeType,
    params.summary,
    params.diff ?? null,
  );

  // Invalida cache
  invalidateJournalCache();

  return getChangeById(id);
}

// ---------------------------------------------------------------------------
// Read / List
// ---------------------------------------------------------------------------

/**
 * Recupera una modifica per ID.
 *
 * @param id - ID della modifica
 * @returns FileChangeRecord
 * @throws Error se la modifica non esiste
 */
export function getChangeById(id: string): FileChangeRecord {
  const db = getDatabase();
  const row = db.prepare('SELECT * FROM file_changes WHERE id = ?').get(id) as Record<string, unknown> | undefined;

  if (!row) {
    throw new Error(`Journal entry not found: ${id}`);
  }

  return parseJournalRow(row);
}

/**
 * Interroga il journal con filtri opzionali.
 *
 * Supporta filtri per file_path, agent, task_id, change_type.
 * I risultati sono paginati con limit/offset.
 *
 * @param params - Filtri opzionali
 * @returns Lista di modifiche e conteggio totale
 *
 * @example
 * ```ts
 * // Tutte le modifiche di un file
 * const { changes, total } = queryChanges({ file_path: 'src/core/file-journal.ts' });
 *
 * // Modifiche di un agente specifico
 * const agentChanges = queryChanges({ agent: 'vulcanus-senior-dev', limit: 20 });
 * ```
 */
export function queryChanges(params?: QueryChangesParams): QueryChangesResult {
  const db = getDatabase();

  const filePath = params?.file_path;
  const agent = params?.agent;
  const taskId = params?.task_id;
  const changeType = params?.change_type;
  const limit = params?.limit ?? 50;
  const offset = params?.offset ?? 0;

  // Cache key basata sui parametri
  const cacheKey = buildJournalCacheKey('query', {
    file_path: filePath ?? '',
    agent: agent ?? '',
    task_id: taskId ?? '',
    change_type: changeType ?? '',
    limit: String(limit),
    offset: String(offset),
  });

  // Cache-aside
  const cached = journalCache.get(cacheKey);
  if (cached) {
    return cached as QueryChangesResult;
  }

  // Costruisci filtri WHERE dinamici
  const whereClauses: string[] = [];
  const queryParams: unknown[] = [];

  if (filePath) {
    whereClauses.push('file_path = ?');
    queryParams.push(filePath);
  }

  if (agent) {
    whereClauses.push('agent = ?');
    queryParams.push(agent);
  }

  if (taskId) {
    whereClauses.push('task_id = ?');
    queryParams.push(taskId);
  }

  if (changeType) {
    whereClauses.push('change_type = ?');
    queryParams.push(changeType.toLowerCase());
  }

  const whereSQL = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

  // Count totale
  const countRow = db.prepare(`SELECT COUNT(*) AS total FROM file_changes ${whereSQL}`).get(...queryParams) as { total: number };
  const total = countRow.total;

  // Query paginata
  const rows = db.prepare(`
    SELECT * FROM file_changes ${whereSQL}
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `).all(...queryParams, limit, offset) as Record<string, unknown>[];

  const changes = rows.map(parseJournalRow);

  const result: QueryChangesResult = { changes, total };

  // Popola cache
  journalCache.set(cacheKey, result);

  return result;
}

/**
 * Recupera la cronologia completa delle modifiche per un file specifico.
 *
 * @param filePath - Percorso del file
 * @param limit - Numero massimo di risultati (default: 50)
 * @returns Array di FileChangeRecord ordinati per created_at DESC
 *
 * @example
 * ```ts
 * const history = getChangesByFile('src/core/file-journal.ts', 10);
 * ```
 */
export function getChangesByFile(filePath: string, limit?: number): FileChangeRecord[] {
  const result = queryChanges({ file_path: filePath, limit });
  return result.changes;
}

/**
 * Recupera le ultime N modifiche registrate nel journal.
 *
 * @param limit - Numero massimo di risultati (default: 20)
 * @returns Array di FileChangeRecord ordinati per created_at DESC
 *
 * @example
 * ```ts
 * const recent = getRecentChanges(10);
 * ```
 */
export function getRecentChanges(limit?: number): FileChangeRecord[] {
  const result = queryChanges({ limit });
  return result.changes;
}

// ---------------------------------------------------------------------------
// Helpers interni
// ---------------------------------------------------------------------------

/**
 * Invalida tutte le entry in cache relative al journal.
 * Chiamata dopo ogni operazione di scrittura (logChange).
 */
function invalidateJournalCache(): void {
  journalCache.invalidatePrefix(CACHE_PREFIX);
}

/**
 * Resetta completamente la cache del journal.
 * Utile per test che ricreano il database da capo.
 *
 * @example
 * ```ts
 * // In un beforeEach di test
 * resetJournalCache();
 * ```
 */
export function resetJournalCache(): void {
  journalCache.clear();
}

/**
 * Costruisce una chiave cache deterministica per query journal.
 */
function buildJournalCacheKey(prefix: string, parts: Record<string, string>): string {
  const sorted = Object.keys(parts)
    .sort()
    .map((k) => `${k}=${parts[k]}`)
    .join('&');
  return `${CACHE_PREFIX}${prefix}:${sorted}`;
}

/**
 * Parsifica una riga dal database in un FileChangeRecord tipizzato.
 *
 * Converte:
 *   - session_id, task_id, diff da null a undefined
 */
function parseJournalRow(row: Record<string, unknown>): FileChangeRecord {
  return {
    id: String(row.id ?? ''),
    file_path: String(row.file_path ?? ''),
    agent: String(row.agent ?? ''),
    session_id: row.session_id ? String(row.session_id) : undefined,
    task_id: row.task_id ? String(row.task_id) : undefined,
    change_type: String(row.change_type ?? 'modified') as ChangeType,
    summary: String(row.summary ?? ''),
    diff: row.diff ? String(row.diff) : undefined,
    created_at: String(row.created_at ?? ''),
  };
}
