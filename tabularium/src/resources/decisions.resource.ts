/**
 * resources/decisions.resource.ts
 * Resource MCP per le Architecture Decision Records (PANTHEON — Fase 8).
 * URI: tabularium://decisions/{path}
 *
 * Supporta:
 * - tabularium://decisions/active       — ADR attive (proposed + accepted)
 * - tabularium://decisions/graph        — grafo completo delle dipendenze
 * - tabularium://decisions/{id}/graph   — sotto-grafo di una specifica ADR
 *
 * ADR-035: file_path viene letto dinamicamente dalla colonna `file_path`
 * nella tabella `adr_status` del database, eliminando la mappa statica
 * in adr-content.ts.
 *
 * @module resources/decisions
 */

import type { ResourceContent, ResourceHandler } from '../types/mcp.js';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  getActiveAdrs,
  listAdrsByStatus,
  ensureAdrLifecycleSchema,
} from '../core/adr-lifecycle.js';
import { getGraph, ensureDepSchema } from '../core/adr-graph.js';

// ---------------------------------------------------------------------------
// Costanti
// ---------------------------------------------------------------------------

const BASE_URI = 'tabularium://decisions';

// Pattern: tabularium://decisions/{id}/graph   (es. adr_012)
const GRAPH_URI_PATTERN = /^tabularium:\/\/decisions\/(adr_\d{3})\/graph$/i;

// Pattern: tabularium://decisions/{id}          (es. adr_005, adr_012)
const DETAIL_URI_PATTERN = /^tabularium:\/\/decisions\/(adr_\d{3})$/i;

// ---------------------------------------------------------------------------
// Resource Handler (panoramica)
// ---------------------------------------------------------------------------

/**
 * Resource handler per decisioni architetturali.
 * Il handler base restituisce una panoramica e gli endpoint disponibili.
 */
export const decisionsResourceHandler: ResourceHandler = {
  uri: BASE_URI,
  name: 'Decisions',
  description:
    'Architecture Decision Records (ADR) — active list and dependency graph',
  mimeType: 'application/json',

  handler: async (): Promise<ResourceContent[]> => {
    try {
      ensureAdrLifecycleSchema();
      const active = getActiveAdrs();
      const all = listAdrsByStatus();

      return [
        {
          uri: `${BASE_URI}/overview`,
          mimeType: 'application/json',
          text: JSON.stringify(
            {
              total_adrs: all.length,
              active_adrs: active.length,
              active_details: active.map((a) => ({
                id: a.id,
                title: a.title,
                status: a.status,
              })),
              endpoints: [
                {
                  uri: `${BASE_URI}/active`,
                  description: 'Active ADRs (proposed + accepted)',
                },
                {
                  uri: `${BASE_URI}/graph`,
                  description: 'Full dependency graph',
                },
                {
                  uri: `${BASE_URI}/{id}/graph`,
                  description: 'Dependency graph for a specific ADR (e.g. adr_012)',
                },
              ],
            },
            null,
            2
          ),
        },
      ];
    } catch {
      return [
        {
          uri: `${BASE_URI}/overview`,
          mimeType: 'application/json',
          text: JSON.stringify({
            status: 'unavailable',
            message: 'Decisions database not initialized',
          }),
        },
      ];
    }
  },
};

// ---------------------------------------------------------------------------
// URI Resolution
// ---------------------------------------------------------------------------

/**
 * Risolve un URI specifico nell'albero tabularium://decisions/.
 * Chiamato dal router centrale quando l'URI inizia con tabularium://decisions.
 *
 * @param uri - URI completo da risolvere
 * @returns Array di ResourceContent
 */
