/**
 * fs_append — Ianus Liminalis
 *
 * Aggiunge testo alla fine di un file. Crea il file se non esiste.
 */

import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { resolveSafePath } from '../core/path-utils.js';
import { logToJournal } from '../core/journal-logger.js';
import { stats as serverStats } from '../core/stats.js';
import { toolRegistry } from './registry.js';
import type { ToolDeps } from './types.js';

export function registerAppendFile(_server: Server, deps: ToolDeps): void {
  toolRegistry.register({
    name: 'fs_append',
    description: 'Append text to the end of a file. Creates the file if it does not exist.',
    annotations: { destructiveHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path of the file (relative to workspace)',
        },
        content: {
          type: 'string',
          description: 'Content to append to the file',
        },
        agent: {
          type: 'string',
          description:
            'Nome dell agente chiamante (opzionale, default: "ianus")',
        },
      },
      required: ['path', 'content'],
    },
    handler: async (args) => {
      const filePath = args.path as string | undefined;
      if (!filePath) {
        return {
          content: [{ type: 'text', text: 'Missing required parameter: "path"' }],
          isError: true,
        };
      }

      const content = args.content as string | undefined;
      if (content === undefined) {
        return {
          content: [{ type: 'text', text: 'Missing required parameter: "content"' }],
          isError: true,
        };
      }

      // Permission check
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

        // Ensure parent directory exists
        await mkdir(dirname(safePath), { recursive: true });

        // Append content
        const buffer = Buffer.from(content, 'utf-8');
        await appendFile(safePath, buffer, { encoding: 'utf-8' });

        // Log to journal
        await logToJournal(deps.workspaceRoot, {
          agent: 'ianus',
          operation: 'append',
          path: filePath,
          details: { size: buffer.length },
        });

        serverStats.increment();

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ appended: true, path: filePath, size: buffer.length }),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: 'text',
              text: `Error appending to file "${filePath}": ${(err as Error).message}`,
            },
          ],
          isError: true,
        };
      }
    },
  });
}
