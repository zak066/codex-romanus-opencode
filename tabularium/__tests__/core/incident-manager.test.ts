/**
 * __tests__/core/incident-manager.test.ts
 * Test per core/incident-manager.ts — Incident Management (Fase 8 PANTHEON)
 *
 * Copertura:
 * - ensureIncidentSchema: crea tabella (idempotente)
 * - createIncident: crea incidente con tutti i campi
 * - createIncident: severity non valida → errore
 * - mitigateIncident: detected → mitigated
 * - resolveIncident: mitigated → resolved
 * - resolveIncident: detected → resolved per severity minor
 * - resolveIncident: detected → resolved per critical → errore
 * - resolveIncident: già risolto → errore
 * - listIncidents: con filtri
 * - Cache invalidation dopo insert/update
 *
 * @module tests/core/incident-manager
 */

import { initDatabase, closeDatabase } from '../../src/core/database.js';
import {
  createIncident,
  mitigateIncident,
  resolveIncident,
  listIncidents,
  getIncidentById,
  ensureIncidentSchema,
  resetIncidentCache,
} from '../../src/core/incident-manager.js';

import type { CreateIncidentParams } from '../../src/core/incident-manager.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function initFreshDb(): Promise<void> {
  closeDatabase();
  resetIncidentCache();
  await initDatabase(':memory:');
}

