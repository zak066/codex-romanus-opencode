/**
 * resources/project-map.resource.ts
 * Resource MCP che espone la mappa completa del progetto (struttura moduli,
 * esportazioni, dipendenze, directory).
 *
 * URI: tabularium://project/map
 *
 * @module resources/project-map
 */

import type { ResourceContent, ResourceHandler } from '../types/mcp.js';
import { generateProjectMap } from '../core/project-map.js';

export const projectMapResourceHandler: ResourceHandler = {
  uri: 'tabularium://project/map',
  name: 'Project Map',
  description: 'Complete project structure: modules, directories, exports, dependencies',
  mimeType: 'application/json',
  handler: async (): Promise<ResourceContent[]> => {
    try {
      const map = generateProjectMap();
      return [
        {
          uri: 'tabularium://project/map',
          mimeType: 'application/json',
          text: JSON.stringify(map, null, 2),
        },
      ];
    } catch (error) {
      return [
        {
          uri: 'tabularium://project/map',
          mimeType: 'application/json',
          text: JSON.stringify({
            error: true,
            message: error instanceof Error ? error.message : String(error),
          }),
        },
      ];
    }
  },
};
