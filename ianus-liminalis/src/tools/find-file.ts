/**
 * fs_find — Ianus Liminalis
 *
 * Cerca file per nome (pattern glob). Restituisce path ordinati per data di modifica.
 * Diverso da fs_search che cerca dentro il contenuto dei file.
 */

import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { readdir, stat as fsStat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { minimatch } from 'minimatch';
import { resolveSafePath } from '../core/path-utils.js';
import { logToJournal } from '../core/journal-logger.js';
import { stats as serverStats } from '../core/stats.js';
import { toolRegistry } from './registry.js';
import type { ToolDeps } from './types.js';

interface FindResult {
  path: string;
  size: number;
  mtime: string;
}

const MAX_RESULTS = 500;

/**
 * Walk directory recursively, collecting file paths that match the glob pattern.
 */
async function walkFiles(
  dir: string,
  baseDir: string,
  pattern: string,
  maxResults: number,
): Promise<FindResult[]> {
  const results: FindResult[] = [];

  async function walk(currentPath: string): Promise<void> {
    if (results.length >= maxResults) return;

    let entries: string[];
    try {
      entries = await readdir(currentPath);
    } catch {
      return; // Skip directories we can't read
    }

    for (const entry of entries) {
      if (results.length >= maxResults) return;

      const fullPath = join(currentPath, entry);
      try {
        const stats = await fsStat(fullPath);
        if (stats.isDirectory()) {
          await walk(fullPath);
        } else if (stats.isFile()) {
          const relPath = relative(baseDir, fullPath).replace(/\\/g, '/');
          if (minimatch(relPath, pattern, { dot: true })) {
            results.push({
              path: relPath,
              size: stats.size,
              mtime: stats.mtime.toISOString(),
            });
          }
        }
      } catch {
        // Skip inaccessible entries
      }
    }
  }

  await walk(dir);
  return results;
}

export function registerFindFile(_server: Server, deps: ToolDeps): void {
  toolRegistry.register({
    name: 'fs_find',
    description: 'Find files by name using glob patterns. Returns paths sorted by modification time.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          description: 'Glob pattern to match files against (e.g., **/*.ts)',
        },
        path: {
          type: 'string',
          default: '.',
          description: 'Base directory to search in (relative to workspace)',
        },
        agent: {
          type: 'string',
          description:
            'Nome dell agente chiamante (opzionale, default: "ianus")',
        },
      },
      required: ['pattern'],
    },
    handler: async (args) => {
      // Valida pattern
      const pattern = args.pattern as string | undefined;
      if (!pattern) {
        return {
          content: [{ type: 'text', text: 'Missing required parameter: "pattern"' }],
          isError: true,
        };
      }

      const searchPath = (args.path as string) ?? '.';

      // Permission check
      const callerAgent = (args.agent as string) || 'ianus';
      const permCheck = await deps.permission.checkOperation(
        callerAgent,
        'read',
        searchPath,
        deps.workspaceRoot,
      );
      if (!permCheck.allowed) {
        return {
          content: [{ type: 'text', text: `Permission denied: ${permCheck.reason}` }],
          isError: true,
        };
      }

      try {
        const safePath = resolveSafePath(searchPath, deps.workspaceRoot);

        const results = await walkFiles(safePath, deps.workspaceRoot, pattern, MAX_RESULTS);

        // Sort by modification time (most recent first)
        results.sort((a, b) => new Date(b.mtime).getTime() - new Date(a.mtime).getTime());

        // Log to journal
        await logToJournal(deps.workspaceRoot, {
          agent: 'ianus',
          operation: 'find',
          path: searchPath,
          details: { pattern, total: results.length },
        });

        serverStats.increment();

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(results),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: 'text',
              text: `Error finding files with pattern "${pattern}": ${(err as Error).message}`,
            },
          ],
          isError: true,
        };
      }
    },
  });
}
