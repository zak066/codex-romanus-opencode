/**
 * fs_rollback — Ianus Liminalis
 *
 * Rollback di un file a un backup specifico (o all'ultimo disponibile).
 */

import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { resolveSafePath } from '../core/path-utils.js';
import { stats as serverStats } from '../core/stats.js';
import { logToJournal } from '../core/journal-logger.js';
import { toolRegistry } from './registry.js';
import type { ToolDeps } from './types.js';

export function registerRollbackFile(_server: Server, deps: ToolDeps): void {
  toolRegistry.register({
    name: 'fs_rollback',
    annotations: { destructiveHint: true },
    description: 'Restore a file from a backup. If backupId is omitted, restores the most recent backup.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path of the file to restore (relative to workspace)',
        },
        backupId: {
          type: 'string',
          description: 'Specific backup ID to restore from (optional: uses latest if omitted)',
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

      const backupId = args.backupId as string | undefined;

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

        await deps.backup.rollback(safePath, backupId);

        const resolvedId = backupId ?? 'latest';

        // Log to journal
        await logToJournal(deps.workspaceRoot, {
          agent: 'ianus',
          operation: 'rollback',
          path: filePath,
          details: { backupId: resolvedId },
        });

        serverStats.increment();

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                restored: true,
                backupId: resolvedId,
                timestamp: new Date().toISOString(),
              }),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            { type: 'text', text: `Error rolling back "${filePath}": ${(err as Error).message}` },
          ],
          isError: true,
        };
      }
    },
  });
}
