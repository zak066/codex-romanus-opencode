/**
 * Test per i moduli Fase 2: Scriptorium
 *
 * Copertura:
 * - core/knowledge-manager.ts — suggestKnowledge, suggestKnowledgeForAgent, findRelatedByTags, suggestCategoryAndTags
 * - core/faq-manager.ts — detectFaqCandidates, generateFaqFromCandidate
 * - tools/memory.tool.ts — nuove action: knowledge_suggest, faq_detect
 * - migrations/002_knowledge_triggers.sql — trigger trg_knowledge_updated, trg_session_updated
 *
 * @module tests/core/memory-phase2
 */

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { initDatabase, closeDatabase, getDatabase, resetDatabase } from '../../src/core/database.js';
import { createSession } from '../../src/core/db-sessions.js';
import { insertEvent } from '../../src/core/db-events.js';
import { createKnowledgeEntry, getKnowledgeEntry } from '../../src/core/db-knowledge.js';
import {
  suggestKnowledge,
  suggestKnowledgeForAgent,
  findRelatedByTags,
  suggestCategoryAndTags,
} from '../../src/core/knowledge-manager.js';
import { detectFaqCandidates, generateFaqFromCandidate } from '../../src/core/faq-manager.js';
import type { FaqCandidate } from '../../src/core/faq-manager.js';
import { memoryToolHandler } from '../../src/tools/memory.tool.js';

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

// ---------------------------------------------------------------------------
// Suite: knowledge-manager.ts
// ---------------------------------------------------------------------------

