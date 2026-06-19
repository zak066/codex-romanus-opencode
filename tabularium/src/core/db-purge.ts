/**
 * core/db-purge.ts
 * Core logic per memory purge operations (MCP² Phase 3 — PURGE).
 *
 * Pure SQLite operations — nessuna dipendenza da altri tool MCP.
 * Safe guards assolute:
 *   - MAI cancellare knowledge_entries
 *   - MAI cancellare decision_rationale (ADR)
 *   - MAI cancellare metrics
 *   - MAI cancellare _migrations
 *   - MAI cancellare ultimi N snapshot (keepLastSnapshots)
 *   - MAI cancellare eventi recenti (WHERE timestamp condizionale)
 *
 * @module core/db-purge
 */

import fs from 'node:fs';
import { getDatabase, getDbPath } from './database.js';

// ---------------------------------------------------------------------------
// Tipi pubblici
// ---------------------------------------------------------------------------

/** Conteggi per dry-run preview */
export interface PurgeCounts {
  events: number;
  sessions: number;
  contexts: number;
}

/** Parametri per logPurgeRecord */
export interface PurgeLogParams {
  olderThan: number;
  eventsDeleted: number;
  sessionsDeleted: number;
  contextsDeleted: number;
  spaceRecoveredKb: number;
  dbSizeBeforeKb: number;
  dbSizeAfterKb: number;
  knowledgeCondensed: number;
  agent: string;
}

// ---------------------------------------------------------------------------
// Schema _purge_log
// ---------------------------------------------------------------------------

/**
 * SQL per creazione tabella _purge_log.
 * Usa CREATE TABLE IF NOT EXISTS per idempotenza.
 */
const PURGE_LOG_TABLE_SQL: string = `
  CREATE TABLE IF NOT EXISTS _purge_log (
    purge_id            INTEGER PRIMARY KEY AUTOINCREMENT,
    executed_at         TEXT NOT NULL DEFAULT (datetime('now')),
    dry_run             INTEGER NOT NULL DEFAULT 1,
    agent               TEXT,
    older_than          INTEGER NOT NULL DEFAULT 30,
    events_deleted      INTEGER DEFAULT 0,
    sessions_deleted    INTEGER DEFAULT 0,
    snapshots_deleted   INTEGER DEFAULT 0,
    space_recovered_kb  REAL DEFAULT 0,
    db_size_before_kb   REAL DEFAULT 0,
    db_size_after_kb    REAL DEFAULT 0,
    knowledge_condensed INTEGER DEFAULT 0
  )
`;

/**
 * Assicura che la tabella _purge_log esista.
 * Chiamata automaticamente da getNextPurgeId e logPurgeRecord.
 */
function ensurePurgeLogTable(): void {
  const db = getDatabase();
  db.exec(PURGE_LOG_TABLE_SQL);
}

// ---------------------------------------------------------------------------
// Counting (dry-run) — stima elementi da eliminare
// ---------------------------------------------------------------------------

/**
 * Conta gli elementi più vecchi di N giorni.
 * Usato in dry-run per mostrare preview senza modificare il database.
 *
 * Safe guards applicate:
 *   - knowledge_entries: MAI conteggiate
 *   - decision_rationale: MAI conteggiate
 *   - metrics: MAI conteggiate
 *   - _migrations: MAI conteggiate
 *   - Eventi recenti (≤ days): esclusi dalla SELECT
 *
 * @param days - Età minima in giorni per il conteggio (≥ 1)
 * @returns PurgeCounts con eventi, sessioni e snapshot
 */
export function countEventsOlderThan(days: number): PurgeCounts {
  const db = getDatabase();
  const paramExpr = `date('now', '-' || ? || ' days')`;

  const eventsRow = db.prepare(
    `SELECT COUNT(*) as cnt FROM events WHERE timestamp < ${paramExpr}`
  ).get(days) as { cnt: number } | undefined;

  const sessionsRow = db.prepare(
    `SELECT COUNT(*) as cnt FROM sessions WHERE status IN ('aborted', 'interrupted') AND start_time < ${paramExpr}`
  ).get(days) as { cnt: number } | undefined;

  // Conta snapshot più vecchi di N giorni (esclusi ultimi keepLastSnapshots — qui non noti,
  // quindi conteggia TUTTI i vecchi; il filtro keepLastSnapshots è applicato solo in DELETE)
  const contextsRow = db.prepare(
    `SELECT COUNT(*) as cnt FROM contexts WHERE context_type = 'snapshot' AND created_at < ${paramExpr}`
  ).get(days) as { cnt: number } | undefined;

  return {
    events: eventsRow?.cnt ?? 0,
    sessions: sessionsRow?.cnt ?? 0,
    contexts: contextsRow?.cnt ?? 0,
  };
}

// ---------------------------------------------------------------------------
// DELETE operations — esecuzione effettiva
// ---------------------------------------------------------------------------

/**
 * Elimina eventi raw più vecchi di N giorni.
 *
 * Safe guard: MAI tocca knowledge_entries / decision_rationale / metrics / _migrations.
 *
 * @param days - Età minima in giorni (≥ 1)
 * @returns Numero di record cancellati
 */
export function deleteEventsOlderThan(days: number): number {
  const db = getDatabase();
  const result = db.prepare(
    `DELETE FROM events WHERE timestamp < date('now', '-' || ? || ' days')`
  ).run(days);
  return result.changes;
}

/**
 * Elimina sessioni fallite/abortite più vecchie di N giorni.
 *
 * Safe guard: sessioni attive o completate NON vengono mai cancellate.
 *
 * @param days - Età minima in giorni (≥ 1)
 * @param _keepLastSnapshots - Mantenuto per consistenza API (non applicato alle sessioni)
 * @returns Numero di record cancellati
 */
