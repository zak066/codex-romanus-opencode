/**
 * resources/graph.resource.ts
 * Resource MCP per il Knowledge Graph (V2d).
 *
 * Supporta:
 * - tabularium://graph/{type}/{id}/neighbors — Vicini di un nodo specifico
 * - tabularium://graph/overview — Panoramica completa del grafo
 *
 * Pattern seguito: messaging.resource.ts (URI_PATTERNS + resolveGraphUri).
 *
 * @module resources/graph
 */

import type { ResourceContent, ResourceHandler } from '../types/mcp.js';
import { getNeighbors, getOverview } from '../core/db-graph.js';
import type { GraphEdge } from '../core/db-graph.js';

// ---------------------------------------------------------------------------
// Patterns URI
// ---------------------------------------------------------------------------

const URI_PATTERNS = [
  {
    pattern: /^tabularium:\/\/graph\/([a-z]+)\/([a-zA-Z0-9_-]+)\/neighbors(?:\?(.+))?$/,
    handler: 'neighbors',
  },
  {
    pattern: /^tabularium:\/\/graph\/overview$/,
    handler: 'overview',
  },
];

// ---------------------------------------------------------------------------
// Resource Handler (static)
// ---------------------------------------------------------------------------

/**
 * Resource handler statico per tabularium://graph.
 * Di default restituisce la panoramica del grafo (overview).
 */
export const graphResourceHandler: ResourceHandler = {
  uri: 'tabularium://graph',
  name: 'Knowledge Graph',
  description: 'Knowledge graph edges, neighbors and overview',
  mimeType: 'application/json',

  async handler(): Promise<ResourceContent[]> {
    return handleOverview();
  },
};

// ---------------------------------------------------------------------------
// URI Resolution
// ---------------------------------------------------------------------------

/**
 * Risolve un URI specifico del knowledge graph e restituisce i contenuti.
 * Chiamato dal router centrale in resources/index.ts per URI
 * che iniziano con tabularium://graph/.
 *
 * Routing dinamico basato su URI_PATTERNS con regex matching.
 * Supporta:
 *   - tabularium://graph/{type}/{id}/neighbors?relation=depends_on
 *   - tabularium://graph/overview
 *
 * @param uri - URI completo da risolvere
 * @returns Array di ResourceContent
 * @throws Error se il pattern non è riconosciuto
 */
export async function resolveGraphUri(uri: string): Promise<ResourceContent[]> {
  for (const { pattern, handler } of URI_PATTERNS) {
    const match = uri.match(pattern);
    if (!match) continue;

    switch (handler) {
      case 'neighbors':
        // match[1] = type, match[2] = id, match[3] = queryString (opzionale)
        return handleNeighbors(match[1], match[2], match[3]);
      case 'overview':
        return handleOverview();
    }
  }

  // Nessun pattern corrisponde: errore
  throw new Error(`Graph resource not found for URI: ${uri}`);
}

// ---------------------------------------------------------------------------
// Handler interni
// ---------------------------------------------------------------------------

/**
 * Gestisce: tabularium://graph/{type}/{id}/neighbors
 *
 * Restituisce tutti i vicini (outgoing + incoming) di un nodo specifico.
 * Supporta filtro opzionale `?relation=depends_on` nella query string.
 */
function handleNeighbors(
  type: string,
  id: string,
  queryString?: string,
): ResourceContent[] {
  try {
    const params = parseQueryString(queryString ?? '');
    const relationFilter = params.relation
      ? [params.relation]
      : undefined;

    // Chiama il core layer con filtro opzionale
    const neighbors = getNeighbors(type, id, {
      ...(relationFilter ? { relationFilter } : {}),
    });

    // Combina outgoing e incoming in un unico array annotato con direction
    const neighborList = [
      ...neighbors.outgoing.map((e: GraphEdge) => ({
        type: e.target_type,
        id: e.target_id,
        relation: e.relation,
        direction: 'outgoing' as const,
        weight: e.weight,
        description: e.description ?? null,
      })),
      ...neighbors.incoming.map((e: GraphEdge) => ({
        type: e.source_type,
        id: e.source_id,
        relation: e.relation,
        direction: 'incoming' as const,
        weight: e.weight,
        description: e.description ?? null,
      })),
    ];

    // Calcola summary per relation type
    const byRelation: Record<string, number> = {};
    for (const n of neighborList) {
      byRelation[n.relation] = (byRelation[n.relation] ?? 0) + 1;
    }

    return [
      {
        uri: `tabularium://graph/${type}/${id}/neighbors`,
        mimeType: 'application/json',
        text: JSON.stringify(
          {
            node: { type, id },
            neighbors_count: neighbors.totalConnections,
            neighbors: neighborList,
            summary: {
              outgoing: neighbors.outgoing.length,
              incoming: neighbors.incoming.length,
              by_relation: byRelation,
            },
          },
          null,
          2
        ),
      },
    ];
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return [
      {
        uri: `tabularium://graph/${type}/${id}/neighbors`,
        mimeType: 'application/json',
        text: JSON.stringify({
          error: true,
          message: `Failed to retrieve neighbors: ${message}`,
          node: { type, id },
        }),
      },
    ];
  }
}

/**
 * Gestisce: tabularium://graph/overview
 *
 * Restituisce la panoramica completa del grafo: totale edges,
 * conteggio per entity type, conteggio per relation, ultimo aggiornamento.
 */
function handleOverview(): ResourceContent[] {
  try {
    const overview = getOverview();

    return [
      {
        uri: 'tabularium://graph/overview',
        mimeType: 'application/json',
        text: JSON.stringify(
          {
            total_edges: overview.totalEdges,
            by_entity_type: overview.byEntityType,
            by_relation: overview.byRelation,
            last_updated: overview.lastUpdated,
          },
          null,
          2
        ),
      },
    ];
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return [
      {
        uri: 'tabularium://graph/overview',
        mimeType: 'application/json',
        text: JSON.stringify({
          error: true,
          message: `Failed to retrieve graph overview: ${message}`,
        }),
      },
    ];
  }
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

/**
 * Parser semplice di query string.
 * Converte "?relation=depends_on" in { relation: 'depends_on' }
 *
 * @param queryString - Query string da parsare (con o senza ? iniziale)
 * @returns Record chiave-valore
 */
function parseQueryString(queryString: string): Record<string, string> {
  const params: Record<string, string> = {};

  if (!queryString) return params;

  // Rimuovi eventuale ? iniziale
  const qs = queryString.startsWith('?') ? queryString.substring(1) : queryString;

  for (const part of qs.split('&')) {
    const [key, value] = part.split('=');
    if (key && value !== undefined) {
      try {
        params[decodeURIComponent(key)] = decodeURIComponent(value);
      } catch {
        // Se la decodifica fallisce, usa il valore raw
        params[key] = value;
      }
    }
  }

  return params;
}
