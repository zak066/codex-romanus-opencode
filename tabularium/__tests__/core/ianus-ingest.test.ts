/**
 * Test per core/ianus-ingest.ts — Ianus Liminalis journal ingestion.
 *
 * Copertura:
 * - Ingest completo: entries importate correttamente con mapping
 * - Operazioni sconosciute → skipped con errore
 * - Operazioni read-only (tree, list, stat...) → skipped
 * - Case-insensitive: "Write", "EDIT", "Delete" → mapping corretto
 * - Deduplicazione: stessa entry ID → duplicate
 * - `since` filter: solo entry dopo la data
 * - `limit` filter: solo N entry processate
 * - `dryRun` mode: letto ma non scritto
 * - Journal file mancante → empty result (no throw)
 * - Journal file vuoto → empty result
 * - Linee JSON non valide → silenziosamente ignorate
 * - Linee con campi mancanti → silenziosamente ignorate
 * - Transazione atomica per entry
 *
 * @module tests/core/ianus-ingest
 */

import Database from 'better-sqlite3';
import { ingestIanusJournal } from '../../src/core/ianus-ingest.js';
import { mkdtempSync, writeFileSync, unlinkSync, rmdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Crea un database SQLite in-memory isolato con le tabelle necessarie.
 */
function createIsolatedDb(): Database.Database {
  const db = new Database(':memory:');

  // Crea tabella file_changes (stesso schema di file-journal.ts)
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

  return db;
}

/**
 * Crea un file JSONL temporaneo con le righe date.
 * Restituisce il path del file creato.
 */
function createTempJournal(lines: string[]): string {
  const tmpDir = mkdtempSync(join(tmpdir(), 'ianus-ingest-test-'));
  const filePath = join(tmpDir, 'journal.jsonl');
  writeFileSync(filePath, lines.join('\n') + '\n', 'utf-8');
  return filePath;
}

/**
 * Distrugge file e directory temporanei.
 */
function cleanupTempJournal(filePath: string): void {
  try {
    unlinkSync(filePath);
    rmdirSync(join(filePath, '..'));
  } catch {
    // Ignora errori di cleanup nei test
  }
}

/**
 * Genera una riga JSONL valida per i test.
 */
function journalLine(overrides?: {
  id?: string;
  timestamp?: string;
  agent?: string;
  operation?: string;
  path?: string;
}): string {
  return JSON.stringify({
    id: overrides?.id ?? `entry_${randomUUID().slice(0, 8)}`,
    timestamp: overrides?.timestamp ?? new Date().toISOString(),
    agent: overrides?.agent ?? 'vulcanus-senior-dev',
    operation: overrides?.operation ?? 'write',
    path: overrides?.path ?? 'src/test.ts',
    details: {},
  });
}

/**
 * Genera N righe JSONL con timestamp progressivi.
 */
function generateJournalLines(
  count: number,
  baseOp = 'write',
  baseTimestamp?: string,
): string[] {
  const lines: string[] = [];
  for (let i = 0; i < count; i++) {
    const ts =
      baseTimestamp
        ? new Date(new Date(baseTimestamp).getTime() + i * 60_000).toISOString()
        : new Date(Date.now() + i * 60_000).toISOString();
    lines.push(
      journalLine({
        id: `test_entry_${i}`,
        timestamp: ts,
        operation: baseOp,
        path: `src/file-${i}.ts`,
      }),
    );
  }
  return lines;
}

// ---------------------------------------------------------------------------
// Suite: ianus-ingest
// ---------------------------------------------------------------------------

describe('ianus-ingest', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createIsolatedDb();
  });

  afterEach(() => {
    db.close();
  });

  // ── Happy path ─────────────────────────────────────────────────────────

  describe('ingestIanusJournal', () => {
    it('importa entries valide in file_changes e tracker', async () => {
      const lines = generateJournalLines(3);
      const journalPath = createTempJournal(lines);

      const result = await ingestIanusJournal(db, journalPath);

      expect(result.imported).toBe(3);
      expect(result.skipped).toBe(0);
      expect(result.duplicates).toBe(0);
      expect(result.errors).toBe(0);
      expect(result.totalIanusEntries).toBe(3);
      expect(result.entries).toHaveLength(3);
      result.entries.forEach((e) => {
        expect(e.status).toBe('imported');
        expect(e.mappedChangeType).toBe('modified');
      });

      // Verifica tabella tracker
      const trackerRows = db
        .prepare('SELECT * FROM ianus_ingest_tracker')
        .all() as { ianus_entry_id: string }[];
      expect(trackerRows).toHaveLength(3);

      // Verifica file_changes
      const changeRows = db
        .prepare('SELECT * FROM file_changes')
        .all() as { file_path: string }[];
      expect(changeRows).toHaveLength(3);
      expect(changeRows[0].file_path).toBe('src/file-0.ts');

      cleanupTempJournal(journalPath);
    });

    it('restituisce result con dettagli per-entry', async () => {
      const lines = [journalLine({ operation: 'write' })];
      const journalPath = createTempJournal(lines);

      const result = await ingestIanusJournal(db, journalPath);

      const entry = result.entries[0];
      expect(entry.id).toBeTruthy();
      expect(entry.operation).toBe('write');
      expect(entry.path).toBe('src/test.ts');
      expect(entry.timestamp).toBeTruthy();
      expect(entry.mappedChangeType).toBe('modified');
      expect(entry.status).toBe('imported');
      expect(entry.error).toBeUndefined();

      cleanupTempJournal(journalPath);
    });
  });

  // ── Operation mapping ──────────────────────────────────────────────────

  describe('operation mapping', () => {
    it('mappa operation=write → modified', async () => {
      const lines = [journalLine({ operation: 'write' })];
      const journalPath = createTempJournal(lines);
      const result = await ingestIanusJournal(db, journalPath);
      expect(result.entries[0].mappedChangeType).toBe('modified');
      expect(result.entries[0].status).toBe('imported');
      cleanupTempJournal(journalPath);
    });

    it('mappa operation=delete → deleted', async () => {
      const lines = [journalLine({ operation: 'delete' })];
      const journalPath = createTempJournal(lines);
      const result = await ingestIanusJournal(db, journalPath);
      expect(result.entries[0].mappedChangeType).toBe('deleted');
      expect(result.imported).toBe(1);
      cleanupTempJournal(journalPath);
    });

    it('mappa operation=edit → modified', async () => {
      const lines = [journalLine({ operation: 'edit' })];
      const journalPath = createTempJournal(lines);
      const result = await ingestIanusJournal(db, journalPath);
      expect(result.entries[0].mappedChangeType).toBe('modified');
      cleanupTempJournal(journalPath);
    });

    it('mappa operation=backup → modified', async () => {
      const lines = [journalLine({ operation: 'backup' })];
      const journalPath = createTempJournal(lines);
      const result = await ingestIanusJournal(db, journalPath);
      expect(result.entries[0].mappedChangeType).toBe('modified');
      cleanupTempJournal(journalPath);
    });

    it('mappa operation=rollback → modified', async () => {
      const lines = [journalLine({ operation: 'rollback' })];
      const journalPath = createTempJournal(lines);
      const result = await ingestIanusJournal(db, journalPath);
      expect(result.entries[0].mappedChangeType).toBe('modified');
      cleanupTempJournal(journalPath);
    });
  });

  // ── Case-insensitive ───────────────────────────────────────────────────

  describe('case-insensitive operation mapping', () => {
    it('accetta operazioni in uppercase', async () => {
      const lines = [journalLine({ operation: 'WRITE' })];
      const journalPath = createTempJournal(lines);
      const result = await ingestIanusJournal(db, journalPath);
      expect(result.imported).toBe(1);
      expect(result.entries[0].mappedChangeType).toBe('modified');
      cleanupTempJournal(journalPath);
    });

    it('accetta operazioni con case misto', async () => {
      const lines = [
        journalLine({ operation: 'Write' }),
        journalLine({ operation: 'EDIT' }),
        journalLine({ operation: 'Delete' }),
      ];
      const journalPath = createTempJournal(lines);
      const result = await ingestIanusJournal(db, journalPath);
      expect(result.imported).toBe(3);
      expect(result.entries[0].mappedChangeType).toBe('modified');
      expect(result.entries[1].mappedChangeType).toBe('modified');
      expect(result.entries[2].mappedChangeType).toBe('deleted');
      cleanupTempJournal(journalPath);
    });
  });

  // ── Read-only / skipped operations ────────────────────────────────────

  describe('read-only operations', () => {
    const READ_ONLY_OPS = ['read', 'search', 'tree', 'stat', 'list', 'journal', 'watch'];

    READ_ONLY_OPS.forEach((op) => {
      it(`skippa operation=${op}`, async () => {
        const lines = [journalLine({ operation: op })];
        const journalPath = createTempJournal(lines);
        const result = await ingestIanusJournal(db, journalPath);
        expect(result.skipped).toBe(1);
        expect(result.imported).toBe(0);
        expect(result.entries[0].status).toBe('skipped');
        cleanupTempJournal(journalPath);
      });
    });
  });

  // ── Unknown operations ─────────────────────────────────────────────────

  describe('unknown operations', () => {
    it('skippa operazioni sconosciute con errore', async () => {
      const lines = [journalLine({ operation: 'sudo' })];
      const journalPath = createTempJournal(lines);
      const result = await ingestIanusJournal(db, journalPath);
      expect(result.skipped).toBe(1);
      expect(result.imported).toBe(0);
      expect(result.entries[0].status).toBe('skipped');
      expect(result.entries[0].error).toContain('Unknown operation');
      cleanupTempJournal(journalPath);
    });

    it('gestisce misto di operazioni valide e sconosciute', async () => {
      const lines = [
        journalLine({ operation: 'write', id: 'a' }),
        journalLine({ operation: 'sudo', id: 'b' }),
        journalLine({ operation: 'delete', id: 'c' }),
      ];
      const journalPath = createTempJournal(lines);
      const result = await ingestIanusJournal(db, journalPath);
      expect(result.imported).toBe(2);
      expect(result.skipped).toBe(1);
      expect(result.entries[1].status).toBe('skipped');
      expect(result.entries[1].error).toContain('sudo');
      cleanupTempJournal(journalPath);
    });
  });

  // ── Deduplication ──────────────────────────────────────────────────────

  describe('deduplication', () => {
    it('rileva entry duplicate dallo stesso batch', async () => {
      const lines = [
        journalLine({ id: 'dup_1', operation: 'write' }),
        journalLine({ id: 'dup_1', operation: 'write' }),
      ];
      const journalPath = createTempJournal(lines);
      const result = await ingestIanusJournal(db, journalPath);
      expect(result.imported).toBe(1);
      expect(result.duplicates).toBe(1);
      expect(result.entries[0].status).toBe('imported');
      expect(result.entries[1].status).toBe('duplicate');
      cleanupTempJournal(journalPath);
    });

    it('rileva entry duplicate da import precedente (tracker persistito)', async () => {
      // Primo import
      const lines1 = [journalLine({ id: 'persist_1', operation: 'write' })];
      const path1 = createTempJournal(lines1);
      await ingestIanusJournal(db, path1);
      cleanupTempJournal(path1);

      // Secondo import con stessa entry
      const lines2 = [journalLine({ id: 'persist_1', operation: 'write' })];
      const path2 = createTempJournal(lines2);
      const result = await ingestIanusJournal(db, path2);

      expect(result.imported).toBe(0);
      expect(result.duplicates).toBe(1);

      // Verifica che non ci siano duplicati in file_changes
      const changes = db
        .prepare('SELECT * FROM file_changes')
        .all() as unknown[];
      expect(changes).toHaveLength(1);

      cleanupTempJournal(path2);
    });
  });

  // ── `since` filter ─────────────────────────────────────────────────────

  describe('since filter', () => {
    it('importa solo entry con timestamp >= since', async () => {
      const lines = [
        journalLine({ id: 'old', timestamp: '2025-01-01T00:00:00.000Z', operation: 'write' }),
        journalLine({ id: 'mid', timestamp: '2026-01-01T00:00:00.000Z', operation: 'write' }),
        journalLine({ id: 'new', timestamp: '2026-06-15T00:00:00.000Z', operation: 'write' }),
      ];
      const journalPath = createTempJournal(lines);
      const result = await ingestIanusJournal(db, journalPath, {
        since: '2026-01-01T00:00:00.000Z',
      });

      expect(result.imported).toBe(2);
      expect(result.totalIanusEntries).toBe(2); // since filtra prima del limit
      expect(result.entries[0].id).toBe('mid');
      expect(result.entries[1].id).toBe('new');
      cleanupTempJournal(journalPath);
    });

    it('since = data futura → nessuna entry importata', async () => {
      const lines = generateJournalLines(3);
      const journalPath = createTempJournal(lines);
      const result = await ingestIanusJournal(db, journalPath, {
        since: '2099-01-01T00:00:00.000Z',
      });

      expect(result.imported).toBe(0);
      expect(result.totalIanusEntries).toBe(0);
      cleanupTempJournal(journalPath);
    });
  });

  // ── `limit` filter ─────────────────────────────────────────────────────

  describe('limit filter', () => {
    it('importa solo N entry quando limit è impostato', async () => {
      const lines = generateJournalLines(10);
      const journalPath = createTempJournal(lines);
      const result = await ingestIanusJournal(db, journalPath, { limit: 3 });

      expect(result.imported).toBe(3);
      expect(result.totalIanusEntries).toBe(10); // totalIanusEntries è SU tutti i parsed
      expect(result.entries).toHaveLength(3);
      cleanupTempJournal(journalPath);
    });

    it('limit=0 → nessuna entry importata', async () => {
      const lines = generateJournalLines(5);
      const journalPath = createTempJournal(lines);
      const result = await ingestIanusJournal(db, journalPath, { limit: 0 });

      expect(result.imported).toBe(0);
      expect(result.totalIanusEntries).toBe(5);
      expect(result.entries).toHaveLength(0);
      cleanupTempJournal(journalPath);
    });

    it('limit maggior del numero di entry → importa tutte', async () => {
      const lines = generateJournalLines(3);
      const journalPath = createTempJournal(lines);
      const result = await ingestIanusJournal(db, journalPath, { limit: 100 });

      expect(result.imported).toBe(3);
      cleanupTempJournal(journalPath);
    });
  });

  // ── `dryRun` mode ──────────────────────────────────────────────────────

  describe('dryRun mode', () => {
    it('non scrive nel database quando dryRun=true', async () => {
      const lines = generateJournalLines(5);
      const journalPath = createTempJournal(lines);
      const result = await ingestIanusJournal(db, journalPath, { dryRun: true });

      expect(result.imported).toBe(5);
      expect(result.errors).toBe(0);

      // Niente nel DB
      const trackerCount = db
        .prepare('SELECT COUNT(*) AS cnt FROM ianus_ingest_tracker')
        .get() as { cnt: number };
      expect(trackerCount.cnt).toBe(0);

      const changeCount = db
        .prepare('SELECT COUNT(*) AS cnt FROM file_changes')
        .get() as { cnt: number };
      expect(changeCount.cnt).toBe(0);

      cleanupTempJournal(journalPath);
    });

    it('dryRun=true con since e limit combinati', async () => {
      const lines = generateJournalLines(10, 'write', '2026-01-01T00:00:00.000Z');
      const journalPath = createTempJournal(lines);
      const result = await ingestIanusJournal(db, journalPath, {
        dryRun: true,
        since: '2026-01-01T00:05:00.000Z',
        limit: 3,
      });

      expect(result.imported).toBe(3);
      expect(result.entries).toHaveLength(3);

      // DB intatto
      const changeCount = db
        .prepare('SELECT COUNT(*) AS cnt FROM file_changes')
        .get() as { cnt: number };
      expect(changeCount.cnt).toBe(0);

      cleanupTempJournal(journalPath);
    });
  });

  // ── Edge cases: file handling ─────────────────────────────────────────

  describe('journal file handling', () => {
    it('restituisce risultato vuoto per file inesistente (nessun errore)', async () => {
      const result = await ingestIanusJournal(db, '/absolute/nonexistent/path.jsonl');

      expect(result.imported).toBe(0);
      expect(result.skipped).toBe(0);
      expect(result.duplicates).toBe(0);
      expect(result.errors).toBe(0);
      expect(result.totalIanusEntries).toBe(0);
      expect(result.entries).toEqual([]);
    });

    it('restituisce risultato vuoto per file vuoto', async () => {
      const journalPath = createTempJournal(['']);
      const result = await ingestIanusJournal(db, journalPath);

      expect(result.imported).toBe(0);
      expect(result.totalIanusEntries).toBe(0);

      cleanupTempJournal(journalPath);
    });

    it('restituisce risultato vuoto per file con solo newline', async () => {
      const journalPath = createTempJournal(['\n', '\n', '']);
      const result = await ingestIanusJournal(db, journalPath);

      expect(result.imported).toBe(0);
      expect(result.totalIanusEntries).toBe(0);

      cleanupTempJournal(journalPath);
    });
  });

  // ── Edge cases: malformed lines ────────────────────────────────────────

  describe('malformed JSON lines', () => {
    it('ignora righe con JSON non valido', async () => {
      const lines = [
        journalLine({ id: 'valid_1' }),
        'this is not json',
        '{broken json',
        journalLine({ id: 'valid_2' }),
        '',
      ];
      const journalPath = createTempJournal(lines);
      const result = await ingestIanusJournal(db, journalPath);

      expect(result.imported).toBe(2);
      expect(result.totalIanusEntries).toBe(2);

      cleanupTempJournal(journalPath);
    });

    it('ignora righe con campi obbligatori mancanti', async () => {
      const lines = [
        // Manca id
        JSON.stringify({ timestamp: '2026-01-01T00:00:00.000Z', operation: 'write', path: 'a.ts' }),
        // Manca timestamp
        JSON.stringify({ id: 'no_ts', operation: 'write', path: 'b.ts' }),
        // Manca operation
        JSON.stringify({ id: 'no_op', timestamp: '2026-01-01T00:00:00.000Z', path: 'c.ts' }),
        // Valida
        journalLine({ id: 'valid' }),
      ];
      const journalPath = createTempJournal(lines);
      const result = await ingestIanusJournal(db, journalPath);

      expect(result.totalIanusEntries).toBe(1);
      expect(result.imported).toBe(1);

      cleanupTempJournal(journalPath);
    });
  });

  // ── Database schema ────────────────────────────────────────────────────

  describe('database schema', () => {
    it('crea tabella ianus_ingest_tracker automaticamente', async () => {
      // Verifica che la tabella non esista ancora
      const tablesBefore = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='ianus_ingest_tracker'",
        )
        .all() as { name: string }[];
      expect(tablesBefore).toHaveLength(0);

      // Chiamata a ingestIanusJournal su file inesistente — la tabella viene
      // comunque creata perché ensureTrackerSchema() è chiamata prima del check
      await ingestIanusJournal(db, '/nonexistent/file.jsonl');

      const tablesAfterNoOp = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='ianus_ingest_tracker'",
        )
        .all() as { name: string }[];
      expect(tablesAfterNoOp).toHaveLength(1);

      // Chiamata con file valido — idempotente
      const lines = [journalLine()];
      const journalPath = createTempJournal(lines);
      await ingestIanusJournal(db, journalPath);

      const tablesAfter = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='ianus_ingest_tracker'",
        )
        .all() as { name: string }[];
      expect(tablesAfter).toHaveLength(1);

      cleanupTempJournal(journalPath);
    });

    it('ianus_ingest_tracker è idempotente (CREATE IF NOT EXISTS)', async () => {
      const lines = generateJournalLines(2);
      const journalPath = createTempJournal(lines);

      // Primo import
      const r1 = await ingestIanusJournal(db, journalPath);
      expect(r1.imported).toBe(2);

      // Secondo import — le entry sono ora duplicate
      const r2 = await ingestIanusJournal(db, journalPath);
      expect(r2.imported).toBe(0);
      expect(r2.duplicates).toBe(2);

      cleanupTempJournal(journalPath);
    });
  });

  // ── Agent field handling ───────────────────────────────────────────────

  describe('agent field handling', () => {
    it('usa agent dal journal entry quando presente', async () => {
      const lines = [
        journalLine({ agent: 'janus-security', operation: 'write', id: 'agent_test' }),
      ];
      const journalPath = createTempJournal(lines);
      await ingestIanusJournal(db, journalPath);

      const change = db
        .prepare("SELECT * FROM file_changes WHERE file_path = 'src/test.ts'")
        .get() as { agent: string };
      expect(change.agent).toBe('janus-security');

      cleanupTempJournal(journalPath);
    });

    it('usa "ianus" come fallback quando agent è assente', async () => {
      const entry = {
        id: 'no_agent',
        timestamp: new Date().toISOString(),
        operation: 'write',
        path: 'src/no-agent.ts',
      };
      const lines = [JSON.stringify(entry)];
      const journalPath = createTempJournal(lines);
      await ingestIanusJournal(db, journalPath);

      const change = db
        .prepare("SELECT * FROM file_changes WHERE file_path = 'src/no-agent.ts'")
        .get() as { agent: string };
      expect(change.agent).toBe('ianus');

      cleanupTempJournal(journalPath);
    });
  });

  // ── Transaction safety ─────────────────────────────────────────────────

  describe('transaction safety', () => {
    it('ogni entry è inserita atomicamente (sia change che tracker)', async () => {
      const lines = [journalLine({ id: 'atomic_1', operation: 'write' })];
      const journalPath = createTempJournal(lines);
      const result = await ingestIanusJournal(db, journalPath);

      expect(result.imported).toBe(1);

      // Verifica che entry ID sia in tracker
      const trackerEntry = db
        .prepare("SELECT * FROM ianus_ingest_tracker WHERE ianus_entry_id = 'atomic_1'")
        .get() as { tabularium_entry_id: string; imported_at: string };
      expect(trackerEntry).toBeTruthy();
      expect(trackerEntry.tabularium_entry_id).toMatch(/^ii_/);
      expect(trackerEntry.imported_at).toBeTruthy();

      cleanupTempJournal(journalPath);
    });
  });

  // ── Summary: mixed scenario ────────────────────────────────────────────

  describe('mixed scenario', () => {
    it('gestisce correttamente un mix di tutti i tipi di entry', async () => {
      const lines = [
        // write (importata)
        journalLine({ id: 'w1', operation: 'write', path: 'src/a.ts' }),
        // delete (importata)
        journalLine({ id: 'd1', operation: 'delete', path: 'src/b.ts' }),
        // read (skippata)
        journalLine({ id: 'r1', operation: 'read', path: 'src/c.ts' }),
        // unknow (skippata con errore)
        journalLine({ id: 'x1', operation: 'chmod', path: 'src/d.ts' }),
        // write (importata)
        journalLine({ id: 'w2', operation: 'write', path: 'src/e.ts' }),
        // duplicate di w1
        journalLine({ id: 'w1', operation: 'write', path: 'src/a.ts' }),
      ];
      const journalPath = createTempJournal(lines);
      const result = await ingestIanusJournal(db, journalPath, { limit: 5 });

      // limit=5 prende: w1(write→imported), d1(delete→imported), r1(read→skipped),
      // x1(chmod→skipped), w2(write→imported) — il duplicato w1 è escluso dal limit
      expect(result.imported).toBe(3);
      expect(result.skipped).toBe(2);
      expect(result.duplicates).toBe(0);
      expect(result.errors).toBe(0);

      // Verify DB has exactly 3 entries
      const changes = db
        .prepare('SELECT * FROM file_changes')
        .all() as unknown[];
      expect(changes).toHaveLength(3);

      cleanupTempJournal(journalPath);
    });

    it('dryRun con mixed scenario non tocca il DB', async () => {
      const lines = [
        journalLine({ id: 'dw1', operation: 'write', path: 'src/a.ts' }),
        journalLine({ id: 'dd1', operation: 'delete', path: 'src/b.ts' }),
        journalLine({ id: 'dr1', operation: 'read', path: 'src/c.ts' }),
        journalLine({ id: 'dx1', operation: 'chmod', path: 'src/d.ts' }),
      ];
      const journalPath = createTempJournal(lines);
      const result = await ingestIanusJournal(db, journalPath, { dryRun: true });

      expect(result.imported).toBe(2); // write + delete
      expect(result.skipped).toBe(2);  // read + chmod
      expect(result.errors).toBe(0);

      // Niente persistere
      const changes = db
        .prepare('SELECT * FROM file_changes')
        .all() as unknown[];
      expect(changes).toHaveLength(0);

      cleanupTempJournal(journalPath);
    });
  });
});
