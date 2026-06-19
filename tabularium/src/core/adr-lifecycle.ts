/**
 * core/adr-lifecycle.ts
 * ADR Lifecycle Engine (PANTHEON — Fase 8.1).
 *
 * Gestisce il ciclo di vita delle Architecture Decision Records (ADR):
 * - registerAdr: inserimento nuova ADR con stato 'proposed'
 * - transitionAdrStatus: transizione tra stati validi
 * - listAdrsByStatus: query per stato
 * - getActiveAdrs: solo ADR attive (proposed + accepted)
 *
 * Transizioni valide:
 *   proposed  → accepted ✓
 *   proposed  → deprecated ✓
 *   accepted  → deprecated ✓
 *   accepted  → superseded ✓ (richiede superseded_by)
 *   deprecated  → (terminal)
 *   superseded  → (terminal)
 *
 * @module core/adr-lifecycle
 */

import { getDatabase } from './database.js';

// ---------------------------------------------------------------------------
// Tipi pubblici
// ---------------------------------------------------------------------------

/** Record di una ADR nel database adr_status */
export interface AdrStatusRecord {
  id: string;
  title: string;
  status: 'proposed' | 'accepted' | 'deprecated' | 'superseded';
  superseded_by?: string;
  created_at: string;
  updated_at: string;
  file_path?: string;  // ADR-035: percorso del file markdown su disco
}

// ---------------------------------------------------------------------------
// Costanti
// ---------------------------------------------------------------------------

/** Matrice delle transizioni valide: stato_corrente → { stato_futuro: true } */
const VALID_TRANSITIONS: Record<string, Record<string, boolean>> = {
  proposed: { accepted: true, deprecated: true },
  accepted: { deprecated: true, superseded: true },
  deprecated: {},  // terminale
  superseded: {},  // terminale
};

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

/**
 * Crea la tabella `adr_status` e l'indice se non esistono.
 * Chiamata automaticamente da ogni funzione pubblica per garantire
 * che lo schema sia sempre presente (lazy initialization).
 */
