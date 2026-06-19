/**
 * fs_size_analyzer — Ianus Liminalis
 *
 * Analizza utilizzo disco di directory e file: top file, directory size, distribuzione per estensione.
 */

import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { readdir, stat } from 'node:fs/promises';
import { join, relative, extname } from 'node:path';
import { minimatch } from 'minimatch';
import { resolveSafePath } from '../core/path-utils.js';
import { logToJournal } from '../core/journal-logger.js';
import { stats as serverStats } from '../core/stats.js';
import { toolRegistry } from './registry.js';
import type { ToolDeps } from './types.js';

// ────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────

interface FileInfo {
  path: string;
  size: number;
  ext: string;
}

interface DirInfo {
  path: string;
  size: number;
  files: number;
}

interface SizeAnalyzerResult {
  path: string;
  totalFiles: number;
  totalDirs: number;
  totalSize: number;
  avgFileSize: number;
  topFiles: FileInfo[];
  topDirs: DirInfo[];
  byExtension: Record<string, { count: number; size: number }>;
}

// ────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────

function formatHumanSize(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = bytes;
  let unitIdx = 0;
  while (size >= 1024 && unitIdx < units.length - 1) {
    size /= 1024;
    unitIdx++;
  }
  return `${size.toFixed(2)} ${units[unitIdx]}`;
}

// ────────────────────────────────────────────────────────────
// Directory walk with depth tracking
// ────────────────────────────────────────────────────────────

interface WalkState {
  files: FileInfo[];
  dirs: Map<string, { size: number; count: number }>;
  excludePatterns: string[];
  top: number;
  baseDir: string;
  maxDepth: number;
}

async function walkAnalyze(
  currentPath: string,
  currentDepth: number,
  state: WalkState,
): Promise<void> {
  if (currentDepth > state.maxDepth) return;

  let entries: string[];
  try {
    entries = await readdir(currentPath);
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullPath = join(currentPath, entry);
    const relPath = relative(state.baseDir, fullPath).replace(/\\/g, '/');

    // Check exclude
    let excluded = false;
    for (const excl of state.excludePatterns) {
      if (minimatch(relPath, excl, { dot: true })) {
        excluded = true;
        break;
      }
    }
    if (excluded) continue;

    try {
      const stats = await stat(fullPath);
      if (stats.isDirectory()) {
        // Register directory (will be updated with its children sizes)
        if (!state.dirs.has(relPath)) {
          state.dirs.set(relPath, { size: 0, count: 0 });
        }
        await walkAnalyze(fullPath, currentDepth + 1, state);
      } else if (stats.isFile()) {
        state.files.push({
          path: relPath,
          size: stats.size,
          ext: extname(entry).toLowerCase() || '(no extension)',
        });
        // Update parent directories
        let parent = relPath;
        while (parent !== '') {
          parent = parent.replace(/\/?[^/]+$/, '') || '.';
          const dirEntry = state.dirs.get(parent);
          if (dirEntry) {
            dirEntry.size += stats.size;
            dirEntry.count += 1;
          }
        }
        // Also update root dir
        const rootEntry = state.dirs.get('.');
        if (rootEntry) {
          rootEntry.size += stats.size;
          rootEntry.count += 1;
        }
      }
    } catch {
      // Skip inaccessible
    }
  }
}

// ────────────────────────────────────────────────────────────
// Tool Registration
// ────────────────────────────────────────────────────────────

