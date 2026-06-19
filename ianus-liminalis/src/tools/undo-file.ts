/**
 * fs_undo — Ianus Liminalis
 *
 * Rollback dell'ultima modifica su un file senza dover conoscere backupId.
 */

import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { resolveSafePath } from '../core/path-utils.js';
import { stats as serverStats } from '../core/stats.js';
import { logToJournal } from '../core/journal-logger.js';
import { toolRegistry } from './registry.js';
import type { ToolDeps } from './types.js';

export function registerUndoFile(_server: Server, deps: ToolDeps): void {
  toolRegistry.register({
    name: 'fs_undo',
    annotations: { destructiveHint: true },
    description:
      'Rollback the last modification of a file without needing to know the backup ID.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path of the file to undo (relative to workspace)',
        },
        agent: {
          type: 'string',
          description: 'Nome dell agente chiamante (opzionale, default: "ianus")',
        },
      },
      required: ['path'],
    },
    handler: async (args) => {
      const filePath = args.path as string | undefined;
      if (!filePath) {
        return {
          content: [{ type: 'text', text: 'Missing required parameter: "path"' }],
          isError: true,
        };
      }

      // Permission check — write is a sensitive operation
      const callerAgent = (args.agent as string) || 'ianus';
      const permCheck = await deps.permission.checkOperation(
        callerAgent,
        'write',
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

        // List backups sorted by most recent first
        const backups = await deps.backup.listBackups(safePath);
        if (backups.length === 0) {
          return {
            content: [
              {
                type: 'text',
                text: `No backups found for "${filePath}". Nothing to undo.`,
              },
            ],
            isError: true,
          };
        }

        // Take the most recent backup
        const latestBackup = backups[0];
        await deps.backup.rollback(safePath, latestBackup.id);

        // Log to journal
        await logToJournal(deps.workspaceRoot, {
          agent: 'ianus',
          operation: 'undo',
          path: filePath,
          details: { backupId: latestBackup.id, timestamp: latestBackup.timestamp },
        });

        serverStats.increment();

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                restored: true,
                backupId: latestBackup.id,
                timestamp: latestBackup.timestamp,
                filePath,
              }),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: 'text',
              text: `Error undoing "${filePath}": ${(err as Error).message}`,
            },
          ],
          isError: true,
        };
      }
    },
  });
}
