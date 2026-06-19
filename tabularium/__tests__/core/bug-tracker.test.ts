/**
 * Test per core/bug-tracker.ts — Bug Tracking strutturato (Fase 7 FABRICA)
 *
 * Copertura:
 * - reportBug: crea bug con tutti i campi, severity non valida, ID univoci
 * - listBugs: nessun bug, filtri per status/severity/component/assigned_to, paginazione
 * - updateBugStatus: transizioni valide e non valide, reopen
 * - getBugTrend: trend giornaliero con chiusi e aperti
 * - Cache: test invalidazione dopo insert
 *
 * Usa database in-memory isolato per ogni test (stesso pattern di alert-manager).
 *
 * @module tests/core/bug-tracker
 */

import { initDatabase, closeDatabase } from '../../src/core/database.js';
import {
  reportBug,
  listBugs,
  updateBugStatus,
  getBugTrend,
  getBugById,
  resetBugCache,
} from '../../src/core/bug-tracker.js';

import type { CreateBugParams } from '../../src/core/bug-tracker.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Inizializza un database in-memory pulito per ogni test.
 * initDatabase(':memory:') esegue TUTTE le migrazioni inclusa 006_create_bugs.
 * Resetta anche la cache dei bug.
 */
async function initFreshDb(): Promise<void> {
  closeDatabase();
  resetBugCache();
  await initDatabase(':memory:');
}

