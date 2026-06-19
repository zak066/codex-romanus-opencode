/**
 * list_allowed_directories — Ianus Liminalis
 *
 * Returns the list of directories that this server is allowed to access.
 */

import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { stat } from 'node:fs/promises';
import { logToJournal } from '../core/journal-logger.js';
import { stats as serverStats } from '../core/stats.js';
import { toolRegistry } from './registry.js';
import type { ToolDeps } from './types.js';

export function registerListAllowedDirs(_server: Server, deps: ToolDeps): void {
  toolRegistry.register({
    name: 'list_allowed_directories',
    description: 'Returns the list of directories that this server is allowed to access.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        agent: {
          type: 'string',
          description: 'Nome dell agente chiamante (opzionale)',
        },
      },
    },
    handler: async (args) => {
      // Permission check — read access to root is sufficient
      const callerAgent = (args.agent as string) || 'ianus';
      const permCheck = await deps.permission.checkOperation(
        callerAgent,
        'read',
        '',
        deps.workspaceRoot,
      );
      if (!permCheck.allowed) {
        return {
          content: [{ type: 'text', text: `Permission denied: ${permCheck.reason}` }],
          isError: true,
        };
      }

      try {
        const dirStat = await stat(deps.workspaceRoot);
        const allowedDirectories = [
          {
            path: deps.workspaceRoot,
            size: dirStat.size,
          },
        ];

        // Log to journal
        await logToJournal(deps.workspaceRoot, {
          agent: callerAgent,
          operation: 'list_allowed_directories',
          path: deps.workspaceRoot,
          details: { total: allowedDirectories.length },
        });

        serverStats.increment();

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                allowedDirectories,
                total: allowedDirectories.length,
              }),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: 'text',
              text: `Error listing allowed directories: ${(err as Error).message}`,
            },
          ],
          isError: true,
        };
      }
    },
  });
}