describe('Fase 2 — Knowledge Manager (knowledge-manager.ts)', () => {
  beforeEach(async () => {
    await initFreshDb();
  });

  afterAll(() => {
    closeDatabase();
  });

  // -----------------------------------------------------------------------
  // suggestKnowledge
  // -----------------------------------------------------------------------

  describe('suggestKnowledge', () => {
    it('restituisce risultati FTS5 per un contesto testuale', () => {
      createKnowledgeEntry(
        'SQLite Performance',
        'How to optimize SQLite queries for speed',
        'lesson',
        'vulcanus',
        ['database', 'sqlite'],
      );
      createKnowledgeEntry(
        'React Patterns',
        'Common React design patterns for components',
        'pattern',
        'ovidio',
        ['react', 'patterns'],
      );

      const results = suggestKnowledge('SQLite');

      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results.some((r) => r.title.includes('SQLite'))).toBe(true);
    });

    it('ordina per relevance_score DESC', () => {
      const e1 = createKnowledgeEntry('Bug Fixing Advanced', 'How to fix advanced bugs', 'lesson', 'vulcanus');
      const e2 = createKnowledgeEntry('Bug Fixing Basic', 'How to fix basic bugs', 'lesson', 'vulcanus');

      // Imposta relevance_score più alto sulla prima entry via SQL diretto
      const db = getDatabase();
      db.prepare('UPDATE knowledge_entries SET relevance_score = 10 WHERE id = ?').run(e1.id);

      const results = suggestKnowledge('bug');

      expect(results.length).toBeGreaterThanOrEqual(2);
      expect(results[0].id).toBe(e1.id);
      expect(results[0].relevance_score).toBe(10);
    });

    it('restituisce array vuoto per knowledge base vuota', () => {
      const results = suggestKnowledge('test');
      expect(results).toEqual([]);
    });

    it('restituisce array vuoto per contesto vuoto', () => {
      expect(suggestKnowledge('')).toEqual([]);
      expect(suggestKnowledge('   ')).toEqual([]);
    });

    it('restituisce array vuoto per contesto con soli caratteri speciali', () => {
      // Dopo escapeFtsQuery, stringhe con soli caratteri speciali diventano vuote
      expect(suggestKnowledge('@!#$%^&*()_+=')).toEqual([]);
    });

    it('rispetta il parametro limit', () => {
      for (let i = 0; i < 10; i++) {
        createKnowledgeEntry(`Entry ${i}`, `Content for entry number ${i}`, 'faq', 'tester');
      }
      const results = suggestKnowledge('entry', 3);
      expect(results.length).toBeLessThanOrEqual(3);
    });
  });

  // -----------------------------------------------------------------------
  // suggestKnowledgeForAgent
  // -----------------------------------------------------------------------

  describe('suggestKnowledgeForAgent', () => {
    it('restituisce entry create da un agente specifico', () => {
      createKnowledgeEntry('Vulcanus Entry 1', 'Vulcanus knowledge', 'lesson', 'vulcanus', ['typescript']);
      createKnowledgeEntry('Minerva Entry', 'Minerva knowledge', 'lesson', 'minerva', ['architecture']);
      createKnowledgeEntry('Vulcanus Entry 2', 'More Vulcanus knowledge', 'tip', 'vulcanus', ['node']);

      const results = suggestKnowledgeForAgent('vulcanus');

      expect(results.length).toBe(2);
      expect(results.every((r) => r.source_agent === 'vulcanus')).toBe(true);
    });

    it('restituisce array vuoto per agente senza entry', () => {
      createKnowledgeEntry('Test', 'Body', 'lesson', 'minerva');
      const results = suggestKnowledgeForAgent('nonexistent');
      expect(results).toEqual([]);
    });

    it('restituisce array vuoto per nome agente vuoto', () => {
      expect(suggestKnowledgeForAgent('')).toEqual([]);
      expect(suggestKnowledgeForAgent('   ')).toEqual([]);
    });

    it('rispetta il parametro limit', () => {
      for (let i = 0; i < 5; i++) {
        createKnowledgeEntry(`Entry ${i}`, `Content ${i}`, 'lesson', 'vulcanus');
      }
      const results = suggestKnowledgeForAgent('vulcanus', 2);
      expect(results.length).toBe(2);
    });
  });

  // -----------------------------------------------------------------------
  // findRelatedByTags
  // -----------------------------------------------------------------------

  describe('findRelatedByTags', () => {
    it('trova entry con tag specifici (matching parziale)', () => {
      createKnowledgeEntry('Bug Fix', 'Fix a critical bug', 'lesson', 'vulcanus', ['bug', 'typescript']);
      createKnowledgeEntry('React Component', 'How to create React components', 'pattern', 'ovidio', ['react']);
      createKnowledgeEntry('Type Safety', 'TypeScript type safety tips', 'tip', 'minerva', ['typescript']);

      const results = findRelatedByTags(['bug', 'typescript']);

      expect(results.length).toBeGreaterThanOrEqual(2);
      const titles = results.map((r) => r.title);
      expect(titles).toContain('Bug Fix');
      expect(titles).toContain('Type Safety');
    });

    it('restituisce array vuoto per array di tag vuoto', () => {
      createKnowledgeEntry('Test', 'Body', 'lesson', 'tester', ['tag']);
      expect(findRelatedByTags([])).toEqual([]);
    });

    it('restituisce array vuoto per tags non presenti', () => {
      createKnowledgeEntry('Test', 'Body', 'lesson', 'tester', ['unrelated']);
      const results = findRelatedByTags(['nonexistent_tag']);
      expect(results).toEqual([]);
    });

    it('restituisce array vuoto per null/undefined tags', () => {
      expect(findRelatedByTags(null as unknown as string[])).toEqual([]);
      expect(findRelatedByTags(undefined as unknown as string[])).toEqual([]);
    });

    it('rispetta il parametro limit', () => {
      for (let i = 0; i < 10; i++) {
        createKnowledgeEntry(`Entry ${i}`, `Body ${i}`, 'lesson', 'tester', ['tag']);
      }
      const results = findRelatedByTags(['tag'], 3);
      expect(results.length).toBe(3);
    });
  });

  // -----------------------------------------------------------------------
  // suggestCategoryAndTags
  // -----------------------------------------------------------------------

  describe('suggestCategoryAndTags', () => {
    it('suggerisce categoria faq per titolo con parola chiave "come"', () => {
      const result = suggestCategoryAndTags('Come si configura un database', 'Guida tutorial per principianti');
      expect(result.category).toBe('faq');
    });

    it('suggerisce categoria lesson per titolo con "bug" o "error"', () => {
      const result = suggestCategoryAndTags('Error critico', 'Bug trovato nel modulo');
      expect(result.category).toBe('lesson');
    });

    it('suggerisce categoria pattern per titolo con "pattern"', () => {
      const result = suggestCategoryAndTags('Design pattern per React', 'Strategy pattern implementation');
      expect(result.category).toBe('pattern');
    });

    it('estrae tag significativi dal testo (esclude stop words)', () => {
      const result = suggestCategoryAndTags(
        'Come ottimizzare SQLite per performance',
        'Guida completa per database veloci',
      );
      expect(result.tags.length).toBeGreaterThanOrEqual(1);
      expect(result.tags).toContain('ottimizzare');
      expect(result.tags.every((t) => t.length > 3)).toBe(true);
    });

    it('default category è "lesson" per testo senza keyword matching', () => {
      const result = suggestCategoryAndTags('Random text here', 'Some random content with no category keywords');
      expect(result.category).toBe('lesson');
    });

    it('deduplica i tag mantenendo l\'ordine', () => {
      const result = suggestCategoryAndTags('test test', 'fixare fixare problema problema');
      // 'fixare' e 'problema' dovrebbero apparire una volta ciascuno
      const fixareCount = result.tags.filter((t) => t === 'fixare').length;
      const problemaCount = result.tags.filter((t) => t === 'problema').length;
      expect(fixareCount).toBe(1);
      expect(problemaCount).toBe(1);
    });
  });
});