/** Parametri base per creare bug nei test */
function sampleBug(overrides?: Partial<CreateBugParams>): CreateBugParams {
  return {
    title: 'Null pointer in login flow',
    description: 'When user submits empty form, the app crashes with null pointer',
    component: 'auth',
    severity: 'major',
    root_cause_category: 'logic',
    affected_files: ['src/auth/login.ts', 'src/auth/validation.ts'],
    reported_by: 'vulcanus-senior-dev',
    assigned_to: 'mercurius-junior-dev',
    tags: { priority: 'high', sprint: '7' },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Suite: bug-tracker
// ---------------------------------------------------------------------------

describe('bug-tracker', () => {
  beforeEach(async () => {
    await initFreshDb();
  });

  afterAll(() => {
    closeDatabase();
  });

  // ── reportBug ─────────────────────────────────────────────────────────

  describe('reportBug', () => {
    it('crea un bug con tutti i campi e restituisce BugRecord completo', () => {
      const bug = reportBug(sampleBug());

      expect(bug.id).toMatch(/^bug_/);
      expect(bug.title).toBe('Null pointer in login flow');
      expect(bug.description).toBe('When user submits empty form, the app crashes with null pointer');
      expect(bug.component).toBe('auth');
      expect(bug.severity).toBe('major');
      expect(bug.status).toBe('open');
      expect(bug.root_cause_category).toBe('logic');
      expect(bug.affected_files).toEqual(['src/auth/login.ts', 'src/auth/validation.ts']);
      expect(bug.reported_by).toBe('vulcanus-senior-dev');
      expect(bug.assigned_to).toBe('mercurius-junior-dev');
      expect(bug.tags).toEqual({ priority: 'high', sprint: '7' });
      expect(bug.created_at).toBeTruthy();
      expect(bug.updated_at).toBeTruthy();
    });

    it('accetta campi opzionali non forniti', () => {
      const bug = reportBug({
        title: 'Minor UI glitch',
        description: 'Button alignment is off by 1px',
        component: 'frontend',
        severity: 'cosmetic',
        reported_by: 'ovidio-frontend',
      });

      expect(bug.root_cause_category).toBeUndefined();
      expect(bug.affected_files).toBeUndefined();
      expect(bug.assigned_to).toBeUndefined();
      expect(bug.tags).toBeUndefined();
      expect(bug.fix_ref).toBeUndefined();
      expect(bug.closed_at).toBeUndefined();
      expect(bug.status).toBe('open');
    });

    it('lancia errore per severity non valida', () => {
      expect(() =>
        reportBug(sampleBug({ severity: 'super-critical' }))
      ).toThrow(/Invalid severity/);
    });

    it('genera ID univoci per inserimenti successivi', () => {
      const b1 = reportBug(sampleBug({ title: 'Bug 1' }));
      const b2 = reportBug(sampleBug({ title: 'Bug 2' }));
      expect(b1.id).not.toBe(b2.id);
    });

    it('setta status="open" di default', () => {
      const bug = reportBug(sampleBug());
      expect(bug.status).toBe('open');
    });
  });

  // ── listBugs ──────────────────────────────────────────────────────────

  describe('listBugs', () => {
    it('restituisce array vuoto quando non ci sono bug', () => {
      const result = listBugs();
      expect(result.total).toBe(0);
      expect(result.bugs).toEqual([]);
    });

    it('restituisce tutti i bug senza filtri', () => {
      reportBug(sampleBug({ title: 'Bug 1' }));
      reportBug(sampleBug({ title: 'Bug 2', component: 'database' }));
      reportBug(sampleBug({ title: 'Bug 3', severity: 'critical' }));

      const result = listBugs();
      expect(result.total).toBe(3);
      expect(result.bugs).toHaveLength(3);
    });

    it('filtra per status', () => {
      const b1 = reportBug(sampleBug({ title: 'Open bug' }));
      const b2 = reportBug(sampleBug({ title: 'Closed bug' }));
      updateBugStatus(b2.id, 'closed', 'diana');

      const openResult = listBugs({ status: 'open' });
      expect(openResult.total).toBe(1);
      expect(openResult.bugs[0].title).toBe('Open bug');

      const closedResult = listBugs({ status: 'closed' });
      expect(closedResult.total).toBe(1);
      expect(closedResult.bugs[0].title).toBe('Closed bug');
    });

    it('filtra per severity', () => {
      reportBug(sampleBug({ severity: 'minor', title: 'Minor bug' }));
      reportBug(sampleBug({ severity: 'critical', title: 'Critical bug' }));
      reportBug(sampleBug({ severity: 'blocker', title: 'Blocker bug' }));

      const result = listBugs({ severity: 'critical' });
      expect(result.total).toBe(1);
      expect(result.bugs[0].title).toBe('Critical bug');
    });

    it('filtra per component', () => {
      reportBug(sampleBug({ component: 'auth', title: 'Auth bug' }));
      reportBug(sampleBug({ component: 'frontend', title: 'Frontend bug' }));

      const result = listBugs({ component: 'auth' });
      expect(result.total).toBe(1);
      expect(result.bugs[0].title).toBe('Auth bug');
    });

    it('filtra per assigned_to', () => {
      reportBug(sampleBug({ assigned_to: 'vulcanus', title: 'Vulcanus bug' }));
      reportBug(sampleBug({ assigned_to: 'mercurius', title: 'Mercurius bug' }));

      const result = listBugs({ assigned_to: 'vulcanus' });
      expect(result.total).toBe(1);
      expect(result.bugs[0].assigned_to).toBe('vulcanus');
    });

    it('combina filtri multipli', () => {
      reportBug(sampleBug({
        component: 'auth',
        severity: 'critical',
        title: 'Target bug',
      }));
      reportBug(sampleBug({
        component: 'auth',
        severity: 'minor',
        title: 'Other bug',
      }));

      const result = listBugs({ component: 'auth', severity: 'critical' });
      expect(result.total).toBe(1);
      expect(result.bugs[0].title).toBe('Target bug');
    });

    it('rispetta il parametro limit', () => {
      for (let i = 0; i < 10; i++) {
        reportBug(sampleBug({ title: `Bug ${i}` }));
      }

      const result = listBugs({ limit: 3 });
      expect(result.bugs).toHaveLength(3);
      expect(result.total).toBe(10);
    });

    it('rispetta il parametro offset', () => {
      for (let i = 0; i < 10; i++) {
        reportBug(sampleBug({ title: `Bug ${i}` }));
      }

      const page1 = listBugs({ limit: 3, offset: 0 });
      const page2 = listBugs({ limit: 3, offset: 3 });

      expect(page1.bugs).toHaveLength(3);
      expect(page2.bugs).toHaveLength(3);

      const page1Ids = page1.bugs.map((b) => b.id);
      const page2Ids = page2.bugs.map((b) => b.id);
      for (const id of page1Ids) {
        expect(page2Ids).not.toContain(id);
      }
    });

    it('usa limit=50 e offset=0 di default', () => {
      for (let i = 0; i < 60; i++) {
        reportBug(sampleBug({ title: `Bug ${i}` }));
      }

      const result = listBugs();
      expect(result.bugs).toHaveLength(50);
      expect(result.total).toBe(60);
    });
  });

  // ── updateBugStatus ───────────────────────────────────────────────────

  describe('updateBugStatus', () => {
    it('segue il ciclo completo open → in_progress → fixed → verified → closed', () => {
      const bug = reportBug(sampleBug());
      expect(bug.status).toBe('open');

      const s1 = updateBugStatus(bug.id, 'in_progress', 'vulcanus');
      expect(s1.status).toBe('in_progress');

      const s2 = updateBugStatus(bug.id, 'fixed', 'vulcanus');
      expect(s2.status).toBe('fixed');

      const s3 = updateBugStatus(bug.id, 'verified', 'diana');
      expect(s3.status).toBe('verified');

      const s4 = updateBugStatus(bug.id, 'closed', 'diana');
      expect(s4.status).toBe('closed');
    });

    it('permette reopen da closed a open', () => {
      const bug = reportBug(sampleBug());
      updateBugStatus(bug.id, 'closed', 'diana');

      const reopened = updateBugStatus(bug.id, 'open', 'vulcanus');
      expect(reopened.status).toBe('open');
    });

    it('permette transizione da fixed a open (ri-apertura)', () => {
      const bug = reportBug(sampleBug());
      updateBugStatus(bug.id, 'in_progress', 'vulcanus');
      updateBugStatus(bug.id, 'fixed', 'vulcanus');

      const reopened = updateBugStatus(bug.id, 'open', 'diana');
      expect(reopened.status).toBe('open');
    });

    it('permette transizione da verified a open', () => {
      const bug = reportBug(sampleBug());
      updateBugStatus(bug.id, 'in_progress', 'vulcanus');
      updateBugStatus(bug.id, 'fixed', 'vulcanus');
      updateBugStatus(bug.id, 'verified', 'diana');

      const reopened = updateBugStatus(bug.id, 'open', 'diana');
      expect(reopened.status).toBe('open');
    });

    it('permette transizione da open a closed', () => {
      const bug = reportBug(sampleBug());
      const closed = updateBugStatus(bug.id, 'closed', 'diana');
      expect(closed.status).toBe('closed');
    });

    it('lancia errore per transizione non valida (open → fixed)', () => {
      const bug = reportBug(sampleBug());
      expect(() => updateBugStatus(bug.id, 'fixed', 'vulcanus')).toThrow(
        /Invalid status transition/
      );
    });

    it('lancia errore per transizione non valida (in_progress → verified)', () => {
      const bug = reportBug(sampleBug());
      updateBugStatus(bug.id, 'in_progress', 'vulcanus');
      expect(() => updateBugStatus(bug.id, 'verified', 'diana')).toThrow(
        /Invalid status transition/
      );
    });

    it('lancia errore per status non valido', () => {
      const bug = reportBug(sampleBug());
      expect(() => updateBugStatus(bug.id, 'invalid_status')).toThrow(
        /Invalid status/
      );
    });

    it('lancia errore per ID bug inesistente', () => {
      expect(() => updateBugStatus('bug_nonexistent', 'closed')).toThrow(
        /Bug not found/
      );
    });

    it('aggiorna assigned_to quando by è fornito', () => {
      const bug = reportBug(sampleBug({ assigned_to: 'mercurius' }));
      const updated = updateBugStatus(bug.id, 'in_progress', 'vulcanus');
      expect(updated.assigned_to).toBe('vulcanus');
    });

    it('mantiene assigned_to invariato quando by non è fornito', () => {
      const bug = reportBug(sampleBug({ assigned_to: 'mercurius' }));
      const updated = updateBugStatus(bug.id, 'in_progress');
      expect(updated.assigned_to).toBe('mercurius');
    });

    it('permette update allo stesso stato (idempotente)', () => {
      const bug = reportBug(sampleBug());
      const same = updateBugStatus(bug.id, 'open');
      expect(same.status).toBe('open');
    });
  });

  // ── getBugTrend ───────────────────────────────────────────────────────

  describe('getBugTrend', () => {
    it('restituisce trend con giorni, totali e media', () => {
      const trend = getBugTrend(undefined, 7);
      expect(trend.days).toHaveLength(7);
      expect(trend.total_closed).toBe(0);
      expect(trend.total_opened).toBe(0);
      expect(trend.total_closed + trend.total_opened).toBe(0);
      expect(trend.avg_per_day).toBe(0);
      expect(trend.period_days).toBe(7);
    });

    it('conta bug aperti e chiusi', () => {
      const bug = reportBug(sampleBug());
      reportBug(sampleBug({ title: 'Bug 2' }));

      // Entrambi aperti
      const trend1 = getBugTrend(undefined, 30);
      expect(trend1.total_opened).toBe(2);
      expect(trend1.total_closed).toBe(0);

      // Chiudi un bug
      updateBugStatus(bug.id, 'closed', 'diana');
      const trend2 = getBugTrend(undefined, 30);
      expect(trend2.total_opened).toBe(2);
      expect(trend2.total_closed).toBe(1);
      // closed_at è impostato dal trigger, quindi il trend dovrebbe vederlo
    });

    it('filtra per componente', () => {
      reportBug(sampleBug({ component: 'auth', title: 'Auth bug' }));
      reportBug(sampleBug({ component: 'frontend', title: 'Frontend bug' }));

      const trend = getBugTrend('auth', 30);
      expect(trend.component).toBe('auth');
      expect(trend.total_opened).toBe(1);
    });

    it('usa 30 giorni come default', () => {
      const trend = getBugTrend();
      expect(trend.days).toHaveLength(30);
      expect(trend.period_days).toBe(30);
    });
  });

  // ── getBugById ────────────────────────────────────────────────────────

  describe('getBugById', () => {
    it('recupera un bug esistente per ID', () => {
      const created = reportBug(sampleBug());
      const found = getBugById(created.id);
      expect(found.id).toBe(created.id);
      expect(found.title).toBe(created.title);
    });

    it('lancia errore per ID inesistente', () => {
      expect(() => getBugById('bug_nonexistent')).toThrow(/Bug not found/);
    });
  });

  // ── Cache invalidation ────────────────────────────────────────────────

  describe('Cache invalidation', () => {
    it('dopo un insert, la query successiva restituisce i dati corretti (cache invalidata)', () => {
      // Prima insert e query
      reportBug(sampleBug({ title: 'Bug 1' }));
      const result1 = listBugs();
      expect(result1.total).toBe(1);

      // Secondo insert (invalida cache)
      reportBug(sampleBug({ title: 'Bug 2' }));

      // La query deve restituire 2 bug, non la cache vecchia con 1
      const result2 = listBugs();
      expect(result2.total).toBe(2);
      expect(result2.bugs).toHaveLength(2);
    });

    it('dopo updateBugStatus, la cache viene invalidata', () => {
      const bug = reportBug(sampleBug());

      const allOpen = listBugs({ status: 'open' });
      expect(allOpen.total).toBe(1);

      updateBugStatus(bug.id, 'closed', 'diana');

      const openAfterClose = listBugs({ status: 'open' });
      expect(openAfterClose.total).toBe(0);

      const closedAfterClose = listBugs({ status: 'closed' });
      expect(closedAfterClose.total).toBe(1);
    });
  });
});
