/**
 * resources/models.resource.ts
 * Resource MCP che espone la configurazione dei modelli AI.
 * URI: tabularium://models
 */

import type { ResourceContent, ResourceHandler } from '../types/mcp.js';
import { getModelAssignments } from '../core/agent-reader.js';
import { getAllModels, buildModelRegistry } from '../core/model-fetcher.js';

export const modelResourceHandler: ResourceHandler = {
  uri: 'tabularium://models',
  name: 'Models Configuration',
  description:
    'Configurazione dei modelli AI disponibili in opencode.json. Include provider, context e assegnazioni per agente.',
  mimeType: 'application/json',

  handler: async (): Promise<ResourceContent[]> => {
    const models = getAllModels();
    const assignments = getModelAssignments();
    const registry = buildModelRegistry();

    return [
      {
        uri: 'tabularium://models/list',
        mimeType: 'application/json',
        text: JSON.stringify(models, null, 2),
      },
      {
        uri: 'tabularium://models/assignments',
        mimeType: 'application/json',
        text: JSON.stringify(assignments, null, 2),
      },
      {
        uri: 'tabularium://models/registry',
        mimeType: 'application/json',
        text: JSON.stringify(registry, null, 2),
      },
    ];
  },
};
