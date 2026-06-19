/**
 * tools/decision.tool.ts
 * Tool MCP per la gestione delle decisioni architetturali (ADR).
 * Supporta lettura, ricerca e statistiche.
 */

import type { ToolHandler, ToolResult } from '../types/mcp.js';
import { parseDecisions } from '../core/decisions-parser.js';

export const decisionToolHandler: ToolHandler = {
  name: 'decision_log',
  description:
    'Consulta il registro delle decisioni architetturali (ADR) del progetto Codex Romanus.',
  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['list', 'search', 'latest', 'by-agent', 'stats'],
        description: 'Azione: list (tutte), search (per testo), latest (ultima), by-agent, stats',
      },
      query: {
        type: 'string',
        description: 'Query di ricerca (per action=search)',
      },
      agent: {
        type: 'string',
        description: "Nome dell'agente (per action=by-agent)",
      },
    },
    required: ['action'],
  },

  handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
    const action = String(args.action ?? 'list');
    const decisionLog = await parseDecisions();

    switch (action) {
      case 'list':
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ decisions: decisionLog.decisions, total: decisionLog.total }, null, 2),
            },
          ],
        };

      case 'search': {
        const query = String(args.query ?? '').toLowerCase();
        const results = decisionLog.decisions.filter(
          (d) =>
            d.title.toLowerCase().includes(query) ||
            d.decision.toLowerCase().includes(query) ||
            d.motivation.toLowerCase().includes(query)
        );
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ query, count: results.length, decisions: results }, null, 2),
            },
          ],
        };
      }

      case 'latest':
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                decisionLog.decisions.length > 0
                  ? decisionLog.decisions[decisionLog.decisions.length - 1]
                  : { message: 'No decisions recorded' },
                null,
                2
              ),
            },
          ],
        };

      case 'by-agent': {
        const agent = String(args.agent ?? '');
        const results = decisionLog.decisions.filter(
          (d) => d.agent.toLowerCase() === agent.toLowerCase()
        );
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ agent, count: results.length, decisions: results }, null, 2),
            },
          ],
        };
      }

      case 'stats':
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  total: decisionLog.total,
                  updatedAt: decisionLog.updatedAt,
                  agents: [...new Set(decisionLog.decisions.map((d) => d.agent))].sort(),
                },
                null,
                2
              ),
            },
          ],
        };

      default:
        return {
          content: [{ type: 'text', text: `Unknown action: ${action}` }],
          isError: true,
        };
    }
  },
};
