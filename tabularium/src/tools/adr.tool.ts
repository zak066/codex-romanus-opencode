/**
 * tools/adr.tool.ts
 * Tool MCP per il ciclo di vita delle ADR (PANTHEON — Fase 8.1).
 *
 * Azioni:
 *   - register:    registra una nuova ADR con stato 'proposed'
 *   - transition:  transisce una ADR a un nuovo stato
 *   - list:        elenca ADR opzionalmente filtrate per stato
 *   - active:      elenca solo ADR attive (proposed + accepted)
 *
 * @module tools/adr
 */

import type { ToolHandler, ToolResult } from '../types/mcp.js';
import {
  registerAdr,
  transitionAdrStatus,
  listAdrsByStatus,
  getActiveAdrs,
  ensureAdrLifecycleSchema,
} from '../core/adr-lifecycle.js';
import { addDependency, ensureDepSchema } from '../core/adr-graph.js';

// ---------------------------------------------------------------------------
// Definizione del Tool
// ---------------------------------------------------------------------------

/**
 * Tool: decision_lifecycle
 * Gestisce il ciclo di vita delle ADR e le dipendenze tra decisioni.
 */
export const decisionLifecycleToolHandler: ToolHandler = {
  name: 'decision_lifecycle',
  description:
    'Gestisce il ciclo di vita delle ADR e le dipendenze tra decisioni architetturali',
  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['register', 'transition', 'list', 'active', 'add_dependency'],
        description:
          'register (nuova ADR), transition (cambio stato), list (per stato), active (attive), add_dependency (aggiunge arco grafo)',
      },
      adrId: {
        type: 'string',
        description: "ID ADR (formato: adr_NNN, es. 'adr_012')",
      },
      title: {
        type: 'string',
        description: 'Titolo della ADR (obbligatorio per action=register)',
      },
      newStatus: {
        type: 'string',
        enum: ['proposed', 'accepted', 'deprecated', 'superseded'],
        description: 'Nuovo stato (obbligatorio per action=transition)',
      },
      supersededBy: {
        type: 'string',
        description:
          "ID ADR che sostituisce (richiesto per transition → 'superseded')",
      },
      status: {
        type: 'string',
        description: "Filtro per stato (opzionale per action=list, default: tutti)",
      },
      // Parametri per dipendenze
      fromAdr: {
        type: 'string',
        description:
          'ADR sorgente della dipendenza (obbligatorio per action=add_dependency)',
      },
      toAdr: {
        type: 'string',
        description:
          'ADR target della dipendenza (obbligatorio per action=add_dependency)',
      },
      relationType: {
        type: 'string',
        enum: ['depends_on', 'supersedes', 'related_to'],
        description: 'Tipo di relazione (obbligatorio per action=add_dependency)',
      },
      description: {
        type: 'string',
        description: 'Descrizione/annotazione della dipendenza (opzionale)',
      },
    },
    required: ['action'],
  },

  handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
    const action = String(args.action ?? '');

    try {
      // Assicura che gli schemi esistano sempre
      ensureAdrLifecycleSchema();
      ensureDepSchema();

      switch (action) {
        // ── register ──────────────────────────────
        case 'register': {
          const adrId = String(args.adrId ?? '');
          const title = String(args.title ?? '');

          if (!adrId || !title) {
            return {
              content: [
                {
                  type: 'text',
                  text: 'Error: "adrId" and "title" are required for action=register',
                },
              ],
              isError: true,
            };
          }

          const result = registerAdr(adrId, title);
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(result, null, 2),
              },
            ],
          };
        }

        // ── transition ────────────────────────────
        case 'transition': {
          const adrId = String(args.adrId ?? '');
          const newStatus = String(args.newStatus ?? '');
          const supersededBy = args.supersededBy
            ? String(args.supersededBy)
            : undefined;

          if (!adrId || !newStatus) {
            return {
              content: [
                {
                  type: 'text',
                  text: 'Error: "adrId" and "newStatus" are required for action=transition',
                },
              ],
              isError: true,
            };
          }

          const result = transitionAdrStatus(adrId, newStatus, supersededBy);
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(result, null, 2),
              },
            ],
          };
        }

        // ── list ──────────────────────────────────
        case 'list': {
          const statusFilter = args.status ? String(args.status) : undefined;
          const results = listAdrsByStatus(statusFilter);

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  { count: results.length, records: results },
                  null,
                  2
                ),
              },
            ],
          };
        }

        // ── active ────────────────────────────────
        case 'active': {
          const results = getActiveAdrs();

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  { count: results.length, records: results },
                  null,
                  2
                ),
              },
            ],
          };
        }

        // ── add_dependency ────────────────────────
        case 'add_dependency': {
          const fromAdr = String(args.fromAdr ?? '');
          const toAdr = String(args.toAdr ?? '');
          const relationType = String(args.relationType ?? '');
          const depDescription = args.description
            ? String(args.description)
            : undefined;

          if (!fromAdr || !toAdr || !relationType) {
            return {
              content: [
                {
                  type: 'text',
                  text: 'Error: "fromAdr", "toAdr", and "relationType" are required for action=add_dependency',
                },
              ],
              isError: true,
            };
          }

          addDependency(fromAdr, toAdr, relationType, depDescription);

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    success: true,
                    message: `Dependency added: ${fromAdr} ${relationType} ${toAdr}`,
                    from: fromAdr,
                    to: toAdr,
                    type: relationType,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        // ── default ──────────────────────────────
        default:
          return {
            content: [
              {
                type: 'text',
                text: `Unknown action: "${action}". Valid actions: register, transition, list, active, add_dependency`,
              },
            ],
            isError: true,
          };
      }
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
};
