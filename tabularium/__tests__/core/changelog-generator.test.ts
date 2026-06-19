/**
 * Test per core/changelog-generator.ts — Generazione Automatica CHANGELOG (Fase 6: AUTOMATA)
 *
 * Copertura:
 * - Output markdown contiene "# Changelog" e sezioni Added/Changed/Fixed/Security
 * - Raggruppamento per data
 * - Raggruppamento per agente (groupByAgent)
 * - Date range custom (fromDate / toDate)
 * - Periodo senza eventi → messaggio "Nessuna modifica"
 * - Mapping event_type → sezione corretta
 * - Deduplicazione entry identiche
 * - Riferimenti (task_id, adr_id, commit) inclusi nel markdown
 * - Eventi custom mappati da details.type
 * - Edge: tags/details JSON non validi
 *
 * Usa database in-memory con tabella `events` mockando getDatabase().
 *
 * @module tests/core/changelog-generator
 */

import Database from 'better-sqlite3';
import { generateChangelog } from '../../src/core/changelog-generator.js';

// ---------------------------------------------------------------------------
// Mock database
// ---------------------------------------------------------------------------

jest.mock('../../src/core/database.js', () => ({
  getDatabase: jest.fn(),
}));

import { getDatabase } from '../../src/core/database.js';
const mockGetDatabase = getDatabase as jest.MockedFunction<typeof getDatabase>;

// ---------------------------------------------------------------------------
// Helpers per il test DB
// ---------------------------------------------------------------------------

const FAKE_NOW = '2026-05-26T12:00:00.000Z';

/**
 * Crea un database SQLite in-memory con la tabella `events`.
 * La tabella è identica allo schema reale ma senza CHECK constraints
 * per poter testare anche event_type non canonici.
 */
