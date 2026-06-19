/**
 * fs_stat_bulk — Ianus Liminalis
 *
 * Restituisce statistiche (size, mtime, type, hash) per multipli file
 * in una singola chiamata. Massimo 50 path per chiamata.
 */

import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { stat as fsStat, lstat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { resolveSafePath } from '../core/path-utils.js';
import { logToJournal } from '../core/journal-logger.js';
import { stats as serverStats } from '../core/stats.js';
import { toolRegistry } from './registry.js';
import type { ToolDeps } from './types.js';

const MAX_PATHS = 50;
const HASH_SIZE_LIMIT = 1 * 1024 * 1024; // 1 MB

/**
 * Compute SHA-256 hash for a small file (≤ 1MB).
 */
async function computeHash(filePath: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

/**
 * Determine file type from the stats.
 */
function getType(
  stats: { isFile: () => boolean; isDirectory: () => boolean },
): 'file' | 'directory' {
  if (stats.isDirectory()) return 'directory';
  return 'file';
}

export function registerStatBulk(_server: Server, deps: ToolDeps): void {
  toolRegistry.register({
    name: 'fs_stat_bulk',
    annotations: { readOnlyHint: true },
    description:
      'Get stats (size, mtime, type, hash) for multiple files in one call. ' +
      'Max 50 paths. Hash SHA-256 only for files ≤ 1MB.',
    inputSchema: {
      type: 'object',
      properties: {
        paths: {
          type: 'array',
          items: { type: 'string' },
          minItems: 1,
          maxItems: 50,
          description: 'Array of file/directory paths to analyze (max 50)',
        },
        agent: {
          type: 'string',
          description:
            'Nome dell agente chiamante (opzionale, default: "ianus")',
        },
      },
      required: ['paths'],
    },
    handler: async (args) => {
      const paths = args.paths as string[] | undefined;

      if (!paths || !Array.isArray(paths) || paths.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: 'Missing required parameter: "paths" must be a non-empty array',
            },
          ],
          isError: true,
        };
      }

      if (paths.length > MAX_PATHS) {
        return {
          content: [
            {
              type: 'text',
              text: `Too many paths: got ${paths.length}, max ${MAX_PATHS}`,
            },
          ],
          isError: true,
        };
      }

      const callerAgent = (args.agent as string) || 'ianus';

      const results: Array<{
        path: string;
        size: number;
        mtime: string;
        type: 'file' | 'directory';
        hash?: string;
      }> = [];

      const errors: Array<{ path: string; error: string }> = [];

      for (const filePath of paths) {
        // Permission check per ogni path
        const permCheck = await deps.permission.checkOperation(
          callerAgent,
          'read',
          filePath,
          deps.workspaceRoot,
        );
        if (!permCheck.allowed) {
          errors.push({ path: filePath, error: `Permission denied: ${permCheck.reason}` });
          continue;
        }

        try {
          const safePath = resolveSafePath(filePath, deps.workspaceRoot);
          const fileStats = await lstat(safePath);
          const fileType = getType(fileStats);

          const entry: {
            path: string;
            size: number;
            mtime: string;
            type: 'file' | 'directory';
            hash?: string;
          } = {
            path: filePath,
            size: fileStats.size,
            mtime: fileStats.mtime.toISOString(),
            type: fileType,
          };

          // Hash only for regular files ≤ 1MB
          if (fileType === 'file' && fileStats.size <= HASH_SIZE_LIMIT) {
            try {
              entry.hash = await computeHash(safePath);
            } catch {
              // Hash computation failure is non-fatal
            }
          }

          results.push(entry);
        } catch (err) {
          if (
            (err as NodeJS.ErrnoException).code === 'ENOENT'
          ) {
            errors.push({ path: filePath, error: 'not found' });
          } else {
            errors.push({
              path: filePath,
              error: (err as Error).message,
            });
          }
        }
      }

      // Log to journal
      await logToJournal(deps.workspaceRoot, {
        agent: 'ianus',
        operation: 'stat_bulk',
        path: '',
        details: {
          total: paths.length,
          succeeded: results.length,
          failed: errors.length,
        },
      });

      serverStats.increment();

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              results,
              errors,
              total: paths.length,
              failed: errors.length,
            }),
          },
        ],
      };
    },
  });
}
