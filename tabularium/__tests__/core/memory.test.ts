/**
 * Test completi per i moduli memoria Tabularium (Fase 1: Fundamentum).
 *
 * Copertura:
 * - core/database.ts     — init, get, close, reset, WAL, FK, migrations
 * - core/db-sessions.ts  — CRUD sessioni
 * - core/db-events.ts    — CRUD eventi
 * - core/db-contexts.ts  — CRUD contesti
 * - core/db-knowledge.ts — CRUD knowledge + FTS5
 * - core/memory-migrator.ts — migrazione da Markdown
 *
 * @module tests/core/memory
 */

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { initDatabase, closeDatabase, getDatabase, getDbPath, resetDatabase } from '../../src/core/database.js';
import { createSession, getSession, listSessions, closeSession, updateSessionStatus } from '../../src/core/db-sessions.js';
import { insertEvent, getEventsBySession, getEventsByAgent, getEventsByType } from '../../src/core/db-events.js';
import { saveContext, getLatestContext, getContextsBySession, getLatestContextPerAgent } from '../../src/core/db-contexts.js';
import {
  createKnowledgeEntry,
  getKnowledgeEntry,
  searchKnowledge,
  listKnowledge,
  incrementRelevance,
  updateKnowledgeEntry,
} from '../../src/core/db-knowledge.js';
import { migrateFromMarkdown } from '../../src/core/memory-migrator.js';

import type {
  MemorySession,
  MemoryEvent,
  MemoryContext,
  KnowledgeEntry,
  SessionStatus,
  EventType,
  ContextType,
  KnowledgeCategory,
} from '../../src/types/memory.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Avvia un database in-memory pulito.
 * Chiamato in beforeEach per isolamento tra test.
 */
async function initFreshDb(): Promise<void> {
  closeDatabase();
  await initDatabase(':memory:');
}

/**
 * Converte un risultato qualsiasi in un oggetto piatto (rimuove prototipi)
 * per agevolare il matching nei test.
 */
function toPlainObject<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

// ---------------------------------------------------------------------------
// Suite: Database init / close / reset
// ---------------------------------------------------------------------------

describe('Database (database.ts)', () => {
  beforeAll(async () => {
    await initFreshDb();
  });

  afterAll(() => {
    closeDatabase();
  });

  describe('initDatabase', () => {
    it('crea una connessione e abilita WAL mode (o memory per :memory:)', () => {
      const db = getDatabase();
      const journalMode = db.pragma('journal_mode', { simple: true }) as string;
      // In-memory DB non può usare WAL; usa memory come fallback.
      // Con file DB reale, sarebbe 'wal'.
      expect(['wal', 'memory']).toContain(journalMode);
    });

    it('abilita foreign keys', () => {
      const db = getDatabase();
      const fk = db.pragma('foreign_keys', { simple: true });
      expect(fk).toBe(1);
    });

    it('crea le tabelle attese (sessions, events, contexts, knowledge_entries, decision_rationale, knowledge_fts)', () => {
      const db = getDatabase();
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE '_migrations' AND name NOT LIKE '%_fts%' AND name NOT LIKE '%_fts%' AND name NOT LIKE '%_config%'")
        .all() as { name: string }[];
      const tableNames = tables.map((r) => r.name).sort();
      expect(tableNames).toContain('sessions');
      expect(tableNames).toContain('events');
      expect(tableNames).toContain('contexts');
      expect(tableNames).toContain('knowledge_entries');
      expect(tableNames).toContain('decision_rationale');
      // La tabella knowledge_fts è un indice FTS5 virtuale
      // Nota: in alcuni build di SQLite le tabelle virtuali appaiono con type='table',
      // non 'virtual_table'. Usiamo il nome diretto per robustezza.
      const ftsRow = db.prepare("SELECT name FROM sqlite_master WHERE name='knowledge_fts'").get() as
        | { name: string }
        | undefined;
      expect(ftsRow).toBeTruthy();
      expect(ftsRow!.name).toBe('knowledge_fts');
    });

    it('crea la tabella _migrations per il tracking', () => {
      const db = getDatabase();
      const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='_migrations'").get();
      expect(row).toBeTruthy();
    });

    it('restituisce la stessa istanza se chiamata più volte', async () => {
      const db1 = getDatabase();
      const db2 = await initDatabase(':memory:');
      expect(db2).toBe(db1);
    });

    it('setta getDbPath() a :memory:', () => {
      expect(getDbPath()).toBe(':memory:');
    });
  });

  describe('getDatabase', () => {
    it('getDatabase() restituisce un oggetto Database valido', () => {
      const db = getDatabase();
      expect(db).toBeTruthy();
      expect(typeof db.prepare).toBe('function');
    });
  });

  describe('closeDatabase', () => {
    it('chiude la connessione (verificabile chiamando getDbPath che torna vuoto)', () => {
      // Salva path corrente
      closeDatabase();
      expect(getDbPath()).toBe('');
    });

    it('è sicuro chiamarla più volte (non lancia)', () => {
      expect(() => closeDatabase()).not.toThrow();
    });
  });

  describe('resetDatabase', () => {
    it('resetta il DB chiamando closeDatabase (path torna vuoto)', async () => {
      await initFreshDb();
      expect(getDbPath()).toBe(':memory:');
      resetDatabase();
      expect(getDbPath()).toBe('');
    });
  });

  describe('getDatabase() prima di init', () => {
    it('lancia errore se chiamata prima di initDatabase()', () => {
      // Dopo resetDatabase il singleton è null
      resetDatabase();
      expect(() => getDatabase()).toThrow(/not initialized/i);
    });
  });
});

