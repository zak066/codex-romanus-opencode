/**
 * Test per core/db-purge.ts — Memory Purge Core Logic (MCP² Phase 3 — PURGE).
 *
 * Copertura:
 * - countEventsOlderThan: 0 eventi, eventi recenti, eventi vecchi
 * - deleteEventsOlderThan: tabella con dati, tabella vuota
 * - estimateRecoverableSpace: stima spazio recuperabile
 * - getNextPurgeId: primo purge, dopo purge
 * - logPurgeRecord: registrazione purge
 * - deleteContextsOlderThan: mantiene ultimi N snapshot
 * - getDatabaseSizeKb: dimensione file DB
 * - Safe guards: knowledge_entries, decision_rationale, metrics intoccate
 *
 * @module tests/core/db-purge
 */

import crypto from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { initDatabase, closeDatabase, getDatabase, resetDatabase } from '../../src/core/database.js';
import {
  countEventsOlderThan,
  deleteEventsOlderThan,
  deleteSessionsOlderThan,
  deleteContextsOlderThan,
  estimateRecoverableSpace,
  getDatabaseSizeKb,
  getNextPurgeId,
  logPurgeRecord,
  getTotalEventsOlderThan,
} from '../../src/core/db-purge.js';

import type { PurgeLogParams } from '../../src/core/db-purge.js';

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

/** Inserisce un contesto snapshot con created_at personalizzato */
function insertSnapshot(
  sessionId: string,
  agent: string,
  createdAtExpr: string,
  content?: string,
): string {
  const db = getDatabase();
  const ctxId = uid('ctx');
  db.prepare(`
    INSERT INTO contexts (id, session_id, agent_name, context_type, content, created_at)
    VALUES (?, ?, ?, 'snapshot', ?, ${createdAtExpr})
  `).run(ctxId, sessionId, agent, content ?? 'test snapshot');
  return ctxId;
}

/** Inserisce una knowledge entry (safe guard: non deve mai essere cancellata) */
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
// Suite: countEventsOlderThan
// ---------------------------------------------------------------------------

