/**
 * tools/graph.tool.ts
 * Tool MCP per il Knowledge Graph (V2c).
 *
 * Fornisce 6 tool per la gestione e navigazione del grafo multi-entità
 * (ADR, knowledge, bug, incident, metric, secret, session):
 *
 *   1. graph_add_edge       — Aggiunge una relazione tra due entità
 *   2. graph_remove_edge    — Rimuove una relazione esistente
 *   3. graph_query          — Naviga il grafo con BFS/DFS
 *   4. graph_get_related    — Recupera entità collegate a una data entità
 *   5. graph_auto_link      — Auto-collega entità per similarità identificatore
 *   6. graph_get_path       — Trova il percorso più breve tra due entità
 *
 * Pattern: messaging.tool.ts — ogni handler è un ToolHandler esportato
 * con name, description, inputSchema e handler async.
 *
 * @module tools/graph
 */

import type { ToolHandler, ToolResult } from '../types/mcp.js';
import {
  addEdge,
  removeEdge,
  queryGraph,
  getRelated,
  autoLink,
  findPath,
} from '../core/db-graph.js';

// ---------------------------------------------------------------------------
// Costanti di validazione
// ---------------------------------------------------------------------------

/** Entity types validi per il grafo */
const VALID_ENTITY_TYPES = [
  'adr',
  'knowledge',
  'bug',
  'incident',
  'metric',
  'secret',
  'session',
] as const;

/** Relation types validi per il grafo */
const VALID_RELATION_TYPES = [
  'depends_on',
  'supersedes',
  'relates_to',
  'caused_bug',
  'fixes',
  'implements',
  'references',
] as const;

/** Direzioni valide per la navigazione */
const VALID_DIRECTIONS = ['outgoing', 'incoming', 'both'] as const;

/** Algoritmi di navigazione validi */
const VALID_ALGORITHMS = ['bfs', 'dfs'] as const;

// ---------------------------------------------------------------------------
// Helper di validazione
// ---------------------------------------------------------------------------

/**
 * Estrae e trimma una stringa da un valore sconosciuto.
 * Restituisce null se il valore è undefined/null/dopo-trim vuoto.
 */
function validateOptionalString(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Valida che un valore sia una stringa non vuota dopo trim.
 * Errore se assente o vuota.
 */
function validateRequiredString(value: unknown, label: string): string {
  const str = validateOptionalString(value);
  if (str === null) {
    throw new Error(`VALIDATION_ERROR: "${label}" is required and must be a non-empty string`);
  }
  return str;
}

/**
 * Valida che una stringa sia un valore valido in un enum.
 */
function validateEnum<T extends string>(
  value: unknown,
  validValues: readonly T[],
  label: string,
): T {
  const str = validateRequiredString(value, label);
  const matched = validValues.find((v) => v === str);
  if (!matched) {
    throw new Error(
      `VALIDATION_ERROR: Invalid ${label}: "${str}". Must be one of: ${validValues.join(', ')}`,
    );
  }
  return matched;
}

/**
 * Valida un valore numerico opzionale.
 * Restituisce null se assente.
 */
function validateOptionalNumber(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  const num = Number(value);
  if (isNaN(num)) return null;
  return num;
}

/**
 * Valida un intero compreso in un range [min, max].
 */
function validateOptionalInt(value: unknown, min: number, max: number, label: string): number | null {
  const num = validateOptionalNumber(value);
  if (num === null) return null;
  if (!Number.isInteger(num)) {
    throw new Error(`VALIDATION_ERROR: "${label}" must be an integer, got ${typeof value}`);
  }
  if (num < min || num > max) {
    throw new Error(
      `VALIDATION_ERROR: "${label}" must be between ${min} and ${max}, got ${num}`,
    );
  }
  return num;
}

/**
 * Valida un valore numerico opzionale in un range [0.0, 10.0] per weight.
 */
function validateOptionalWeight(value: unknown): number | null {
  const num = validateOptionalNumber(value);
  if (num === null) return null;
  if (num < 0.0 || num > 10.0) {
    throw new Error(`VALIDATION_ERROR: "weight" must be between 0.0 and 10.0, got ${num}`);
  }
  return num;
}

/**
 * Valida un array opzionale di stringhe, opzionalmente contro un enum.
 */
function validateOptionalStringArray(
  value: unknown,
  label: string,
  validValues?: readonly string[],
): string[] | null {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value)) {
    throw new Error(`VALIDATION_ERROR: "${label}" must be an array, got ${typeof value}`);
  }
  const result: string[] = [];
  for (let i = 0; i < value.length; i++) {
    const item = validateOptionalString(value[i]);
    if (item === null) {
      throw new Error(`VALIDATION_ERROR: "${label}[${i}]" must be a non-empty string`);
    }
    if (validValues && !validValues.includes(item)) {
      throw new Error(
        `VALIDATION_ERROR: "${label}[${i}]" = "${item}" is not valid. Must be one of: ${validValues.join(', ')}`,
      );
    }
    result.push(item);
  }
  return result;
}