export function registerSizeAnalyzer(_server: Server, deps: ToolDeps): void {
  toolRegistry.register({
    name: 'fs_size_analyzer',
    annotations: { readOnlyHint: true },
    description:
      'Analyze disk usage: total size, top files, top directories, ' +
      'distribution by file extension. ' +
      'Supports depth limiting, sorting, and exclusion patterns.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Directory to analyze (required)',
        },
        depth: {
          type: 'number',
          default: 3,
          description: 'Maximum analysis depth (default: 3)',
        },
        sortBy: {
          type: 'string',
          enum: ['size', 'name', 'count'],
          default: 'size',
          description: 'Sort top files/dirs by (default: size)',
        },
        top: {
          type: 'number',
          default: 20,
          description: 'Show only top N files/dirs (default: 20, 0 = all)',
        },
        exclude: {
          type: 'string',
          default: '**/node_modules/**,**/.git/**',
          description: 'Glob exclude patterns (default: **/node_modules/**,**/.git/**)',
        },
        humanReadable: {
          type: 'boolean',
          default: false,
          description: 'Display sizes in human-readable format (default: false)',
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

      const depth = (args.depth as number) ?? 3;
      const sortBy = (args.sortBy as string) ?? 'size';
      const top = (args.top as number) ?? 20;
      const excludeRaw = (args.exclude as string) ?? '**/node_modules/**,**/.git/**';
      const humanReadable = (args.humanReadable as boolean) ?? false;
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

        const state: WalkState = {
          files: [],
          dirs: new Map(),
          excludePatterns,
          top,
          baseDir: deps.workspaceRoot,
          maxDepth: depth,
        };

        // Initialize root dir
        state.dirs.set('.', { size: 0, count: 0 });

        await walkAnalyze(safePath, 0, state);

        // Sort files
        const sortedFiles = [...state.files];
        if (sortBy === 'size') {
          sortedFiles.sort((a, b) => b.size - a.size);
        } else if (sortBy === 'name') {
          sortedFiles.sort((a, b) => a.path.localeCompare(b.path));
        }

        // Sort dirs
        const dirEntries = Array.from(state.dirs.entries()).map(([p, info]) => ({
          path: p === '.' ? scanPath : p,
          size: info.size,
          files: info.count,
        }));
        if (sortBy === 'size' || sortBy === 'count') {
          dirEntries.sort((a, b) => b.size - a.size);
        } else {
          dirEntries.sort((a, b) => a.path.localeCompare(b.path));
        }

        // Apply top limit
        const topLimit = top > 0 ? top : sortedFiles.length;
        const topFiles = sortedFiles.slice(0, topLimit);
        const topDirs = dirEntries.slice(0, topLimit);

        // Compute byExtension
        const byExtension: Record<string, { count: number; size: number }> = {};
        for (const f of state.files) {
          if (!byExtension[f.ext]) {
            byExtension[f.ext] = { count: 0, size: 0 };
          }
          byExtension[f.ext].count++;
          byExtension[f.ext].size += f.size;
        }

        // Sort byExtension by count descending
        const extSorted = Object.entries(byExtension).sort((a, b) => b[1].count - a[1].count);
        const sortedExtensions: Record<string, { count: number; size: number }> = {};
        for (const [ext, info] of extSorted) {
          sortedExtensions[ext] = info;
        }

        const totalFiles = state.files.length;
        const totalSize = state.files.reduce((sum, f) => sum + f.size, 0);
        const avgFileSize = totalFiles > 0 ? Math.round(totalSize / totalFiles) : 0;
        const totalDirs = state.dirs.size;

        let result: SizeAnalyzerResult = {
          path: scanPath,
          totalFiles,
          totalDirs,
          totalSize,
          avgFileSize,
          topFiles,
          topDirs,
          byExtension: sortedExtensions,
        };

        // Convert to human readable if requested
        if (humanReadable) {
          result = {
            ...result,
            totalSize: totalSize,
            avgFileSize: avgFileSize,
            topFiles: topFiles.map((f) => ({ ...f, size: f.size })),
            topDirs: topDirs.map((d) => ({ ...d, size: d.size })),
            byExtension: Object.fromEntries(
              Object.entries(sortedExtensions).map(([ext, info]) => [
                ext,
                { count: info.count, size: info.size },
              ]),
            ),
          };
          // Override with human-readable string output
          const humanResult = {
            path: scanPath,
            totalFiles,
            totalDirs,
            totalSize: formatHumanSize(totalSize),
            avgFileSize: formatHumanSize(avgFileSize),
            topFiles: topFiles.map((f) => ({ ...f, size: formatHumanSize(f.size) })),
            topDirs: topDirs.map((d) => ({ ...d, size: formatHumanSize(d.size) })),
            byExtension: Object.fromEntries(
              Object.entries(sortedExtensions).map(([ext, info]) => [
                ext,
                { count: info.count, size: formatHumanSize(info.size) },
              ]),
            ),
          };
          return {
            content: [{ type: 'text', text: JSON.stringify(humanResult, null, 2) }],
          };
        }

        await logToJournal(deps.workspaceRoot, {
          agent: 'ianus',
          operation: 'size_analyzer',
          path: scanPath,
          details: {
            totalFiles,
            totalDirs,
            totalSize,
          },
        });

        serverStats.increment();

        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        return {
          content: [{ type: 'text', text: `Error analyzing size: ${(err as Error).message}` }],
          isError: true,
        };
      }
    },
  });
}