describe('countEventsOlderThan', () => {
  let sessionId: string;

  beforeEach(async () => {
    await initFreshDb();
    sessionId = insertSession('diana-tester', 'completed', "datetime('now')");
  });

  afterAll(() => {
    closeDatabase();
  });

  it('UT1: restituisce 0 eventi, sessioni e contesti quando il DB è vuoto', () => {
    const result = countEventsOlderThan(30);
    expect(result).toEqual({ events: 0, sessions: 0, contexts: 0 });
  });

  it('UT2: non conta eventi recenti (1 giorno fa, days=30)', () => {
    insertEvent(sessionId, 'diana-tester', 'task_started', 'Evento recente', "datetime('now', '-1 day')");
    const result = countEventsOlderThan(30);
    expect(result.events).toBe(0);
  });

  it('UT3: conta eventi vecchi (60 giorni fa, days=30)', () => {
    insertEvent(sessionId, 'diana-tester', 'task_completed', 'Evento vecchio', "datetime('now', '-60 days')");
    const result = countEventsOlderThan(30);
    expect(result.events).toBe(1);
  });

  it('conta solo sessioni abortite/interrotte', () => {
    insertSession('vulcanus', 'aborted', "datetime('now', '-60 days')");
    insertSession('minerva', 'active', "datetime('now', '-60 days')");
    insertSession('iuppiter', 'completed', "datetime('now', '-60 days')");
    const result = countEventsOlderThan(30);
    expect(result.sessions).toBe(1); // solo quella aborted
  });

  it('conta solo snapshot vecchi in contexts', () => {
    const s = insertSession('vulcanus', 'completed', "datetime('now')");
    insertSnapshot(s, 'vulcanus', "datetime('now', '-60 days')");
    insertSnapshot(s, 'vulcanus', "datetime('now', '-5 days')"); // recente, non contato
    const result = countEventsOlderThan(30);
    expect(result.contexts).toBe(1); // solo quello vecchio
  });

  it('conteggi combinati per eventi, sessioni e contesti', () => {
    // Eventi vecchi
    insertEvent(sessionId, 'diana', 'task_started', 'Vecchio', "datetime('now', '-60 days')");
    insertEvent(sessionId, 'diana', 'task_completed', 'Recente', "datetime('now', '-1 day')");

    // Sessioni vecchie (abortite)
    insertSession('vulcanus', 'aborted', "datetime('now', '-60 days')");

    // Snapshot vecchi
    insertSnapshot(sessionId, 'diana', "datetime('now', '-60 days')");

    const result = countEventsOlderThan(30);
    expect(result.events).toBe(1);
    expect(result.sessions).toBe(1);
    expect(result.contexts).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Suite: deleteEventsOlderThan
// ---------------------------------------------------------------------------

describe('deleteEventsOlderThan', () => {
  beforeEach(async () => {
    await initFreshDb();
  });

  afterAll(() => {
    closeDatabase();
  });

  it('UT4: elimina eventi vecchi e restituisce changes > 0', () => {
    const s = insertSession('diana', 'completed', "datetime('now')");
    insertEvent(s, 'diana', 'task_started', 'Da cancellare', "datetime('now', '-60 days')");
    insertEvent(s, 'diana', 'task_completed', 'Da mantenere', "datetime('now', '-1 day')");

    const changes = deleteEventsOlderThan(30);
    expect(changes).toBe(1);

    // Verifica che il record non sia più presente
    const db = getDatabase();
    const remaining = db.prepare('SELECT COUNT(*) as cnt FROM events').get() as { cnt: number };
    expect(remaining.cnt).toBe(1);
  });

  it('UT5: restituisce 0 changes su tabella vuota', () => {
    const changes = deleteEventsOlderThan(30);
    expect(changes).toBe(0);
  });

  it('non elimina eventi recenti', () => {
    const s = insertSession('diana', 'completed', "datetime('now')");
    insertEvent(s, 'diana', 'task_completed', 'Recente', "datetime('now', '-1 day')");

    const changes = deleteEventsOlderThan(30);
    expect(changes).toBe(0);

    const db = getDatabase();
    const remaining = db.prepare('SELECT COUNT(*) as cnt FROM events').get() as { cnt: number };
    expect(remaining.cnt).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Suite: deleteSessionsOlderThan
// ---------------------------------------------------------------------------

describe('deleteSessionsOlderThan', () => {
  beforeEach(async () => {
    await initFreshDb();
  });

  afterAll(() => {
    closeDatabase();
  });

  it('elimina solo sessioni abortite/interrotte vecchie', () => {
    insertSession('vulcanus', 'aborted', "datetime('now', '-60 days')");
    insertSession('vulcanus', 'interrupted', "datetime('now', '-60 days')");
    insertSession('minerva', 'active', "datetime('now', '-60 days')");  // non cancellata
    insertSession('iuppiter', 'completed', "datetime('now', '-60 days')"); // non cancellata

    const changes = deleteSessionsOlderThan(30, 3);
    expect(changes).toBe(2);

    const db = getDatabase();
    const remaining = db.prepare('SELECT COUNT(*) as cnt FROM sessions').get() as { cnt: number };
    expect(remaining.cnt).toBe(2);
  });

  it('non elimina sessioni recenti anche se abortite', () => {
    insertSession('vulcanus', 'aborted', "datetime('now', '-1 day')");

    const changes = deleteSessionsOlderThan(30, 3);
    expect(changes).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Suite: deleteContextsOlderThan (keepLastSnapshots)
// ---------------------------------------------------------------------------

describe('deleteContextsOlderThan', () => {
  beforeEach(async () => {
    await initFreshDb();
  });

  afterAll(() => {
    closeDatabase();
  });

  it('UT9: preserva almeno N snapshot più recenti', () => {
    const s = insertSession('diana', 'completed', "datetime('now')");

    // 5 snapshot tutti vecchi (60 giorni fa)
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      ids.push(insertSnapshot(s, 'diana', "datetime('now', '-60 days')", `snapshot-${i}`));
    }

    const changes = deleteContextsOlderThan(30, 3);
    expect(changes).toBe(2); // 5 - 3 preservati = 2 cancellati

    const db = getDatabase();
    const remaining = db.prepare(
      "SELECT COUNT(*) as cnt FROM contexts WHERE context_type = 'snapshot'"
    ).get() as { cnt: number };
    expect(remaining.cnt).toBe(3);
  });

  it('non elimina contesti non-snapshot', () => {
    const s = insertSession('diana', 'completed', "datetime('now')");
    const db = getDatabase();

    // Inserisci contesto task_context vecchio
    const ctxId = uid('ctx');
    db.prepare(`
      INSERT INTO contexts (id, session_id, agent_name, context_type, content, created_at)
      VALUES (?, ?, ?, 'task_context', ?, datetime('now', '-60 days'))
    `).run(ctxId, s, 'diana', 'task context vecchio');

    const changes = deleteContextsOlderThan(30, 3);
    expect(changes).toBe(0); // task_context non è snapshot

    const remaining = db.prepare('SELECT COUNT(*) as cnt FROM contexts').get() as { cnt: number };
    expect(remaining.cnt).toBe(1);
  });

  it('non cancella nulla se keepLastSnapshots >= totale snapshot vecchi', () => {
    const s = insertSession('diana', 'completed', "datetime('now')");
    insertSnapshot(s, 'diana', "datetime('now', '-60 days')");
    insertSnapshot(s, 'diana', "datetime('now', '-60 days')");

    const changes = deleteContextsOlderThan(30, 10); // keep 10 ma ne esistono solo 2
    expect(changes).toBe(0);

    const db = getDatabase();
    const remaining = db.prepare(
      "SELECT COUNT(*) as cnt FROM contexts WHERE context_type = 'snapshot'"
    ).get() as { cnt: number };
    expect(remaining.cnt).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Suite: estimateRecoverableSpace
// ---------------------------------------------------------------------------

describe('estimateRecoverableSpace', () => {
  beforeEach(async () => {
    await initFreshDb();
  });

  afterAll(() => {
    closeDatabase();
  });

  it('UT6: stima spazio > 0 con eventi che hanno summary lungo', () => {
    const s = insertSession('diana', 'completed', "datetime('now')");
    const longSummary = 'A'.repeat(2000);
    insertEvent(s, 'diana', 'task_started', longSummary, "datetime('now', '-60 days')");

    const space = estimateRecoverableSpace(30);
    // 2000 bytes / 1024 ≈ 1.95 KB → arrotondato 2
    expect(space).toBeGreaterThan(0);
  });

  it('restituisce 0 senza eventi vecchi', () => {
    const s = insertSession('diana', 'completed', "datetime('now')");
    insertEvent(s, 'diana', 'task_started', 'Corto', "datetime('now', '-1 day')");

    const space = estimateRecoverableSpace(30);
    expect(space).toBe(0);
  });

  it('restituisce 0 su DB vuoto', () => {
    const space = estimateRecoverableSpace(30);
    expect(space).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Suite: getNextPurgeId
// ---------------------------------------------------------------------------

describe('getNextPurgeId', () => {
  beforeEach(async () => {
    await initFreshDb();
  });

  afterAll(() => {
    closeDatabase();
  });

  it('UT7: primo purge_id = 1', () => {
    const id = getNextPurgeId();
    expect(id).toBe(1);
  });

  it('UT8: purge_id incrementa dopo logPurgeRecord', () => {
    const id1 = getNextPurgeId();
    expect(id1).toBe(1);

    const params: PurgeLogParams = {
      olderThan: 30,
      eventsDeleted: 5,
      sessionsDeleted: 2,
      contextsDeleted: 1,
      spaceRecoveredKb: 10,
      dbSizeBeforeKb: 100,
      dbSizeAfterKb: 90,
      knowledgeCondensed: 3,
      agent: 'diana-tester',
    };
    logPurgeRecord(1, true, params);

    const id2 = getNextPurgeId();
    expect(id2).toBe(2);
  });

  it('getNextPurgeId è idempotente (non incrementa se chiamato più volte senza log)', () => {
    const id1 = getNextPurgeId();
    const id2 = getNextPurgeId();
    expect(id1).toBe(id2);
  });
});

// ---------------------------------------------------------------------------
// Suite: logPurgeRecord
// ---------------------------------------------------------------------------

describe('logPurgeRecord', () => {
  beforeEach(async () => {
    await initFreshDb();
  });

  afterAll(() => {
    closeDatabase();
  });

  it('registra un purge record e lo rende leggibile', () => {
    const params: PurgeLogParams = {
      olderThan: 60,
      eventsDeleted: 10,
      sessionsDeleted: 3,
      contextsDeleted: 2,
      spaceRecoveredKb: 50.5,
      dbSizeBeforeKb: 500,
      dbSizeAfterKb: 450,
      knowledgeCondensed: 5,
      agent: 'vulcanus-senior-dev',
    };

    logPurgeRecord(1, false, params);

    const db = getDatabase();
    const row = db.prepare('SELECT * FROM _purge_log WHERE purge_id = 1').get() as Record<string, unknown>;
    expect(row).toBeTruthy();
    expect(row.purge_id).toBe(1);
    expect(row.dry_run).toBe(0);
    expect(row.agent).toBe('vulcanus-senior-dev');
    expect(row.older_than).toBe(60);
    expect(row.events_deleted).toBe(10);
    expect(row.sessions_deleted).toBe(3);
    expect(row.snapshots_deleted).toBe(2);
    expect(row.space_recovered_kb).toBe(50.5);
    expect(row.db_size_before_kb).toBe(500);
    expect(row.db_size_after_kb).toBe(450);
    expect(row.knowledge_condensed).toBe(5);
  });

  it('registra dry_run=1 quando dryRun=true', () => {
    const params: PurgeLogParams = {
      olderThan: 30, eventsDeleted: 0, sessionsDeleted: 0, contextsDeleted: 0,
      spaceRecoveredKb: 0, dbSizeBeforeKb: 0, dbSizeAfterKb: 0,
      knowledgeCondensed: 0, agent: 'test',
    };

    logPurgeRecord(1, true, params);

    const db = getDatabase();
    const row = db.prepare('SELECT dry_run FROM _purge_log WHERE purge_id = 1').get() as { dry_run: number };
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

  it('UT10: restituisce > 0 per database su file', () => {
    const tmpPath = path.join(os.tmpdir(), `test-db-purge-${Date.now()}.db`);
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
      // getDbPath() returns ':memory:' which isn't a real file
      const size = getDatabaseSizeKb();
      expect(size).toBe(0);
    });
  });
});

// ---------------------------------------------------------------------------
// Suite: getTotalEventsOlderThan
// ---------------------------------------------------------------------------

describe('getTotalEventsOlderThan', () => {
  beforeEach(async () => {
    await initFreshDb();
  });

  afterAll(() => {
    closeDatabase();
  });

  it('restituisce 0 su DB vuoto', () => {
    const total = getTotalEventsOlderThan(30);
    expect(total).toBe(0);
  });

  it('conta eventi vecchi', () => {
    const s = insertSession('diana', 'completed', "datetime('now')");
    insertEvent(s, 'diana', 'task_started', 'Vecchio', "datetime('now', '-60 days')");
    insertEvent(s, 'diana', 'task_started', 'Recente', "datetime('now', '-1 day')");

    const total = getTotalEventsOlderThan(30);
    expect(total).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Suite: Safe Guards — tabelle protette non vengono toccate
// ---------------------------------------------------------------------------

describe('Safe Guards', () => {
  beforeEach(async () => {
    await initFreshDb();
  });

  afterAll(() => {
    closeDatabase();
  });

  it('SG1: knowledge_entries non vengono cancellate', () => {
    insertKnowledgeEntry('Pattern test', 'Body test pattern', 'pattern', 'diana-tester');
    insertKnowledgeEntry('Lesson test', 'Body lesson', 'lesson', 'vulcanus');

    const db = getDatabase();
    const before = db.prepare('SELECT COUNT(*) as cnt FROM knowledge_entries').get() as { cnt: number };

    // Esegui delete su eventi (non tocca knowledge)
    const s = insertSession('diana', 'completed', "datetime('now')");
    insertEvent(s, 'diana', 'task_started', 'Vecchio', "datetime('now', '-60 days')");
    deleteEventsOlderThan(30);

    const after = db.prepare('SELECT COUNT(*) as cnt FROM knowledge_entries').get() as { cnt: number };
    expect(after.cnt).toBe(before.cnt);
  });

  it('SG2: decision_rationale non viene cancellata', () => {
    const db = getDatabase();
    const id = `dec_${crypto.randomUUID()}`;
    db.prepare(`
      INSERT INTO decision_rationale (id, adr_id, agent_name)
      VALUES (?, 'ADR-037', 'vulcanus')
    `).run(id);

    const before = db.prepare('SELECT COUNT(*) as cnt FROM decision_rationale').get() as { cnt: number };

    deleteEventsOlderThan(30);

    const after = db.prepare('SELECT COUNT(*) as cnt FROM decision_rationale').get() as { cnt: number };
    expect(after.cnt).toBe(before.cnt);
  });

  it('SG3: metrics non vengono cancellate', () => {
    const db = getDatabase();
    // Inserisci una metrica direttamente
    db.prepare(`
      INSERT INTO metrics (id, domain, metric_name, value, recorded_at)
      VALUES (?, 'test', 'test_metric', 42, datetime('now', '-60 days'))
    `).run(`mtr_${crypto.randomUUID()}`);

    const before = db.prepare('SELECT COUNT(*) as cnt FROM metrics').get() as { cnt: number };

    deleteEventsOlderThan(30);

    const after = db.prepare('SELECT COUNT(*) as cnt FROM metrics').get() as { cnt: number };
    expect(after.cnt).toBe(before.cnt);
  });

  it('SG4: eventi recenti non vengono cancellati', () => {
    const s = insertSession('diana', 'completed', "datetime('now')");
    insertEvent(s, 'diana', 'task_completed', 'Recente 5gg', "datetime('now', '-5 days')");

    deleteEventsOlderThan(30);

    const db = getDatabase();
    const remaining = db.prepare('SELECT COUNT(*) as cnt FROM events').get() as { cnt: number };
    expect(remaining.cnt).toBe(1);
  });
});
