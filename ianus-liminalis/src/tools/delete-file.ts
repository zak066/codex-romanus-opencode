import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { stat, rm, readdir } from 'node:fs/promises';
import { resolveSafePath } from '../core/path-utils.js';
import { logToJournal } from '../core/journal-logger.js';
import { stats as serverStats } from '../core/stats.js';
import { toolRegistry } from './registry.js';
import type { ToolDeps } from './types.js';

export function registerDeleteFile(_server: Server, deps: ToolDeps): void {
  toolRegistry.register({
    name: 'fs_delete',
    description:
      'Delete a file or directory. Creates a backup before deletion. Non-empty directories require recursive=true.',
    annotations: { destructiveHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path of the file or directory to delete (relative to workspace)',
    annotations: { destructiveHint: true },
        },
        recursive: {
          type: 'boolean',
          default: false,
          description: 'Recursively delete directory contents (required for non-empty directories)',
    annotations: { destructiveHint: true },
        },
        agent: {
          type: 'string',
          description: 'Nome dell agente chiamante (opzionale, default: "ianus")',
    annotations: { destructiveHint: true },
        },
      },
      required: ['path'],
    },
    handler: async (args) => {
      const filePath = args.path as string | undefined;
      if (!filePath) {
        return { content: [{ type: 'text', text: 'Missing required parameter: "path"' }], isError: true };
      }

      const recursive = args.recursive === true;

      // Permission check
      const callerAgent = (args.agent as string) || 'ianus';
      const permCheck = await deps.permission.checkOperation(
        callerAgent,
        'delete',
        filePath,
        deps.workspaceRoot,
      );
      if (!permCheck.allowed) {
        return {
          content: [{ type: 'text', text: `Permission denied: ${permCheck.reason}` }],
          isError: true,
        };
      }

      try {
        const safePath = resolveSafePath(filePath, deps.workspaceRoot);

        // Check what we're dealing with
        const stats = await stat(safePath);

        // If it's a directory and not recursive, check if empty
        if (stats.isDirectory() && !recursive) {
          const entries = await readdir(safePath);
          if (entries.length > 0) {
            return {
              content: [
                {
                  type: 'text',
                  text: `Directory "${filePath}" is not empty. Use recursive=true to delete non-empty directories.`,
                },
              ],
              isError: true,
            };
          }
        }

        // Create backup before deleting (only for files; directories are too large)
        let backupId: string | undefined;
        if (stats.isFile()) {
          try {
            const backup = await deps.backup.backup(safePath);
            backupId = backup.id;
          } catch {
            // Backup failed — proceed anyway
          }
        }

        // Delete
        await rm(safePath, { recursive: stats.isDirectory() && recursive, force: true });

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ deleted: true, backupId }),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            { type: 'text', text: `Error deleting "${filePath}": ${(err as Error).message}` },
          ],
          isError: true,
        };
      }
    },
  });
}
