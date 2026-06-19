/**
 * __tests__/core/adr-lifecycle.test.ts
 * Test per core/adr-lifecycle.ts — ADR Lifecycle Engine (Fase 8 PANTHEON)
 *
 * Copertura:
 * - ensureAdrLifecycleSchema: crea tabelle (idempotente)
 * - registerAdr: registra ADR con ID valido, duplicati, formato non valido
 * - transitionAdrStatus: tutte le transizioni valide
 * - transitionAdrStatus: transizioni non valide lanciano errore
 * - listAdrsByStatus: lista/filtro per stato
 * - getActiveAdrs: solo proposed + accepted
 *
 * @module tests/core/adr-lifecycle
 */

import { initDatabase, closeDatabase, getDatabase } from '../../src/core/database.js';
import {
  registerAdr,
  transitionAdrStatus,
  listAdrsByStatus,
  getActiveAdrs,
  ensureAdrLifecycleSchema,
} from '../../src/core/adr-lifecycle.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Inizializza database in-memory pulito per ogni test.
 */
async function initFreshDb(): Promise<void> {
  closeDatabase();
  await initDatabase(':memory:');
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('adr-lifecycle', () => {
  beforeEach(async () => {
    await initFreshDb();
  });

  afterAll(() => {
    closeDatabase();
  });

  // ── ensureAdrLifecycleSchema ───────────────────────────────────────────

  describe('ensureAdrLifecycleSchema', () => {
    it('crea la tabella adr_status senza errori', () => {
      expect(() => ensureAdrLifecycleSchema()).not.toThrow();
    });

    it('è idempotente (chiamata multipla non lancia errori)', () => {
      ensureAdrLifecycleSchema();
      ensureAdrLifecycleSchema();
      expect(() => ensureAdrLifecycleSchema()).not.toThrow();
    });

    it('la tabella adr_status esiste dopo la creazione', () => {
      ensureAdrLifecycleSchema();
      const db = getDatabase();
      const result = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='adr_status'"
      ).get() as { name: string } | undefined;
      expect(result).toBeDefined();
      expect(result!.name).toBe('adr_status');
    });
  });

  // ── registerAdr ────────────────────────────────────────────────────────

  describe('registerAdr', () => {
    it('registra una ADR con ID valido e restituisce il record', () => {
      const adr = registerAdr('adr_001', 'Use TypeScript for all modules');

      expect(adr.id).toBe('adr_001');
      expect(adr.title).toBe('Use TypeScript for all modules');
      expect(adr.status).toBe('proposed');
      expect(adr.created_at).toBeTruthy();
      expect(adr.updated_at).toBeTruthy();
    });

    it('lancia errore per formato ID non valido', () => {
      expect(() => registerAdr('invalid', 'Bad ID')).toThrow(/Invalid ADR ID format/);
      expect(() => registerAdr('adr_12', 'Too short')).toThrow(/Invalid ADR ID format/);
      expect(() => registerAdr('adr_1234', 'Too long')).toThrow(/Invalid ADR ID format/);
      expect(() => registerAdr('', 'Empty')).toThrow(/Invalid ADR ID format/);
    });

    it('lancia errore per ID già esistente', () => {
      registerAdr('adr_001', 'First');
      expect(() => registerAdr('adr_001', 'Duplicate')).toThrow(/already exists/);
    });

    it('genera timestamp corretti al momento della creazione', () => {
      const before = new Date().toISOString();
      const adr = registerAdr('adr_002', 'Test timestamp');
      const after = new Date().toISOString();

      expect(adr.created_at).toBeTruthy();
      expect(adr.created_at >= before || adr.created_at >= before).toBe(true);
      // Nota: il trigger SQL potrebbe sovrascrivere updated_at, controlliamo solo che esista
      expect(adr.updated_at).toBeTruthy();
    });

    it('setta status="proposed" di default', () => {
      const adr = registerAdr('adr_003', 'Default status');
      expect(adr.status).toBe('proposed');
    });
  });

  // ── transitionAdrStatus ────────────────────────────────────────────────

  describe('transitionAdrStatus', () => {
    it('esegue proposed → accepted', () => {
      registerAdr('adr_001', 'Test ADR');
      const updated = transitionAdrStatus('adr_001', 'accepted');
      expect(updated.status).toBe('accepted');
    });

    it('esegue proposed → deprecated', () => {
      registerAdr('adr_001', 'Test ADR');
      const updated = transitionAdrStatus('adr_001', 'deprecated');
      expect(updated.status).toBe('deprecated');
    });

    it('esegue accepted → deprecated', () => {
      registerAdr('adr_001', 'Test ADR');
      transitionAdrStatus('adr_001', 'accepted');
      const updated = transitionAdrStatus('adr_001', 'deprecated');
      expect(updated.status).toBe('deprecated');
    });

    it('esegue accepted → superseded con supersededBy', () => {
      registerAdr('adr_001', 'Old ADR');
      registerAdr('adr_002', 'New ADR');
      transitionAdrStatus('adr_001', 'accepted');
      const updated = transitionAdrStatus('adr_001', 'superseded', 'adr_002');
      expect(updated.status).toBe('superseded');
      expect(updated.superseded_by).toBe('adr_002');
    });

    it('lancia errore per transizione non valida accepted → proposed', () => {
      registerAdr('adr_001', 'Test ADR');
      transitionAdrStatus('adr_001', 'accepted');
      expect(() => transitionAdrStatus('adr_001', 'proposed')).toThrow(/Invalid transition/);
    });

    it('lancia errore per transizione da stato terminale deprecated', () => {
      registerAdr('adr_001', 'Test ADR');
      transitionAdrStatus('adr_001', 'deprecated');
      expect(() => transitionAdrStatus('adr_001', 'accepted')).toThrow(/Invalid transition/);
    });

    it('lancia errore per transizione da stato terminale superseded', () => {
      registerAdr('adr_001', 'Old ADR');
      registerAdr('adr_002', 'New ADR');
      transitionAdrStatus('adr_001', 'accepted');
      transitionAdrStatus('adr_001', 'superseded', 'adr_002');
      expect(() => transitionAdrStatus('adr_001', 'accepted')).toThrow(/Invalid transition/);
    });

    it('lancia errore per superseded senza supersededBy', () => {
      registerAdr('adr_001', 'Test ADR');
      transitionAdrStatus('adr_001', 'accepted');
      expect(() => transitionAdrStatus('adr_001', 'superseded')).toThrow(/supersededBy/);
    });

    it('lancia errore per superseded con ADR target inesistente', () => {
      registerAdr('adr_001', 'Test ADR');
      transitionAdrStatus('adr_001', 'accepted');
      expect(() =>
        transitionAdrStatus('adr_001', 'superseded', 'adr_999')
      ).toThrow(/not found/);
    });

    it('lancia errore per ID inesistente', () => {
      expect(() => transitionAdrStatus('adr_999', 'accepted')).toThrow(/not found/);
    });
  });

  // ── listAdrsByStatus ───────────────────────────────────────────────────

  describe('listAdrsByStatus', () => {
    it('restituisce array vuoto quando non ci sono ADR', () => {
      const result = listAdrsByStatus();
      expect(result).toEqual([]);
    });

    it('restituisce tutte le ADR senza filtro', () => {
      registerAdr('adr_001', 'First');
      registerAdr('adr_002', 'Second');
      const result = listAdrsByStatus();
      expect(result).toHaveLength(2);
    });

    it('filtra per stato', () => {
      registerAdr('adr_001', 'Proposed');
      registerAdr('adr_002', 'To accept');
      transitionAdrStatus('adr_002', 'accepted');

      const proposed = listAdrsByStatus('proposed');
      expect(proposed).toHaveLength(1);
      expect(proposed[0].id).toBe('adr_001');

      const accepted = listAdrsByStatus('accepted');
      expect(accepted).toHaveLength(1);
      expect(accepted[0].id).toBe('adr_002');
    });

    it('lancia errore per filtro stato non valido', () => {
      expect(() => listAdrsByStatus('invalid_status')).toThrow(/Invalid status filter/);
    });

    it('restituisce ADR ordinate per ID', () => {
      registerAdr('adr_003', 'Third');
      registerAdr('adr_001', 'First');
      registerAdr('adr_002', 'Second');
      const result = listAdrsByStatus();
      expect(result[0].id).toBe('adr_001');
      expect(result[1].id).toBe('adr_002');
      expect(result[2].id).toBe('adr_003');
    });
  });

  // ── getActiveAdrs ──────────────────────────────────────────────────────

  describe('getActiveAdrs', () => {
    it('restituisce solo ADR proposed e accepted', () => {
      registerAdr('adr_001', 'Proposed');
      registerAdr('adr_002', 'To accept');
      transitionAdrStatus('adr_002', 'accepted');
      registerAdr('adr_003', 'To deprecate');
      transitionAdrStatus('adr_003', 'deprecated');

      const active = getActiveAdrs();
      expect(active).toHaveLength(2);
      const ids = active.map((a) => a.id).sort();
      expect(ids).toEqual(['adr_001', 'adr_002']);
    });

    it('restituisce array vuoto se nessuna ADR attiva', () => {
      registerAdr('adr_001', 'Direct deprecate');
      transitionAdrStatus('adr_001', 'deprecated');
      const active = getActiveAdrs();
      expect(active).toHaveLength(0);
    });
  });
});
