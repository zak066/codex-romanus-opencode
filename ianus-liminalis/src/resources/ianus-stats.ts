/**
 * Resource: ianus://stats
 *
 * Espone statistiche in tempo reale del server MCP.
 */

import type { ToolDeps } from '../tools/types.js';
import { stats } from '../core/stats.js';
import type { ResourceHandler } from './ianus-files.js';

export const statsResourceHandler: ResourceHandler = {
  uriTemplate: 'ianus://stats',
  name: 'Server stats',
  description: 'Statistiche in tempo reale del server Ianus Liminalis',

  match(uri: string): string | null {
    return uri === 'ianus://stats' ? '' : null;
  },

  async read(uri: string, deps: ToolDeps) {
    const data = {
      uptime: stats.getUptime(),
      totalOperations: stats.totalOperations,
      toolsRegistered: 12,
      permissionVersion: 1,
      workspaceRoot: deps.workspaceRoot,
    };

    return {
      uri,
      mimeType: 'application/json',
      text: JSON.stringify(data, null, 2),
    };
  },
};