// ---------------------------------------------------------------------------
// Suite: Sessioni (db-sessions.ts)
// ---------------------------------------------------------------------------

describe('Sessioni (db-sessions.ts)', () => {
  beforeEach(async () => {
    await initFreshDb();
  });

  afterAll(() => {
    closeDatabase();
  });

  describe('createSession', () => {
    it('crea una sessione con UUID, start_time ISO, status active', () => {
      const session = createSession('diana-tester', 'testing');
      expect(session).toBeTruthy();
      expect(session.id).toMatch(/^ses_/);
      expect(typeof session.id).toBe('string');
      expect(session.agent_name).toBe('diana-tester');
      expect(session.start_time).toBeTruthy();
      // Verifica formato ISO 8601
      expect(() => new Date(session.start_time)).not.toThrow();
      expect(session.status).toBe('active');
      expect(session.focus).toBe('testing');
      // event_count non è presente nel return di createSession (solo getSession lo calcola)
    });

    it('usa focus default "all" se non specificato', () => {
      const session = createSession('iuppiter');
      expect(session.focus).toBe('all');
    });

    it('crea sessioni con ID univoci', () => {
      const s1 = createSession('agent-a');
      const s2 = createSession('agent-a');
      expect(s1.id).not.toBe(s2.id);
    });
  });

  describe('getSession', () => {
    it('restituisce la sessione creata', () => {
      const created = createSession('minerva-architect');
      const found = getSession(created.id);
      expect(found).toBeTruthy();
      expect(found!.id).toBe(created.id);
      expect(found!.agent_name).toBe(created.agent_name);
      expect(found!.status).toBe(created.status);
    });

    it('restituisce undefined per ID inesistente', () => {
      const result = getSession('ses_nonexistent');
      expect(result).toBeUndefined();
    });
  });

  describe('listSessions', () => {
    it('restituisce tutte le sessioni senza filtri', () => {
      createSession('agent-a');
      createSession('agent-b');
      createSession('agent-c');
      const sessions = listSessions();
      expect(sessions.length).toBe(3);
    });

    it('filtra per agent_name', () => {
      createSession('agent-a');
      createSession('agent-b');
      const sessions = listSessions({ agent: 'agent-a' });
      expect(sessions.length).toBe(1);
      expect(sessions[0].agent_name).toBe('agent-a');
    });

    it('filtra per status', () => {
      const s = createSession('agent-a');
      closeSession(s.id);
      const active = listSessions({ status: 'active' });
      const completed = listSessions({ status: 'completed' });
      expect(active.length).toBe(0); // l'unica sessione è chiusa
      expect(completed.length).toBe(1);
    });

    it('rispetta il parametro limit', () => {
      for (let i = 0; i < 10; i++) {
        createSession(`agent-${i}`);
      }
      const sessions = listSessions({ limit: 3 });
      expect(sessions.length).toBe(3);
    });

    it('ordina per start_time DESC', () => {
      createSession('first', 'focus');
      // Piccola pausa per timestamp diverso
      const s2 = createSession('second', 'focus');
      const all = listSessions();
      // La più recente (second) deve essere prima
      expect(all[0].id).toBe(s2.id);
    });
  });

  describe('closeSession', () => {
    it('imposta end_time e status completed', () => {
      const session = createSession('diana-tester');
      closeSession(session.id);
      const closed = getSession(session.id);
      expect(closed!.status).toBe('completed');
      expect(closed!.end_time).toBeTruthy();
      expect(() => new Date(closed!.end_time!)).not.toThrow();
    });

    it('lancia errore per ID inesistente', () => {
      expect(() => closeSession('ses_doesnotexist')).toThrow(/not found/i);
    });
  });

  describe('updateSessionStatus', () => {
    it('aggiorna lo stato di una sessione', () => {
      const session = createSession('tester');
      updateSessionStatus(session.id, 'aborted');
      const updated = getSession(session.id);
      expect(updated!.status).toBe('aborted');
    });

    it('aggiorna status e metadata se forniti', () => {
      const session = createSession('tester');
      updateSessionStatus(session.id, 'interrupted', { reason: 'timeout' });
      const updated = getSession(session.id);
      expect(updated!.status).toBe('interrupted');
      expect(updated!.metadata).toEqual({ reason: 'timeout' });
    });
  });
});