export async function resolveDecisionsUri(
  uri: string
): Promise<ResourceContent[]> {
  // Assicura che gli schemi esistano
  try {
    ensureAdrLifecycleSchema();
    ensureDepSchema();
  } catch {
    return [
      {
        uri,
        mimeType: 'application/json',
        text: JSON.stringify({
          error: 'Database not initialized. Cannot access decisions.',
        }),
      },
    ];
  }

  // ── tabularium://decisions/active ────────────
  if (uri === `${BASE_URI}/active`) {
    const active = getActiveAdrs();
    return [
      {
        uri,
        mimeType: 'application/json',
        text: JSON.stringify(
          { count: active.length, records: active },
          null,
          2
        ),
      },
    ];
  }

  // ── tabularium://decisions/graph ─────────────
  if (uri === `${BASE_URI}/graph`) {
    const graph = getGraph();
    return [
      {
        uri,
        mimeType: 'application/json',
        text: JSON.stringify(graph, null, 2),
      },
    ];
  }

  // ── tabularium://decisions/{id}/graph ────────
  const graphMatch = uri.match(GRAPH_URI_PATTERN);
  if (graphMatch) {
    const adrId = graphMatch[1].toLowerCase();
    const graph = getGraph(adrId);
    return [
      {
        uri,
        mimeType: 'application/json',
        text: JSON.stringify(graph, null, 2),
      },
    ];
  }

  // ── tabularium://decisions/{id} ──────────────
  const detailMatch = uri.match(DETAIL_URI_PATTERN);
  if (detailMatch) {
    const adrId = detailMatch[1].toLowerCase();
    return [await getAdrDetail(adrId, uri)];
  }

  // ── Fallback: restituisci panoramica ─────────
  return decisionsResourceHandler.handler();
}

// ---------------------------------------------------------------------------
// Helper: getAdrDetail
// ---------------------------------------------------------------------------

/**
 * Restituisce il dettaglio completo di una ADR, incluso il contenuto
 * del file markdown associato (se presente).
 *
 * ADR-035: file_path viene letto dalla colonna `file_path` nella tabella
 * `adr_status` del database — eliminata la dipendenza dalla mappa statica
 * in adr-content.ts. Il contenuto markdown viene letto dal filesystem
 * usando il percorso registrato, con troncamento a 100KB.
 *
 * @param adrId - ID della ADR (es. "adr_005")
 * @param uri - URI originale della richiesta
 * @returns ResourceContent con JSON strutturato
 */
async function getAdrDetail(
  adrId: string,
  uri: string
): Promise<ResourceContent> {
  // Recupera metadati dal database — ora include file_path (ADR-035)
  let title: string | null = null;
  let status: string | null = null;
  let createdAt: string | null = null;
  let updatedAt: string | null = null;
  let filePath: string | null = null;

  try {
    const allAdrs = listAdrsByStatus();
    const record = allAdrs.find(
      (a) => a.id.toLowerCase() === adrId.toLowerCase()
    );
    if (record) {
      title = record.title;
      status = record.status;
      createdAt = record.created_at;
      updatedAt = record.updated_at;
      filePath = record.file_path ?? null;  // ← dal DB (ADR-035)
    }
  } catch {
    // Database non disponibile — procedi con null
  }

  // Leggi il contenuto del file markdown se il percorso è disponibile
  let hasFile = false;
  let contentMarkdown = '';
  let contentTruncated = false;

  if (filePath) {
    const absolutePath = path.join(process.cwd(), filePath);
    try {
      const content = await readFile(absolutePath, { encoding: 'utf-8' });
      hasFile = true;

      if (content.length > 100 * 1024) {
        contentMarkdown = content.slice(0, 100 * 1024);
        contentTruncated = true;
      } else {
        contentMarkdown = content;
      }
    } catch {
      // File non trovato o non leggibile — mantieni hasFile = false
    }
  }

  return {
    uri,
    mimeType: 'application/json',
    text: JSON.stringify(
      {
        id: adrId,
        title,
        status,
        created_at: createdAt,
        updated_at: updatedAt,
        has_file: hasFile,
        file_path: filePath,  // ← dal DB, non più da adr-content.ts
        content_markdown: contentMarkdown,
        content_truncated: contentTruncated,
      },
      null,
      2
    ),
  };
}