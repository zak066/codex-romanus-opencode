/**
 * core/db-compact.ts
 * Core logic per memory compact operations (MCP² Phase 2 — COMPACT).
 *
 * Pure SQLite operations — nessuna dipendenza da altri tool MCP.
 * Safe guards assolute:
 *   - MAI cancellare eventi (quello e' compito di PURGE)
 *   - MAI modificare ADR esistenti
 *   - MAI toccare knowledge entries esistenti (solo creazione nuove)
 *   - MAI modificare metriche esistenti (solo nuove scritture)
 *
 * @module core/db-compact
 */

import fs from 'node:fs';
import { getDatabase, getDbPath } from './database.js';

// ---------------------------------------------------------------------------
// Tipi pubblici
// ---------------------------------------------------------------------------

/** Conteggi per preview compact */
export interface CompactCounts {
  total: number;
  recent: number;
  knowledgeReady: number;
}

/** Statistiche per logCompactRecord */
export interface CompactLogParams {
  olderThan: number;
  knowledgeLimit: number;
  snapshotCreated: number;
  knowledgeCreated: number;
  faqCreated: number;
  snapshotId: string;
  dbSizeKb: number;
  eventCountBefore: number;
  agent: string;
}

// ---------------------------------------------------------------------------
// Schema _compact_log
// ---------------------------------------------------------------------------

/**
 * SQL per creazione tabella _compact_log.
 * Usa CREATE TABLE IF NOT EXISTS per idempotenza.
 */
const COMPACT_LOG_TABLE_SQL: string = `
  CREATE TABLE IF NOT EXISTS _compact_log (
    compact_id         INTEGER PRIMARY KEY AUTOINCREMENT,
    executed_at        TEXT NOT NULL DEFAULT (datetime('now')),
    dry_run            INTEGER NOT NULL DEFAULT 1,
    agent              TEXT,
    older_than         INTEGER NOT NULL DEFAULT 7,
    knowledge_limit    INTEGER NOT NULL DEFAULT 10,
    snapshot_created   INTEGER NOT NULL DEFAULT 0,
    knowledge_created  INTEGER DEFAULT 0,
    faq_created        INTEGER DEFAULT 0,
    snapshot_id        TEXT,
    db_size_kb         REAL DEFAULT 0,
    event_count_before INTEGER DEFAULT 0
  )
`;

/**
 * Assicura che la tabella _compact_log esista.
 * Chiamata automaticamente da getNextCompactId e logCompactRecord.
 */
function ensureCompactLogTable(): void {
  const db = getDatabase();
  db.exec(COMPACT_LOG_TABLE_SQL);
}

// ---------------------------------------------------------------------------
// Counting (dry-run) — stima elementi da compattare
// ---------------------------------------------------------------------------

/**
 * Conta gli eventi nella finestra di compact.
 * Distingue tra totali, recenti e candidati per knowledge.
 *
 * @param days - Finestra in giorni per il conteggio (≥ 1)
 * @returns CompactCounts con total, recent, knowledgeReady
 */
export function countEventsForCompact(days: number): CompactCounts {
  const db = getDatabase();
  const olderExpr = `date('now', '-' || ? || ' days')`;

  // Eventi totali
  const totalRow = db.prepare(
    `SELECT COUNT(*) as cnt FROM events WHERE timestamp >= ${olderExpr}`
  ).get(days) as { cnt: number } | undefined;

  // Eventi recenti (ultime 24 ore) — esclusi da compact
  const recentRow = db.prepare(
    `SELECT COUNT(*) as cnt FROM events WHERE timestamp >= date('now', '-1 day')`
  ).get() as { cnt: number } | undefined;

  // Eventi "knowledge-ready": eventi di errore o task completati nella finestra
  const knowledgeReadyRow = db.prepare(
    `SELECT COUNT(*) as cnt FROM events
     WHERE timestamp >= ${olderExpr}
       AND event_type IN ('task_completed', 'error_encountered', 'task_failed')`
  ).get(days) as { cnt: number } | undefined;

  return {
    total: totalRow?.cnt ?? 0,
    recent: recentRow?.cnt ?? 0,
    knowledgeReady: knowledgeReadyRow?.cnt ?? 0,
  };
}

/**
 * Conta le knowledge entries esistenti (per report).
 *
 * @returns Numero totale di knowledge entries attive
 */
export function countKnowledgeEntries(): number {
  const db = getDatabase();
  try {
    const row = db.prepare(
      `SELECT COUNT(*) as cnt FROM knowledge_entries WHERE status = 'active'`
    ).get() as { cnt: number } | undefined;
    return row?.cnt ?? 0;
  } catch {
    // Tabella potrebbe non esistere ancora
    return 0;
  }
}

/**
 * Restituisce il conteggio totale degli eventi nel database.
 * Utile per metriche post-compact (event_count_before).
 *
 * @returns Numero totale di eventi
 */
export function getTotalEventCount(): number {
  const db = getDatabase();
  try {
    const row = db.prepare(
      'SELECT COUNT(*) as cnt FROM events'
    ).get() as { cnt: number } | undefined;
    return row?.cnt ?? 0;
  } catch {
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Dimensione database
// ---------------------------------------------------------------------------

/**
 * Restituisce la dimensione del file database in kilobyte.
 * Usa fs.statSync per leggere la dimensione effettiva del file.
 *
 * @returns Dimensione in KB (0 se il file non e' accessibile)
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
// COMPACT_ID lifecycle
// ---------------------------------------------------------------------------

/**
 * Genera il prossimo COMPACT_ID incrementale.
 * Legge MAX(compact_id) dalla tabella _compact_log e restituisce +1.
 * Crea la tabella _compact_log se non esiste.
 *
 * @returns Prossimo compact_id (1-based, parte da 1)
 */
export function getNextCompactId(): number {
  ensureCompactLogTable();
  const db = getDatabase();
  const row = db.prepare(
    'SELECT COALESCE(MAX(compact_id), 0) + 1 AS next_id FROM _compact_log'
  ).get() as { next_id: number } | undefined;
  return row?.next_id ?? 1;
}

/**
 * Registra un'operazione COMPACT nella tabella _compact_log.
 * Crea la tabella se non esiste.
 *
 * @param compactId - ID progressivo del compact
 * @param dryRun - Se true, registra come dry-run (nessuna condensazione effettiva)
 * @param stats - Statistiche dell'operazione
 */
export function logCompactRecord(
  compactId: number,
  dryRun: boolean,
  stats: CompactLogParams,
): void {
  ensureCompactLogTable();
  const db = getDatabase();
  db.prepare(`
    INSERT INTO _compact_log
      (compact_id, dry_run, agent, older_than, knowledge_limit,
       snapshot_created, knowledge_created, faq_created,
       snapshot_id, db_size_kb, event_count_before)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    compactId,
    dryRun ? 1 : 0,
    stats.agent,
    stats.olderThan,
    stats.knowledgeLimit,
    stats.snapshotCreated,
    stats.knowledgeCreated,
    stats.faqCreated,
    stats.snapshotId || null,
    stats.dbSizeKb,
    stats.eventCountBefore,
  );
}