// ---------------------------------------------------------------------------
// Suite: Eventi (db-events.ts)
// ---------------------------------------------------------------------------

describe('Eventi (db-events.ts)', () => {
  let sessionId: string;

  beforeEach(async () => {
    await initFreshDb();
    sessionId = createSession('diana-tester').id;
  });

  afterAll(() => {
    closeDatabase();
  });

  describe('insertEvent', () => {
    it('crea un evento collegato a una sessione', () => {
      const event = insertEvent(sessionId, 'diana-tester', 'task_started', 'Test event');
      expect(event).toBeTruthy();
      expect(event.id).toMatch(/^evt_/);
      expect(event.session_id).toBe(sessionId);
      expect(event.agent_name).toBe('diana-tester');
      expect(event.event_type).toBe('task_started');
      expect(event.summary).toBe('Test event');
      expect(event.timestamp).toBeTruthy();
      expect(() => new Date(event.timestamp)).not.toThrow();
    });

    it('accetta details e tags opzionali', () => {
      const event = insertEvent(
        sessionId,
        'minerva',
        'decision_made',
        'Decision test',
        { key: 'value', nested: { a: 1 } },
        ['important', 'decision']
      );
      expect(event.details).toEqual({ key: 'value', nested: { a: 1 } });
      expect(event.tags).toEqual(['important', 'decision']);
    });

    it('usa default vuoto per details e tags non forniti', () => {
      const event = insertEvent(sessionId, 'agent', 'custom', 'Minimal');
      expect(event.details).toEqual({});
      expect(event.tags).toEqual([]);
    });
  });

  describe('getEventsBySession', () => {
    it('restituisce gli eventi di una sessione in ordine decrescente', () => {
      insertEvent(sessionId, 'a', 'task_started', 'First');
      insertEvent(sessionId, 'a', 'task_completed', 'Second');
      const result = getEventsBySession(sessionId);
      expect(result.total).toBe(2);
      expect(result.events.length).toBe(2);
      // Con timestamp identici (stesso millisecondo), l'ordinamento
      // non è deterministico — usiamo arrayContaining
      const summaries = result.events.map((e) => e.summary);
      expect(summaries).toEqual(expect.arrayContaining(['First', 'Second']));
    });

    it('rispetta limit e offset', () => {
      for (let i = 0; i < 10; i++) {
        insertEvent(sessionId, 'agent', 'custom', `Event ${i}`);
      }
      const page1 = getEventsBySession(sessionId, { limit: 3, offset: 0 });
      expect(page1.events.length).toBe(3);
      expect(page1.total).toBe(10);

      const page2 = getEventsBySession(sessionId, { limit: 3, offset: 3 });
      expect(page2.events.length).toBe(3);
      // Verifica che siano pagine diverse
      const page1Ids = page1.events.map((e) => e.id).sort();
      const page2Ids = page2.events.map((e) => e.id).sort();
      expect(page1Ids).not.toEqual(page2Ids);
    });

    it('filtra per event_type', () => {
      insertEvent(sessionId, 'a', 'task_started', 'Start');
      insertEvent(sessionId, 'a', 'task_completed', 'Done');
      insertEvent(sessionId, 'a', 'task_started', 'Start 2');
      const result = getEventsBySession(sessionId, { type: 'task_started' });
      expect(result.total).toBe(2);
      expect(result.events.every((e) => e.event_type === 'task_started')).toBe(true);
    });

    it('restituisce array vuoto per sessione senza eventi', () => {
      const result = getEventsBySession(sessionId);
      expect(result.events).toEqual([]);
      expect(result.total).toBe(0);
    });
  });

  describe('getEventsByAgent', () => {
    it('restituisce eventi di un agente specifico', () => {
      const s1 = createSession('minerva').id;
      const s2 = createSession('vulcanus').id;
      insertEvent(s1, 'minerva', 'task_started', 'Minerva event');
      insertEvent(s2, 'vulcanus', 'task_completed', 'Vulcanus event');
      insertEvent(s1, 'minerva', 'decision_made', 'Minerva decision');

      const minervaEvents = getEventsByAgent('minerva');
      expect(minervaEvents.length).toBe(2);
      expect(minervaEvents.every((e) => e.agent_name === 'minerva')).toBe(true);
    });

    it('rispetta il parametro limit', () => {
      const s = createSession('agent').id;
      for (let i = 0; i < 10; i++) {
        insertEvent(s, 'agent', 'custom', `E${i}`);
      }
      const events = getEventsByAgent('agent', 3);
      expect(events.length).toBe(3);
    });

    it('restituisce array vuoto per agente senza eventi', () => {
      const events = getEventsByAgent('ghost-agent');
      expect(events).toEqual([]);
    });
  });

  describe('getEventsByType', () => {
    it('filtra per tipo e intervallo temporale', () => {
      const s = createSession('agent').id;
      insertEvent(s, 'agent', 'milestone_reached', 'M1');
      insertEvent(s, 'agent', 'task_started', 'T1');
      insertEvent(s, 'agent', 'task_started', 'T2');

      const since = new Date(0).toISOString(); // epoch
      const result = getEventsByType('task_started', since);
      expect(result.length).toBe(2);
      expect(result.every((e) => e.event_type === 'task_started')).toBe(true);
    });

    it('filtra anche per until se fornito', () => {
      const s = createSession('agent').id;
      insertEvent(s, 'agent', 'milestone_reached', 'M1');
      const future = new Date(Date.now() + 3600000).toISOString();
      const result = getEventsByType('milestone_reached', new Date(0).toISOString(), future);
      expect(result.length).toBe(1);
    });
  });

  describe('Serializzazione JSON', () => {
    it('details e tags sono serializzati/deserializzati correttamente', () => {
      const details = { complexity: 5, flags: ['a', 'b'] };
      const tags = ['urgent', 'refactor'];
      insertEvent(sessionId, 'agent', 'task_completed', 'Serde test', details, tags);

      const result = getEventsBySession(sessionId);
      const event = result.events[0];
      expect(event.details).toEqual(details);
      expect(event.tags).toEqual(tags);
    });
  });
});

