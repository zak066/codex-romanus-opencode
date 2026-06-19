/**
 * Resource registry — Ianus Liminalis
 *
 * Registra tutti i resource handler MCP centralizzando i registratori
 * ListResourceTemplatesRequestSchema e ReadResourceRequestSchema.
 */

import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  ReadResourceRequestSchema,
  ListResourceTemplatesRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { ToolDeps } from '../tools/types.js';
import { fileResourceHandler } from './ianus-files.js';
import { treeResourceHandler } from './ianus-tree.js';
import { journalResourceHandler } from './ianus-journal.js';
import { statsResourceHandler } from './ianus-stats.js';
import type { ResourceHandler } from './ianus-files.js';

const handlers: ResourceHandler[] = [
  fileResourceHandler,
  treeResourceHandler,
  journalResourceHandler,
  statsResourceHandler,
];

export function registerAllResources(server: Server, deps: ToolDeps): void {
  // Registra unico handler per ListResourceTemplates
  server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({
    resourceTemplates: handlers.map((h) => ({
      uriTemplate: h.uriTemplate,
      name: h.name,
      description: h.description,
    })),
  }));

  // Registra unico handler per ReadResource con routing
  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const uri = request.params.uri;

    for (const handler of handlers) {
      const match = handler.match(uri);
      if (match !== null) {
        return {
          contents: [await handler.read(uri, deps)],
        };
      }
    }

    throw new Error(`Unknown resource: ${uri}`);
  });
}
