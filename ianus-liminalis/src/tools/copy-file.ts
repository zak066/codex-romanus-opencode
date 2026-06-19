/**
 * fs_copy — Ianus Liminalis
 *
 * Copia un file in una nuova destinazione. Crea le directory parent se necessario.
 */

import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { cp, mkdir, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { resolveSafePath } from '../core/path-utils.js';
import { logToJournal } from '../core/journal-logger.js';
import { stats as serverStats } from '../core/stats.js';
import { toolRegistry } from './registry.js';
import type { ToolDeps } from './types.js';

export function registerCopyFile(_server: Server, deps: ToolDeps): void {
  toolRegistry.register({
    name: 'fs_copy',
    description: 'Copy a file to a new destination. Creates parent directories if needed.',
    annotations: { destructiveHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        source: {
          type: 'string',
          description: 'Path of the source file (relative to workspace)',
        },
        destination: {
          type: 'string',
          description: 'Path of the destination (relative to workspace)',
        },
        overwrite: {
          type: 'boolean',
          default: false,
          description: 'Overwrite if destination exists (default: false)',
        },
        agent: {
          type: 'string',
          description:
            'Nome dell agente chiamante (opzionale, default: "ianus")',
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

      const overwrite = args.overwrite === true;

      // Permission check — source (read)
      const callerAgent = (args.agent as string) || 'ianus';
      const sourcePermCheck = await deps.permission.checkOperation(
        callerAgent,
        'read',
        source,
        deps.workspaceRoot,
      );
      if (!sourcePermCheck.allowed) {
        return {
          content: [{ type: 'text', text: `Permission denied: ${sourcePermCheck.reason}` }],
          isError: true,
        };
      }

      // Permission check — destination (write)
      const destPermCheck = await deps.permission.checkOperation(
        callerAgent,
        'write',
        destination,
        deps.workspaceRoot,
      );
      if (!destPermCheck.allowed) {
        return {
          content: [{ type: 'text', text: `Permission denied: ${destPermCheck.reason}` }],
          isError: true,
        };
      }

      try {
        const sourcePath = resolveSafePath(source, deps.workspaceRoot);
        const destPath = resolveSafePath(destination, deps.workspaceRoot);

        // Check if destination already exists
        let destExists = false;
        try {
          await stat(destPath);
          destExists = true;
        } catch {
          // Destination doesn't exist — proceed
        }

        if (destExists && !overwrite) {
          return {
            content: [
              {
                type: 'text',
                text: `Destination "${destination}" already exists. Use overwrite=true to overwrite.`,
              },
            ],
            isError: true,
          };
        }

        // Create backup of destination if it exists and overwrite is true
        let backupId: string | undefined;
        if (destExists && overwrite) {
          try {
            const backup = await deps.backup.backup(destPath);
            backupId = backup.id;
          } catch {
            // Backup failed — proceed anyway
          }
        }

        // Ensure parent directory of destination exists
        await mkdir(dirname(destPath), { recursive: true });

        // Copy file/directory
        await cp(sourcePath, destPath, { recursive: true, force: overwrite });

        // Get size of the copied destination
        const destStats = await stat(destPath);

        // Log to journal
        await logToJournal(deps.workspaceRoot, {
          agent: 'ianus',
          operation: 'copy',
          path: destination,
          details: { source, backupId },
        });

        serverStats.increment();

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ copied: true, size: destStats.size, backupId }),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: 'text',
              text: `Error copying "${source}" to "${destination}": ${(err as Error).message}`,
            },
          ],
          isError: true,
        };
      }
    },
  });
}