function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      timestamp TEXT NOT NULL DEFAULT (datetime('now')),
      agent_name TEXT NOT NULL,
      event_type TEXT NOT NULL,
      summary TEXT NOT NULL,
      details TEXT DEFAULT '{}',
      tags TEXT DEFAULT '[]'
    );
  `);
  return db;
}

/**
 * Inserisce un evento finto nella tabella events.
 * I campi opzionali hanno default sensati per i test.
 */
function insertEvent(
  db: Database.Database,
  overrides: Partial<{
    id: string;
    session_id: string;
    timestamp: string;
    agent_name: string;
    event_type: string;
    summary: string;
    details: string;
    tags: string;
  }> = {}
): void {
  const defaults = {
    id: `evt_${Math.random().toString(36).substring(2, 10)}`,
    session_id: 'sess_test',
    timestamp: FAKE_NOW,
    agent_name: 'diana-tester',
    event_type: 'custom',
    summary: 'Test event',
    details: '{}',
    tags: '[]',
  };
  const row = { ...defaults, ...overrides };

  db.prepare(`
    INSERT INTO events (id, session_id, timestamp, agent_name, event_type, summary, details, tags)
    VALUES (@id, @session_id, @timestamp, @agent_name, @event_type, @summary, @details, @tags)
  `).run(row);
}

/**
 * Inizializza un DB pulito e lo imposta come mock per getDatabase().
 */
function initDb(): Database.Database {
  const db = createTestDb();
  mockGetDatabase.mockReturnValue(db);
  return db;
}

// ---------------------------------------------------------------------------
// Suite: generateChangelog
// ---------------------------------------------------------------------------

describe('generateChangelog', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── Output markdown base ──────────────────────────────────────────────

  it('produce markdown con # Changelog e sezioni Added/Changed/Fixed/Security', () => {
    const db = initDb();

    // Inserisci eventi che mappano a sezioni diverse
    insertEvent(db, {
      event_type: 'file_created',
      summary: 'Implementato modulo autenticazione',
      agent_name: 'vulcanus-senior-dev',
      timestamp: '2026-05-25T10:00:00.000Z',
    });

    insertEvent(db, {
      event_type: 'file_modified',
      summary: 'Refactor middleware logging',
      agent_name: 'vulcanus-senior-dev',
      timestamp: '2026-05-25T11:00:00.000Z',
    });

    insertEvent(db, {
      event_type: 'bug_fixed',
      summary: 'Corretto memory leak in cache module',
      agent_name: 'mercurius-junior-dev',
      timestamp: '2026-05-25T12:00:00.000Z',
    });

    insertEvent(db, {
      event_type: 'security_audit',
      summary: 'Audit dipendenze npm',
      agent_name: 'janus-security',
      timestamp: '2026-05-25T13:00:00.000Z',
    });

    const result = generateChangelog({
      fromDate: '2026-05-25',
      toDate: '2026-05-26',
    });

    // Verifica struttura markdown
    expect(result.markdown).toContain('# Changelog');
    expect(result.markdown).toContain('### Added');
    expect(result.markdown).toContain('### Changed');
    expect(result.markdown).toContain('### Fixed');
    expect(result.markdown).toContain('### Security');
    expect(result.markdown).toContain('Implementato modulo autenticazione');
    expect(result.markdown).toContain('Refactor middleware logging');
    expect(result.markdown).toContain('Corretto memory leak in cache module');
    expect(result.markdown).toContain('Audit dipendenze npm');

    // Verifica entries
    expect(result.entries).toHaveLength(4);
    expect(result.fromDate).toBe('2026-05-25');
    expect(result.toDate).toBe('2026-05-26');
  });

  // ── Raggruppamento per data ──────────────────────────────────────────

  it('raggruppa le entry per data (ordinamento decrescente)', () => {
    const db = initDb();

    // Evento giorno 1
    insertEvent(db, {
      event_type: 'file_created',
      summary: 'Feature giorno 1',
      timestamp: '2026-05-20T08:00:00.000Z',
      agent_name: 'vulcanus',
    });

    // Evento giorno 2
    insertEvent(db, {
      event_type: 'file_created',
      summary: 'Feature giorno 2',
      timestamp: '2026-05-21T08:00:00.000Z',
      agent_name: 'vulcanus',
    });

    // Evento giorno 3
    insertEvent(db, {
      event_type: 'file_created',
      summary: 'Feature giorno 3',
      timestamp: '2026-05-22T08:00:00.000Z',
      agent_name: 'vulcanus',
    });

    const result = generateChangelog({
      fromDate: '2026-05-20',
      toDate: '2026-05-22',
    });

    // Deve contenere i titoli delle date
    expect(result.markdown).toContain('## 2026-05-22');
    expect(result.markdown).toContain('## 2026-05-21');
    expect(result.markdown).toContain('## 2026-05-20');

    // Le date devono essere in ordine decrescente nel markdown
    const dateIndex1 = result.markdown.indexOf('## 2026-05-22');
    const dateIndex2 = result.markdown.indexOf('## 2026-05-21');
    const dateIndex3 = result.markdown.indexOf('## 2026-05-20');
    expect(dateIndex1).toBeLessThan(dateIndex2);
    expect(dateIndex2).toBeLessThan(dateIndex3);

    // Le entries devono avere date corrette
    const dates = result.entries.map((e) => e.date);
    expect(dates).toContain('2026-05-20');
    expect(dates).toContain('2026-05-21');
    expect(dates).toContain('2026-05-22');
  });

  // ── groupByAgent ─────────────────────────────────────────────────────

  it('raggruppa le entry per agente quando groupByAgent=true', () => {
    const db = initDb();

    insertEvent(db, {
      event_type: 'file_created',
      summary: 'Feature A',
      agent_name: 'vulcanus',
      timestamp: '2026-05-25T08:00:00.000Z',
    });

    insertEvent(db, {
      event_type: 'file_created',
      summary: 'Feature B',
      agent_name: 'minerva',
      timestamp: '2026-05-25T09:00:00.000Z',
    });

    insertEvent(db, {
      event_type: 'bug_fixed',
      summary: 'Fix minore',
      agent_name: 'mercurius',
      timestamp: '2026-05-25T10:00:00.000Z',
    });

    const result = generateChangelog({
      fromDate: '2026-05-25',
      toDate: '2026-05-26',
      groupByAgent: true,
    });

    // Con groupByAgent, i nomi agenti appaiono come heading
    expect(result.markdown).toContain('### @vulcanus');
    expect(result.markdown).toContain('### @minerva');
    expect(result.markdown).toContain('### @mercurius');

    // Le sezioni diventano H4 invece di H3
    expect(result.markdown).toContain('#### Added');
    expect(result.markdown).toContain('#### Fixed');

    // Le descrizioni devono essere presenti
    expect(result.markdown).toContain('Feature A');
    expect(result.markdown).toContain('Feature B');
    expect(result.markdown).toContain('Fix minore');
  });

  // ── groupByAgent=false (default) ──────────────────────────────────────

  it('raggruppa per sezione quando groupByAgent=false (default)', () => {
    const db = initDb();

    insertEvent(db, {
      event_type: 'file_created',
      summary: 'Feature di vulcanus',
      agent_name: 'vulcanus',
      timestamp: '2026-05-25T08:00:00.000Z',
    });

    insertEvent(db, {
      event_type: 'file_created',
      summary: 'Feature di minerva',
      agent_name: 'minerva',
      timestamp: '2026-05-25T09:00:00.000Z',
    });

    // Default: groupByAgent = false
    const result = generateChangelog({
      fromDate: '2026-05-25',
      toDate: '2026-05-26',
    });

    // Non ci sono heading per agente
    expect(result.markdown).not.toContain('### @vulcanus');
    expect(result.markdown).not.toContain('### @minerva');

    // C'è una sola sezione Added con entrambe le feature
    expect(result.markdown).toContain('### Added');
    expect(result.markdown).toContain('Feature di vulcanus');
    expect(result.markdown).toContain('Feature di minerva');
  });

  // ── Date range custom ────────────────────────────────────────────────

  it('rispetta il date range custom (fromDate / toDate)', () => {
    const db = initDb();

    // Evento prima del range (non deve comparire)
    insertEvent(db, {
      event_type: 'file_created',
      summary: 'Troppo vecchio',
      timestamp: '2026-05-01T08:00:00.000Z',
    });

    // Evento nel range
    insertEvent(db, {
      event_type: 'file_created',
      summary: 'Nel range',
      timestamp: '2026-05-15T08:00:00.000Z',
    });

    // Evento dopo il range (non deve comparire)
    insertEvent(db, {
      event_type: 'file_created',
      summary: 'Troppo recente',
      timestamp: '2026-05-30T08:00:00.000Z',
    });

    const result = generateChangelog({
      fromDate: '2026-05-10',
      toDate: '2026-05-20',
    });

    expect(result.markdown).toContain('Nel range');
    expect(result.markdown).not.toContain('Troppo vecchio');
    expect(result.markdown).not.toContain('Troppo recente');
    expect(result.fromDate).toBe('2026-05-10');
    expect(result.toDate).toBe('2026-05-20');
  });

  // ── Periodo senza eventi ─────────────────────────────────────────────

  it('restituisce messaggio "Nessuna modifica" quando non ci sono eventi nel periodo', () => {
    initDb(); // DB vuoto

    const result = generateChangelog({
      fromDate: '2026-01-01',
      toDate: '2026-01-31',
    });

    expect(result.markdown).toContain('Nessuna modifica');
    expect(result.entries).toHaveLength(0);
  });

  // ── Mapping task_completed per tag ───────────────────────────────────

  it('mappa task_completed con tag feature → Added', () => {
    const db = initDb();

    insertEvent(db, {
      event_type: 'task_completed',
      summary: 'Implementata dashboard utente',
      tags: JSON.stringify(['feature', 'frontend']),
      timestamp: '2026-05-25T08:00:00.000Z',
    });

    const result = generateChangelog({
      fromDate: '2026-05-25',
      toDate: '2026-05-26',
    });

    expect(result.markdown).toContain('### Added');
    expect(result.markdown).toContain('Implementata dashboard utente');
    const entry = result.entries.find((e) => e.description.includes('Implementata'));
    expect(entry?.type).toBe('Added');
  });

  it('mappa task_completed con tag bug/fix → Fixed', () => {
    const db = initDb();

    insertEvent(db, {
      event_type: 'task_completed',
      summary: 'Fixato crash su input non validi',
      tags: JSON.stringify(['bug', 'backend']),
      timestamp: '2026-05-25T08:00:00.000Z',
    });

    const result = generateChangelog({
      fromDate: '2026-05-25',
      toDate: '2026-05-26',
    });

    expect(result.markdown).toContain('### Fixed');
    expect(result.markdown).toContain('Fixato crash su input non validi');
    const entry = result.entries.find((e) => e.description.includes('Fixato'));
    expect(entry?.type).toBe('Fixed');
  });

  it('mappa task_completed con tag security → Security', () => {
    const db = initDb();

    insertEvent(db, {
      event_type: 'task_completed',
      summary: 'Patch vulnerabilità XSS',
      tags: JSON.stringify(['security']),
      timestamp: '2026-05-25T08:00:00.000Z',
    });

    const result = generateChangelog({
      fromDate: '2026-05-25',
      toDate: '2026-05-26',
    });

    expect(result.markdown).toContain('### Security');
    expect(result.markdown).toContain('Patch vulnerabilità XSS');
    const entry = result.entries.find((e) => e.description.includes('Patch'));
    expect(entry?.type).toBe('Security');
  });

  it('mappa task_completed con tag perf → Changed con prefisso [Performance]', () => {
    const db = initDb();

    insertEvent(db, {
      event_type: 'task_completed',
      summary: 'Ottimizzato caricamento pagina',
      tags: JSON.stringify(['perf']),
      timestamp: '2026-05-25T08:00:00.000Z',
    });

    const result = generateChangelog({
      fromDate: '2026-05-25',
      toDate: '2026-05-26',
    });

    expect(result.markdown).toContain('[Performance]');
    const entry = result.entries.find((e) => e.description.includes('[Performance]'));
    expect(entry?.type).toBe('Changed');
  });

  it('mappa task_completed senza tag speciali → Changed (default)', () => {
    const db = initDb();

    insertEvent(db, {
      event_type: 'task_completed',
      summary: 'Refactor generico',
      tags: JSON.stringify(['chore']),
      timestamp: '2026-05-25T08:00:00.000Z',
    });

    const result = generateChangelog({
      fromDate: '2026-05-25',
      toDate: '2026-05-26',
    });

    const entry = result.entries.find((e) => e.description.includes('Refactor'));
    expect(entry?.type).toBe('Changed');
  });

  // ── Riferimenti (references) ─────────────────────────────────────────

  it('include riferimenti (task_id, adr_id, commit) nel markdown', () => {
    const db = initDb();

    insertEvent(db, {
      event_type: 'task_completed',
      summary: 'Implementata login SSO',
      tags: JSON.stringify(['feature']),
      details: JSON.stringify({
        task_id: 'TASK-42',
        adr_id: 'ADR-007',
        commit: 'a1b2c3d',
      }),
      timestamp: '2026-05-25T08:00:00.000Z',
    });

    const result = generateChangelog({
      fromDate: '2026-05-25',
      toDate: '2026-05-26',
    });

    expect(result.markdown).toContain('[TASK-42]');
    expect(result.markdown).toContain('[ADR-007]');
    expect(result.markdown).toContain('[a1b2c3d]');
  });

  // ── Deduplicazione ───────────────────────────────────────────────────

  it('deduplica entry con stesso tipo e stessa descrizione', () => {
    const db = initDb();

    // Due eventi identici in date diverse
    insertEvent(db, {
      event_type: 'file_created',
      summary: 'README iniziale',
      timestamp: '2026-05-25T08:00:00.000Z',
    });

    insertEvent(db, {
      event_type: 'file_created',
      summary: 'README iniziale',
      timestamp: '2026-05-26T08:00:00.000Z',
    });

    const result = generateChangelog({
      fromDate: '2026-05-25',
      toDate: '2026-05-27',
    });

    // Deve avere solo 1 entry dopo deduplicazione
    const readmeEntries = result.entries.filter((e) =>
      e.description.includes('README iniziale')
    );
    expect(readmeEntries).toHaveLength(1);
  });

  // ── Eventi custom con details.type ───────────────────────────────────

  it('mappa eventi custom con details.type=bug_fixed → Fixed', () => {
    const db = initDb();

    insertEvent(db, {
      event_type: 'custom',
      summary: 'Hotfix per produzione',
      details: JSON.stringify({ type: 'bug_fixed' }),
      timestamp: '2026-05-25T08:00:00.000Z',
    });

    const result = generateChangelog({
      fromDate: '2026-05-25',
      toDate: '2026-05-26',
    });

    expect(result.markdown).toContain('### Fixed');
    expect(result.markdown).toContain('Hotfix per produzione');
  });

  it('ignora eventi custom con tipo non riconosciuto', () => {
    const db = initDb();

    insertEvent(db, {
      event_type: 'custom',
      summary: 'Evento sconosciuto',
      details: JSON.stringify({ type: 'boh' }),
      timestamp: '2026-05-25T08:00:00.000Z',
    });

    const result = generateChangelog({
      fromDate: '2026-05-25',
      toDate: '2026-05-26',
    });

    // L'evento custom non riconosciuto non deve apparire nel changelog
    expect(result.markdown).not.toContain('Evento sconosciuto');
  });

  // ── Edge: tags e details JSON non validi ─────────────────────────────

  it('gestisce tags JSON non validi senza crash', () => {
    const db = initDb();

    insertEvent(db, {
      event_type: 'task_completed',
      summary: 'Task con tags malformati',
      tags: 'not-valid-json',
      timestamp: '2026-05-25T08:00:00.000Z',
    });

    const result = generateChangelog({
      fromDate: '2026-05-25',
      toDate: '2026-05-26',
    });

    // Deve finire in Changed (default per task_completed senza tag parsabili)
    const entry = result.entries.find((e) => e.description.includes('Task con tags malformati'));
    expect(entry).toBeDefined();
    expect(entry?.type).toBe('Changed');
  });

  it('gestisce details JSON non validi senza crash', () => {
    const db = initDb();

    insertEvent(db, {
      event_type: 'file_created',
      summary: 'File con details malformati',
      details: 'not-valid-json',
      timestamp: '2026-05-25T08:00:00.000Z',
    });

    const result = generateChangelog({
      fromDate: '2026-05-25',
      toDate: '2026-05-26',
    });

    expect(result.entries.length).toBeGreaterThan(0);
  });

  // ── @agent nel markdown ──────────────────────────────────────────────

  it('include il nome agente come @agent nel markdown', () => {
    const db = initDb();

    insertEvent(db, {
      event_type: 'file_created',
      summary: 'Nuovo modulo',
      agent_name: 'minerva-architect',
      timestamp: '2026-05-25T08:00:00.000Z',
    });

    const result = generateChangelog({
      fromDate: '2026-05-25',
      toDate: '2026-05-26',
    });

    expect(result.markdown).toContain('(@minerva-architect)');
  });

  // ── Decisioni (ADR) ──────────────────────────────────────────────────

  it('mappa decision_made → Added con ADR prefix', () => {
    const db = initDb();

    insertEvent(db, {
      event_type: 'decision_made',
      summary: 'Scelto pattern CQRS',
      details: JSON.stringify({ adr_id: '012', title: 'CQRS per proiezioni' }),
      timestamp: '2026-05-25T08:00:00.000Z',
    });

    const result = generateChangelog({
      fromDate: '2026-05-25',
      toDate: '2026-05-26',
    });

    expect(result.markdown).toContain('### Added');
    expect(result.markdown).toContain('ADR-012');
    expect(result.markdown).toContain('CQRS per proiezioni');
  });

  // ── milestone_reached ────────────────────────────────────────────────

  it('mappa milestone_reached → Changed con prefisso 🎯', () => {
    const db = initDb();

    insertEvent(db, {
      event_type: 'milestone_reached',
      summary: 'Raggiunta milestone 50% coverage',
      timestamp: '2026-05-25T08:00:00.000Z',
    });

    const result = generateChangelog({
      fromDate: '2026-05-25',
      toDate: '2026-05-26',
    });

    expect(result.markdown).toContain('🎯 Raggiunta milestone 50% coverage');
  });

  // ── error_encountered → Fixed ────────────────────────────────────────

  it('mappa error_encountered → Fixed', () => {
    const db = initDb();

    insertEvent(db, {
      event_type: 'error_encountered',
      summary: 'Errore connessione DB risolto con retry',
      timestamp: '2026-05-25T08:00:00.000Z',
    });

    const result = generateChangelog({
      fromDate: '2026-05-25',
      toDate: '2026-05-26',
    });

    expect(result.markdown).toContain('### Fixed');
    expect(result.markdown).toContain('Rilevato e risolto: Errore connessione DB risolto con retry');
  });

  // ── regression_detected → Fixed ──────────────────────────────────────

  it('mappa regression_detected → Fixed', () => {
    const db = initDb();

    insertEvent(db, {
      event_type: 'regression_detected',
      summary: 'Lint errors raddoppiati',
      timestamp: '2026-05-25T08:00:00.000Z',
    });

    const result = generateChangelog({
      fromDate: '2026-05-25',
      toDate: '2026-05-26',
    });

    expect(result.markdown).toContain('Regressione rilevata: Lint errors raddoppiati');
  });

  // ── Fallback: event_type sconosciuto → Changed ───────────────────────

  it('mappa event_type non riconosciuto → Changed (fallback)', () => {
    const db = initDb();

    insertEvent(db, {
      event_type: 'something_unknown',
      summary: 'Evento strano',
      timestamp: '2026-05-25T08:00:00.000Z',
    });

    const result = generateChangelog({
      fromDate: '2026-05-25',
      toDate: '2026-05-26',
    });

    expect(result.markdown).toContain('### Changed');
    expect(result.markdown).toContain('Evento strano');
    const entry = result.entries.find((e) => e.description === 'Evento strano');
    expect(entry?.type).toBe('Changed');
  });
});