export function ensureAdrLifecycleSchema(): void {
  const db = getDatabase();

  db.exec(`
    CREATE TABLE IF NOT EXISTS adr_status (
      id            TEXT PRIMARY KEY,
      title         TEXT NOT NULL,
      status        TEXT NOT NULL DEFAULT 'proposed' CHECK(status IN ('proposed','accepted','deprecated','superseded')),
      superseded_by TEXT,
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
      file_path     TEXT
    )
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_adr_status
    ON adr_status(status)
  `);
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

/**
 * Registra una nuova ADR con stato 'proposed'.
 *
 * @param id - Identificativo univoco (formato: adr_NNN, es. adr_012)
 * @param title - Titolo descrittivo della decisione
 * @param filePath - Percorso opzionale del file markdown su disco
 * @returns AdrStatusRecord della ADR appena creata
 * @throws Error se il formato ID non è valido o la ADR esiste già
 */
export function registerAdr(id: string, title: string, filePath?: string): AdrStatusRecord {
  const db = getDatabase();
  ensureAdrLifecycleSchema();

  // Validazione formato ID: adr_NNN (es. adr_012, adr_123)
  if (!/^adr_\d{3}$/i.test(id)) {
    throw new Error(
      `Invalid ADR ID format: "${id}". Expected format: adr_NNN (e.g., adr_012)`
    );
  }

  // Verifica duplicati
  const existing = db.prepare('SELECT id FROM adr_status WHERE id = ?').get(id);
  if (existing) {
    throw new Error(`ADR "${id}" already exists`);
  }

  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO adr_status (id, title, status, created_at, updated_at, file_path)
    VALUES (?, ?, 'proposed', ?, ?, ?)
  `).run(id, title, now, now, filePath ?? null);

  return {
    id,
    title,
    status: 'proposed',
    created_at: now,
    updated_at: now,
    file_path: filePath,
  };
}

/**
 * Transisce una ADR a un nuovo stato, convalidando la transizione.
 *
 * Transizioni valide:
 * - proposed  → accepted
 * - proposed  → deprecated
 * - accepted  → deprecated
 * - accepted  → superseded (richiede supersededBy)
 * - deprecated  → (nessuna, terminale)
 * - superseded  → (nessuna, terminale)
 *
 * @param id - Identificativo della ADR da transire
 * @param newStatus - Stato di destinazione
 * @param supersededBy - ID della ADR sostitutiva (obbligatorio per → superseded)
 * @returns AdrStatusRecord aggiornato
 * @throws Error se la transizione non è valida o la ADR non esiste
 */
export function transitionAdrStatus(
  id: string,
  newStatus: string,
  supersededBy?: string
): AdrStatusRecord {
  const db = getDatabase();
  ensureAdrLifecycleSchema();

  // Leggi record corrente — colonne esplicite con COALESCE per file_path (ADR-035)
  const record = db.prepare(
    'SELECT id, title, status, superseded_by, created_at, updated_at, COALESCE(file_path, NULL) as file_path FROM adr_status WHERE id = ?'
  ).get(id) as AdrStatusRecord | undefined;

  if (!record) {
    throw new Error(`ADR "${id}" not found`);
  }

  const currentStatus = record.status;

  // Verifica che la transizione sia valida
  const allowed = VALID_TRANSITIONS[currentStatus];
  if (!allowed || !allowed[newStatus]) {
    const allowedList = allowed
      ? Object.keys(allowed).join(', ') || 'none (terminal state)'
      : 'none (terminal state)';
    throw new Error(
      `Invalid transition: "${currentStatus}" → "${newStatus}". ` +
      `Allowed transitions from "${currentStatus}": ${allowedList}`
    );
  }

  // La transizione a 'superseded' richiede l'ADR sostitutiva
  if (newStatus === 'superseded' && !supersededBy) {
    throw new Error(
      'Transition to "superseded" requires "supersededBy" parameter'
    );
  }

  // Se supersededBy è fornito, verifica che l'ADR target esista
  if (supersededBy) {
    const targetExists = db.prepare('SELECT id FROM adr_status WHERE id = ?').get(supersededBy);
    if (!targetExists) {
      throw new Error(
        `Superseding ADR "${supersededBy}" not found. Register it first.`
      );
    }
  }

  const now = new Date().toISOString();

  db.prepare(`
    UPDATE adr_status
    SET status = ?, superseded_by = ?, updated_at = ?
    WHERE id = ?
  `).run(newStatus, supersededBy ?? null, now, id);

  return {
    ...record,
    status: newStatus as AdrStatusRecord['status'],
    superseded_by: supersededBy,
    updated_at: now,
  };
}

// ---------------------------------------------------------------------------
// Query
// ---------------------------------------------------------------------------

/** Query base con colonne esplicite + COALESCE per file_path (ADR-035) */
const SELECT_COLUMNS = 'SELECT id, title, status, superseded_by, created_at, updated_at, COALESCE(file_path, NULL) as file_path';

/**
 * Elenca tutte le ADR, opzionalmente filtrate per stato.
 *
 * @param status - Filtro opzionale per stato (proposed, accepted, deprecated, superseded)
 * @returns Array di AdrStatusRecord ordinate per ID
 */
export function listAdrsByStatus(status?: string): AdrStatusRecord[] {
  const db = getDatabase();
  ensureAdrLifecycleSchema();

  if (status) {
    if (!['proposed', 'accepted', 'deprecated', 'superseded'].includes(status)) {
      throw new Error(
        `Invalid status filter: "${status}". ` +
        'Valid values: proposed, accepted, deprecated, superseded'
      );
    }
    return db
      .prepare(`${SELECT_COLUMNS} FROM adr_status WHERE status = ? ORDER BY id`)
      .all(status) as AdrStatusRecord[];
  }

  return db
    .prepare(`${SELECT_COLUMNS} FROM adr_status ORDER BY id`)
    .all() as AdrStatusRecord[];
}

/**
 * Restituisce solo le ADR attive (proposed + accepted).
 * Utile per focalizzarsi sulle decisioni ancora in vigore.
 *
 * @returns Array di AdrStatusRecord attive
 */
export function getActiveAdrs(): AdrStatusRecord[] {
  const db = getDatabase();
  ensureAdrLifecycleSchema();

  return db
    .prepare(`${SELECT_COLUMNS} FROM adr_status WHERE status IN ('proposed', 'accepted') ORDER BY id`)
    .all() as AdrStatusRecord[];
}