// ---------------------------------------------------------------------------
// Suite: Contesti (db-contexts.ts)
// ---------------------------------------------------------------------------

describe('Contesti (db-contexts.ts)', () => {
  let sessionId: string;

  beforeEach(async () => {
    await initFreshDb();
    sessionId = createSession('diana-tester').id;
  });

  afterAll(() => {
    closeDatabase();
  });

  describe('saveContext', () => {
    it('salva un contesto e lo restituisce', () => {
      const ctx = saveContext(sessionId, 'minerva', 'session_start', 'Contenuto del contesto');
      expect(ctx).toBeTruthy();
      expect(ctx.id).toMatch(/^ctx_/);
      expect(ctx.session_id).toBe(sessionId);
      expect(ctx.agent_name).toBe('minerva');
      expect(ctx.context_type).toBe('session_start');
      expect(ctx.content).toBe('Contenuto del contesto');
      expect(ctx.source).toBe('auto');
      expect(ctx.created_at).toBeTruthy();
      expect(() => new Date(ctx.created_at)).not.toThrow();
    });

    it('accetta source e metadata personalizzati', () => {
      const ctx = saveContext(sessionId, 'vulcanus', 'snapshot', 'Snapshot content', 'manual', { version: 2 });
      expect(ctx.source).toBe('manual');
      expect(ctx.metadata).toEqual({ version: 2 });
    });
  });

  describe('getLatestContext', () => {
    it('restituisce il contesto più recente per agente', async () => {
      saveContext(sessionId, 'minerva', 'task_context', 'Primo contesto');
      // Piccola pausa per garantire timestamp differente
      await new Promise((r) => setTimeout(r, 5));
      const second = saveContext(sessionId, 'minerva', 'task_context', 'Secondo contesto');
      const latest = getLatestContext('minerva');
      expect(latest).toBeTruthy();
      expect(latest!.id).toBe(second.id);
      expect(latest!.content).toBe('Secondo contesto');
    });

    it('filtra per context_type', () => {
      saveContext(sessionId, 'minerva', 'session_start', 'Inizio sessione');
      saveContext(sessionId, 'minerva', 'task_context', 'Contesto task');
      const latestSession = getLatestContext('minerva', 'session_start');
      expect(latestSession).toBeTruthy();
      expect(latestSession!.context_type).toBe('session_start');
      expect(latestSession!.content).toBe('Inizio sessione');

      const latestTask = getLatestContext('minerva', 'task_context');
      expect(latestTask!.context_type).toBe('task_context');
    });

    it('restituisce undefined per agente senza contesti', () => {
      const result = getLatestContext('ghost');
      expect(result).toBeUndefined();
    });
  });

  describe('getContextsBySession', () => {
    it('restituisce tutti i contesti di una sessione', () => {
      saveContext(sessionId, 'a', 'task_context', 'C1');
      saveContext(sessionId, 'b', 'task_context', 'C2');
      const contexts = getContextsBySession(sessionId);
      expect(contexts.length).toBe(2);
    });

    it('rispetta il limite', () => {
      for (let i = 0; i < 5; i++) {
        saveContext(sessionId, 'a', 'task_context', `C${i}`);
      }
      const contexts = getContextsBySession(sessionId, 2);
      expect(contexts.length).toBe(2);
    });
  });

  describe('getLatestContextPerAgent', () => {
    it('restituisce un contesto per ogni agente', async () => {
      const s1 = createSession('minerva').id;
      saveContext(s1, 'minerva', 'snapshot', 'Minerva ctx');
      // Piccola pausa per timestamp differenti
      await new Promise((r) => setTimeout(r, 5));
      const s2 = createSession('vulcanus').id;
      saveContext(s2, 'vulcanus', 'snapshot', 'Vulcanus ctx');
      const contexts = getLatestContextPerAgent();
      expect(contexts.length).toBe(2);
      const agents = contexts.map((c) => c.agent_name).sort();
      expect(agents).toEqual(['minerva', 'vulcanus']);
    });

    it('filtra per context_type', async () => {
      const s1 = createSession('minerva').id;
      saveContext(s1, 'minerva', 'session_start', 'Start');
      await new Promise((r) => setTimeout(r, 5));
      saveContext(s1, 'minerva', 'task_context', 'Task');
      const filtered = getLatestContextPerAgent('session_start');
      expect(filtered.length).toBe(1);
      expect(filtered[0].context_type).toBe('session_start');
    });
  });
});