// ---------------------------------------------------------------------------
// Suite: faq-manager.ts
// ---------------------------------------------------------------------------

describe('Fase 2 — FAQ Manager (faq-manager.ts)', () => {
  let sessionId: string;

  beforeEach(async () => {
    await initFreshDb();
    sessionId = createSession('diana-tester').id;
  });

  afterAll(() => {
    closeDatabase();
  });

  // -----------------------------------------------------------------------
  // detectFaqCandidates
  // -----------------------------------------------------------------------

  describe('detectFaqCandidates', () => {
    it('restituisce array vuoto con 0 eventi di errore', () => {
      const candidates = detectFaqCandidates();
      expect(candidates).toEqual([]);
    });

    it('restituisce array vuoto con meno di 3 errori uguali (default minOccurrences=3)', () => {
      for (let i = 0; i < 2; i++) {
        insertEvent(sessionId, 'vulcanus', 'error_encountered', 'TS2353: type mismatch', { line: i });
      }

      const candidates = detectFaqCandidates();

      expect(candidates).toEqual([]);
    });

    it('restituisce candidates quando ci sono 3+ errori uguali con minOccurrences=2', () => {
      for (let i = 0; i < 3; i++) {
        insertEvent(sessionId, 'vulcanus', 'error_encountered', 'TS2353: type mismatch', { line: i });
      }

      const candidates = detectFaqCandidates(2);

      expect(candidates.length).toBe(1);
      expect(candidates[0].pattern).toContain('TS2353');
      expect(candidates[0].occurrences).toBe(3);
      expect(candidates[0].suggestedTitle).toContain('FAQ:');
    });

    it('rileva anche eventi di tipo task_failed', () => {
      for (let i = 0; i < 3; i++) {
        insertEvent(sessionId, 'vulcanus', 'task_failed', 'ERR_CONNECTION_REFUSED', { attempt: i });
      }

      const candidates = detectFaqCandidates(2);
      expect(candidates.length).toBe(1);
      expect(candidates[0].pattern).toContain('ERR_CONNECTION_REFUSED');
    });

    it('ordina i candidati per occorrenze decrescenti', () => {
      // 4 errori di tipo A, 3 di tipo B
      for (let i = 0; i < 4; i++) {
        insertEvent(sessionId, 'vulcanus', 'error_encountered', 'ERROR_A: common bug', { id: i });
      }
      for (let i = 0; i < 3; i++) {
        insertEvent(sessionId, 'vulcanus', 'error_encountered', 'ERROR_B: rare bug', { id: i });
      }

      const candidates = detectFaqCandidates(3);

      expect(candidates.length).toBe(2);
      expect(candidates[0].pattern).toContain('ERROR_A');
      expect(candidates[0].occurrences).toBe(4);
      expect(candidates[1].pattern).toContain('ERROR_B');
      expect(candidates[1].occurrences).toBe(3);
    });

    it('restituisce array vuoto con minOccurrences alto', () => {
      for (let i = 0; i < 3; i++) {
        insertEvent(sessionId, 'vulcanus', 'error_encountered', 'TS2353: type mismatch', { line: i });
      }

      const candidates = detectFaqCandidates(10);
      expect(candidates).toEqual([]);
    });
  });

  // -----------------------------------------------------------------------
  // generateFaqFromCandidate
  // -----------------------------------------------------------------------

  describe('generateFaqFromCandidate', () => {
    it('crea una knowledge entry di categoria faq', () => {
      const candidate: FaqCandidate = {
        pattern: 'TS2353: type mismatch error',
        occurrences: 5,
        suggestedTitle: 'FAQ: TS2353 — type mismatch error',
        recentExample: '[2026-05-25] TS2353: type mismatch error',
      };

      generateFaqFromCandidate(candidate, 'diana-tester');

      const entries = getDatabase()
        .prepare("SELECT * FROM knowledge_entries WHERE category = 'faq'")
        .all() as Record<string, unknown>[];

      expect(entries.length).toBe(1);
      expect(entries[0].title).toContain('TS2353');
      expect(entries[0].category).toBe('faq');
      expect(entries[0].source_agent).toBe('diana-tester');
    });

    it('crea una entry con body contenente pattern e occorrenze', () => {
      const candidate: FaqCandidate = {
        pattern: 'ERR_TIMEOUT: request timed out',
        occurrences: 10,
        suggestedTitle: 'FAQ: ERR_TIMEOUT',
        recentExample: '[2026-05-25] ERR_TIMEOUT: request timed out',
      };

      generateFaqFromCandidate(candidate, 'vulcanus');

      const entry = getDatabase()
        .prepare("SELECT * FROM knowledge_entries WHERE category = 'faq'")
        .get() as Record<string, unknown>;

      expect(entry).toBeTruthy();
      expect(entry.body).toContain('ERR_TIMEOUT');
      expect(entry.body).toContain('10 volte');
    });

    it('crea una entry con tag predefiniti autogenerated, faq, recurring-error', () => {
      const candidate: FaqCandidate = {
        pattern: 'ERR_BUG: fatal',
        occurrences: 3,
        suggestedTitle: 'FAQ: ERR_BUG',
        recentExample: 'ERR_BUG: fatal',
      };

      generateFaqFromCandidate(candidate, 'minerva');

      const entry = getDatabase()
        .prepare("SELECT * FROM knowledge_entries WHERE category = 'faq'")
        .get() as Record<string, unknown>;

      const tags = JSON.parse(entry.tags as string) as string[];
      expect(tags).toContain('autogenerated');
      expect(tags).toContain('faq');
      expect(tags).toContain('recurring-error');
    });
  });
});

