/**
 * Test per core/alert-manager.ts — Sistema di Alert Centralizzato (Fase 6: AUTOMATA)
 *
 * Copertura:
 * - createAlert: inserisce con tutti i campi, converte domain in lowercase
 * - listAlerts: tutti, filtri per status/domain/severity, paginazione
 * - acknowledgeAlert: aggiorna status e acknowledged_at
 * - acknowledgeAlert: fallisce se già acknowledged o risolto
 * - resolveAlert: aggiorna status, resolved_at via trigger SQL
 * - resolveAlert: fallisce se già risolto
 *
 * Usa database in-memory isolato per ogni test.
 *
 * @module tests/core/alert-manager
 */

import { initDatabase, closeDatabase, getDatabase } from '../../src/core/database.js';
import {
  createAlert,
  listAlerts,
  acknowledgeAlert,
  resolveAlert,
  getAlertById,
  resetAlertCache,
} from '../../src/core/alert-manager.js';

import type { CreateAlertParams } from '../../src/core/alert-manager.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Inizializza un database in-memory pulito per ogni test.
 * initDatabase(':memory:') esegue TUTTE le migrazioni inclusa 005_create_alerts.
 * Resetta anche la cache degli alert per evitare dati stale tra test.
 */
async function initFreshDb(): Promise<void> {
  closeDatabase();
  resetAlertCache();
  await initDatabase(':memory:');
}

