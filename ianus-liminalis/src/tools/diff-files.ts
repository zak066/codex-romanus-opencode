/**
 * diff_files — Ianus Liminalis
 *
 * Compare two files and return a unified diff.
 * READ-ONLY tool — never modifies files.
 */

import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { readFile } from 'node:fs/promises';
import { createTwoFilesPatch } from 'diff';
import { resolveSafePath } from '../core/path-utils.js';
import { logToJournal } from '../core/journal-logger.js';
import { stats as serverStats } from '../core/stats.js';
import { toolRegistry } from './registry.js';
import type { ToolDeps } from './types.js';

interface DiffResult {
  path1: string;
  path2: string;
  diff: string;
  hasChanges: boolean;
  added: number;
  removed: number;
}

/**
 * Count added (+) and removed (-) lines in a unified diff.
 */
function countChanges(diff: string): { added: number; removed: number } {
  const lines = diff.split('\n');
  let added = 0;
  let removed = 0;
  for (const line of lines) {
    if (line.startsWith('+') && !line.startsWith('+++')) {
      added++;
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      removed++;
    }
  }
  return { added, removed };
}

export function registerDiffFiles(_server: Server, deps: ToolDeps): void {
  toolRegistry.register({
    name: 'diff_files',
    description: 'Compare two files and return a unified diff.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        path1: {
          type: 'string',
          description: 'First file path (relative to workspace)',
        },
        path2: {
          type: 'string',
          description: 'Second file path (relative to workspace)',
        },
        context: {
          type: 'number',
          default: 3,
          description: 'Lines of context (default: 3)',
        },
        agent: {
          type: 'string',
          description: 'Nome dell agente chiamante (opzionale)',
        },
      },
      required: ['path1', 'path2'],
    },
    handler: async (args) => {
      const path1 = args.path1 as string | undefined;
      const path2 = args.path2 as string | undefined;

      if (!path1) {
        return { content: [{ type: 'text', text: 'Missing required parameter: "path1"' }], isError: true };
      }
      if (!path2) {
        return { content: [{ type: 'text', text: 'Missing required parameter: "path2"' }], isError: true };
      }

      const context = (args.context as number) ?? 3;

      // Permission check — both paths must be readable
      const callerAgent = (args.agent as string) || 'ianus';
      const permCheck1 = await deps.permission.checkOperation(
        callerAgent,
        'read',
        path1,
        deps.workspaceRoot,
      );
      if (!permCheck1.allowed) {
        return {
          content: [{ type: 'text', text: `Permission denied for path1: ${permCheck1.reason}` }],
          isError: true,
        };
      }

      const permCheck2 = await deps.permission.checkOperation(
        callerAgent,
        'read',
        path2,
        deps.workspaceRoot,
      );
      if (!permCheck2.allowed) {
        return {
          content: [{ type: 'text', text: `Permission denied for path2: ${permCheck2.reason}` }],
          isError: true,
        };
      }

      try {
        const safePath1 = resolveSafePath(path1, deps.workspaceRoot);
        const safePath2 = resolveSafePath(path2, deps.workspaceRoot);

        // Read both files
        const content1 = await readFile(safePath1, 'utf-8');
        const content2 = await readFile(safePath2, 'utf-8');

        // Generate unified diff
        const diff = createTwoFilesPatch(path1, path2, content1, content2, undefined, undefined, { context });

        const { added, removed } = countChanges(diff);
        const hasChanges = added > 0 || removed > 0;

        const result: DiffResult = {
          path1,
          path2,
          diff: hasChanges ? diff : '',
          hasChanges,
          added,
          removed,
        };

        // Log to journal
        await logToJournal(deps.workspaceRoot, {
          agent: callerAgent,
          operation: 'diff',
          path: `${path1} ↔ ${path2}`,
          details: { hasChanges, added, removed },
        });

        serverStats.increment();

        return {
          content: [{ type: 'text', text: JSON.stringify(result) }],
        };
      } catch (err) {
        return {
          content: [
            {
              type: 'text',
              text: `Error diffing files "${path1}" and "${path2}": ${(err as Error).message}`,
            },
          ],
          isError: true,
        };
      }
    },
  });
}