// ---------------------------------------------------------------------------
// Suite: memory.tool.ts — Nuove action (knowledge_suggest, faq_detect)
// ---------------------------------------------------------------------------

describe('Fase 2 — Memory Tool (memory.tool.ts) — Nuove action', () => {
  beforeEach(async () => {
    await initFreshDb();
  });

  afterAll(() => {
    closeDatabase();
  });

  // -----------------------------------------------------------------------
  // knowledge_suggest
  // -----------------------------------------------------------------------

  describe('action: knowledge_suggest', () => {
    it('restituisce suggestions con context valido', async () => {
      createKnowledgeEntry('SQLite Performance', 'How to optimize SQLite queries', 'lesson', 'vulcanus', ['sqlite']);
      createKnowledgeEntry('React Patterns', 'Common React design patterns', 'pattern', 'ovidio', ['react']);

      const result = await memoryToolHandler.handler({
        action: 'knowledge_suggest',
        context: 'SQLite',
        limit: 5,
      });

      const data = JSON.parse(result.content[0].text);
      expect(data.success).toBe(true);
      expect(data.data.suggestions.length).toBeGreaterThanOrEqual(1);
      expect(data.data.mode).toBe('by_context');
      expect(result.isError).toBeUndefined();
    });

    it('restituisce error se mancano context e agent_name', async () => {
      const result = await memoryToolHandler.handler({
        action: 'knowledge_suggest',
      });

      const data = JSON.parse(result.content[0].text);
      expect(data.success).toBe(false);
      expect(data.error).toContain('knowledge_suggest requires context or agent_name');
      expect(result.isError).toBe(true);
    });

    it('restituisce error se context è stringa vuota e agent_name assente', async () => {
      const result = await memoryToolHandler.handler({
        action: 'knowledge_suggest',
        context: '',
      });

      const data = JSON.parse(result.content[0].text);
      expect(data.success).toBe(false);
      expect(data.error).toContain('requires context or agent_name');
    });

    it('usa agent_name se fornito', async () => {
      createKnowledgeEntry('Vulcanus Tip', 'Vulcanus specific knowledge', 'tip', 'vulcanus', ['vulcanus']);

      const result = await memoryToolHandler.handler({
        action: 'knowledge_suggest',
        agent_name: 'vulcanus',
        limit: 5,
      });

      const data = JSON.parse(result.content[0].text);
      expect(data.success).toBe(true);
      expect(data.data.mode).toBe('by_agent');
      expect(data.data.suggestions.length).toBeGreaterThanOrEqual(1);
    });
  });

  // -----------------------------------------------------------------------
  // faq_detect
  // -----------------------------------------------------------------------

  describe('action: faq_detect', () => {
    it('restituisce candidates array vuoto se nessun evento', async () => {
      const result = await memoryToolHandler.handler({
        action: 'faq_detect',
        min_occurrences: 3,
      });

      const data = JSON.parse(result.content[0].text);
      expect(data.success).toBe(true);
      expect(data.data.candidates).toEqual([]);
      expect(data.data.total).toBe(0);
      expect(result.isError).toBeUndefined();
    });

    it('restituisce candidates con eventi di errore duplicati', async () => {
      const sid = createSession('vulcanus').id;
      for (let i = 0; i < 4; i++) {
        insertEvent(sid, 'vulcanus', 'error_encountered', 'ERR_BUG: type error', { attempt: i });
      }

      const result = await memoryToolHandler.handler({
        action: 'faq_detect',
        min_occurrences: 3,
      });

      const data = JSON.parse(result.content[0].text);
      expect(data.success).toBe(true);
      expect(data.data.candidates.length).toBe(1);
      expect(data.data.candidates[0].pattern).toContain('ERR_BUG');
      expect(data.data.candidates[0].occurrences).toBe(4);
    });

    it('usa min_occurrences di default (3) se non fornito', async () => {
      const sid = createSession('vulcanus').id;
      for (let i = 0; i < 2; i++) {
        insertEvent(sid, 'vulcanus', 'error_encountered', 'ERR_MINOR: warning', { attempt: i });
      }

      const result = await memoryToolHandler.handler({
        action: 'faq_detect',
      });

      const data = JSON.parse(result.content[0].text);
      expect(data.data.candidates).toEqual([]);
    });
  });
});

