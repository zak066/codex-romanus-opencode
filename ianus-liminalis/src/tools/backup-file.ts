/**
 * fs_backup — Ianus Liminalis
 *
 * Crea un backup manuale di un file usando il BackupManager.
 */

import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { resolveSafePath } from '../core/path-utils.js';
import { stats as serverStats } from '../core/stats.js';
import { logToJournal } from '../core/journal-logger.js';
import { toolRegistry } from './registry.js';
import type { ToolDeps } from './types.js';

export function registerBackupFile(_server: Server, deps: ToolDeps): void {
  toolRegistry.register({
    name: 'fs_backup',
    annotations: { readOnlyHint: true },
    description: 'Create a manual backup of a file. Returns backup metadata including ID, path, timestamp, and size.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path of the file to backup (relative to workspace)',
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
        return { content: [{ type: 'text', text: 'Missing required parameter: "path"' }], isError: true };
      }

      // Permission check — read is sufficient for backup
      const callerAgent = (args.agent as string) || 'ianus';
      const permCheck = await deps.permission.checkOperation(
        callerAgent,
        'read',
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

        const entry = await deps.backup.backup(safePath);

        // Log to journal
        await logToJournal(deps.workspaceRoot, {
          agent: 'ianus',
          operation: 'backup',
          path: filePath,
          details: { backupId: entry.id, size: entry.size },
        });

        serverStats.increment();

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                backupId: entry.id,
                filePath: entry.filePath,
                timestamp: entry.timestamp,
                size: entry.size,
              }),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            { type: 'text', text: `Error backing up "${filePath}": ${(err as Error).message}` },
          ],
          isError: true,
        };
      }
    },
  });
}