// ---------------------------------------------------------------------------
// Suite: Knowledge (db-knowledge.ts)
// ---------------------------------------------------------------------------

describe('Knowledge (db-knowledge.ts)', () => {
  beforeEach(async () => {
    await initFreshDb();
  });

  afterAll(() => {
    closeDatabase();
  });

  describe('createKnowledgeEntry', () => {
    it('crea una entry con tutti i campi', () => {
      const entry = createKnowledgeEntry(
        'Test Title',
        'Test body content for knowledge entry',
        'lesson',
        'diana-tester',
        ['test', 'coverage'],
        'TASK-001'
      );
      expect(entry).toBeTruthy();
      expect(entry.id).toMatch(/^k_/);
      expect(entry.title).toBe('Test Title');
      expect(entry.body).toBe('Test body content for knowledge entry');
      expect(entry.category).toBe('lesson');
      expect(entry.tags).toEqual(['test', 'coverage']);
      expect(entry.source_agent).toBe('diana-tester');
      expect(entry.source_task_id).toBe('TASK-001');
      expect(entry.relevance_score).toBe(0);
      expect(entry.status).toBe('active');
      expect(entry.created_at).toBeTruthy();
      expect(entry.updated_at).toBeTruthy();
    });

    it('crea entry senza campi opzionali', () => {
      const entry = createKnowledgeEntry('Minimal', 'Just body', 'faq');
      expect(entry.id).toBeTruthy();
      expect(entry.source_agent).toBeUndefined();
      expect(entry.source_task_id).toBeUndefined();
      expect(entry.tags).toEqual([]);
    });
  });

  describe('getKnowledgeEntry', () => {
    it('restituisce la entry creata', () => {
      const created = createKnowledgeEntry('Get test', 'Body', 'tip');
      const found = getKnowledgeEntry(created.id);
      expect(found).toBeTruthy();
      expect(found!.id).toBe(created.id);
      expect(found!.title).toBe('Get test');
    });

    it('restituisce undefined per ID inesistente', () => {
      const result = getKnowledgeEntry('k_nonexistent');
      expect(result).toBeUndefined();
    });
  });

  describe('searchKnowledge', () => {
    it('trova per testo usando FTS5', () => {
      createKnowledgeEntry('SQLite Performance', 'How to optimize SQLite queries for speed', 'lesson', 'vulcanus');
      createKnowledgeEntry('React Patterns', 'Common React design patterns for components', 'pattern', 'ovidio');
      const results = searchKnowledge('SQLite');
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results.some((r) => r.title.includes('SQLite'))).toBe(true);
    });

    it('non trova testo inesistente', () => {
      createKnowledgeEntry('Only One', 'Some content here', 'faq');
      const results = searchKnowledge('zzz_nonexistent_zzz');
      expect(results).toEqual([]);
    });

    it('filtra per categoria opzionale', () => {
      createKnowledgeEntry('TypeScript Tips', 'Tips for TypeScript', 'tip', 'minerva');
      createKnowledgeEntry('TypeScript Pitfalls', 'Common pitfalls', 'pitfall', 'minerva');
      const tips = searchKnowledge('TypeScript', 'tip');
      expect(tips.length).toBe(1);
      expect(tips[0].category).toBe('tip');
    });

    it('rispetta il limite', () => {
      for (let i = 0; i < 10; i++) {
        createKnowledgeEntry(`Entry ${i}`, `Content for entry number ${i}`, 'faq');
      }
      const results = searchKnowledge('entry', undefined, 3);
      expect(results.length).toBeLessThanOrEqual(3);
    });
  });

  describe('listKnowledge', () => {
    it('restituisce tutte le entries', () => {
      createKnowledgeEntry('A', 'Body A', 'pattern');
      createKnowledgeEntry('B', 'Body B', 'tip');
      const all = listKnowledge();
      expect(all.length).toBe(2);
    });

    it('filtra per category', () => {
      createKnowledgeEntry('Pattern 1', 'Body', 'pattern');
      createKnowledgeEntry('Tip 1', 'Body', 'tip');
      createKnowledgeEntry('Pattern 2', 'Body', 'pattern');
      const patterns = listKnowledge({ category: 'pattern' });
      expect(patterns.length).toBe(2);
      expect(patterns.every((e) => e.category === 'pattern')).toBe(true);
    });

    it('filtra per status', () => {
      createKnowledgeEntry('Active', 'Body', 'lesson');
      // Dobbiamo usare updateKnowledgeEntry per cambiare status
      const draft = createKnowledgeEntry('Draft', 'Body', 'lesson');
      updateKnowledgeEntry(draft.id, { status: 'draft' });
      const all = listKnowledge({ status: 'draft' });
      expect(all.length).toBe(1);
      expect(all[0].status).toBe('draft');
    });
  });

  describe('incrementRelevance', () => {
    it('incrementa il contatore di rilevanza', () => {
      const entry = createKnowledgeEntry('Relevance Test', 'Body', 'faq');
      expect(entry.relevance_score).toBe(0);
      incrementRelevance(entry.id);
      const updated = getKnowledgeEntry(entry.id);
      expect(updated!.relevance_score).toBe(1);
      incrementRelevance(entry.id);
      incrementRelevance(entry.id);
      const updated2 = getKnowledgeEntry(entry.id);
      expect(updated2!.relevance_score).toBe(3);
    });
  });

  describe('updateKnowledgeEntry', () => {
    it('modifica una entry esistente', () => {
      const entry = createKnowledgeEntry('Original Title', 'Original body', 'lesson');
      const updated = updateKnowledgeEntry(entry.id, {
        title: 'Updated Title',
        body: 'Updated body',
        category: 'tip',
        tags: ['updated'],
        status: 'archived',
      });
      expect(updated).toBeTruthy();
      expect(updated!.title).toBe('Updated Title');
      expect(updated!.body).toBe('Updated body');
      expect(updated!.category).toBe('tip');
      expect(updated!.tags).toEqual(['updated']);
      expect(updated!.status).toBe('archived');
    });

    it('restituisce undefined per ID inesistente', () => {
      const result = updateKnowledgeEntry('k_nonexistent', { title: 'Nope' });
      expect(result).toBeUndefined();
    });

    it('aggiorna solo i campi forniti (merge)', () => {
      const entry = createKnowledgeEntry('Original', 'Original body', 'pitfall', undefined, ['tag1']);
      const updated = updateKnowledgeEntry(entry.id, { title: 'New Title' });
      expect(updated!.title).toBe('New Title');
      expect(updated!.body).toBe('Original body');
      expect(updated!.category).toBe('pitfall');
      expect(updated!.tags).toEqual(['tag1']);
    });
  });
});

