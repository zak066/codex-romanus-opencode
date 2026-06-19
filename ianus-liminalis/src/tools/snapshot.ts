/**
 * fs_snapshot — Ianus Liminalis
 *
 * Cattura uno snapshot dello stato di una directory: metadata + hash SHA-256
 * per ogni file. Salva come JSON strutturato.
 * READ-ONLY tool — mai modifiche.
 */

import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { readFile, stat, opendir } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { writeFile, mkdir } from 'node:fs/promises';
import { minimatch } from 'minimatch';
import { resolveSafePath } from '../core/path-utils.js';
import { logToJournal } from '../core/journal-logger.js';
import { stats as serverStats } from '../core/stats.js';
import { toolRegistry } from './registry.js';
import type { ToolDeps } from './types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SnapshotFileEntry {
  path: string;
  type: 'file' | 'directory';
  size: number;
  mtime: string;
  mode?: number;
  hash?: string;
}

interface SnapshotResult {
  snapshot: {
    timestamp: string;
    root: string;
    fileCount: number;
    dirCount: number;
    totalSize: number;
  };
  files: SnapshotFileEntry[];
}

// ---------------------------------------------------------------------------
// Walk helper
// ---------------------------------------------------------------------------

async function walkDirectory(
  dirAbs: string,
  root: string,
  include?: string,
  exclude?: string,
  includeContent?: boolean,
  includeMeta?: boolean,
): Promise<{ files: SnapshotFileEntry[]; totalSize: number; fileCount: number; dirCount: number }> {
  const entries: SnapshotFileEntry[] = [];
  let totalSize = 0;
  let fileCount = 0;
  let dirCount = 0;

  async function walk(currentAbs: string): Promise<void> {
    let dir;
    try {
      dir = await opendir(currentAbs);
    } catch {
      return;
    }

    for await (const entry of dir) {
      const absPath = resolve(currentAbs, entry.name);
      const relPath = relative(root, absPath).replace(/\\/g, '/');

      let entryStat;
      try {
        entryStat = await stat(absPath);
      } catch {
        continue;
      }

      if (entryStat.isDirectory()) {
        const dirRelPath = relPath + '/';

        // Applica include/exclude
        if (include && !minimatch(dirRelPath, include, { dot: true })) {
          // Check if we should still recurse
        }
        if (exclude && minimatch(dirRelPath, exclude, { dot: true })) continue;

        dirCount++;
        const fileEntry: SnapshotFileEntry = {
          path: dirRelPath,
          type: 'directory',
          size: 0,
          mtime: entryStat.mtime.toISOString(),
        };
        if (includeMeta) {
          fileEntry.mode = entryStat.mode;
        }
        entries.push(fileEntry);

        await walk(absPath);
      } else if (entryStat.isFile()) {
        // Applica include/exclude
        if (include && !minimatch(relPath, include, { dot: true })) continue;
        if (exclude && minimatch(relPath, exclude, { dot: true })) continue;

        fileCount++;
        totalSize += entryStat.size;

        const fileEntry: SnapshotFileEntry = {
          path: relPath,
          type: 'file',
          size: entryStat.size,
          mtime: entryStat.mtime.toISOString(),
        };

        if (includeMeta) {
          fileEntry.mode = entryStat.mode;
        }

        if (includeContent) {
          try {
            const content = await readFile(absPath);
            fileEntry.hash = createHash('sha256').update(content).digest('hex');
          } catch {
            // Se non si può leggere, hash non disponibile
          }
        }

        entries.push(fileEntry);
      }
    }
  }

  await walk(dirAbs);
  return { files: entries, totalSize, fileCount, dirCount };
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export function registerSnapshot(_server: Server, deps: ToolDeps): void {
  toolRegistry.register({
    name: 'fs_snapshot',
    description:
      'Capture a snapshot of a directory state: metadata + SHA-256 hashes for every file. Saves as structured JSON. By default excludes node_modules/ and .git/.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Directory to snapshot (relative to workspace)',
        },
        output: {
          type: 'string',
          description:
            'Output JSON file path (relative to workspace). Default: ".ianus-snapshot.json" in the snapshot directory',
        },
        include: {
          type: 'string',
          description: 'Glob pattern to include files (e.g., "src/**/*.ts")',
        },
        exclude: {
          type: 'string',
          default: '**/node_modules/**,**/.git/**',
          description:
            'Glob pattern to exclude files (default: "**/node_modules/**,**/.git/**")',
        },
        includeContent: {
          type: 'boolean',
          default: true,
          description: 'Include SHA-256 content hash (default: true)',
        },
        includeMeta: {
          type: 'boolean',
          default: true,
          description: 'Include file metadata (size, mtime, mode) (default: true)',
        },
        agent: {
          type: 'string',
          description: 'Agent name (optional, default: "ianus")',
        },
      },
      required: ['path'],
    },
    handler: async (args) => {
      const snapshotPath = args.path as string | undefined;
      if (!snapshotPath) {
        return { content: [{ type: 'text', text: 'Missing required parameter: "path"' }], isError: true };
      }

      const output = (args.output as string) || '.ianus-snapshot.json';
      const include = args.include as string | undefined;
      const exclude =
        (args.exclude as string) || '**/node_modules/**,**/.git/**';
      const includeContent = (args.includeContent as boolean) ?? true;
      const includeMeta = (args.includeMeta as boolean) ?? true;
      const callerAgent = (args.agent as string) || 'ianus';

      // Permission check — read sulla directory
      const permCheck = await deps.permission.checkOperation(
        callerAgent,
        'read',
        snapshotPath,
        deps.workspaceRoot,
      );
      if (!permCheck.allowed) {
        return {
          content: [{ type: 'text', text: `Permission denied: ${permCheck.reason}` }],
          isError: true,
        };
      }

      try {
        const safePath = resolveSafePath(snapshotPath, deps.workspaceRoot);

        const { files, totalSize, fileCount, dirCount } = await walkDirectory(
          safePath,
          safePath,
          include,
          exclude,
          includeContent,
          includeMeta,
        );

        const result: SnapshotResult = {
          snapshot: {
            timestamp: new Date().toISOString(),
            root: snapshotPath,
            fileCount,
            dirCount,
            totalSize,
          },
          files,
        };

        // Scrivi snapshot su file output
        const safeOutputPath = resolveSafePath(
          output.startsWith('.') ? `${snapshotPath}/${output}` : output,
          deps.workspaceRoot,
        );

        await mkdir(resolve(safeOutputPath, '..'), { recursive: true });
        await writeFile(safeOutputPath, JSON.stringify(result, null, 2), 'utf-8');

        // Log journal
        await logToJournal(deps.workspaceRoot, {
          agent: callerAgent,
          operation: 'snapshot',
          path: snapshotPath,
          details: {
            output,
            fileCount,
            dirCount,
            totalSize,
          },
        });

        serverStats.increment();

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  snapshot: result.snapshot,
                  output,
                  files: result.files,
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: 'text',
              text: `Error snapshotting "${snapshotPath}": ${(err as Error).message}`,
            },
          ],
          isError: true,
        };
      }
    },
  });
}
