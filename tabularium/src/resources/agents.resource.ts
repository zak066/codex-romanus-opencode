/**
 * resources/agents.resource.ts
 * Resource MCP che espone la configurazione degli agenti.
 * URI: tabularium://agents
 *
 * @module resources/agents
 */

import type { ResourceContent, ResourceHandler } from '../types/mcp.js';
import { getAllAgents, getPrimaryAgent } from '../core/agent-reader.js';

export const agentResourceHandler: ResourceHandler = {
  uri: 'tabularium://agents',
  name: 'Agents Configuration',
  description:
    'Configurazione completa degli agenti Codex Romanus da opencode.json. Include nome, ruolo, modello, permessi e skill.',
  mimeType: 'application/json',

  handler: async (): Promise<ResourceContent[]> => {
    const agents = await getAllAgents();
    const primary = await getPrimaryAgent();

    return [
      {
        uri: 'tabularium://agents/list',
        mimeType: 'application/json',
        text: JSON.stringify(agents, null, 2),
      },
      {
        uri: 'tabularium://agents/primary',
        mimeType: 'application/json',
        text: JSON.stringify(primary ?? {}, null, 2),
      },
      {
        uri: 'tabularium://agents/names',
        mimeType: 'application/json',
        text: JSON.stringify(
          agents.map((a) => ({
            name: a.name,
            latinName: a.latinName,
            emoji: a.emoji,
          })),
          null,
          2
        ),
      },
    ];
  },
};