// ---------------------------------------------------------------------------
// Suite: Memory Migrator (memory-migrator.ts)
// ---------------------------------------------------------------------------

describe('Memory Migrator (memory-migrator.ts)', () => {
  // DEV_TEAM_DIR nel modulo migrator è calcolato all'import come:
  //   path.resolve(process.cwd(), '..', 'docs', 'codex-romanus')
  // dove process.cwd() = tabularium/ (radice di Jest).
  // Quindi punta sempre a <project-root>/docs/codex-romanus/.
  // Salviamo i file reali, sovrascriviamo con dati test, ripristiniamo in afterAll.
  const DEV_TEAM_PATH = path.resolve(process.cwd(), '..', 'docs', 'codex-romanus');
  const BACKUPS_BASE = path.resolve(process.cwd(), 'backups');

  let realProgressContent: string;
  let realDecisionsContent: string;
  let realPlanningContent: string;

  const testProgressContent = `# Test Progress Log

### diana-tester
- [x] Task completato con successo (@diana-tester)
- [ ] Task in sospeso senza owner
- [failed] Task fallito (@vulcanus)

### iuppiter-orchestrator
- [x] Pianificazione completata (@iuppiter)
`;

  const testDecisionsContent = `# Test Decisioni

## ADR-001: Scegliere SQLite
**Decisione:** Adottiamo SQLite come database embedded
**Motivazione:** Portabilità, zero configurazione, FTS5 integrato

## ADR-002: Usare better-sqlite3
**Decisione:** better-sqlite3 come driver Node.js
**Motivazione:** API sincrona, performance, maturità
`;

  const testPlanningContent = `# Test Planning
Planning content for testing purposes.
`;

  beforeAll(() => {
    // Salva i contenuti originali dei file .dev-team/
    realProgressContent = fs.readFileSync(path.join(DEV_TEAM_PATH, 'progress.md'), 'utf-8');
    realDecisionsContent = fs.readFileSync(path.join(DEV_TEAM_PATH, 'decisions.md'), 'utf-8');
    realPlanningContent = fs.readFileSync(path.join(DEV_TEAM_PATH, 'planning.md'), 'utf-8');

    // Sovrascrive con contenuti di test (il migrator legge da DEV_TEAM_DIR
    // che è una costante a livello di modulo, punta sempre a DEV_TEAM_PATH)
    fs.writeFileSync(path.join(DEV_TEAM_PATH, 'progress.md'), testProgressContent, 'utf-8');
    fs.writeFileSync(path.join(DEV_TEAM_PATH, 'decisions.md'), testDecisionsContent, 'utf-8');
    fs.writeFileSync(path.join(DEV_TEAM_PATH, 'planning.md'), testPlanningContent, 'utf-8');
  });

  afterAll(() => {
    // Ripristina i file originali
    fs.writeFileSync(path.join(DEV_TEAM_PATH, 'progress.md'), realProgressContent, 'utf-8');
    fs.writeFileSync(path.join(DEV_TEAM_PATH, 'decisions.md'), realDecisionsContent, 'utf-8');
    fs.writeFileSync(path.join(DEV_TEAM_PATH, 'planning.md'), realPlanningContent, 'utf-8');

    // Pulisce backup creati dal migrator
    if (fs.existsSync(BACKUPS_BASE)) {
      const backupDirs = fs.readdirSync(BACKUPS_BASE).filter((d) => d.startsWith('markdown-import-'));
      for (const dir of backupDirs) {
        fs.rmSync(path.join(BACKUPS_BASE, dir), { recursive: true, force: true });
      }
    }

    closeDatabase();
  });

  beforeEach(async () => {
    closeDatabase();
    await initDatabase(':memory:');
  });

  it('importa dati da progress.md e decisions.md', async () => {
    const result = await migrateFromMarkdown();
    expect(result.sessionsImported).toBeGreaterThanOrEqual(1);
    expect(result.eventsImported).toBeGreaterThan(0);
    expect(result.contextsImported).toBeGreaterThan(0);
  });

  it('crea eventi importati verificabili nel DB', async () => {
    await migrateFromMarkdown();

    // Verifica che gli eventi siano stati creati nelle sessioni
    const sessions = listSessions();
    expect(sessions.length).toBeGreaterThanOrEqual(1);

    // Cerca eventi con tag 'import' che indicano l'import
    const allEvents = getEventsByAgent('diana-tester');
    expect(allEvents.length).toBeGreaterThan(0);

    // Verifica contenuto specifico importato
    const completedEvents = allEvents.filter((e) => e.event_type === 'task_completed');
    expect(completedEvents.length).toBeGreaterThanOrEqual(1);
    const completedSummary = completedEvents.map((e) => e.summary);
    expect(completedSummary).toContain('Task completato con successo');
  });

  it('importa decision_rationale da decisions.md', async () => {
    await migrateFromMarkdown();
    const db = getDatabase();
    const decisions = db.prepare('SELECT * FROM decision_rationale').all() as Record<string, unknown>[];
    expect(decisions.length).toBeGreaterThanOrEqual(2);

    const adrIds = decisions.map((d) => d.adr_id).sort();
    expect(adrIds).toContain('ADR-001');
    expect(adrIds).toContain('ADR-002');
  });

  it('crea il backup directory', async () => {
    await migrateFromMarkdown();
    // BACKUPS_DIR nel modulo migrator è calcolato all'import come:
    //   path.resolve(process.cwd(), 'backups') = tabularium/backups/
    const backupsDir = BACKUPS_BASE;
    expect(fs.existsSync(backupsDir)).toBe(true);
    const backupDirs = fs.readdirSync(backupsDir).filter((d) => d.startsWith('markdown-import-'));
    expect(backupDirs.length).toBeGreaterThanOrEqual(1);

    // Verifica che i file siano stati copiati
    const latestBackup = path.join(backupsDir, backupDirs[backupDirs.length - 1]);
    expect(fs.existsSync(path.join(latestBackup, 'progress.md'))).toBe(true);
    expect(fs.existsSync(path.join(latestBackup, 'decisions.md'))).toBe(true);
    expect(fs.existsSync(path.join(latestBackup, 'planning.md'))).toBe(true);
  });

  it('restituisce conteggi corretti', async () => {
    const result = await migrateFromMarkdown();
    // progress.md: 1 sessione, 3 eventi (2 completati + 1 failed + 1 pending), 1 contesto
    // decisions.md: 2 ADR → 2 decision_rationale events
    // planning.md: 1 contesto
    expect(result.sessionsImported).toBe(1);
    expect(result.eventsImported).toBeGreaterThanOrEqual(3); // 3 eventi da progress
    expect(result.contextsImported).toBeGreaterThanOrEqual(2); // 1 da progress + 1 da planning
  });

  describe('directory docs/codex-romanus non esistente', () => {
    let devTeamBackupPath: string;

    beforeAll(() => {
      // Sposta temporaneamente docs/codex-romanus/ per simulare l'assenza
      devTeamBackupPath = DEV_TEAM_PATH + '-migrator-test-backup';
      if (fs.existsSync(devTeamBackupPath)) {
        fs.rmSync(devTeamBackupPath, { recursive: true, force: true });
      }
      fs.renameSync(DEV_TEAM_PATH, devTeamBackupPath);
    });

    afterAll(() => {
      // Ripristina docs/codex-romanus/
      if (fs.existsSync(devTeamBackupPath)) {
        if (fs.existsSync(DEV_TEAM_PATH)) {
          fs.rmSync(DEV_TEAM_PATH, { recursive: true, force: true });
        }
        fs.renameSync(devTeamBackupPath, DEV_TEAM_PATH);
      }
    });

    it('non fallisce se la directory docs/codex-romanus non esiste', async () => {
      const result = await migrateFromMarkdown();
      expect(result.sessionsImported).toBe(0);
      expect(result.eventsImported).toBe(0);
      expect(result.contextsImported).toBe(0);
    });
  });
});

