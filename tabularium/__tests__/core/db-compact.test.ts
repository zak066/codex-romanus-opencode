/**
 * Test per core/db-compact.ts — Memory Compact Core Logic (MCP² Phase 2 — COMPACT).
 *
 * Copertura:
 * - countEventsForCompact: 0 eventi, eventi nella finestra, eventi fuori finestra
 * - getNextCompactId: primo compact, dopo compact
 * - logCompactRecord: registrazione compact
 * - countKnowledgeEntries: conteggio knowledge
 * - getDatabaseSizeKb: dimensione file DB
 * - Safe guards: eventi non vengono cancellati, ADR preservate
 *
 * @module tests/core/db-compact
 */

import crypto from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { initDatabase, closeDatabase, getDatabase, resetDatabase } from '../../src/core/database.js';
import fs from 'node:fs';

import {
  countEventsForCompact,
  countKnowledgeEntries,
  getNextCompactId,
  logCompactRecord,
  getDatabaseSizeKb,
  getTotalEventCount,
} from '../../src/core/db-compact.js';

import type { CompactLogParams } from '../../src/core/db-compact.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function initFreshDb(): Promise<import('better-sqlite3').Database> {
  closeDatabase();
  return initDatabase(':memory:');
}

/** Genera ID univoci per test */
function uid(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

/** Inserisce una sessione con start_time personalizzato */
function insertSession(
  agent: string,
  status: string,
  startTimeExpr: string,
  id?: string,
): string {
  const db = getDatabase();
  const sessionId = id ?? uid('ses');
  db.prepare(`
    INSERT INTO sessions (id, agent_name, start_time, status, focus)
    VALUES (?, ?, ${startTimeExpr}, ?, 'test')
  `).run(sessionId, agent, status);
  return sessionId;
}

/** Inserisce un evento con timestamp personalizzato */
function insertEvent(
  sessionId: string,
  agent: string,
  eventType: string,
  summary: string,
  timestampExpr: string,
  details?: string,
  tags?: string,
): string {
  const db = getDatabase();
  const eventId = uid('evt');
  db.prepare(`
    INSERT INTO events (id, session_id, timestamp, agent_name, event_type, summary, details, tags)
    VALUES (?, ?, ${timestampExpr}, ?, ?, ?, ?, ?)
  `).run(eventId, sessionId, agent, eventType, summary, details ?? '{}', tags ?? '[]');
  return eventId;
}

/** Inserisce una knowledge entry */
function insertKnowledgeEntry(
  title: string,
  body: string,
  category: string,
  agent: string,
): string {
  const db = getDatabase();
  const id = uid('k');
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO knowledge_entries (id, created_at, updated_at, title, body, category, source_agent, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'active')
  `).run(id, now, now, title, body, category, agent);
  return id;
}

// ---------------------------------------------------------------------------
// Suite: countEventsForCompact
// ---------------------------------------------------------------------------

describe('countEventsForCompact', () => {
  let sessionId: string;

  beforeEach(async () => {
    await initFreshDb();
    sessionId = insertSession('diana-tester', 'completed', "datetime('now')");
  });

  afterAll(() => {
    closeDatabase();
  });

  it('UT1: restituisce 0 per tutti i campi quando il DB e\' vuoto', () => {
    const result = countEventsForCompact(7);
    expect(result).toEqual({ total: 0, recent: 0, knowledgeReady: 0 });
  });

  it('conta eventi nella finestra di compact (7 giorni)', () => {
    insertEvent(sessionId, 'diana-tester', 'task_completed', 'Task recente', "datetime('now', '-2 days')");
    const result = countEventsForCompact(7);
    expect(result.total).toBe(1);
  });

  it('ignora eventi fuori dalla finestra di compact', () => {
    insertEvent(sessionId, 'diana-tester', 'task_completed', 'Task vecchio', "datetime('now', '-30 days')");
    const result = countEventsForCompact(7);
    expect(result.total).toBe(0);
  });

  it('conta eventi knowledge-ready (task_completed, error_encountered, task_failed)', () => {
    insertEvent(sessionId, 'vulcanus', 'task_completed', 'Task ok', "datetime('now', '-1 day')");
    insertEvent(sessionId, 'vulcanus', 'error_encountered', 'Errore X', "datetime('now', '-2 days')");
    insertEvent(sessionId, 'vulcanus', 'task_started', 'Task iniziato', "datetime('now', '-3 days')"); // non knowledge-ready
    const result = countEventsForCompact(7);
    expect(result.total).toBe(3);
    expect(result.knowledgeReady).toBe(2);
  });

  it('distingue eventi recenti (< 24h)', () => {
    insertEvent(sessionId, 'diana', 'task_completed', 'Poche ore fa', "datetime('now', '-2 hours')");
    insertEvent(sessionId, 'diana', 'task_completed', '2 giorni fa', "datetime('now', '-2 days')");
    const result = countEventsForCompact(7);
    expect(result.total).toBe(2);
    expect(result.recent).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Suite: countKnowledgeEntries
// ---------------------------------------------------------------------------

describe('countKnowledgeEntries', () => {
  beforeEach(async () => {
    await initFreshDb();
  });

  afterAll(() => {
    closeDatabase();
  });

  it('UT6: restituisce 0 su DB vuoto', () => {
    const count = countKnowledgeEntries();
    expect(count).toBe(0);
  });

  it('conta solo knowledge entries attive', () => {
    insertKnowledgeEntry('Pattern A', 'Body', 'pattern', 'vulcanus');
    insertKnowledgeEntry('Pattern B', 'Body', 'lesson', 'minerva');
    const count = countKnowledgeEntries();
    expect(count).toBe(2);
  });

  it('esclude knowledge entries non attive', () => {
    const db = getDatabase();
    insertKnowledgeEntry('Pattern A', 'Body', 'pattern', 'vulcanus');
    // Inserisci entry archiviata direttamente
    const id = uid('k');
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO knowledge_entries (id, created_at, updated_at, title, body, category, source_agent, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'archived')
    `).run(id, now, now, 'Archived', 'body', 'lesson', 'test');

    const count = countKnowledgeEntries();
    expect(count).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Suite: getTotalEventCount
// ---------------------------------------------------------------------------

describe('getTotalEventCount', () => {
  beforeEach(async () => {
    await initFreshDb();
  });

  afterAll(() => {
    closeDatabase();
  });

  it('restituisce 0 su DB vuoto', () => {
    const count = getTotalEventCount();
    expect(count).toBe(0);
  });

  it('conta tutti gli eventi indipendentemente dalla finestra', () => {
    const s = insertSession('diana', 'completed', "datetime('now')");
    insertEvent(s, 'diana', 'task_completed', 'Recent', "datetime('now', '-1 day')");
    insertEvent(s, 'diana', 'task_completed', 'Old', "datetime('now', '-60 days')");
    const count = getTotalEventCount();
    expect(count).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Suite: getNextCompactId
// ---------------------------------------------------------------------------

describe('getNextCompactId', () => {
  beforeEach(async () => {
    await initFreshDb();
  });

  afterAll(() => {
    closeDatabase();
  });

  it('UT3: primo compact_id = 1', () => {
    const id = getNextCompactId();
    expect(id).toBe(1);
  });

  it('UT4: compact_id incrementa dopo logCompactRecord', () => {
    const id1 = getNextCompactId();
    expect(id1).toBe(1);

    const stats: CompactLogParams = {
      olderThan: 7,
      knowledgeLimit: 10,
      snapshotCreated: 1,
      knowledgeCreated: 3,
      faqCreated: 1,
      snapshotId: 'snap_001',
      dbSizeKb: 500,
      eventCountBefore: 100,
      agent: 'vulcanus-senior-dev',
    };
    logCompactRecord(1, true, stats);

    const id2 = getNextCompactId();
    expect(id2).toBe(2);
  });

  it('getNextCompactId e\' idempotente (non incrementa se chiamato piu\' volte senza log)', () => {
    const id1 = getNextCompactId();
    const id2 = getNextCompactId();
    expect(id1).toBe(id2);
  });
});

// ---------------------------------------------------------------------------
// Suite: logCompactRecord
// ---------------------------------------------------------------------------

describe('logCompactRecord', () => {
  beforeEach(async () => {
    await initFreshDb();
  });

  afterAll(() => {
    closeDatabase();
  });

  it('registra un compact record e lo rende leggibile', () => {
    const stats: CompactLogParams = {
      olderThan: 14,
      knowledgeLimit: 10,
      snapshotCreated: 1,
      knowledgeCreated: 3,
      faqCreated: 1,
      snapshotId: 'snap_001',
      dbSizeKb: 500,
      eventCountBefore: 200,
      agent: 'vulcanus-senior-dev',
    };

    logCompactRecord(1, false, stats);

    const db = getDatabase();
    const row = db.prepare('SELECT * FROM _compact_log WHERE compact_id = 1').get() as Record<string, unknown>;
    expect(row).toBeTruthy();
    expect(row.compact_id).toBe(1);
    expect(row.dry_run).toBe(0);
    expect(row.agent).toBe('vulcanus-senior-dev');
    expect(row.older_than).toBe(14);
    expect(row.knowledge_limit).toBe(10);
    expect(row.snapshot_created).toBe(1);
    expect(row.knowledge_created).toBe(3);
    expect(row.faq_created).toBe(1);
    expect(row.snapshot_id).toBe('snap_001');
    expect(row.db_size_kb).toBe(500);
    expect(row.event_count_before).toBe(200);
  });

  it('registra dry_run=1 quando dryRun=true', () => {
    const stats: CompactLogParams = {
      olderThan: 7, knowledgeLimit: 10, snapshotCreated: 0,
      knowledgeCreated: 0, faqCreated: 0, snapshotId: '',
      dbSizeKb: 0, eventCountBefore: 0, agent: 'test',
    };

    logCompactRecord(1, true, stats);

    const db = getDatabase();
    const row = db.prepare('SELECT dry_run FROM _compact_log WHERE compact_id = 1').get() as { dry_run: number };
    expect(row.dry_run).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Suite: getDatabaseSizeKb
// ---------------------------------------------------------------------------

describe('getDatabaseSizeKb', () => {
  afterEach(() => {
    resetDatabase();
  });

  afterAll(() => {
    closeDatabase();
  });

  it('UT5: restituisce > 0 per database su file', () => {
    const tmpPath = path.join(os.tmpdir(), `test-db-compact-${Date.now()}.db`);
    // Pulisci eventuale residuo
    try { require('fs').unlinkSync(tmpPath); } catch { /* ok */ }
    try { require('fs').unlinkSync(tmpPath + '-wal'); } catch { /* ok */ }

    return initDatabase(tmpPath).then(() => {
      const size = getDatabaseSizeKb();
      expect(size).toBeGreaterThan(0);
      resetDatabase();
      try { require('fs').unlinkSync(tmpPath); } catch { /* ok */ }
    });
  });

  it('restituisce 0 per database :memory:', () => {
    return initFreshDb().then(() => {
      const size = getDatabaseSizeKb();
      expect(size).toBe(0);
    });
  });
});

// ---------------------------------------------------------------------------
// Suite: Safe Guards
// ---------------------------------------------------------------------------

describe('Safe Guards', () => {
  beforeEach(async () => {
    await initFreshDb();
  });

  afterAll(() => {
    closeDatabase();
  });

  it('SC1: countEventsForCompact non cancella eventi (sola lettura)', () => {
    const s = insertSession('diana', 'completed', "datetime('now')");
    insertEvent(s, 'diana', 'task_completed', 'Evento', "datetime('now', '-2 days')");

    const db = getDatabase();
    const before = db.prepare('SELECT COUNT(*) as cnt FROM events').get() as { cnt: number };

    // countEventsForCompact NON modifica il DB
    countEventsForCompact(7);

    const after = db.prepare('SELECT COUNT(*) as cnt FROM events').get() as { cnt: number };
    expect(after.cnt).toBe(before.cnt);
  });

  it('SC2: ADR decision_rationale non viene toccata da nessuna funzione compact', () => {
    const db = getDatabase();
    // Inserisci una decision_rationale
    const id = `dec_${crypto.randomUUID()}`;
    db.prepare(`
      INSERT INTO decision_rationale (id, adr_id, agent_name)
      VALUES (?, 'ADR-038', 'vulcanus')
    `).run(id);

    const before = db.prepare('SELECT COUNT(*) as cnt FROM decision_rationale').get() as { cnt: number };

    // Esegui funzioni compact (nessuna tocca decision_rationale)
    countEventsForCompact(7);
    countKnowledgeEntries();
    getNextCompactId();
    getTotalEventCount();

    const after = db.prepare('SELECT COUNT(*) as cnt FROM decision_rationale').get() as { cnt: number };
    expect(after.cnt).toBe(before.cnt);
  });

  it('SC3: knowledge entries esistenti non vengono modificate', () => {
    insertKnowledgeEntry('Pattern test', 'Body', 'pattern', 'diana-tester');
    insertKnowledgeEntry('Lesson test', 'Body', 'lesson', 'vulcanus');

    const db = getDatabase();
    const before = db.prepare('SELECT COUNT(*) as cnt FROM knowledge_entries').get() as { cnt: number };

    countEventsForCompact(7);

    const after = db.prepare('SELECT COUNT(*) as cnt FROM knowledge_entries').get() as { cnt: number };
    expect(after.cnt).toBe(before.cnt);
  });
});

// ---------------------------------------------------------------------------
// Suite: Catch branches (edge cases)
// ---------------------------------------------------------------------------

describe('Catch branches (edge cases)', () => {
  afterAll(() => {
    closeDatabase();
  });

  it('getDatabaseSizeKb catch: restituisce 0 quando fs.statSync fallisce su file DB', () => {
    // Per innescare il ramo catch serve un database su file e mock di fs.statSync che lancia
    const tmpPath = path.join(os.tmpdir(), `test-catch-db-size-${Date.now()}.db`);
    try { fs.unlinkSync(tmpPath); } catch { /* ok */ }
    try { fs.unlinkSync(tmpPath + '-wal'); } catch { /* ok */ }

    return initDatabase(tmpPath).then(() => {
      const statSpy = jest.spyOn(fs, 'statSync').mockImplementation(() => {
        throw new Error('ENOENT: permission denied');
      });

      const size = getDatabaseSizeKb();
      expect(size).toBe(0);

      statSpy.mockRestore();
      resetDatabase();
      try { fs.unlinkSync(tmpPath); } catch { /* ok */ }
    });
  });

  it('countKnowledgeEntries catch: restituisce 0 quando db.prepare fallisce', async () => {
    await initFreshDb();
    const db = getDatabase();
    const prepareSpy = jest.spyOn(db, 'prepare').mockImplementation(() => {
      throw new Error('Simulated DB error');
    });

    const count = countKnowledgeEntries();
    expect(count).toBe(0);

    prepareSpy.mockRestore();
  });

  it('getTotalEventCount catch: restituisce 0 quando db.prepare fallisce', async () => {
    await initFreshDb();
    const db = getDatabase();
    const prepareSpy = jest.spyOn(db, 'prepare').mockImplementation(() => {
      throw new Error('Simulated DB error');
    });

    const count = getTotalEventCount();
    expect(count).toBe(0);

    prepareSpy.mockRestore();
  });
});
