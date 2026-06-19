/**
 * fs_dupe_finder — Ianus Liminalis
 *
 * Scansiona una directory e trova file duplicati tramite hash SHA-256/SHA-1/MD5 del contenuto.
 */

import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { readdir, stat, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { minimatch } from 'minimatch';
import { resolveSafePath } from '../core/path-utils.js';
import { logToJournal } from '../core/journal-logger.js';
import { stats as serverStats } from '../core/stats.js';
import { toolRegistry } from './registry.js';
import type { ToolDeps } from './types.js';

// ────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────

interface DuplicateGroup {
  hash: string;
  size: number;
  count: number;
  files: string[];
  original: string;
  duplicates: string[];
}

interface DupeFinderResult {
  totalScanned: number;
  totalSize: number;
  wastedSize: number;
  duplicateGroups: DuplicateGroup[];
  totalDuplicates: number;
}

// ────────────────────────────────────────────────────────────
// Walking
// ────────────────────────────────────────────────────────────

/**
 * Cammina ricorsivamente la directory collezionando file
 * che matchano include e non matchano exclude.
 */
async function walkFiles(
  dir: string,
  baseDir: string,
  includePattern: string | undefined,
  excludePatterns: string[],
): Promise<string[]> {
  const files: string[] = [];

  async function walk(currentPath: string): Promise<void> {
    let entries: string[];
    try {
      entries = await readdir(currentPath);
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = join(currentPath, entry);
      const relPath = relative(baseDir, fullPath).replace(/\\/g, '/');

      let excluded = false;
      for (const excl of excludePatterns) {
        if (minimatch(relPath, excl, { dot: true })) {
          excluded = true;
          break;
        }
      }
      if (excluded) continue;

      try {
        const stats = await stat(fullPath);
        if (stats.isDirectory()) {
          await walk(fullPath);
        } else if (stats.isFile()) {
          if (!includePattern || minimatch(relPath, includePattern, { dot: true })) {
            files.push(fullPath);
          }
        }
      } catch {
        // Skip inaccessible
      }
    }
  }

  await walk(dir);
  return files;
}

// ────────────────────────────────────────────────────────────
// Hashing
// ────────────────────────────────────────────────────────────

function computeHash(content: Buffer, algo: string): string {
  return createHash(algo).update(content).digest('hex');
}

// ────────────────────────────────────────────────────────────
// Tool Registration
// ────────────────────────────────────────────────────────────

export function registerDupeFinder(_server: Server, deps: ToolDeps): void {
  toolRegistry.register({
    name: 'fs_dupe_finder',
    description:
      'Scan a directory and find duplicate files by content hash (SHA-256, SHA-1, or MD5). ' +
      'Groups files by hash and identifies originals (first by mtime) and duplicates. ' +
      'Skips files smaller than minSize and larger than maxSize.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Directory to scan (required)',
        },
        include: {
          type: 'string',
          description: 'Glob include pattern (optional, default: all files)',
        },
        exclude: {
          type: 'string',
          default: '**/node_modules/**,**/.git/**',
          description: 'Glob exclude pattern (default: **/node_modules/**,**/.git/**)',
        },
        minSize: {
          type: 'number',
          default: 1,
          description: 'Minimum file size in bytes (default: 1, skips empty files)',
        },
        maxSize: {
          type: 'number',
          description: 'Maximum file size in bytes (optional, no limit by default)',
        },
        algo: {
          type: 'string',
          enum: ['sha256', 'sha1', 'md5'],
          default: 'sha256',
          description: 'Hash algorithm (default: sha256)',
        },
        agent: {
          type: 'string',
          description: 'Calling agent name (optional, default: "ianus")',
        },
      },
      required: ['path'],
    },
    handler: async (args) => {
      const scanPath = args.path as string;
      if (!scanPath) {
        return {
          content: [{ type: 'text', text: 'Missing required parameter: "path"' }],
          isError: true,
        };
      }

      const includePattern = args.include as string | undefined;
      const excludeRaw = (args.exclude as string) ?? '**/node_modules/**,**/.git/**';
      const minSize = (args.minSize as number) ?? 1;
      const maxSize = args.maxSize as number | undefined;
      const algo = (args.algo as string) ?? 'sha256';
      const callerAgent = (args.agent as string) || 'ianus';

      const excludePatterns = excludeRaw
        .split(',')
        .map((p) => p.trim())
        .filter((p) => p.length > 0);

      const permCheck = await deps.permission.checkOperation(
        callerAgent,
        'read',
        scanPath,
        deps.workspaceRoot,
      );
      if (!permCheck.allowed) {
        return {
          content: [{ type: 'text', text: `Permission denied: ${permCheck.reason}` }],
          isError: true,
        };
      }

      try {
        const safePath = resolveSafePath(scanPath, deps.workspaceRoot);
        const filePaths = await walkFiles(safePath, deps.workspaceRoot, includePattern, excludePatterns);

        // Hash map: hash → { size, mtime, path }[]
        const hashMap = new Map<string, Array<{ path: string; size: number; mtime: Date }>>();
        let totalSize = 0;
        let scannedCount = 0;

        for (const filePath of filePaths) {
          try {
            const fileStats = await stat(filePath);
            if (fileStats.size < minSize) continue;
            if (maxSize !== undefined && fileStats.size > maxSize) continue;

            const content = await readFile(filePath);
            const hash = computeHash(content, algo);

            totalSize += fileStats.size;
            scannedCount++;

            const entry = { path: filePath, size: fileStats.size, mtime: fileStats.mtime };
            const existing = hashMap.get(hash);
            if (existing) {
              existing.push(entry);
            } else {
              hashMap.set(hash, [entry]);
            }
          } catch {
            // Skip problematic files
          }
        }

        const duplicateGroups: DuplicateGroup[] = [];
        let wastedSize = 0;
        let totalDuplicates = 0;

        for (const [hash, entries] of hashMap) {
          if (entries.length < 2) continue;

          // Sort by mtime ascending — oldest first = original
          entries.sort((a, b) => a.mtime.getTime() - b.mtime.getTime());
          const originalPath = relative(deps.workspaceRoot, entries[0].path).replace(/\\/g, '/');
          const filePathsRel = entries.map((e) => relative(deps.workspaceRoot, e.path).replace(/\\/g, '/'));
          const duplicatesRel = entries.slice(1).map((e) => relative(deps.workspaceRoot, e.path).replace(/\\/g, '/'));

          wastedSize += entries[0].size * (entries.length - 1);
          totalDuplicates += entries.length - 1;

          duplicateGroups.push({
            hash,
            size: entries[0].size,
            count: entries.length,
            files: filePathsRel,
            original: originalPath,
            duplicates: duplicatesRel,
          });
        }

        // Sort by wasted size descending
        duplicateGroups.sort((a, b) => (b.size * (b.count - 1)) - (a.size * (a.count - 1)));

        const result: DupeFinderResult = {
          totalScanned: scannedCount,
          totalSize,
          wastedSize,
          duplicateGroups,
          totalDuplicates,
        };

        await logToJournal(deps.workspaceRoot, {
          agent: 'ianus',
          operation: 'dupe_finder',
          path: scanPath,
          details: {
            scannedCount,
            totalDuplicates,
            wastedSize,
            algo,
          },
        });

        serverStats.increment();

        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        return {
          content: [{ type: 'text', text: `Error finding duplicates: ${(err as Error).message}` }],
          isError: true,
        };
      }
    },
  });
}