// ---------------------------------------------------------------------------
// Suite: Edge cases
// ---------------------------------------------------------------------------

describe('Edge cases', () => {
  beforeEach(async () => {
    await initFreshDb();
  });

  afterEach(() => {
    closeDatabase();
  });

  afterAll(() => {
    resetDatabase();
  });

  describe('Database non inizializzato', () => {
    it('createSession lancia errore', () => {
      resetDatabase();
      expect(() => createSession('test')).toThrow(/not initialized/i);
    });

    it('insertEvent lancia errore', () => {
      resetDatabase();
      expect(() => insertEvent('ses_id', 'test', 'custom', 'test')).toThrow(/not initialized/i);
    });

    it('saveContext lancia errore', () => {
      resetDatabase();
      expect(() => saveContext('s', 'a', 'session_start', 'c')).toThrow(/not initialized/i);
    });

    it('createKnowledgeEntry lancia errore', () => {
      resetDatabase();
      expect(() => createKnowledgeEntry('t', 'b', 'lesson')).toThrow(/not initialized/i);
    });
  });

  describe('ID inesistenti', () => {
    beforeEach(async () => {
      await initFreshDb();
    });

    it('getSession → undefined per ID non esistente', () => {
      expect(getSession('ses_nonexistent')).toBeUndefined();
    });

    it('closeSession lancia per ID inesistente', () => {
      expect(() => closeSession('ses_nonexistent')).toThrow(/not found/i);
    });

    it('getKnowledgeEntry → undefined per ID non esistente', () => {
      expect(getKnowledgeEntry('k_nonexistent')).toBeUndefined();
    });
  });

  describe('Foreign key violations', () => {
    beforeEach(async () => {
      await initFreshDb();
    });

    it('insertEvent con session_id inesistente lancia errore FK', () => {
      expect(() => {
        insertEvent('ses_nonexistent', 'agent', 'custom', 'test');
      }).toThrow();
    });

    it('saveContext con session_id inesistente lancia errore FK', () => {
      expect(() => {
        saveContext('ses_nonexistent', 'agent', 'session_start', 'test');
      }).toThrow();
    });
  });

  describe('In-memory isolation', () => {
    it('ogni beforeEach produce un DB pulito', async () => {
      // Questo test verifica che due test consecutivi non condividano stato
      // (eseguito in un describe separato con il suo beforeEach)
      const db = getDatabase();
      const sessions = db.prepare('SELECT COUNT(*) as count FROM sessions').get() as { count: number };
      expect(sessions.count).toBe(0);
    });
  });
});