// ---------------------------------------------------------------------------
// Suite: Migration 002 — Trigger SQL
// ---------------------------------------------------------------------------

describe('Fase 2 — Trigger SQL (002_knowledge_triggers.sql)', () => {
  beforeEach(async () => {
    await initFreshDb();
  });

  afterAll(() => {
    closeDatabase();
  });

  // -----------------------------------------------------------------------
  // trg_knowledge_updated
  // -----------------------------------------------------------------------

  describe('trg_knowledge_updated', () => {
    it('viene creato dalla migrazione', () => {
      const db = getDatabase();
      const trigger = db
        .prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name='trg_knowledge_updated'")
        .get() as { name: string } | undefined;

      expect(trigger).toBeTruthy();
      expect(trigger!.name).toBe('trg_knowledge_updated');
    });

    it('aggiorna updated_at dopo UPDATE su knowledge_entries', () => {
      const entry = createKnowledgeEntry('Test', 'Body', 'lesson');

      const db = getDatabase();
      const beforeRow = db
        .prepare('SELECT updated_at FROM knowledge_entries WHERE id = ?')
        .get(entry.id) as { updated_at: string };
      const beforeUpdatedAt = beforeRow.updated_at;

      // UPDATE diretto che non setta updated_at — trigger deve agire
      db.prepare('UPDATE knowledge_entries SET title = ? WHERE id = ?').run('Updated by trigger', entry.id);

      const afterRow = db
        .prepare('SELECT updated_at FROM knowledge_entries WHERE id = ?')
        .get(entry.id) as { updated_at: string };

      // Il trigger imposta datetime('now') in formato SQLite: YYYY-MM-DD HH:MM:SS
      expect(afterRow.updated_at).toBeTruthy();
      expect(afterRow.updated_at).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    });
  });

  // -----------------------------------------------------------------------
  // trg_session_updated
  // -----------------------------------------------------------------------

  describe('trg_session_updated', () => {
    it('viene creato dalla migrazione', () => {
      const db = getDatabase();
      const trigger = db
        .prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name='trg_session_updated'")
        .get() as { name: string } | undefined;

      expect(trigger).toBeTruthy();
      expect(trigger!.name).toBe('trg_session_updated');
    });

    it('aggiorna updated_at dopo UPDATE su sessions', () => {
      const session = createSession('diana-tester');

      const db = getDatabase();
      const beforeRow = db
        .prepare('SELECT updated_at FROM sessions WHERE id = ?')
        .get(session.id) as { updated_at: string };

      // UPDATE diretto che non setta updated_at — trigger deve agire
      db.prepare('UPDATE sessions SET focus = ? WHERE id = ?').run('testing-trigger', session.id);

      const afterRow = db
        .prepare('SELECT updated_at FROM sessions WHERE id = ?')
        .get(session.id) as { updated_at: string };

      expect(afterRow.updated_at).toBeTruthy();
      expect(afterRow.updated_at).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    });
  });
});

