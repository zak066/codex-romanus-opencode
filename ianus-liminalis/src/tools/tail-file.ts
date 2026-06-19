/**
 * fs_tail — Ianus Liminalis
 *
 * Legge le ultime N righe di un file (default 10, max 1000).
 */

import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { readFile } from 'node:fs/promises';
import { resolveSafePath } from '../core/path-utils.js';
import { stats as serverStats } from '../core/stats.js';
import { toolRegistry } from './registry.js';
import type { ToolDeps } from './types.js';

export function registerTailFile(_server: Server, deps: ToolDeps): void {
  toolRegistry.register({
    name: 'fs_tail',
    annotations: { readOnlyHint: true },
    description: 'Read the last N lines of a file (default: 10, max: 1000).',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path of the file (relative to workspace)',
        },
        lines: {
          type: 'number',
          description: 'Number of lines to read (default: 10, max: 1000)',
          default: 10,
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

      // Parse and clamp lines parameter
      let lines = typeof args.lines === 'number' ? args.lines : 10;
      if (lines < 1) lines = 1;
      if (lines > 1000) lines = 1000;

      // Permission check
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

        // Read entire file
        const content = await readFile(safePath, 'utf-8');

        // Split into lines and take the last N
        const allLines = content.split('\n');
        const totalLines = allLines.length;

        // If file is empty or smaller than requested lines, return everything
        const startLine = Math.max(0, totalLines - lines);
        const tailLines = allLines.slice(startLine);

        // If the file ends with a newline, the last element will be an empty string
        // which we keep as part of the content representation
        const result = tailLines.join('\n');

        serverStats.increment();

        return {
          content: [
            {
              type: 'text',
              text: result,
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: 'text',
              text: `Error reading tail of "${filePath}": ${(err as Error).message}`,
            },
          ],
          isError: true,
        };
      }
    },
  });
}
