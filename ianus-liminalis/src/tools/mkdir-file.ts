/**
 * fs_mkdir — Ianus Liminalis
 *
 * Crea una directory (singola o albero ricorsivo). Fallisce se già esiste
 * a meno di force: true.
 */

import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { mkdir, stat } from 'node:fs/promises';
import { resolveSafePath } from '../core/path-utils.js';
import { logToJournal } from '../core/journal-logger.js';
import { stats as serverStats } from '../core/stats.js';
import { toolRegistry } from './registry.js';
import type { ToolDeps } from './types.js';

export function registerMkdirFile(_server: Server, deps: ToolDeps): void {
  toolRegistry.register({
    name: 'fs_mkdir',
    description: 'Create a directory (single or recursive tree). Fails if already exists unless force=true.',
    annotations: { idempotentHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path of the directory to create (relative to workspace)',
        },
        recursive: {
          type: 'boolean',
          default: true,
          description: 'Create parent directories as needed (default: true)',
        },
        force: {
          type: 'boolean',
          default: false,
          description: 'Do not fail if directory already exists (default: false)',
        },
        agent: {
          type: 'string',
          description: 'Nome dell agente chiamante (opzionale, default: "ianus")',
        },
      },
      required: ['path'],
    },
    handler: async (args) => {
      const dirPath = args.path as string | undefined;
      if (!dirPath) {
        return {
          content: [{ type: 'text', text: 'Missing required parameter: "path"' }],
          isError: true,
        };
      }

      const recursive = (args.recursive as boolean) ?? true;
      const force = (args.force as boolean) ?? false;

      // Permission check
      const callerAgent = (args.agent as string) || 'ianus';
      const permCheck = await deps.permission.checkOperation(
        callerAgent,
        'write',
        dirPath,
        deps.workspaceRoot,
      );
      if (!permCheck.allowed) {
        return {
          content: [{ type: 'text', text: `Permission denied: ${permCheck.reason}` }],
          isError: true,
        };
      }

      try {
        const safePath = resolveSafePath(dirPath, deps.workspaceRoot);

        // Check if directory already exists
        let existed = false;
        try {
          const dirStat = await stat(safePath);
          if (dirStat.isDirectory()) {
            existed = true;
            if (!force) {
              return {
                content: [
                  {
                    type: 'text',
                    text: `Directory "${dirPath}" already exists. Use force=true to allow.`,
                  },
                ],
                isError: true,
              };
            }
          }
        } catch {
          // Directory does not exist — safe to create
        }

        if (!existed) {
          await mkdir(safePath, { recursive });
        }

        // Log to journal
        await logToJournal(deps.workspaceRoot, {
          agent: 'ianus',
          operation: 'mkdir',
          path: dirPath,
          details: { recursive, force },
        });

        serverStats.increment();

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                created: !existed,
                path: dirPath,
                recursive,
                existed,
              }),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: 'text',
              text: `Error creating directory "${dirPath}": ${(err as Error).message}`,
            },
          ],
          isError: true,
        };
      }
    },
  });
}
