/**
 * core/adr-graph.ts
 * Decision Dependency Graph (PANTHEON — Fase 8.2).
 *
 * Gestisce il grafo delle dipendenze tra Architecture Decision Records (ADR):
 * - addDependency: crea un arco tra due ADR con tipo di relazione
 * - getGraph: restituisce l'intero grafo o il sotto-grafo connesso a una ADR
 *
 * Tipi di relazione:
 * - depends_on: A dipende da B (A non può essere compresa senza B)
 * - supersedes: A sostituisce B (A supera B)
 * - related_to: A e B sono correlate senza dipendenza diretta
 *
 * @module core/adr-graph
 */

import { getDatabase } from './database.js';

// ---------------------------------------------------------------------------
// Tipi pubblici
// ---------------------------------------------------------------------------

/** Record di una dipendenza nel database decision_dependencies */
export interface DependencyRecord {
  from_adr: string;
  to_adr: string;
  relation_type: 'depends_on' | 'supersedes' | 'related_to';
  description?: string;
}

/** Grafo completo delle dipendenze con nodi e archi */
export interface DependencyGraph {
  nodes: Array<{ id: string; title: string; status: string }>;
  edges: Array<{ from: string; to: string; type: string; description?: string }>;
}

// ---------------------------------------------------------------------------
// Costanti
// ---------------------------------------------------------------------------

/** Tipi di relazione validi */
const VALID_RELATION_TYPES = ['depends_on', 'supersedes', 'related_to'];

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

/**
 * Crea la tabella `decision_dependencies` e gli indici se non esistono.
 */
export function ensureDepSchema(): void {
  const db = getDatabase();

  db.exec(`
    CREATE TABLE IF NOT EXISTS decision_dependencies (
      id            TEXT PRIMARY KEY,
      from_adr      TEXT NOT NULL,
      to_adr        TEXT NOT NULL,
      relation_type TEXT NOT NULL CHECK(relation_type IN ('depends_on','supersedes','related_to')),
      description   TEXT,
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (from_adr) REFERENCES adr_status(id),
      FOREIGN KEY (to_adr) REFERENCES adr_status(id)
    )
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_dep_from
    ON decision_dependencies(from_adr)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_dep_to
    ON decision_dependencies(to_adr)
  `);
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

/**
 * Aggiunge una dipendenza tra due ADR.
 * Se la stessa dipendenza esiste già, l'operazione è un no-op (INSERT OR IGNORE).
 *
 * @param from - ADR sorgente (che dipende)
 * @param to - ADR target (da cui si dipende)
 * @param type - Tipo di relazione: depends_on, supersedes, related_to
 * @param description - Annotazione semantica opzionale
 * @throws Error se una delle due ADR non esiste o il tipo non è valido
 */
export function addDependency(
  from: string,
  to: string,
  type: string,
  description?: string
): void {
  const db = getDatabase();
  ensureDepSchema();

  // Validazione tipo di relazione
  if (!VALID_RELATION_TYPES.includes(type)) {
    throw new Error(
      `Invalid relation type: "${type}". Must be one of: ${VALID_RELATION_TYPES.join(', ')}`
    );
  }

  // Validazione esistenza ADR sorgente
  const fromExists = db
    .prepare('SELECT id FROM adr_status WHERE id = ?')
    .get(from) as { id: string } | undefined;
  if (!fromExists) {
    throw new Error(`Source ADR "${from}" not found. Register it first.`);
  }

  // Validazione esistenza ADR target
  const toExists = db
    .prepare('SELECT id FROM adr_status WHERE id = ?')
    .get(to) as { id: string } | undefined;
  if (!toExists) {
    throw new Error(`Target ADR "${to}" not found. Register it first.`);
  }

  // Impedisci auto-dipendenza
  if (from === to) {
    throw new Error('Cannot create a self-referencing dependency');
  }

  // ID deterministico per evitare duplicati
  const id = `dep_${from}_${to}_${type}`;

  db.prepare(`
    INSERT OR IGNORE INTO decision_dependencies (id, from_adr, to_adr, relation_type, description)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, from, to, type, description ?? null);
}

// ---------------------------------------------------------------------------
// Query
// ---------------------------------------------------------------------------

/**
 * Restituisce il grafo delle dipendenze.
 *
 * Se forAdr è specificato, restituisce solo il sotto-grafo
 * direttamente connesso a quella ADR (nodo + vicini diretti).
 * Altrimenti restituisce l'intero grafo.
 *
 * @param forAdr - ADR di cui ottenere il sotto-grafo (opzionale)
 * @returns DependencyGraph con nodi e archi
 */
export function getGraph(forAdr?: string): DependencyGraph {
  const db = getDatabase();
  ensureDepSchema();

  // ── Risolvi nodi da includere ─────────────
  let adrIds: string[] = [];

  if (forAdr) {
    // Cerca ADR connesse direttamente
    const connected = db
      .prepare(
        `SELECT DISTINCT node FROM (
          SELECT from_adr AS node FROM decision_dependencies WHERE to_adr = ?
          UNION
          SELECT to_adr AS node FROM decision_dependencies WHERE from_adr = ?
        )`
      )
      .all(forAdr, forAdr) as Array<{ node: string }>;

    adrIds = [forAdr, ...connected.map((r) => r.node)];
  }

  // ── Query nodi ─────────────────────────────
  let nodes: Array<{ id: string; title: string; status: string }>;

  if (forAdr && adrIds.length > 1) {
    const placeholders = adrIds.map(() => '?').join(',');
    nodes = db
      .prepare(
        `SELECT id, title, status FROM adr_status WHERE id IN (${placeholders})`
      )
      .all(...adrIds) as Array<{ id: string; title: string; status: string }>;
  } else if (forAdr) {
    // Singola ADR senza connessioni
    const adr = db
      .prepare('SELECT id, title, status FROM adr_status WHERE id = ?')
      .get(forAdr) as { id: string; title: string; status: string } | undefined;
    nodes = adr ? [adr] : [];
  } else {
    // Tutte le ADR
    nodes = db
      .prepare('SELECT id, title, status FROM adr_status ORDER BY id')
      .all() as Array<{ id: string; title: string; status: string }>;
  }

  // ── Query archi ────────────────────────────
  let edges: Array<{
    from: string;
    to: string;
    type: string;
    description?: string;
  }>;

  if (forAdr && adrIds.length > 1) {
    const placeholders = adrIds.map(() => '?').join(',');
    edges = db
      .prepare(
        `SELECT from_adr AS "from", to_adr AS "to",
                relation_type AS "type", description
         FROM decision_dependencies
         WHERE from_adr IN (${placeholders}) OR to_adr IN (${placeholders})`
      )
      .all(...adrIds) as Array<{
      from: string;
      to: string;
      type: string;
      description?: string;
    }>;
  } else if (forAdr) {
    edges = db
      .prepare(
        `SELECT from_adr AS "from", to_adr AS "to",
                relation_type AS "type", description
         FROM decision_dependencies
         WHERE from_adr = ? OR to_adr = ?`
      )
      .all(forAdr, forAdr) as Array<{
      from: string;
      to: string;
      type: string;
      description?: string;
    }>;
  } else {
    edges = db
      .prepare(
        `SELECT from_adr AS "from", to_adr AS "to",
                relation_type AS "type", description
         FROM decision_dependencies`
      )
      .all() as Array<{
      from: string;
      to: string;
      type: string;
      description?: string;
    }>;
  }

  return { nodes, edges };
}
