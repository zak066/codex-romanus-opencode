/**
 * resources/advisory.resource.ts
 * Resource MCP che espone le decisioni architetturali (ADR).
 * URI: tabularium://advisory
 */

import type { ResourceContent, ResourceHandler } from '../types/mcp.js';
import { parseDecisions } from '../core/decisions-parser.js';

export const advisoryResourceHandler: ResourceHandler = {
  uri: 'tabularium://advisory',
  name: 'Architectural Decisions (ADR)',
  description:
    'Registro delle decisioni architetturali prese dal team. Dati da docs/codex-romanus/decisions.md.',
  mimeType: 'application/json',

  handler: async (): Promise<ResourceContent[]> => {
    const decisionLog = await parseDecisions();

    return [
      {
        uri: 'tabularium://advisory/list',
        mimeType: 'application/json',
        text: JSON.stringify(decisionLog.decisions, null, 2),
      },
      {
        uri: 'tabularium://advisory/summary',
        mimeType: 'application/json',
        text: JSON.stringify({ total: decisionLog.total, updatedAt: decisionLog.updatedAt }, null, 2),
      },
      {
        uri: 'tabularium://advisory/latest',
        mimeType: 'application/json',
        text: JSON.stringify(
          decisionLog.decisions.length > 0
            ? decisionLog.decisions[decisionLog.decisions.length - 1]
            : {},
          null,
          2
        ),
      },
    ];
  },
};