/**
 * Costruisce una risposta di successo JSON.
 */
function successResponse(data: unknown): ToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
  };
}

/**
 * Costruisce una risposta di errore JSON strutturata.
 */
function errorResponse(message: string): ToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify({ success: false, error: 'ERROR', message }, null, 2) }],
    isError: true,
  };
}

// ---------------------------------------------------------------------------
// Tool 1: graph_add_edge
// ---------------------------------------------------------------------------

/**
 * Aggiunge una relazione tra due entità del knowledge graph.
 *
 * Esegue validazione completa: entity types, relation type, weight range.
 * Chiama addEdge() dal core layer db-graph.ts.
 */
export const graphAddEdgeToolHandler: ToolHandler = {
  name: 'graph_add_edge',
  description: 'Add a relationship edge between two entities in the knowledge graph',
  inputSchema: {
    type: 'object',
    properties: {
      source_type: {
        type: 'string',
        enum: [...VALID_ENTITY_TYPES],
        description: 'Tipo di entità sorgente (adr, knowledge, bug, incident, metric, secret, session)',
      },
      source_id: {
        type: 'string',
        description: "ID dell'entità sorgente (es. adr_012, bug_001)",
      },
      target_type: {
        type: 'string',
        enum: [...VALID_ENTITY_TYPES],
        description: 'Tipo di entità target',
      },
      target_id: {
        type: 'string',
        description: "ID dell'entità target",
      },
      relation: {
        type: 'string',
        enum: [...VALID_RELATION_TYPES],
        description: "Tipo di relazione tra le due entità (depends_on, supersedes, relates_to, caused_bug, fixes, implements, references)",
      },
      weight: {
        type: 'number',
        default: 1.0,
        description: "Peso della relazione (0.0-10.0, default: 1.0 per relazioni certe)",
      },
      description: {
        type: 'string',
        description: 'Annotazione semantica opzionale',
      },
      created_by: {
        type: 'string',
        description: "Nome dell'agente che ha creato la relazione (opzionale, default: 'tool')",
      },
    },
    required: ['source_type', 'source_id', 'target_type', 'target_id', 'relation'],
  },

  async handler(args: Record<string, unknown>): Promise<ToolResult> {
    try {
      // ── Validazione ──────────────────────────────
      const sourceType = validateEnum(args.source_type, VALID_ENTITY_TYPES, 'source_type');
      const sourceId = validateRequiredString(args.source_id, 'source_id');
      const targetType = validateEnum(args.target_type, VALID_ENTITY_TYPES, 'target_type');
      const targetId = validateRequiredString(args.target_id, 'target_id');
      const relation = validateEnum(args.relation, VALID_RELATION_TYPES, 'relation');
      const weight = validateOptionalWeight(args.weight);
      const description = validateOptionalString(args.description);
      const createdBy = validateOptionalString(args.created_by);

      // ── Chiamata core ────────────────────────────
      const edge = addEdge(sourceType, sourceId, targetType, targetId, relation, {
        ...(weight !== null && { weight }),
        ...(description !== null && { description }),
        ...(createdBy !== null ? { createdBy } : { createdBy: 'tool' }),
      });

      return successResponse({ success: true, edge });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.startsWith('VALIDATION_ERROR:')) {
        return errorResponse(message.replace('VALIDATION_ERROR: ', ''));
      }
      return errorResponse(`graph_add_edge failed: ${message}`);
    }
  },
};

// ---------------------------------------------------------------------------
// Tool 2: graph_remove_edge
// ---------------------------------------------------------------------------

/**
 * Rimuove una relazione esistente dal knowledge graph.
 *
 * La rimozione avviene per combinazione univoca:
 * source_type + source_id + target_type + target_id + relation.
 */
