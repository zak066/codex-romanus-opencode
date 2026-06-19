/**
 * core/db-graph.ts
 * Core DB Layer per il Knowledge Graph (graph_edges).
 *
 * Gestisce CRUD, query navigazionali BFS/DFS, neighbors e path finding
 * per il grafo multi-entità di Tabularium (ADR, knowledge, bug, incident,
 * metric, secret, session). Ogni funzione chiama lazy schema init
 * (ensureGraphSchema()) prima di operare.
 *
 * Pattern seguito: db-knowledge.ts e db-sessions.ts (singole funzioni,
 * prepared statements, try-catch con console.error logging).
 *
 * @module core/db-graph
 */

import { getDatabase } from './database.js';

// ---------------------------------------------------------------------------
// Tipi pubblici
// ---------------------------------------------------------------------------

/** Entity type supportate dal grafo */
export type EntityType = 'adr' | 'knowledge' | 'bug' | 'incident' | 'metric' | 'secret' | 'session';

/** Relation types supportati */
export type RelationType =
  | 'depends_on'
  | 'supersedes'
  | 'relates_to'
  | 'caused_bug'
  | 'fixes'
  | 'implements'
  | 'references';

/** Record di un edge nel database */
export interface GraphEdge {
  id: number;
  source_type: EntityType;
  source_id: string;
  target_type: EntityType;
  target_id: string;
  relation: RelationType;
  weight: number;
  description?: string;
  created_by?: string;
  created_at: string;
  metadata?: string;
}

/** Nodo del grafo (per risultati query) */
export interface GraphNode {
  type: EntityType;
  id: string;
  /** Numero di archi uscenti */
  outDegree: number;
  /** Numero di archi entranti */
  inDegree: number;
}

/** Risultato query navigazionale */
export interface GraphQueryResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** Se BFS/DFS ha raggiunto il limite profondità */
  truncated: boolean;
}

/** Panoramica del grafo */
export interface GraphOverview {
  totalEdges: number;
  byEntityType: Record<EntityType, number>;
  byRelation: Record<RelationType, number>;
  lastUpdated: string;
}

/** Vicini di un nodo */
export interface NodeNeighbors {
  node: { type: EntityType; id: string };
  outgoing: GraphEdge[];
  incoming: GraphEdge[];
  totalConnections: number;
}

// ---------------------------------------------------------------------------
// Costanti
// ---------------------------------------------------------------------------

/** Entity types validi */
const VALID_ENTITY_TYPES: readonly EntityType[] = [
  'adr', 'knowledge', 'bug', 'incident', 'metric', 'secret', 'session',
];

/** Relation types validi */
const VALID_RELATION_TYPES: readonly RelationType[] = [
  'depends_on', 'supersedes', 'relates_to', 'caused_bug', 'fixes', 'implements', 'references',
];

/** Peso minimo consentito */
const MIN_WEIGHT = 0.0;

/** Peso massimo consentito */
const MAX_WEIGHT = 10.0;

/** Peso di default */
const DEFAULT_WEIGHT = 1.0;

/** Profondità massima di default */
const DEFAULT_MAX_DEPTH = 3;

/** Profondità massima assoluta */
const ABSOLUTE_MAX_DEPTH = 10;

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

/**
 * Crea la tabella `graph_edges` e gli indici se non esistono.
 * Lazy schema init: chiamata da ogni funzione pubblica.
 * Corrisponde alla migrazione 014_create_graph_edges.sql.
 */