function sampleIncident(overrides?: Partial<CreateIncidentParams>): CreateIncidentParams {
  return {
    title: 'Quality gate failed',
    description: 'Lint errors exceeded threshold in auth module',
    severity: 'major',
    domain: 'quality',
    source: 'quality_gate',
    tags: { agent: 'catone-quality', priority: 'high' },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('incident-manager', () => {
  beforeEach(async () => {
    await initFreshDb();
  });

  afterAll(() => {
    closeDatabase();
  });

  // ── ensureIncidentSchema ───────────────────────────────────────────────

  describe('ensureIncidentSchema', () => {
    it('crea la tabella incidents senza errori', () => {
      expect(() => ensureIncidentSchema()).not.toThrow();
    });

    it('è idempotente (chiamata multipla non lancia errori)', () => {
      ensureIncidentSchema();
      ensureIncidentSchema();
      expect(() => ensureIncidentSchema()).not.toThrow();
    });
  });

  // ── createIncident ─────────────────────────────────────────────────────

  describe('createIncident', () => {
    it('crea un incidente con tutti i campi e restituisce IncidentRecord', () => {
      const incident = createIncident(sampleIncident());

      expect(incident.id).toMatch(/^inc_/);
      expect(incident.title).toBe('Quality gate failed');
      expect(incident.description).toBe('Lint errors exceeded threshold in auth module');
      expect(incident.severity).toBe('major');
      expect(incident.status).toBe('detected');
      expect(incident.domain).toBe('quality');
      expect(incident.source).toBe('quality_gate');
      expect(incident.tags).toEqual({ agent: 'catone-quality', priority: 'high' });
      expect(incident.detected_at).toBeTruthy();
    });

    it('accetta campi opzionali non forniti', () => {
      const incident = createIncident({
        title: 'Simple incident',
        description: 'Minor UI glitch',
        severity: 'minor',
      });

      expect(incident.domain).toBeUndefined();
      expect(incident.source).toBeUndefined();
      expect(incident.tags).toBeUndefined();
      expect(incident.mitigated_at).toBeUndefined();
      expect(incident.resolved_at).toBeUndefined();
      expect(incident.status).toBe('detected');
    });

    it('setta severity in lowercase', () => {
      const incident = createIncident({
        title: 'Case test',
        description: 'Testing severity case',
        severity: 'CRITICAL',
      });
      expect(incident.severity).toBe('critical');
    });

    it('lancia errore per severity non valida', () => {
      expect(() =>
        createIncident(sampleIncident({ severity: 'super-critical' }))
      ).toThrow(/Invalid severity/);
    });

    it('genera ID univoci per inserimenti successivi', () => {
      const i1 = createIncident(sampleIncident({ title: 'Incident 1' }));
      const i2 = createIncident(sampleIncident({ title: 'Incident 2' }));
      expect(i1.id).not.toBe(i2.id);
    });
  });

  // ── mitigateIncident ───────────────────────────────────────────────────

  describe('mitigateIncident', () => {
    it('transisce detected → mitigated', () => {
      const incident = createIncident(sampleIncident());
      expect(incident.status).toBe('detected');

      const mitigated = mitigateIncident(incident.id, 'vulcanus-senior-dev', 'Disabled the failing lint rule');
      expect(mitigated.status).toBe('mitigated');
      expect(mitigated.mitigated_by).toBe('vulcanus-senior-dev');
      expect(mitigated.action_taken).toBe('Disabled the failing lint rule');
    });

    it('lancia errore per incidente inesistente', () => {
      expect(() => mitigateIncident('inc_nonexistent', 'diana')).toThrow(/Incident not found/);
    });

    it('lancia errore se l\'incidente non è in stato detected', () => {
      const incident = createIncident(sampleIncident({ severity: 'minor' }));
      mitigateIncident(incident.id, 'diana');
      expect(() => mitigateIncident(incident.id, 'diana')).toThrow(/Cannot mitigate/);
    });

    it('funziona senza action (opzionale)', () => {
      const incident = createIncident(sampleIncident());
      const mitigated = mitigateIncident(incident.id, 'diana');
      expect(mitigated.status).toBe('mitigated');
      expect(mitigated.mitigated_by).toBe('diana');
    });
  });

  // ── resolveIncident ────────────────────────────────────────────────────

  describe('resolveIncident', () => {
    it('transisce mitigated → resolved', () => {
      const incident = createIncident(sampleIncident());
      mitigateIncident(incident.id, 'diana');

      const resolved = resolveIncident(incident.id, 'diana', 'Root cause: misconfigured ESLint', 'Updated config');
      expect(resolved.status).toBe('resolved');
      expect(resolved.resolved_by).toBe('diana');
      expect(resolved.root_cause).toBe('Root cause: misconfigured ESLint');
      expect(resolved.action_taken).toBe('Updated config');
    });

    it('transisce detected → resolved per severity minor', () => {
      const incident = createIncident(sampleIncident({ severity: 'minor' }));

      const resolved = resolveIncident(incident.id, 'diana', 'Cosmetic issue', 'Fixed UI');
      expect(resolved.status).toBe('resolved');
      expect(resolved.resolved_by).toBe('diana');
    });

    it('lancia errore per detected → resolved con severity critical', () => {
      const incident = createIncident(sampleIncident({ severity: 'critical' }));

      expect(() =>
        resolveIncident(incident.id, 'diana', 'Trying to skip')
      ).toThrow(/only.*minor.*incidents.*can be resolved/);
    });

    it('lancia errore per detected → resolved con severity major', () => {
      const incident = createIncident(sampleIncident({ severity: 'major' }));

      expect(() =>
        resolveIncident(incident.id, 'diana')
      ).toThrow(/only.*minor.*incidents.*can be resolved/);
    });

    it('lancia errore per incidente già resolved', () => {
      const incident = createIncident(sampleIncident({ severity: 'minor' }));
      resolveIncident(incident.id, 'diana');

      expect(() =>
        resolveIncident(incident.id, 'diana')
      ).toThrow(/already resolved/);
    });

    it('lancia errore per incidente inesistente', () => {
      expect(() => resolveIncident('inc_nonexistent', 'diana')).toThrow(/Incident not found/);
    });
  });

  // ── listIncidents ──────────────────────────────────────────────────────

  describe('listIncidents', () => {
    it('restituisce array vuoto quando non ci sono incidenti', () => {
      const result = listIncidents();
      expect(result.total).toBe(0);
      expect(result.incidents).toEqual([]);
    });

    it('restituisce tutti gli incidenti senza filtri', () => {
      createIncident(sampleIncident({ title: 'Incident 1' }));
      createIncident(sampleIncident({ title: 'Incident 2', severity: 'minor' }));

      const result = listIncidents();
      expect(result.total).toBe(2);
      expect(result.incidents).toHaveLength(2);
    });

    it('filtra per status', () => {
      const i1 = createIncident(sampleIncident({ title: 'Active incident' }));
      const i2 = createIncident(sampleIncident({ title: 'Resolved minor', severity: 'minor' }));
      resolveIncident(i2.id, 'diana');

      const detected = listIncidents({ status: 'detected' });
      expect(detected.total).toBe(1);
      expect(detected.incidents[0].title).toBe('Active incident');

      const resolved = listIncidents({ status: 'resolved' });
      expect(resolved.total).toBe(1);
      expect(resolved.incidents[0].title).toBe('Resolved minor');
    });

    it('filtra per severity', () => {
      createIncident(sampleIncident({ severity: 'minor', title: 'Minor' }));
      createIncident(sampleIncident({ severity: 'critical', title: 'Critical' }));

      const result = listIncidents({ severity: 'critical' });
      expect(result.total).toBe(1);
      expect(result.incidents[0].title).toBe('Critical');
    });

    it('filtra per domain', () => {
      createIncident(sampleIncident({ domain: 'quality', title: 'Quality' }));
      createIncident(sampleIncident({ domain: 'security', title: 'Security' }));

      const result = listIncidents({ domain: 'security' });
      expect(result.total).toBe(1);
      expect(result.incidents[0].title).toBe('Security');
    });

    it('combina filtri multipli', () => {
      createIncident(sampleIncident({
        domain: 'quality',
        severity: 'critical',
        title: 'Target',
      }));
      createIncident(sampleIncident({
        domain: 'quality',
        severity: 'minor',
        title: 'Other',
      }));

      const result = listIncidents({ domain: 'quality', severity: 'critical' });
      expect(result.total).toBe(1);
      expect(result.incidents[0].title).toBe('Target');
    });

    it('rispetta il parametro limit', () => {
      for (let i = 0; i < 10; i++) {
        createIncident(sampleIncident({ title: `Incident ${i}` }));
      }

      const result = listIncidents({ limit: 3 });
      expect(result.incidents).toHaveLength(3);
      expect(result.total).toBe(10);
    });

    it('usa limit=50 e offset=0 di default', () => {
      for (let i = 0; i < 60; i++) {
        createIncident(sampleIncident({ title: `Incident ${i}` }));
      }

      const result = listIncidents();
      expect(result.incidents).toHaveLength(50);
      expect(result.total).toBe(60);
    });
  });

  // ── getIncidentById ────────────────────────────────────────────────────

  describe('getIncidentById', () => {
    it('recupera un incidente esistente per ID', () => {
      const created = createIncident(sampleIncident());
      const found = getIncidentById(created.id);
      expect(found.id).toBe(created.id);
      expect(found.title).toBe(created.title);
    });

    it('lancia errore per ID inesistente', () => {
      expect(() => getIncidentById('inc_nonexistent')).toThrow(/Incident not found/);
    });
  });

  // ── Cache invalidation ─────────────────────────────────────────────────

  describe('Cache invalidation', () => {
    it('dopo createIncident, la cache viene invalidata', () => {
      const result1 = listIncidents();
      expect(result1.total).toBe(0);

      createIncident(sampleIncident({ title: 'New incident' }));

      const result2 = listIncidents();
      expect(result2.total).toBe(1);
    });

    it('dopo mitigateIncident, la cache viene invalidata', () => {
      const incident = createIncident(sampleIncident());

      const detected = listIncidents({ status: 'detected' });
      expect(detected.total).toBe(1);

      mitigateIncident(incident.id, 'diana');

      const detectedAfter = listIncidents({ status: 'detected' });
      expect(detectedAfter.total).toBe(0);

      const mitigated = listIncidents({ status: 'mitigated' });
      expect(mitigated.total).toBe(1);
    });

    it('dopo resolveIncident, la cache viene invalidata', () => {
      const incident = createIncident(sampleIncident({ severity: 'minor' }));

      resolveIncident(incident.id, 'diana');

      const detected = listIncidents({ status: 'detected' });
      expect(detected.total).toBe(0);

      const resolved = listIncidents({ status: 'resolved' });
      expect(resolved.total).toBe(1);
    });
  });
});