export function deleteSessionsOlderThan(days: number, _keepLastSnapshots: number): number {
  const db = getDatabase();
  const result = db.prepare(
    `DELETE FROM sessions WHERE status IN ('aborted', 'interrupted') AND start_time < date('now', '-' || ? || ' days')`
  ).run(days);
  return result.changes;
}

/**
 * Elimina snapshot (context_type='snapshot') più vecchi di N giorni,
 * preservando almeno gli ultimi N snapshot.
 *
 * Safe guard:
 *   - MAI cancellare ultimi `keepLastSnapshots` snapshot
 *   - MAI cancellare contesti non-snapshot (task_context, session_start, etc.)
 *
 * @param days - Età minima in giorni (≥ 1)
 * @param keepLastSnapshots - Numero di snapshot recenti da preservare (≥ 1)
 * @returns Numero di record cancellati
 */
export function deleteContextsOlderThan(days: number, keepLastSnapshots: number): number {
  const db = getDatabase();
  const result = db.prepare(
    `DELETE FROM contexts
     WHERE context_type = 'snapshot'
       AND created_at < date('now', '-' || ? || ' days')
       AND id NOT IN (
         SELECT id FROM contexts
         WHERE context_type = 'snapshot'
         ORDER BY created_at DESC
         LIMIT ?
       )`
  ).run(days, keepLastSnapshots);
  return result.changes;
}

// ---------------------------------------------------------------------------
// Stima spazio recuperabile
// ---------------------------------------------------------------------------

/**
 * Stima lo spazio recuperabile sommando la lunghezza dei campi testuali
 * degli eventi che verranno cancellati.
 *
 * NOTA: Questa è una stima del contenuto, non della reale riduzione del file DB
 * (che dipende da VACUUM/CHECKPOINT). La differenza può essere significativa.
 *
 * @param days - Età minima in giorni per la stima
 * @returns Stima in kilobyte (arrotondata)
 */
export function estimateRecoverableSpace(days: number): number {
  const db = getDatabase();

  // Somma LENGTH di summary + details + tags per eventi da cancellare
  const row = db.prepare(`
    SELECT COALESCE(
      SUM(LENGTH(summary) + LENGTH(COALESCE(details, '{}')) + LENGTH(COALESCE(tags, '[]'))),
      0
    ) / 1024.0 AS estimated_kb
    FROM events
    WHERE timestamp < date('now', '-' || ? || ' days')
  `).get(days) as { estimated_kb: number } | undefined;

  return Math.round(row?.estimated_kb ?? 0);
}

// ---------------------------------------------------------------------------
// Dimensione database
// ---------------------------------------------------------------------------

/**
 * Restituisce la dimensione del file database in kilobyte.
 * Usa fs.statSync per leggere la dimensione effettiva del file.
 *
 * @returns Dimensione in KB (0 se il file non è accessibile)
 */
export function getDatabaseSizeKb(): number {
  const dbPath = getDbPath();
  if (!dbPath) {
    return 0;
  }
  try {
    const stats = fs.statSync(dbPath);
    return Math.round(stats.size / 1024);
  } catch {
    // File non accessibile (non inizializzato, permessi, etc.)
    return 0;
  }
}

// ---------------------------------------------------------------------------
// PURGE_ID lifecycle
// ---------------------------------------------------------------------------

/**
 * Genera il prossimo PURGE_ID incrementale.
 * Legge MAX(purge_id) dalla tabella _purge_log e restituisce +1.
 * Crea la tabella _purge_log se non esiste.
 *
 * @returns Prossimo purge_id (1-based, parte da 1)
 */
export function getNextPurgeId(): number {
  ensurePurgeLogTable();
  const db = getDatabase();
  const row = db.prepare(
    'SELECT COALESCE(MAX(purge_id), 0) + 1 AS next_id FROM _purge_log'
  ).get() as { next_id: number } | undefined;
  return row?.next_id ?? 1;
}

/**
 * Registra un'operazione PURGE nella tabella _purge_log.
 * Crea la tabella se non esiste.
 *
 * @param purgeId - ID progressivo del purge
 * @param dryRun - Se true, registra come dry-run (nessun DELETE effettivo)
 * @param params - Parametri dell'operazione
 */
export function logPurgeRecord(
  purgeId: number,
  dryRun: boolean,
  params: PurgeLogParams,
): void {
  ensurePurgeLogTable();
  const db = getDatabase();
  db.prepare(`
    INSERT INTO _purge_log
      (purge_id, dry_run, agent, older_than, events_deleted, sessions_deleted,
       snapshots_deleted, space_recovered_kb, db_size_before_kb,
       db_size_after_kb, knowledge_condensed)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    purgeId,
    dryRun ? 1 : 0,
    params.agent,
    params.olderThan,
    params.eventsDeleted,
    params.sessionsDeleted,
    params.contextsDeleted,
    params.spaceRecoveredKb,
    params.dbSizeBeforeKb,
    params.dbSizeAfterKb,
    params.knowledgeCondensed,
  );
}

/**
 * Restituisce il totale degli eventi più vecchi di N giorni.
 * Utile per metriche e stime aggiuntive.
 *
 * @param days - Età minima in giorni
 * @returns Numero totale di eventi candidati
 */
export function getTotalEventsOlderThan(days: number): number {
  const db = getDatabase();
  const row = db.prepare(
    `SELECT COUNT(*) as cnt FROM events WHERE timestamp < date('now', '-' || ? || ' days')`
  ).get(days) as { cnt: number } | undefined;
  return row?.cnt ?? 0;
}
