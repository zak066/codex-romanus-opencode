/**
 * fs_move — Ianus Liminalis
 *
 * Sposta/rinomina un file o directory. Crea backup prima dello spostamento.
 */

import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { rename, mkdir, cp, rm, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { resolveSafePath } from '../core/path-utils.js';
import { logToJournal } from '../core/journal-logger.js';
import { stats as serverStats } from '../core/stats.js';
import { toolRegistry } from './registry.js';
import type { ToolDeps } from './types.js';

export function registerMoveFile(_server: Server, deps: ToolDeps): void {
  toolRegistry.register({
    name: 'fs_move',
    description: 'Move or rename a file or directory. Creates a backup before moving.',
    annotations: { destructiveHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        source: {
          type: 'string',
          description: 'Source path (relative to workspace)',
        },
        destination: {
          type: 'string',
          description: 'Destination path (relative to workspace)',
        },
        agent: {
          type: 'string',
          description: 'Nome dell agente chiamante (opzionale, default: "ianus")',
        },
      },
      required: ['source', 'destination'],
    },
    handler: async (args) => {
      const source = args.source as string | undefined;
      if (!source) {
        return {
          content: [{ type: 'text', text: 'Missing required parameter: "source"' }],
          isError: true,
        };
      }

      const destination = args.destination as string | undefined;
      if (!destination) {
        return {
          content: [{ type: 'text', text: 'Missing required parameter: "destination"' }],
          isError: true,
        };
      }

      // Permission check
      const callerAgent = (args.agent as string) || 'ianus';
      const permCheck = await deps.permission.checkOperation(
        callerAgent,
        'write',
        source,
        deps.workspaceRoot,
      );
      if (!permCheck.allowed) {
        return {
          content: [{ type: 'text', text: `Permission denied: ${permCheck.reason}` }],
          isError: true,
        };
      }

      try {
        const sourcePath = resolveSafePath(source, deps.workspaceRoot);
        const destPath = resolveSafePath(destination, deps.workspaceRoot);

        // Create backup of source before moving
        let backupId: string | undefined;
        try {
          await stat(sourcePath);
          const backup = await deps.backup.backup(sourcePath);
          backupId = backup.id;
        } catch {
          // Source doesn't exist — rename will fail below with a clearer error
        }

        // Ensure parent directory of destination exists
        await mkdir(dirname(destPath), { recursive: true });

        // Try rename first, fallback to copy+delete for cross-device moves (EXDEV)
        try {
          await rename(sourcePath, destPath);
        } catch (renameErr) {
          // Cross-device link: copy then delete
          await cp(sourcePath, destPath, { recursive: true, force: true });
          await rm(sourcePath, { recursive: true, force: true });
        }

        // Log to journal
        await logToJournal(deps.workspaceRoot, {
          agent: 'ianus',
          operation: 'move',
          path: source,
          details: { destination, backupId },
        });

        serverStats.increment();

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ moved: true, destination, backupId }),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: 'text',
              text: `Error moving "${source}" to "${destination}": ${(err as Error).message}`,
            },
          ],
          isError: true,
        };
      }
    },
  });
}