/** Parametri base per creare alert nei test */
function sampleAlert(overrides?: Partial<CreateAlertParams>): CreateAlertParams {
  return {
    domain: 'quality',
    metric_name: 'lint_errors',
    severity: 'high',
    source: 'regression_detector',
    message: 'Lint errors exceeded threshold',
    current_value: 12,
    threshold_value: 0,
    deviation_pct: 50.5,
    tags: { agent: 'catone-quality' },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Suite: alert-manager
// ---------------------------------------------------------------------------

describe('alert-manager', () => {
  beforeEach(async () => {
    await initFreshDb();
  });

  afterAll(() => {
    closeDatabase();
  });

  // ── createAlert ──────────────────────────────────────────────────────

  describe('createAlert', () => {
    it('crea un alert con tutti i campi e restituisce AlertRecord completo', () => {
      const alert = createAlert(sampleAlert());

      expect(alert.id).toMatch(/^alr_/);
      expect(alert.domain).toBe('quality');
      expect(alert.metric_name).toBe('lint_errors');
      expect(alert.severity).toBe('high');
      expect(alert.source).toBe('regression_detector');
      expect(alert.message).toBe('Lint errors exceeded threshold');
      expect(alert.current_value).toBe(12);
      expect(alert.threshold_value).toBe(0);
      expect(alert.deviation_pct).toBe(50.5);
      expect(alert.status).toBe('open');
      expect(alert.created_at).toBeTruthy();
      expect(alert.tags).toEqual({ agent: 'catone-quality' });
    });

    it('converte il dominio in lowercase', () => {
      const alert = createAlert(sampleAlert({ domain: 'QUALITY' }));
      expect(alert.domain).toBe('quality');
    });

    it('genera ID univoci per inserimenti successivi', () => {
      const a1 = createAlert(sampleAlert({ message: 'First' }));
      const a2 = createAlert(sampleAlert({ message: 'Second' }));
      expect(a1.id).not.toBe(a2.id);
    });

    it('accetta campi opzionali non forniti (current_value, tags)', () => {
      const alert = createAlert({
        domain: 'security',
        metric_name: 'vuln_count',
        severity: 'low',
        source: 'manual',
        message: 'Manual alert',
      });

      expect(alert.current_value).toBeUndefined();
      expect(alert.threshold_value).toBeUndefined();
      expect(alert.deviation_pct).toBeUndefined();
      expect(alert.tags).toBeUndefined();
      expect(alert.status).toBe('open');
    });

    it('setta status="open" di default', () => {
      const alert = createAlert(sampleAlert());
      expect(alert.status).toBe('open');
    });

    it('salva tags come JSON e li restituisce come oggetto', () => {
      const tags = { agent: 'janus', severity: 'custom', env: 'prod' };
      const alert = createAlert(sampleAlert({ tags }));

      expect(alert.tags).toEqual(tags);
    });
  });

  // ── listAlerts ───────────────────────────────────────────────────────

  describe('listAlerts', () => {
    it('restituisce tutti gli alert senza filtri', () => {
      createAlert(sampleAlert({ message: 'Alert 1' }));
      createAlert(sampleAlert({ message: 'Alert 2', domain: 'perf' }));
      createAlert(sampleAlert({ message: 'Alert 3', severity: 'critical' }));

      const result = listAlerts();
      expect(result.total).toBe(3);
      expect(result.alerts).toHaveLength(3);
    });

    it('restituisce array vuoto quando non ci sono alert', () => {
      const result = listAlerts();
      expect(result.total).toBe(0);
      expect(result.alerts).toEqual([]);
    });

    it('filtra per status', () => {
      createAlert(sampleAlert({ message: 'Open alert' }));
      const ackId = createAlert(sampleAlert({ message: 'Ack alert' })).id;
      acknowledgeAlert(ackId, 'diana');

      const openResult = listAlerts({ status: 'open' });
      expect(openResult.total).toBe(1);
      expect(openResult.alerts[0].message).toBe('Open alert');

      const ackResult = listAlerts({ status: 'acknowledged' });
      expect(ackResult.total).toBe(1);
      expect(ackResult.alerts[0].message).toBe('Ack alert');
    });

    it('filtra per domain', () => {
      createAlert(sampleAlert({ domain: 'quality', message: 'Quality alert' }));
      createAlert(sampleAlert({ domain: 'security', message: 'Security alert' }));
      createAlert(sampleAlert({ domain: 'perf', message: 'Perf alert' }));

      const result = listAlerts({ domain: 'security' });
      expect(result.total).toBe(1);
      expect(result.alerts[0].message).toBe('Security alert');
    });

    it('filtra per severity', () => {
      createAlert(sampleAlert({ severity: 'high', message: 'High alert' }));
      createAlert(sampleAlert({ severity: 'critical', message: 'Critical alert' }));
      createAlert(sampleAlert({ severity: 'low', message: 'Low alert' }));

      const result = listAlerts({ severity: 'critical' });
      expect(result.total).toBe(1);
      expect(result.alerts[0].message).toBe('Critical alert');
    });

    it('combina filtri multipli', () => {
      createAlert(sampleAlert({
        domain: 'quality',
        severity: 'high',
        message: 'Target alert',
      }));
      createAlert(sampleAlert({
        domain: 'quality',
        severity: 'critical',
        message: 'Other alert',
      }));

      const result = listAlerts({
        domain: 'quality',
        severity: 'high',
      });
      expect(result.total).toBe(1);
      expect(result.alerts[0].message).toBe('Target alert');
    });

    it('rispetta il parametro limit', () => {
      for (let i = 0; i < 10; i++) {
        createAlert(sampleAlert({ message: `Alert ${i}` }));
      }

      const result = listAlerts({ limit: 3 });
      expect(result.alerts).toHaveLength(3);
      expect(result.total).toBe(10);
    });

    it('rispetta il parametro offset', () => {
      for (let i = 0; i < 10; i++) {
        createAlert(sampleAlert({ message: `Alert ${i}` }));
      }

      const page1 = listAlerts({ limit: 3, offset: 0 });
      const page2 = listAlerts({ limit: 3, offset: 3 });

      expect(page1.alerts).toHaveLength(3);
      expect(page2.alerts).toHaveLength(3);

      const page1Ids = page1.alerts.map((a) => a.id);
      const page2Ids = page2.alerts.map((a) => a.id);
      // Le due pagine non devono sovrapporsi
      for (const id of page1Ids) {
        expect(page2Ids).not.toContain(id);
      }
    });

    it('usa limit=50 e offset=0 di default', () => {
      for (let i = 0; i < 60; i++) {
        createAlert(sampleAlert({ message: `Alert ${i}` }));
      }

      const result = listAlerts();
      expect(result.alerts).toHaveLength(50);
      expect(result.total).toBe(60);
    });
  });

  // ── acknowledgeAlert ─────────────────────────────────────────────────

  describe('acknowledgeAlert', () => {
    it('aggiorna status a "acknowledged" e setta acknowledged_at e acknowledged_by', () => {
      const alert = createAlert(sampleAlert());

      const ackResult = acknowledgeAlert(alert.id, 'diana-tester');

      expect(ackResult.status).toBe('acknowledged');
      expect(ackResult.acknowledged_by).toBe('diana-tester');
      expect(ackResult.acknowledged_at).toBeTruthy();
      expect(() => new Date(ackResult.acknowledged_at!)).not.toThrow();
    });

    it('fallisce con errore per alert ID inesistente', () => {
      expect(() => acknowledgeAlert('alr_nonexistent', 'diana')).toThrow(
        /Alert not found/
      );
    });

    it('fallisce con errore se l\'alert è già acknowledged', () => {
      const alert = createAlert(sampleAlert());
      acknowledgeAlert(alert.id, 'diana');

      expect(() => acknowledgeAlert(alert.id, 'vulcanus')).toThrow(
        /Cannot acknowledge/
      );
      expect(() => acknowledgeAlert(alert.id, 'vulcanus')).toThrow(
        /acknowledged/
      );
    });

    it('fallisce con errore se l\'alert è già resolved', () => {
      const alert = createAlert(sampleAlert());
      resolveAlert(alert.id, 'janus');

      expect(() => acknowledgeAlert(alert.id, 'diana')).toThrow(
        /Cannot acknowledge/
      );
    });

    it('preserva i campi originali dopo acknowledge', () => {
      const alert = createAlert(sampleAlert());
      const ackResult = acknowledgeAlert(alert.id, 'diana');

      expect(ackResult.domain).toBe(alert.domain);
      expect(ackResult.metric_name).toBe(alert.metric_name);
      expect(ackResult.severity).toBe(alert.severity);
      expect(ackResult.message).toBe(alert.message);
      expect(ackResult.current_value).toBe(alert.current_value);
    });
  });

  // ── resolveAlert ─────────────────────────────────────────────────────

  describe('resolveAlert', () => {
    it('aggiorna status a "resolved" e setta resolved_by', () => {
      const alert = createAlert(sampleAlert());
      const resolved = resolveAlert(alert.id, 'janus');

      expect(resolved.status).toBe('resolved');
      expect(resolved.resolved_by).toBe('janus');
    });

    it('setta resolved_at tramite trigger SQL', () => {
      const alert = createAlert(sampleAlert());
      const resolved = resolveAlert(alert.id, 'janus');

      expect(resolved.resolved_at).toBeTruthy();
      expect(() => new Date(resolved.resolved_at!)).not.toThrow();
    });

    it('risolve alert in stato "open"', () => {
      const alert = createAlert(sampleAlert());
      const resolved = resolveAlert(alert.id, 'janus');

      expect(resolved.status).toBe('resolved');
      expect(resolved.resolved_at).toBeTruthy();
    });

    it('risolve alert in stato "acknowledged"', () => {
      const alert = createAlert(sampleAlert());
      acknowledgeAlert(alert.id, 'diana');

      const resolved = resolveAlert(alert.id, 'janus');
      expect(resolved.status).toBe('resolved');
    });

    it('fallisce con errore per alert ID inesistente', () => {
      expect(() => resolveAlert('alr_nonexistent', 'janus')).toThrow(
        /Alert not found/
      );
    });

    it('fallisce con errore se l\'alert è già resolved', () => {
      const alert = createAlert(sampleAlert());
      resolveAlert(alert.id, 'janus');

      expect(() => resolveAlert(alert.id, 'vulcanus')).toThrow(
        /already resolved/
      );
    });

    it('preserva i campi originali dopo resolve', () => {
      const alert = createAlert(sampleAlert());
      const resolved = resolveAlert(alert.id, 'janus');

      expect(resolved.domain).toBe(alert.domain);
      expect(resolved.metric_name).toBe(alert.metric_name);
      expect(resolved.severity).toBe(alert.severity);
      expect(resolved.message).toBe(alert.message);
    });
  });

  // ── getAlertById ─────────────────────────────────────────────────────

  describe('getAlertById', () => {
    it('recupera un alert esistente per ID', () => {
      const created = createAlert(sampleAlert());
      const found = getAlertById(created.id);

      expect(found.id).toBe(created.id);
      expect(found.message).toBe(created.message);
    });

    it('lancia errore per ID inesistente', () => {
      expect(() => getAlertById('alr_nonexistent')).toThrow(
        /Alert not found/
      );
    });
  });

  // ── Ciclo di vita completo ──────────────────────────────────────────

  describe('Ciclo di vita: open → acknowledged → resolved', () => {
    it('segue il ciclo completo open → acknowledged → resolved', () => {
      const alert = createAlert(sampleAlert());
      expect(alert.status).toBe('open');

      const ack = acknowledgeAlert(alert.id, 'diana');
      expect(ack.status).toBe('acknowledged');

      const resolved = resolveAlert(alert.id, 'janus');
      expect(resolved.status).toBe('resolved');
    });
  });
});