export const graphRemoveEdgeToolHandler: ToolHandler = {
  name: 'graph_remove_edge',
  description: 'Remove a relationship edge from the knowledge graph',
  inputSchema: {
    type: 'object',
    properties: {
      source_type: {
        type: 'string',
        enum: [...VALID_ENTITY_TYPES],
        description: 'Tipo di entità sorgente',
      },
      source_id: {
        type: 'string',
        description: "ID dell'entità sorgente",
      },
      target_type: {
        type: 'string',
        enum: [...VALID_ENTITY_TYPES],
        description: 'Tipo di entità target',
      },
      target_id: {
        type: 'string',
        description: "ID dell'entità target",
      },
      relation: {
        type: 'string',
        enum: [...VALID_RELATION_TYPES],
        description: 'Tipo di relazione da rimuovere',
      },
    },
    required: ['source_type', 'source_id', 'target_type', 'target_id', 'relation'],
  },

  async handler(args: Record<string, unknown>): Promise<ToolResult> {
    try {
      // ── Validazione ──────────────────────────────
      const sourceType = validateEnum(args.source_type, VALID_ENTITY_TYPES, 'source_type');
      const sourceId = validateRequiredString(args.source_id, 'source_id');
      const targetType = validateEnum(args.target_type, VALID_ENTITY_TYPES, 'target_type');
      const targetId = validateRequiredString(args.target_id, 'target_id');
      const relation = validateEnum(args.relation, VALID_RELATION_TYPES, 'relation');

      // ── Chiamata core ────────────────────────────
      const removed = removeEdge(sourceType, sourceId, targetType, targetId, relation);

      return successResponse({
        success: removed,
        removed,
        edge: { source_type: sourceType, source_id: sourceId, target_type: targetType, target_id: targetId, relation },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.startsWith('VALIDATION_ERROR:')) {
        return errorResponse(message.replace('VALIDATION_ERROR: ', ''));
      }
      return errorResponse(`graph_remove_edge failed: ${message}`);
    }
  },
};

// ---------------------------------------------------------------------------
// Tool 3: graph_query
// ---------------------------------------------------------------------------

/**
 * Naviga il knowledge graph con BFS/DFS a partire da un'entità.
 *
 * Supporta filtri per direzione, tipo di relazione e profondità massima.
 * BFS (default) garantisce percorso minimo in numero di archi.
 */
export const graphQueryToolHandler: ToolHandler = {
  name: 'graph_query',
  description: 'Navigate the knowledge graph using BFS/DFS from a starting entity',
  inputSchema: {
    type: 'object',
    properties: {
      entity_type: {
        type: 'string',
        enum: [...VALID_ENTITY_TYPES],
        description: "Tipo di entità di partenza (adr, knowledge, bug, incident, metric, secret, session)",
      },
      entity_id: {
        type: 'string',
        description: "ID dell'entità di partenza (es. adr_012, bug_001)",
      },
      direction: {
        type: 'string',
        enum: [...VALID_DIRECTIONS],
        default: 'both',
        description: "Direzione delle relazioni da seguire: outgoing (uscenti), incoming (entranti), both (entrambe, default)",
      },
      relation_filter: {
        type: 'array',
        items: { type: 'string', enum: [...VALID_RELATION_TYPES] },
        description: 'Filtra per tipi di relazione (opzionale, default: tutte)',
      },
      max_depth: {
        type: 'integer',
        default: 3,
        minimum: 1,
        maximum: 10,
        description: 'Profondità massima di navigazione (default: 3, range: 1-10)',
      },
      algorithm: {
        type: 'string',
        enum: [...VALID_ALGORITHMS],
        default: 'bfs',
        description: "Algoritmo di navigazione: bfs (breadth-first, default) o dfs (depth-first)",
      },
    },
    required: ['entity_type', 'entity_id'],
  },

  async handler(args: Record<string, unknown>): Promise<ToolResult> {
    try {
      // ── Validazione ──────────────────────────────
      const entityType = validateEnum(args.entity_type, VALID_ENTITY_TYPES, 'entity_type');
      const entityId = validateRequiredString(args.entity_id, 'entity_id');
      const direction = validateEnum(
        args.direction ?? 'both',
        VALID_DIRECTIONS,
        'direction',
      );
      const relationFilter = validateOptionalStringArray(
        args.relation_filter,
        'relation_filter',
        VALID_RELATION_TYPES as unknown as string[],
      );
      const maxDepth = validateOptionalInt(args.max_depth, 1, 10, 'max_depth') ?? 3;
      const algorithm = validateEnum(
        args.algorithm ?? 'bfs',
        VALID_ALGORITHMS,
        'algorithm',
      );

      // ── Chiamata core ────────────────────────────
      const result = queryGraph(entityType, entityId, {
        direction,
        relationFilter: relationFilter ?? undefined,
        maxDepth,
        algorithm,
      });

      return successResponse({
        nodes: result.nodes,
        edges: result.edges,
        truncated: result.truncated,
        stats: {
          nodes_count: result.nodes.length,
          edges_count: result.edges.length,
          max_depth_reached: maxDepth,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.startsWith('VALIDATION_ERROR:')) {
        return errorResponse(message.replace('VALIDATION_ERROR: ', ''));
      }
      return errorResponse(`graph_query failed: ${message}`);
    }
  },
};

// ---------------------------------------------------------------------------
// Tool 4: graph_get_related
// ---------------------------------------------------------------------------

/**
 * Recupera tutte le entità collegate a una data entità nel grafo.
 *
 * A differenza di graph_query, non include il nodo di partenza nei risultati.
 * La profondità default è 1 (sole entità direttamente collegate).
 */
export const graphGetRelatedToolHandler: ToolHandler = {
  name: 'graph_get_related',
  description: 'Get entities related to a specific entity in the knowledge graph',
  inputSchema: {
    type: 'object',
    properties: {
      entity_type: {
        type: 'string',
        enum: [...VALID_ENTITY_TYPES],
        description: "Tipo di entità (adr, knowledge, bug, incident, metric, secret, session)",
      },
      entity_id: {
        type: 'string',
        description: "ID dell'entità di cui trovare i collegamenti",
      },
      relation_filter: {
        type: 'array',
        items: { type: 'string', enum: [...VALID_RELATION_TYPES] },
        description: 'Filtra per tipi di relazione (opzionale, default: tutte)',
      },
      depth: {
        type: 'integer',
        default: 1,
        minimum: 1,
        maximum: 10,
        description: "Profondità massima (default: 1 = solo dirette, max: 10)",
      },
    },
    required: ['entity_type', 'entity_id'],
  },

  async handler(args: Record<string, unknown>): Promise<ToolResult> {
    try {
      // ── Validazione ──────────────────────────────
      const entityType = validateEnum(args.entity_type, VALID_ENTITY_TYPES, 'entity_type');
      const entityId = validateRequiredString(args.entity_id, 'entity_id');
      const relationFilter = validateOptionalStringArray(
        args.relation_filter,
        'relation_filter',
        VALID_RELATION_TYPES as unknown as string[],
      );
      const depth = validateOptionalInt(args.depth, 1, 10, 'depth') ?? 1;

      // ── Chiamata core ────────────────────────────
      const result = getRelated(entityType, entityId, {
        relationFilter: relationFilter ?? undefined,
        depth,
      });

      return successResponse({
        related_entities: result.nodes.map((n) => ({
          type: n.type,
          id: n.id,
        })),
        edges: result.edges.map((e) => ({
          source_type: e.source_type,
          source_id: e.source_id,
          target_type: e.target_type,
          target_id: e.target_id,
          relation: e.relation,
          weight: e.weight,
        })),
        total_count: result.nodes.length,
        truncated: result.truncated,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.startsWith('VALIDATION_ERROR:')) {
        return errorResponse(message.replace('VALIDATION_ERROR: ', ''));
      }
      return errorResponse(`graph_get_related failed: ${message}`);
    }
  },
};

// ---------------------------------------------------------------------------
// Tool 5: graph_auto_link
// ---------------------------------------------------------------------------

/**
 * Auto-collega un'entità ad altre basandosi sulla similarità
 * dell'identificatore (base identifier matching).
 *
 * Trova altre entità il cui ID contiene lo stesso identificatore di base
 * e crea edge 'references' per i candidati non già direttamente connessi.
 */
export const graphAutoLinkToolHandler: ToolHandler = {
  name: 'graph_auto_link',
  description: 'Automatically create links between entities based on identifier similarity',
  inputSchema: {
    type: 'object',
    properties: {
      entity_type: {
        type: 'string',
        enum: [...VALID_ENTITY_TYPES],
        description: "Tipo di entità da analizzare (adr, knowledge, bug, incident, metric, secret, session)",
      },
      entity_id: {
        type: 'string',
        description: "ID dell'entità da auto-linkare",
      },
      threshold: {
        type: 'number',
        default: 0.75,
        description: "Soglia di similarità (0.0-1.0, default: 0.75). Valori più alti = link più precisi",
      },
      max_links: {
        type: 'integer',
        default: 5,
        minimum: 1,
        maximum: 50,
        description: "Massimo link automatici da creare per chiamata (default: 5, max: 50)",
      },
    },
    required: ['entity_type', 'entity_id'],
  },

  async handler(args: Record<string, unknown>): Promise<ToolResult> {
    try {
      // ── Validazione ──────────────────────────────
      const entityType = validateEnum(args.entity_type, VALID_ENTITY_TYPES, 'entity_type');
      const entityId = validateRequiredString(args.entity_id, 'entity_id');
      const threshold = validateOptionalNumber(args.threshold) ?? 0.75;
      const maxLinks = validateOptionalInt(args.max_links, 1, 50, 'max_links') ?? 5;

      // ── Chiamata core ────────────────────────────
      const result = autoLink(entityType, entityId, {
        threshold,
        maxLinks,
      });

      return successResponse({
        linksCreated: result.linksCreated,
        edges: result.edges.map((e) => ({
          source_type: e.source_type,
          source_id: e.source_id,
          target_type: e.target_type,
          target_id: e.target_id,
          relation: e.relation,
          weight: e.weight,
          description: e.description,
        })),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.startsWith('VALIDATION_ERROR:')) {
        return errorResponse(message.replace('VALIDATION_ERROR: ', ''));
      }
      return errorResponse(`graph_auto_link failed: ${message}`);
    }
  },
};

// ---------------------------------------------------------------------------
// Tool 6: graph_get_path
// ---------------------------------------------------------------------------

/**
 * Trova il percorso più breve tra due entità del grafo usando BFS.
 *
 * L'algoritmo esplora il grafo in ampiezza partendo da source,
 * memorizza i predecessor per ogni nodo visitato, e ricostruisce
 * il percorso all'indietro quando target viene raggiunto.
 */
export const graphGetPathToolHandler: ToolHandler = {
  name: 'graph_get_path',
  description: 'Find the shortest path between two entities in the knowledge graph',
  inputSchema: {
    type: 'object',
    properties: {
      source_type: {
        type: 'string',
        enum: [...VALID_ENTITY_TYPES],
        description: "Tipo di entità di partenza",
      },
      source_id: {
        type: 'string',
        description: "ID dell'entità di partenza",
      },
      target_type: {
        type: 'string',
        enum: [...VALID_ENTITY_TYPES],
        description: "Tipo di entità di arrivo",
      },
      target_id: {
        type: 'string',
        description: "ID dell'entità di arrivo",
      },
      max_depth: {
        type: 'integer',
        default: 5,
        minimum: 1,
        maximum: 10,
        description: "Profondità massima di ricerca (default: 5, range: 1-10)",
      },
    },
    required: ['source_type', 'source_id', 'target_type', 'target_id'],
  },

  async handler(args: Record<string, unknown>): Promise<ToolResult> {
    try {
      // ── Validazione ──────────────────────────────
      const sourceType = validateEnum(args.source_type, VALID_ENTITY_TYPES, 'source_type');
      const sourceId = validateRequiredString(args.source_id, 'source_id');
      const targetType = validateEnum(args.target_type, VALID_ENTITY_TYPES, 'target_type');
      const targetId = validateRequiredString(args.target_id, 'target_id');
      const maxDepth = validateOptionalInt(args.max_depth, 1, 10, 'max_depth') ?? 5;

      // ── Chiamata core ────────────────────────────
      const result = findPath(sourceType, sourceId, targetType, targetId, {
        maxDepth,
      });

      return successResponse({
        found: result.found,
        path_length: result.path.length,
        path: result.path.map((e, idx) => ({
          step: idx,
          source_type: e.source_type,
          source_id: e.source_id,
          target_type: e.target_type,
          target_id: e.target_id,
          relation: e.relation,
          weight: e.weight,
        })),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.startsWith('VALIDATION_ERROR:')) {
        return errorResponse(message.replace('VALIDATION_ERROR: ', ''));
      }
      return errorResponse(`graph_get_path failed: ${message}`);
    }
  },
};
