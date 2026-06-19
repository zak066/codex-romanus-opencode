/**
 * Test per core/file-journal.ts — File Change Journal (Fase 7 FABRICA)
 *
 * Copertura:
 * - logChange: crea con tutti i campi, change_type non valida, ID univoci
 * - queryChanges: nessuna modifica, filtri per file_path/agent/change_type, paginazione
 * - getChangesByFile: cronologia per file specifico
 * - getRecentChanges: ultime N modifiche
 * - Cache: test invalidazione dopo insert
 *
 * Usa database in-memory isolato per ogni test (stesso pattern di alert-manager).
 *
 * @module tests/core/file-journal
 */

import { initDatabase, closeDatabase } from '../../src/core/database.js';
import {
  logChange,
  queryChanges,
  getChangesByFile,
  getRecentChanges,
  getChangeById,
  resetJournalCache,
} from '../../src/core/file-journal.js';

import type { LogChangeParams } from '../../src/core/file-journal.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Inizializza un database in-memory pulito per ogni test.
 * initDatabase(':memory:') esegue TUTTE le migrazioni inclusa 007_create_file_changes.
 */
async function initFreshDb(): Promise<void> {
  closeDatabase();
  resetJournalCache();
  await initDatabase(':memory:');
}

/** Parametri base per registrare modifiche nei test */
function sampleChange(overrides?: Partial<LogChangeParams>): LogChangeParams {
  return {
    file_path: 'src/core/file-journal.ts',
    agent: 'vulcanus-senior-dev',
    change_type: 'created',
    summary: 'Creato modulo File Change Journal',
    session_id: 'sess_test_001',
    task_id: 'task_fabrica_7',
    diff: '+ export function logChange() {...}',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Suite: file-journal
// ---------------------------------------------------------------------------

describe('file-journal', () => {
  beforeEach(async () => {
    await initFreshDb();
  });

  afterAll(() => {
    closeDatabase();
  });

  // ── logChange ─────────────────────────────────────────────────────────

  describe('logChange', () => {
    it('registra una modifica con tutti i campi e restituisce FileChangeRecord', () => {
      const record = logChange(sampleChange());

      expect(record.id).toMatch(/^fc_/);
      expect(record.file_path).toBe('src/core/file-journal.ts');
      expect(record.agent).toBe('vulcanus-senior-dev');
      expect(record.change_type).toBe('created');
      expect(record.summary).toBe('Creato modulo File Change Journal');
      expect(record.session_id).toBe('sess_test_001');
      expect(record.task_id).toBe('task_fabrica_7');
      expect(record.diff).toBe('+ export function logChange() {...}');
      expect(record.created_at).toBeTruthy();
    });

    it('accetta campi opzionali non forniti', () => {
      const record = logChange({
        file_path: 'src/test.ts',
        agent: 'diana-tester',
        change_type: 'modified',
        summary: 'Modified test file',
      });

      expect(record.session_id).toBeUndefined();
      expect(record.task_id).toBeUndefined();
      expect(record.diff).toBeUndefined();
      expect(record.created_at).toBeTruthy();
    });

    it('lancia errore per change_type non valida', () => {
      expect(() =>
        logChange(sampleChange({ change_type: 'invalid_type' }))
      ).toThrow(/Invalid change_type/);
    });

    it('genera ID univoci per inserimenti successivi', () => {
      const r1 = logChange(sampleChange({ summary: 'First change' }));
      const r2 = logChange(sampleChange({ summary: 'Second change' }));
      expect(r1.id).not.toBe(r2.id);
    });

    it('accetta change_type in uppercase e la converte in lowercase', () => {
      const record = logChange(sampleChange({ change_type: 'MODIFIED' }));
      expect(record.change_type).toBe('modified');
    });
  });

  // ── queryChanges ──────────────────────────────────────────────────────

  describe('queryChanges', () => {
    it('restituisce array vuoto quando non ci sono modifiche', () => {
      const result = queryChanges();
      expect(result.total).toBe(0);
      expect(result.changes).toEqual([]);
    });

    it('restituisce tutte le modifiche senza filtri', () => {
      logChange(sampleChange({ summary: 'Change 1' }));
      logChange(sampleChange({ summary: 'Change 2', agent: 'diana' }));
      logChange(sampleChange({ summary: 'Change 3', file_path: 'src/other.ts' }));

      const result = queryChanges();
      expect(result.total).toBe(3);
      expect(result.changes).toHaveLength(3);
    });

    it('filtra per file_path', () => {
      logChange(sampleChange({ file_path: 'src/auth.ts', summary: 'Auth change' }));
      logChange(sampleChange({ file_path: 'src/db.ts', summary: 'DB change' }));

      const result = queryChanges({ file_path: 'src/auth.ts' });
      expect(result.total).toBe(1);
      expect(result.changes[0].summary).toBe('Auth change');
    });

    it('filtra per agent', () => {
      logChange(sampleChange({ agent: 'vulcanus', summary: 'Vulcanus change' }));
      logChange(sampleChange({ agent: 'diana', summary: 'Diana change' }));

      const result = queryChanges({ agent: 'diana' });
      expect(result.total).toBe(1);
      expect(result.changes[0].agent).toBe('diana');
    });

    it('filtra per change_type', () => {
      logChange(sampleChange({ change_type: 'created', summary: 'Created file' }));
      logChange(sampleChange({ change_type: 'modified', summary: 'Modified file' }));
      logChange(sampleChange({ change_type: 'deleted', summary: 'Deleted file' }));

      const result = queryChanges({ change_type: 'deleted' });
      expect(result.total).toBe(1);
      expect(result.changes[0].change_type).toBe('deleted');
    });

    it('combina filtri multipli', () => {
      logChange(sampleChange({
        file_path: 'src/target.ts',
        agent: 'vulcanus',
        change_type: 'modified',
        summary: 'Target change',
      }));
      logChange(sampleChange({
        file_path: 'src/target.ts',
        agent: 'diana',
        change_type: 'modified',
        summary: 'Other change',
      }));

      const result = queryChanges({
        file_path: 'src/target.ts',
        agent: 'vulcanus',
      });
      expect(result.total).toBe(1);
      expect(result.changes[0].summary).toBe('Target change');
    });

    it('rispetta il parametro limit', () => {
      for (let i = 0; i < 10; i++) {
        logChange(sampleChange({ summary: `Change ${i}` }));
      }

      const result = queryChanges({ limit: 3 });
      expect(result.changes).toHaveLength(3);
      expect(result.total).toBe(10);
    });

    it('usa limit=50 e offset=0 di default', () => {
      for (let i = 0; i < 60; i++) {
        logChange(sampleChange({ summary: `Change ${i}` }));
      }

      const result = queryChanges();
      expect(result.changes).toHaveLength(50);
      expect(result.total).toBe(60);
    });
  });

  // ── getChangesByFile ──────────────────────────────────────────────────

  describe('getChangesByFile', () => {
    it('restituisce cronologia per file specifico', () => {
      logChange(sampleChange({ file_path: 'src/target.ts', summary: 'First' }));
      logChange(sampleChange({ file_path: 'src/other.ts', summary: 'Other' }));
      logChange(sampleChange({ file_path: 'src/target.ts', summary: 'Second' }));

      const changes = getChangesByFile('src/target.ts');
      expect(changes).toHaveLength(2);
      expect(changes.map((c) => c.summary)).toContain('First');
      expect(changes.map((c) => c.summary)).toContain('Second');
    });

    it('restituisce array vuoto per file senza modifiche', () => {
      const changes = getChangesByFile('src/nonexistent.ts');
      expect(changes).toEqual([]);
    });

    it('rispetta il parametro limit', () => {
      for (let i = 0; i < 10; i++) {
        logChange(sampleChange({ file_path: 'src/target.ts', summary: `Change ${i}` }));
      }

      const changes = getChangesByFile('src/target.ts', 3);
      expect(changes).toHaveLength(3);
    });
  });

  // ── getRecentChanges ──────────────────────────────────────────────────

  describe('getRecentChanges', () => {
    it('restituisce le ultime N modifiche', () => {
      for (let i = 0; i < 10; i++) {
        logChange(sampleChange({ summary: `Change ${i}` }));
      }

      const recent = getRecentChanges(3);
      expect(recent).toHaveLength(3);
    });

    it('restituisce fino a 50 modifiche per default', () => {
      for (let i = 0; i < 60; i++) {
        logChange(sampleChange({ summary: `Change ${i}` }));
      }

      const recent = getRecentChanges();
      // getRecentChanges chiama queryChanges con limit=undefined, che defaulta a 50
      expect(recent).toHaveLength(50);
    });
  });

  // ── getChangeById ─────────────────────────────────────────────────────

  describe('getChangeById', () => {
    it('recupera una modifica esistente per ID', () => {
      const created = logChange(sampleChange());
      const found = getChangeById(created.id);
      expect(found.id).toBe(created.id);
      expect(found.summary).toBe(created.summary);
    });

    it('lancia errore per ID inesistente', () => {
      expect(() => getChangeById('fc_nonexistent')).toThrow(/Journal entry not found/);
    });
  });

  // ── Cache invalidation ────────────────────────────────────────────────

  describe('Cache invalidation', () => {
    it('dopo un insert, la query successiva restituisce i dati corretti', () => {
      logChange(sampleChange({ summary: 'Change 1' }));
      const result1 = queryChanges();
      expect(result1.total).toBe(1);

      logChange(sampleChange({ summary: 'Change 2' }));

      const result2 = queryChanges();
      expect(result2.total).toBe(2);
      expect(result2.changes).toHaveLength(2);
    });
  });
});
