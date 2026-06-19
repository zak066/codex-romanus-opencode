/**
 * core/ianus-ingest.ts
 * Ingestion engine for Ianus Liminalis journal entries into Tabularium.
 *
 * Reads a JSONL journal file produced by Ianus Liminalis, maps each operation
 * to a Tabularium file_changes entry via IANUS_OPERATION_MAPPING,
 * deduplicates against ianus_ingest_tracker, and inserts into the database.
 *
 * Edge cases handled:
 *   - Missing or empty journal file → empty result (no error thrown)
 *   - Invalid JSON lines → silently skipped
 *   - Unknown operations → skipped with error detail
 *   - Read-only operations (tree, list, stat...) → skipped per mapping
 *   - Duplicate entries → detected via tracking table, reported as duplicate
 *   - Case-insensitive operation matching
 *   - `since` timestamp filter
 *   - `limit` cap on entries processed
 *   - `dryRun` mode (parse + report without writing)
 *   - Transactional inserts (atomic per entry)
 *
 * @module core/ianus-ingest
 */

import type {
  IanusJournalEntry,
  IanusIngestResult,
  IanusIngestResultEntry,
  IanusIngestOptions,
} from '../types/ianus.js';
import { IANUS_OPERATION_MAPPING } from '../types/ianus.js';
import type Database from 'better-sqlite3';
import { readFile, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

// ---------------------------------------------------------------------------
// Costanti
// ---------------------------------------------------------------------------

/** Prefisso per gli ID delle entry inserite in file_changes */
const TABULARIUM_ENTRY_ID_PREFIX = 'ii_';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Ingest Ianus Liminalis journal entries into Tabularium.
 *
 * 1. Ensures the `ianus_ingest_tracker` table exists
 * 2. Reads the JSONL file asynchronously
 * 3. Parses each line, applying `since` and `limit` filters
 * 4. Maps operations (case-insensitive), skips read-only ops
 * 5. Checks duplicates against `ianus_ingest_tracker`
 * 6. Inserts into `file_changes` + `ianus_ingest_tracker` (unless dry-run)
 *
 * @param db          - Open better-sqlite3 database instance
 * @param journalPath - Path to the Ianus journal JSONL file
 * @param options     - Optional: limit, since (ISO timestamp), dryRun
 * @returns IanusIngestResult with per-entry status breakdown
 *
 * @example
 * ```ts
 * import Database from 'better-sqlite3';
 * const db = new Database(':memory:');
 * // Ensure file_changes table exists first
 * db.exec(`CREATE TABLE IF NOT EXISTS file_changes (
 *   id TEXT PRIMARY KEY, file_path TEXT NOT NULL, agent TEXT NOT NULL,
 *   change_type TEXT NOT NULL, summary TEXT NOT NULL, created_at TEXT NOT NULL
 * )`);
 * const result = await ingestIanusJournal(
 *   db,
 *   'ianus-liminalis/.ianus-journal/journal.jsonl',
 *   { limit: 50, since: '2026-01-01T00:00:00.000Z', dryRun: false }
 * );
 * ```
 */
export async function ingestIanusJournal(
  db: Database.Database,
  journalPath: string,
  options: IanusIngestOptions = {},
): Promise<IanusIngestResult> {
  // ── 1. Ensure tracker schema exists ──────────────────────────────────
  ensureTrackerSchema(db);

  // ── 2. Resolve and check journal file ────────────────────────────────
  const resolvedPath = resolve(journalPath);

  const fileExists = await fileIsReadable(resolvedPath);
  if (!fileExists) {
    return buildEmptyResult(`Journal file not found: ${resolvedPath}`);
  }

  // ── 3. Read file content ─────────────────────────────────────────────
  let rawContent: string;
  try {
    rawContent = await readFile(resolvedPath, 'utf-8');
  } catch (err) {
    return buildEmptyResult(
      `Failed to read journal file: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // ── 4. Parse lines into structured entries ───────────────────────────
  const lines = rawContent.split('\n');
  const { limit, since, dryRun } = options;

  const parsedEntries: IanusJournalEntry[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue; // skip empty lines

    let entry: IanusJournalEntry;
    try {
      entry = JSON.parse(trimmed) as IanusJournalEntry;
    } catch {
      continue; // skip malformed JSON
    }

    // Validate required fields
    if (!entry.id || !entry.timestamp || !entry.operation) {
      continue;
    }

    // Apply `since` filter — entry must be >= cutoff
    if (since && entry.timestamp < since) {
      continue;
    }

    parsedEntries.push(entry);
  }

  // ── 5. Apply limit ──────────────────────────────────────────────────
  const entriesToProcess =
    limit !== undefined ? parsedEntries.slice(0, limit) : parsedEntries;

  // ── 6. Process each entry ────────────────────────────────────────────
  const result: IanusIngestResult = {
    imported: 0,
    skipped: 0,
    duplicates: 0,
    errors: 0,
    totalIanusEntries: parsedEntries.length,
    entries: [],
  };

  // Pre-load already tracked IDs for O(1) duplicate lookups
  const trackedIds = loadTrackedIds(db);

  // Prepared statements (reused across loop iterations)
  const stmtInsertChange = db.prepare(`
    INSERT INTO file_changes (id, file_path, agent, change_type, summary, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const stmtInsertTracker = db.prepare(`
    INSERT INTO ianus_ingest_tracker (ianus_entry_id, tabularium_entry_id, imported_at)
    VALUES (?, ?, datetime('now'))
  `);

  for (const entry of entriesToProcess) {
    const entryResult: IanusIngestResultEntry = {
      id: entry.id,
      operation: entry.operation,
      path: entry.path,
      timestamp: entry.timestamp,
      mappedChangeType: null,
      status: 'imported',
    };

    // ── 6a. Map operation (case-insensitive) ──────────────────────────
    const opKey = entry.operation.toLowerCase();
    const mapping = IANUS_OPERATION_MAPPING[opKey];

    if (!mapping) {
      entryResult.status = 'skipped';
      entryResult.error = `Unknown operation '${entry.operation}'`;
      result.skipped++;
      result.entries.push(entryResult);
      continue;
    }

    if (mapping.skip) {
      // Read-only operation — skip without error
      entryResult.status = 'skipped';
      result.skipped++;
      result.entries.push(entryResult);
      continue;
    }

    entryResult.mappedChangeType = mapping.changeType;

    // ── 6b. Check duplicate ───────────────────────────────────────────
    if (trackedIds.has(entry.id)) {
      entryResult.status = 'duplicate';
      result.duplicates++;
      result.entries.push(entryResult);
      continue;
    }

    // ── 6c. Insert into DB (unless dry-run) ───────────────────────────
    if (!dryRun) {
      const tabulariumEntryId = `${TABULARIUM_ENTRY_ID_PREFIX}${randomUUID()}`;

      try {
        // Wrap in transaction for atomicity per entry
        const runInsert = db.transaction(() => {
          stmtInsertChange.run(
            tabulariumEntryId,
            entry.path,
            entry.agent || 'ianus',
            mapping.changeType!,
            `Ianus ${mapping.changeType}: ${entry.path}`,
            entry.timestamp,
          );

          stmtInsertTracker.run(entry.id, tabulariumEntryId);
        });

        runInsert();

        // Update in-memory set so same-batch duplicates are caught too
        trackedIds.add(entry.id);

        result.imported++;
      } catch (err) {
        entryResult.status = 'error';
        entryResult.error = err instanceof Error ? err.message : String(err);
        result.errors++;
      }
    } else {
      // Dry-run: count as imported for reporting but write nothing
      result.imported++;
    }

    result.entries.push(entryResult);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Helpers interni
// ---------------------------------------------------------------------------

/**
 * Crea la tabella `ianus_ingest_tracker` se non esiste, con indice.
 * Idempotente — può essere chiamata più volte senza effetti collaterali.
 */
function ensureTrackerSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ianus_ingest_tracker (
      ianus_entry_id   TEXT PRIMARY KEY,
      tabularium_entry_id TEXT NOT NULL,
      imported_at      TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // Indice per lookup veloci su ianus_entry_id
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_ianus_tracker_entry_id
    ON ianus_ingest_tracker(ianus_entry_id)
  `);
}

/**
 * Carica tutti gli ID delle entry Ianus già importate in un Set per
 * lookup O(1) durante la deduplicazione.
 */
function loadTrackedIds(db: Database.Database): Set<string> {
  const rows = db
    .prepare('SELECT ianus_entry_id FROM ianus_ingest_tracker')
    .all() as { ianus_entry_id: string }[];
  return new Set(rows.map((r) => r.ianus_entry_id));
}

/**
 * Verifica se un file esiste ed è leggibile.
 */
async function fileIsReadable(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Costruisce un risultato vuoto per i casi in cui il journal
 * non è disponibile o non contiene dati processabili.
 *
 * Il log su stderr assicura visibilità nei log del server MCP
 * senza interrompere il flusso.
 */
function buildEmptyResult(message: string): IanusIngestResult {
  console.error(`[ianus-ingest] ${message}`);
  return {
    imported: 0,
    skipped: 0,
    duplicates: 0,
    errors: 0,
    totalIanusEntries: 0,
    entries: [],
  };
}