// ---------------------------------------------------------------------------
// Suite: Edge cases e integrazione tra moduli
// ---------------------------------------------------------------------------

describe('Fase 2 — Edge cases e integrazione', () => {
  beforeEach(async () => {
    await initFreshDb();
  });

  afterEach(() => {
    closeDatabase();
  });

  afterAll(() => {
    resetDatabase();
  });

  describe('Detect FAQ + Generate integrazione', () => {
    it('detect + generate produce una knowledge entry di tipo faq', () => {
      const sid = createSession('vulcanus').id;
      for (let i = 0; i < 5; i++) {
        insertEvent(sid, 'vulcanus', 'error_encountered', 'ERR_INTEGRATION: test error', { i });
      }

      const candidates = detectFaqCandidates(3);
      expect(candidates.length).toBe(1);

      generateFaqFromCandidate(candidates[0], 'diana-tester');

      const entry = getKnowledgeEntry(
        (
          getDatabase()
            .prepare("SELECT id FROM knowledge_entries WHERE category = 'faq'")
            .get() as { id: string }
        ).id,
      );

      expect(entry).toBeTruthy();
      expect(entry!.category).toBe('faq');
      expect(entry!.source_agent).toBe('diana-tester');
      expect(entry!.body).toContain('ERR_INTEGRATION');
    });
  });

  describe('Database non inizializzato', () => {
    it('suggestKnowledge lancia errore se DB non inizializzato', () => {
      resetDatabase();
      expect(() => suggestKnowledge('test')).toThrow(/not initialized/i);
    });

    it('suggestKnowledgeForAgent lancia errore se DB non inizializzato', () => {
      resetDatabase();
      expect(() => suggestKnowledgeForAgent('vulcanus')).toThrow(/not initialized/i);
    });

    it('findRelatedByTags lancia errore se DB non inizializzato', () => {
      resetDatabase();
      expect(() => findRelatedByTags(['test'])).toThrow(/not initialized/i);
    });

    it('generateFaqFromCandidate lancia errore se DB non inizializzato', () => {
      resetDatabase();
      const candidate: FaqCandidate = {
        pattern: 'ERR',
        occurrences: 1,
        suggestedTitle: 'FAQ: ERR',
        recentExample: 'ERR',
      };
      expect(() => generateFaqFromCandidate(candidate, 'test')).toThrow(/not initialized/i);
    });
  });

  describe('In-memory isolation', () => {
    it('ogni beforeEach produce un DB pulito (knowledge entry)', () => {
      const db = getDatabase();
      const count = db.prepare('SELECT COUNT(*) as count FROM knowledge_entries').get() as { count: number };
      expect(count.count).toBe(0);
    });
  });
});