export function ensureGraphSchema(): void {
  const db = getDatabase();

  db.exec(`
    CREATE TABLE IF NOT EXISTS graph_edges (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      source_type     TEXT NOT NULL CHECK(source_type IN ('adr','knowledge','bug','incident','metric','secret','session')),
      source_id       TEXT NOT NULL,
      target_type     TEXT NOT NULL CHECK(target_type IN ('adr','knowledge','bug','incident','metric','secret','session')),
      target_id       TEXT NOT NULL,
      relation        TEXT NOT NULL CHECK(relation IN (
                          'depends_on',
                          'supersedes',
                          'relates_to',
                          'caused_bug',
                          'fixes',
                          'implements',
                          'references'
                      )),
      weight          REAL NOT NULL DEFAULT 1.0,
      description     TEXT,
      created_by      TEXT,
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      metadata        TEXT DEFAULT '{}',
      UNIQUE(source_type, source_id, target_type, target_id, relation)
    )
  `);

  // Indice per query source: tutte le uscite da un nodo
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_graph_source
    ON graph_edges(source_type, source_id)
  `);

  // Indice per query target: tutti gli ingressi a un nodo
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_graph_target
    ON graph_edges(target_type, target_id)
  `);

  // Indice per filtro tipo di relazione
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_graph_relation
    ON graph_edges(relation)
  `);
}

// ---------------------------------------------------------------------------
// Validazione
// ---------------------------------------------------------------------------

/**
 * Valida un entity type. Lancia errore se non valido o non riconosciuto.
 */
function assertValidEntityType(type: string, label: string): asserts type is EntityType {
  if (!(VALID_ENTITY_TYPES as readonly string[]).includes(type)) {
    throw new Error(
      `Invalid ${label}: "${type}". Must be one of: ${VALID_ENTITY_TYPES.join(', ')}`
    );
  }
}

/**
 * Valida un relation type. Lancia errore se non valido.
 */
function assertValidRelationType(type: string): asserts type is RelationType {
  if (!(VALID_RELATION_TYPES as readonly string[]).includes(type)) {
    throw new Error(
      `Invalid relation type: "${type}". Must be one of: ${VALID_RELATION_TYPES.join(', ')}`
    );
  }
}

/**
 * Valida che source e target non siano la stessa entità (auto-referenza).
 * Lancia errore se coincidono.
 */
function assertNoSelfReference(
  sourceType: string,
  sourceId: string,
  targetType: string,
  targetId: string,
): void {
  if (sourceType === targetType && sourceId === targetId) {
    throw new Error(
      'Self-referencing edge not allowed: source and target must be different entities'
    );
  }
}

/**
 * Valida il peso di un edge. Lancia errore se fuori dal range [0.0, 10.0].
 */
function assertValidWeight(weight: number): void {
  if (typeof weight !== 'number' || isNaN(weight) || weight < MIN_WEIGHT || weight > MAX_WEIGHT) {
    throw new Error(
      `Invalid weight: ${weight}. Must be a number between ${MIN_WEIGHT} and ${MAX_WEIGHT}`
    );
  }
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

/**
 * Mappa una riga del database in un oggetto GraphEdge.
 * Parsing JSON di metadata se presente.
 */
function mapRowToGraphEdge(row: Record<string, unknown>): GraphEdge {
  return {
    id: row.id as number,
    source_type: row.source_type as EntityType,
    source_id: row.source_id as string,
    target_type: row.target_type as EntityType,
    target_id: row.target_id as string,
    relation: row.relation as RelationType,
    weight: (row.weight as number) ?? DEFAULT_WEIGHT,
    description: (row.description as string) || undefined,
    created_by: (row.created_by as string) || undefined,
    created_at: row.created_at as string,
    metadata: (row.metadata as string) || undefined,
  };
}

/**
 * Costruisce una chiave nodo univoca per set/map: "type:id"
 */
function nodeKey(type: string, id: string): string {
  return `${type}:${id}`;
}

/**
 * Prepara una clausola SQL di filtro per relation type (IN ? placeholders).
 * Ritorna { sqlClause, params } da spalmare nella query.
 */
function buildRelationFilterClause(
  prefix: string,
  relationFilter?: string[],
): { clause: string; params: unknown[] } {
  if (!relationFilter || relationFilter.length === 0) {
    return { clause: '', params: [] };
  }
  const placeholders = relationFilter.map(() => '?').join(',');
  return {
    clause: ` AND ${prefix}relation IN (${placeholders})`,
    params: [...relationFilter],
  };
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

/** Opzioni per addEdge */
export interface AddEdgeOptions {
  weight?: number;
  description?: string;
  createdBy?: string;
  metadata?: string;
}

/**
 * Aggiunge un edge diretto tra due entità del grafo.
 *
 * Esegue validazione: entity types, relation type, no self-reference,
 * weight range. Se l'edge esiste già (UNIQUE constraint), lancia errore.
 *
 * @param sourceType - Tipo di entità sorgente
 * @param sourceId - ID dell'entità sorgente
 * @param targetType - Tipo di entità target
 * @param targetId - ID dell'entità target
 * @param relation - Tipo di relazione
 * @param options - Opzioni aggiuntive (weight, description, createdBy, metadata)
 * @returns L'edge creato (GraphEdge completo)
 * @throws Error se validazione fallisce o UNIQUE constraint violato
 */
export function addEdge(
  sourceType: string,
  sourceId: string,
  targetType: string,
  targetId: string,
  relation: string,
  options?: AddEdgeOptions,
): GraphEdge {
  const db = getDatabase();
  ensureGraphSchema();

  // ── Validazione ───────────────────────────────
  assertValidEntityType(sourceType, 'source_type');
  assertValidEntityType(targetType, 'target_type');
  assertValidRelationType(relation);
  assertNoSelfReference(sourceType, sourceId, targetType, targetId);

  const weight = options?.weight ?? DEFAULT_WEIGHT;
  assertValidWeight(weight);

  const description = options?.description ?? null;
  const createdBy = options?.createdBy ?? null;
  const metadata = options?.metadata ?? '{}';

  // ── Inserimento ───────────────────────────────
  try {
    const result = db.prepare(`
      INSERT INTO graph_edges
        (source_type, source_id, target_type, target_id, relation, weight, description, created_by, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(sourceType, sourceId, targetType, targetId, relation, weight, description, createdBy, metadata);

    const row = db.prepare('SELECT * FROM graph_edges WHERE id = ?').get(
      result.lastInsertRowid,
    ) as Record<string, unknown>;

    return mapRowToGraphEdge(row);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);

    if (errMsg.includes('UNIQUE constraint')) {
      throw new Error(
        `Edge already exists: ${sourceType}:${sourceId} ─[${relation}]→ ${targetType}:${targetId}`
      );
    }

    console.error(`[db-graph] addEdge failed: ${errMsg}`);
    throw new Error(`Failed to add edge: ${errMsg}`, { cause: err });
  }
}

