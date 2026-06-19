import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { readdir, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { minimatch } from 'minimatch';
import { resolveSafePath } from '../core/path-utils.js';
import { stats as serverStats } from '../core/stats.js';
import { toolRegistry } from './registry.js';
import type { ToolDeps } from './types.js';

interface DirEntry {
  name: string;
  path: string;
  type: 'file' | 'directory' | 'symlink' | 'other';
  size: number;
  mtime: string;
}

type SortBy = 'name' | 'size' | 'mtime' | 'type';
type SortOrder = 'asc' | 'desc';

function getEntryType(stats: { isFile: () => boolean; isDirectory: () => boolean; isSymbolicLink: () => boolean }): DirEntry['type'] {
  if (stats.isSymbolicLink()) return 'symlink';
  if (stats.isDirectory()) return 'directory';
  if (stats.isFile()) return 'file';
  return 'other';
}

function compareEntries(a: DirEntry, b: DirEntry, sortBy: SortBy, order: SortOrder): number {
  const dirOrder = (e: DirEntry) => (e.type === 'directory' ? 0 : 1);
  // Directories always come first, then sort by the chosen field
  if (a.type === 'directory' && b.type !== 'directory') return -1;
  if (a.type !== 'directory' && b.type === 'directory') return 1;

  let comparison = 0;
  switch (sortBy) {
    case 'name':
      comparison = a.name.localeCompare(b.name);
      break;
    case 'size':
      comparison = a.size - b.size;
      break;
    case 'mtime':
      comparison = new Date(a.mtime).getTime() - new Date(b.mtime).getTime();
      break;
    case 'type':
      comparison = a.type.localeCompare(b.type);
      break;
  }

  return order === 'desc' ? -comparison : comparison;
}

export function registerListFile(_server: Server, deps: ToolDeps): void {
  toolRegistry.register({
    name: 'fs_list',
    description:
      'List directory entries with metadata. Supports glob filtering and sorting by name, size, mtime, or type.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          default: '.',
          description: 'Directory path to list (relative to workspace)',
    annotations: { readOnlyHint: true },
        },
        include: {
          type: 'string',
          description: 'Glob pattern to filter entries (e.g., *.ts)',
    annotations: { readOnlyHint: true },
        },
        sortBy: {
          type: 'string',
          enum: ['name', 'size', 'mtime', 'type'],
          default: 'name',
          description: 'Field to sort by',
    annotations: { readOnlyHint: true },
        },
        order: {
          type: 'string',
          enum: ['asc', 'desc'],
          default: 'asc',
          description: 'Sort order',
    annotations: { readOnlyHint: true },
        },
        agent: {
          type: 'string',
          description: 'Nome dell agente chiamante (opzionale, default: "ianus")',
    annotations: { readOnlyHint: true },
        },
      },
    },
    handler: async (args) => {
      const listPath = (args.path as string) ?? '.';
      const includePattern = args.include as string | undefined;
      const sortBy = (args.sortBy as SortBy) ?? 'name';
      const order = (args.order as SortOrder) ?? 'asc';

      // Permission check
      const callerAgent = (args.agent as string) || 'ianus';
      const permCheck = await deps.permission.checkOperation(
        callerAgent,
        'read',
        listPath,
        deps.workspaceRoot,
      );
      if (!permCheck.allowed) {
        return {
          content: [{ type: 'text', text: `Permission denied: ${permCheck.reason}` }],
          isError: true,
        };
      }

      try {
        const safePath = resolveSafePath(listPath, deps.workspaceRoot);

        const entryNames = await readdir(safePath);
        const entries: DirEntry[] = [];

        for (const name of entryNames) {
          const fullPath = join(safePath, name);
          const relPath = relative(deps.workspaceRoot, fullPath).replace(/\\/g, '/');

          try {
            const stats = await stat(fullPath);

            const entry: DirEntry = {
              name,
              path: relPath,
              type: getEntryType(stats),
              size: stats.size,
              mtime: stats.mtime.toISOString(),
            };

            // Apply include pattern
            if (includePattern && !minimatch(name, includePattern, { dot: true })) {
              continue;
            }

            entries.push(entry);
          } catch {
            // Skip inaccessible entries
          }
        }

        // Sort
        entries.sort((a, b) => compareEntries(a, b, sortBy, order));

        serverStats.increment();

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ entries, total: entries.length }),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            { type: 'text', text: `Error listing "${listPath}": ${(err as Error).message}` },
          ],
          isError: true,
        };
      }
    },
  });
}