/**
 * Rimuove un edge identificato da source, target e relation.
 *
 * @param sourceType - Tipo di entità sorgente
 * @param sourceId - ID dell'entità sorgente
 * @param targetType - Tipo di entità target
 * @param targetId - ID dell'entità target
 * @param relation - Tipo di relazione
 * @returns true se l'edge è stato rimosso, false se non trovato
 */
export function removeEdge(
  sourceType: string,
  sourceId: string,
  targetType: string,
  targetId: string,
  relation: string,
): boolean {
  const db = getDatabase();
  ensureGraphSchema();

  assertValidEntityType(sourceType, 'source_type');
  assertValidEntityType(targetType, 'target_type');
  assertValidRelationType(relation);

  const result = db.prepare(`
    DELETE FROM graph_edges
    WHERE source_type = ?
      AND source_id = ?
      AND target_type = ?
      AND target_id = ?
      AND relation = ?
  `).run(sourceType, sourceId, targetType, targetId, relation);

  return result.changes > 0;
}

// ---------------------------------------------------------------------------
// Query — Vicini
// ---------------------------------------------------------------------------

/** Opzioni per getNeighbors */
export interface NeighborsOptions {
  /** Filtra per tipi di relazione (opzionale, default: tutti) */
  relationFilter?: string[];
}

/**
 * Restituisce tutti i vicini (outgoing + incoming) di un nodo.
 *
 * I vicini outgoing sono archi dove il nodo è source.
 * I vicini incoming sono archi dove il nodo è target.
 *
 * @param type - Tipo di entità del nodo
 * @param id - ID del nodo
 * @param options - Opzioni di filtro (relationFilter)
 * @returns NodeNeighbors con archi outgoing e incoming
 */
export function getNeighbors(
  type: string,
  id: string,
  options?: NeighborsOptions,
): NodeNeighbors {
  const db = getDatabase();
  ensureGraphSchema();

  assertValidEntityType(type, 'type');

  // ── Outgoing: edges dove il nodo è source ─────
  let outgoingSql = 'SELECT * FROM graph_edges WHERE source_type = ? AND source_id = ?';
  const outgoingParams: unknown[] = [type, id];

  if (options?.relationFilter && options.relationFilter.length > 0) {
    const { clause, params } = buildRelationFilterClause('', options.relationFilter);
    outgoingSql += clause;
    outgoingParams.push(...params);
  }
  outgoingSql += ' ORDER BY relation, target_type, target_id';

  // ── Incoming: edges dove il nodo è target ─────
  let incomingSql = 'SELECT * FROM graph_edges WHERE target_type = ? AND target_id = ?';
  const incomingParams: unknown[] = [type, id];

  if (options?.relationFilter && options.relationFilter.length > 0) {
    const { clause, params } = buildRelationFilterClause('', options.relationFilter);
    incomingSql += clause;
    incomingParams.push(...params);
  }
  incomingSql += ' ORDER BY relation, source_type, source_id';

  // ── Esecuzione ────────────────────────────────
  const outgoing = (db.prepare(outgoingSql).all(...outgoingParams) as Record<string, unknown>[]);
  const incoming = (db.prepare(incomingSql).all(...incomingParams) as Record<string, unknown>[]);

  return {
    node: { type: type as EntityType, id },
    outgoing: outgoing.map(mapRowToGraphEdge),
    incoming: incoming.map(mapRowToGraphEdge),
    totalConnections: outgoing.length + incoming.length,
  };
}

// ---------------------------------------------------------------------------
// Query — Navigazione BFS/DFS
// ---------------------------------------------------------------------------

/** Opzioni per queryGraph */
export interface GraphQueryOptions {
  /** Direzione di navigazione (default: 'both') */
  direction?: 'outgoing' | 'incoming' | 'both';
  /** Filtra per tipi di relazione (opzionale) */
  relationFilter?: string[];
  /** Profondità massima (default: 3, max: 10) */
  maxDepth?: number;
  /** Algoritmo: 'bfs' (breadth-first) o 'dfs' (depth-first, default: 'bfs') */
  algorithm?: 'bfs' | 'dfs';
}

/**
 * Naviga il grafo a partire da un nodo usando BFS o DFS.
 *
 * BFS (default): breadth-first, garantisce percorso minimo in termini
 *   di numero di archi. Usa una queue esplicita.
 * DFS: depth-first, usa meno memoria ma non garantisce percorso minimo.
 *   Usa uno stack (LIFO).
 *
 * @param type - Tipo dell'entità di partenza
 * @param id - ID dell'entità di partenza
 * @param options - Opzioni di navigazione
 * @returns GraphQueryResult con nodi visitati, archi trovati, flag truncated
 */
export function queryGraph(
  type: string,
  id: string,
  options?: GraphQueryOptions,
): GraphQueryResult {
  const db = getDatabase();
  ensureGraphSchema();

  assertValidEntityType(type, 'type');

  const direction = options?.direction ?? 'both';
  const maxDepth = Math.min(options?.maxDepth ?? DEFAULT_MAX_DEPTH, ABSOLUTE_MAX_DEPTH);
  const algorithm = options?.algorithm ?? 'bfs';
  const relationFilter = options?.relationFilter;

  // ── Preparazione strutture dati ────────────────
  const visitedNodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];
  let truncated = false;

  const startKey = nodeKey(type, id);
  visitedNodes.set(startKey, { type: type as EntityType, id, outDegree: 0, inDegree: 0 });

  // Container: BFS usa queue (shift), DFS usa stack (pop)
  type QueueItem = { type: EntityType; id: string; depth: number };
  const container: QueueItem[] = [{ type: type as EntityType, id, depth: 0 }];

  // ── Helper: processa un gruppo di archi ────────
  const processEdges = (
    edgeRows: Record<string, unknown>[],
    getNeighbor: (e: GraphEdge) => { type: EntityType; id: string },
    currentDepth: number,
  ): void => {
    for (const row of edgeRows) {
      const edge = mapRowToGraphEdge(row);
      edges.push(edge);

      const neighbor = getNeighbor(edge);
      const nKey = nodeKey(neighbor.type, neighbor.id);

      if (!visitedNodes.has(nKey)) {
        visitedNodes.set(nKey, {
          type: neighbor.type,
          id: neighbor.id,
          outDegree: 0,
          inDegree: 0,
        });

        if (currentDepth + 1 < maxDepth) {
          container.push({ type: neighbor.type, id: neighbor.id, depth: currentDepth + 1 });
        } else {
          truncated = true;
        }
      }
    }
  };

  // ── Navigazione ─────────────────────────────────
  while (container.length > 0) {
    const current = algorithm === 'bfs' ? container.shift()! : container.pop()!;

    // Naviga outgoing: source_type/source_id = current
    if (direction === 'outgoing' || direction === 'both') {
      let sql = 'SELECT * FROM graph_edges WHERE source_type = ? AND source_id = ?';
      const params: unknown[] = [current.type, current.id];

      if (relationFilter && relationFilter.length > 0) {
        const { clause, params: filterParams } = buildRelationFilterClause('', relationFilter);
        sql += clause;
        params.push(...filterParams);
      }

      try {
        const rows = db.prepare(sql).all(...params) as Record<string, unknown>[];
        processEdges(rows, (e) => ({ type: e.target_type, id: e.target_id }), current.depth);
      } catch (err) {
        console.error(`[db-graph] queryGraph outgoing error: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // Naviga incoming: target_type/target_id = current
    if (direction === 'incoming' || direction === 'both') {
      let sql = 'SELECT * FROM graph_edges WHERE target_type = ? AND target_id = ?';
      const params: unknown[] = [current.type, current.id];

      if (relationFilter && relationFilter.length > 0) {
        const { clause, params: filterParams } = buildRelationFilterClause('', relationFilter);
        sql += clause;
        params.push(...filterParams);
      }

      try {
        const rows = db.prepare(sql).all(...params) as Record<string, unknown>[];
        processEdges(rows, (e) => ({ type: e.source_type, id: e.source_id }), current.depth);
      } catch (err) {
        console.error(`[db-graph] queryGraph incoming error: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  // ── Calcolo degree per ogni nodo ────────────────
  for (const edge of edges) {
    const sKey = nodeKey(edge.source_type, edge.source_id);
    const tKey = nodeKey(edge.target_type, edge.target_id);

    const src = visitedNodes.get(sKey);
    if (src) src.outDegree++;

    const tgt = visitedNodes.get(tKey);
    if (tgt) tgt.inDegree++;
  }

  return {
    nodes: Array.from(visitedNodes.values()),
    edges,
    truncated,
  };
}

// ---------------------------------------------------------------------------
// Query — Entità correlate (collegate direttamente)
// ---------------------------------------------------------------------------

/** Opzioni per getRelated */
export interface RelatedOptions {
  /** Filtra per tipi di relazione (opzionale) */
  relationFilter?: string[];
  /** Profondità massima (default: 1, solo diretti) */
  depth?: number;
}

/**
 * Restituisce le entità collegate a un'entità (per archi diretti o a
 * profondità limitata). A differenza di queryGraph, non torna il nodo
 * di partenza nei risultati.
 *
 * @param type - Tipo dell'entità
 * @param id - ID dell'entità
 * @param options - Opzioni: relationFilter, depth
 * @returns GraphQueryResult senza il nodo di partenza
 */
export function getRelated(
  type: string,
  id: string,
  options?: RelatedOptions,
): GraphQueryResult {
  const maxDepth = Math.min(options?.depth ?? 1, ABSOLUTE_MAX_DEPTH);

  // Usa queryGraph internamente con BFS, profondità limitata, 'both' direction
  const result = queryGraph(type, id, {
    direction: 'both',
    relationFilter: options?.relationFilter,
    maxDepth,
    algorithm: 'bfs',
  });

  // Filtra il nodo di partenza dai nodi risultato
  const startKey = nodeKey(type, id);
  return {
    nodes: result.nodes.filter((n) => nodeKey(n.type, n.id) !== startKey),
    edges: result.edges,
    truncated: result.truncated,
  };
}

// ---------------------------------------------------------------------------
// Query — Path finding (BFS shortest path)
// ---------------------------------------------------------------------------

/** Opzioni per findPath */
export interface PathOptions {
  /** Profondità massima di ricerca (default: 6, max: 15) */
  maxDepth?: number;
  /** Filtra per tipi di relazione consentiti (opzionale) */
  relationFilter?: string[];
}

/** Risultato path finding */
export interface PathResult {
  /** Array di edge che compongono il percorso */
  path: GraphEdge[];
  /** true se il percorso è stato trovato */
  found: boolean;
}

/**
 * Trova il percorso più breve tra due entità usando BFS (breadth-first).
 *
 * L'algoritmo esplora il grafo in ampiezza partendo da source, memorizza
 * per ogni nodo visitato il predecessor (l'edge che lo ha raggiunto).
 * Quando raggiunge target, ricostruisce il percorso all'indietro.
 *
 * @param sourceType - Tipo entità sorgente
 * @param sourceId - ID entità sorgente
 * @param targetType - Tipo entità target
 * @param targetId - ID entità target
 * @param options - Opzioni: maxDepth (default: 6, max: 15), relationFilter
 * @returns PathResult con gli edge del percorso e found flag
 */
export function findPath(
  sourceType: string,
  sourceId: string,
  targetType: string,
  targetId: string,
  options?: PathOptions,
): PathResult {
  const db = getDatabase();
  ensureGraphSchema();

  assertValidEntityType(sourceType, 'source_type');
  assertValidEntityType(targetType, 'target_type');

  const maxDepth = Math.min(options?.maxDepth ?? 6, 15);
  const relationFilter = options?.relationFilter;
  const targetKey = nodeKey(targetType, targetId);

  // BFS: queue di nodi da visitare
  type BfsItem = { type: EntityType; id: string; depth: number };
  const queue: BfsItem[] = [{ type: sourceType as EntityType, id: sourceId, depth: 0 }];

  // Mappa: nodeKey → { from: edge che ha portato qui, fromKey: nodeKey del predecessor }
  const predecessors = new Map<string, { edge: GraphEdge; fromKey: string }>();
  const visited = new Set<string>();
  const startKey = nodeKey(sourceType, sourceId);
  visited.add(startKey);

  // ── BFS loop ────────────────────────────────────
  while (queue.length > 0) {
    const current = queue.shift()!;

    if (current.depth >= maxDepth) continue;

    // Esplora outgoing
    let outSql = 'SELECT * FROM graph_edges WHERE source_type = ? AND source_id = ?';
    const outParams: unknown[] = [current.type, current.id];
    if (relationFilter && relationFilter.length > 0) {
      const { clause, params } = buildRelationFilterClause('', relationFilter);
      outSql += clause;
      outParams.push(...params);
    }

    const outgoingRows = db.prepare(outSql).all(...outParams) as Record<string, unknown>[];
    for (const row of outgoingRows) {
      const edge = mapRowToGraphEdge(row);
      const nKey = nodeKey(edge.target_type, edge.target_id);

      if (!visited.has(nKey)) {
        visited.add(nKey);
        predecessors.set(nKey, { edge, fromKey: nodeKey(current.type, current.id) });

        if (nKey === targetKey) {
          // Trovato! Ricostruisci percorso
          return reconstructPath(predecessors, startKey, targetKey);
        }

        queue.push({ type: edge.target_type, id: edge.target_id, depth: current.depth + 1 });
      }
    }

    // Esplora incoming
    let inSql = 'SELECT * FROM graph_edges WHERE target_type = ? AND target_id = ?';
    const inParams: unknown[] = [current.type, current.id];
    if (relationFilter && relationFilter.length > 0) {
      const { clause, params } = buildRelationFilterClause('', relationFilter);
      inSql += clause;
      inParams.push(...params);
    }

    const incomingRows = db.prepare(inSql).all(...inParams) as Record<string, unknown>[];
    for (const row of incomingRows) {
      const edge = mapRowToGraphEdge(row);
      const nKey = nodeKey(edge.source_type, edge.source_id);

      if (!visited.has(nKey)) {
        visited.add(nKey);
        predecessors.set(nKey, { edge, fromKey: nodeKey(current.type, current.id) });

        if (nKey === targetKey) {
          return reconstructPath(predecessors, startKey, targetKey);
        }

        queue.push({ type: edge.source_type, id: edge.source_id, depth: current.depth + 1 });
      }
    }
  }

  // Percorso non trovato
  return { path: [], found: false };
}

/**
 * Ricostruisce il percorso da startKey a targetKey usando la mappa
 * dei predecessor (reverse direction: target → source).
 *
 * NON accetta più `lastEdge` come parametro: la mappa `predecessors`
 * contiene già l'edge che porta a targetKey, quindi passarlo
 * separatamente causava la duplicazione dell'ultimo edge nel percorso.
 */
function reconstructPath(
  predecessors: Map<string, { edge: GraphEdge; fromKey: string }>,
  startKey: string,
  targetKey: string,
): PathResult {
  const path: GraphEdge[] = [];
  let currentKey = targetKey;

  // Risali fino a startKey
  while (currentKey !== startKey) {
    const pred = predecessors.get(currentKey);
    if (!pred) break;
    path.unshift(pred.edge);
    currentKey = pred.fromKey;
  }

  return { path, found: path.length > 0 };
}

// ---------------------------------------------------------------------------
// Auto-link
// ---------------------------------------------------------------------------

/** Opzioni per autoLink */
export interface AutoLinkOptions {
  /** Soglia di matching (riservato per futuro uso semantico, default: 0.7) */
  threshold?: number;
  /** Massimo link da creare per chiamata (default: 5) */
  maxLinks?: number;
}

/** Risultato auto-link */
export interface AutoLinkResult {
  linksCreated: number;
  edges: GraphEdge[];
}

/**
 * Auto-collega un'entità ad altre per similarità basata su identificatore.
 *
 * Fase corrente (V2b): matching semplice — cerca tutte le entità nel grafo
 * il cui source_id o target_id contiene lo stesso identificatore di base
 * del nodo dato (es. stesso numero numerico). Per ogni candidato non
 * già direttamente connesso, crea un edge 'references' con weight 0.7.
 *
 * Fase futura (V2e): verrà aggiunta similarità semantica vera tramite
 * embedding vettoriali (sqlite-vec).
 *
 * @param type - Tipo dell'entità da auto-linkare
 * @param id - ID dell'entità da auto-linkare
 * @param options - Opzioni: threshold, maxLinks
 * @returns AutoLinkResult con conteggio e edges creati
 */
export function autoLink(
  type: string,
  id: string,
  options?: AutoLinkOptions,
): AutoLinkResult {
  const db = getDatabase();
  ensureGraphSchema();

  assertValidEntityType(type, 'type');

  const maxLinks = options?.maxLinks ?? 5;
  const createdEdges: GraphEdge[] = [];

  // Estrai l'identificatore di base: es. da "adr_012" -> "012", da "bug_3" -> "3"
  // Supporta pattern come: "adr_012", "bug_003", "k_abc123def", "ses_uuid"
  const baseId = extractBaseIdentifier(id);
  if (!baseId) {
    console.error(`[db-graph] autoLink: could not extract base identifier from "${id}"`);
    return { linksCreated: 0, edges: [] };
  }

  // Trova le connessioni esistenti per evitare duplicati
  const existingKeys = new Set<string>();
  const existingEdges = db.prepare(`
    SELECT source_type, source_id, target_type, target_id FROM graph_edges
    WHERE (source_type = ? AND source_id = ?) OR (target_type = ? AND target_id = ?)
  `).all(type, id, type, id) as Record<string, unknown>[];

  for (const row of existingEdges) {
    // L'altra entità dell'edge (non il nodo corrente)
    if (!(row.source_type === type && row.source_id === id)) {
      existingKeys.add(nodeKey(row.source_type as string, row.source_id as string));
    }
    if (!(row.target_type === type && row.target_id === id)) {
      existingKeys.add(nodeKey(row.target_type as string, row.target_id as string));
    }
  }

  // Cerca entità candidate in graph_edges il cui ID contiene baseId
  const candidateSet = new Set<string>();

  // Cerca in source_id
  const srcCandidates = db.prepare(`
    SELECT DISTINCT source_type AS cand_type, source_id AS cand_id
    FROM graph_edges
    WHERE source_id LIKE ?
      AND NOT (source_type = ? AND source_id = ?)
  `).all(`%${baseId}%`, type, id) as Record<string, unknown>[];

  for (const row of srcCandidates) {
    candidateSet.add(nodeKey(row.cand_type as string, row.cand_id as string));
  }

  // Cerca in target_id
  const tgtCandidates = db.prepare(`
    SELECT DISTINCT target_type AS cand_type, target_id AS cand_id
    FROM graph_edges
    WHERE target_id LIKE ?
      AND NOT (target_type = ? AND target_id = ?)
  `).all(`%${baseId}%`, type, id) as Record<string, unknown>[];

  for (const row of tgtCandidates) {
    candidateSet.add(nodeKey(row.cand_type as string, row.cand_id as string));
  }

  // Filtra: solo candidati non già connessi
  const candidates = Array.from(candidateSet).filter((key) => !existingKeys.has(key));

  // Crea edges per ogni candidato (fino a maxLinks)
  let count = 0;
  for (const candidateKey of candidates) {
    if (count >= maxLinks) break;

    const sepIdx = candidateKey.indexOf(':');
    if (sepIdx === -1) continue;

    const candType = candidateKey.substring(0, sepIdx) as EntityType;
    const candId = candidateKey.substring(sepIdx + 1);

    try {
      const newEdge = addEdge(type, id, candType, candId, 'references', {
        weight: 0.7,
        createdBy: 'auto-link',
        description: `Auto-linked by base identifier matching: "${baseId}"`,
      });
      createdEdges.push(newEdge);
      count++;
    } catch (err) {
      // Ignora errori per singoli candidati (es. già connessi da altra relazione)
      console.error(`[db-graph] autoLink skipped candidate ${candidateKey}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { linksCreated: count, edges: createdEdges };
}

/**
 * Estrae un identificatore di base da un ID entità.
 * Cerca di trovare un pattern significativo (numerico o alfanumerico dopo underscore).
 *
 * Esempi:
 *   "adr_012"    → "012"
 *   "bug_003"    → "003"
 *   "k_abc123de" → "abc123de"
 *   "ses_uuid"   → restituisce l'intera stringa dopo il separatore
 *   "42"         → "42" (ID puramente numerico)
 *
 * Fallback: restituisce l'ID originale se nessun pattern è riconoscibile.
 */
function extractBaseIdentifier(id: string): string | null {
  // Pattern: anything_that_matters (es. adr_012 -> 012, prefix_abc123 -> abc123)
  const underscoreMatch = id.match(/^[a-z]+_(.+)$/i);
  if (underscoreMatch) {
    return underscoreMatch[1];
  }

  // Pattern: puramente numerico
  const numericMatch = id.match(/^\d+$/);
  if (numericMatch) {
    return numericMatch[0];
  }

  // Pattern: contiene numeri alla fine (es. "bug03" → "03")
  const trailingNums = id.match(/(\d+)$/);
  if (trailingNums) {
    return trailingNums[1];
  }

  // Fallback: ID intero (per stringhe brevi e significative)
  if (id.length <= 20 && id.length > 0) {
    return id;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Statistiche e panoramica
// ---------------------------------------------------------------------------

/**
 * Restituisce una panoramica completa del grafo: totale edges,
 * conteggio per entity_type, conteggio per relation, ultimo aggiornamento.
 *
 * @returns GraphOverview con statistiche aggregate
 */
export function getOverview(): GraphOverview {
  const db = getDatabase();
  ensureGraphSchema();

  const totalRow = db.prepare('SELECT COUNT(*) AS cnt FROM graph_edges').get() as { cnt: number };
  const totalEdges = totalRow.cnt;

  // Conteggio per entity type (source_type + target_type combinati)
  const byEntityType: Record<string, number> = {};
  for (const et of VALID_ENTITY_TYPES) {
    const row = db.prepare(`
      SELECT COUNT(*) AS cnt FROM graph_edges
      WHERE source_type = ? OR target_type = ?
    `).get(et, et) as { cnt: number };
    byEntityType[et] = row.cnt;
  }

  // Conteggio per relation
  const byRelation: Record<string, number> = {};
  for (const rel of VALID_RELATION_TYPES) {
    const row = db.prepare('SELECT COUNT(*) AS cnt FROM graph_edges WHERE relation = ?').get(rel) as {
      cnt: number;
    };
    byRelation[rel] = row.cnt;
  }

  // Ultimo aggiornamento
  const lastRow = db.prepare('SELECT MAX(created_at) AS last FROM graph_edges').get() as {
    last: string | null;
  };
  const lastUpdated = lastRow.last ?? new Date().toISOString();

  return {
    totalEdges,
    byEntityType: byEntityType as Record<EntityType, number>,
    byRelation: byRelation as Record<RelationType, number>,
    lastUpdated,
  };
}

/**
 * Restituisce statistiche dettagliate sugli edge del grafo.
 * Combina totali, distribuzione per tipo e per relazione.
 *
 * @returns Record con totali, per tipo entità, per relazione
 */
export function getEdgeStats(): {
  total: number;
  byEntityType: Record<string, number>;
  byRelation: Record<string, number>;
} {
  const db = getDatabase();
  ensureGraphSchema();

  const totalRow = db.prepare('SELECT COUNT(*) AS cnt FROM graph_edges').get() as {
    cnt: number;
  };

  // Conteggio source_type
  const byEntityType: Record<string, number> = {};
  for (const et of VALID_ENTITY_TYPES) {
    const row = db.prepare(
      'SELECT COUNT(*) AS cnt FROM graph_edges WHERE source_type = ?',
    ).get(et) as { cnt: number };
    byEntityType[et] = row.cnt;
  }

  // Conteggio per relation
  const byRelation: Record<string, number> = {};
  for (const rel of VALID_RELATION_TYPES) {
    const row = db.prepare('SELECT COUNT(*) AS cnt FROM graph_edges WHERE relation = ?').get(rel) as {
      cnt: number;
    };
    byRelation[rel] = row.cnt;
  }

  return { total: totalRow.cnt, byEntityType, byRelation };
}
