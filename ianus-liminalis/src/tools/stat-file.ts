import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { stat as fsStat, lstat } from 'node:fs/promises';
import { resolveSafePath } from '../core/path-utils.js';
import { stats as serverStats } from '../core/stats.js';
import { toolRegistry } from './registry.js';
import type { ToolDeps } from './types.js';

/**
 * Convert numeric mode to symbolic permissions string (e.g. "rwxr-xr-x").
 */
function modeToSymbolic(mode: number): string {
  const s = (mode & 0o777).toString(8).padStart(3, '0');
  const permChars = ['---', '--x', '-w-', '-wx', 'r--', 'r-x', 'rw-', 'rwx'];
  return s
    .split('')
    .map((c) => permChars[parseInt(c, 10)])
    .join('');
}

/**
 * Determine file type from the stats.
 */
function getType(stats: { isFile: () => boolean; isDirectory: () => boolean; isSymbolicLink: () => boolean }): string {
  if (stats.isSymbolicLink()) return 'symlink';
  if (stats.isDirectory()) return 'directory';
  if (stats.isFile()) return 'file';
  return 'other';
}

export function registerStatFile(_server: Server, deps: ToolDeps): void {
  toolRegistry.register({
    name: 'fs_stat',
    annotations: { readOnlyHint: true },
    description: 'Get detailed metadata about a file, directory, or symlink.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path of the file or directory (relative to workspace)',
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
        return { content: [{ type: 'text', text: 'Missing required parameter: "path"' }], isError: true };
      }

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

        // Use lstat to detect symlinks without following them
        const fileStats = await lstat(safePath);
        const fileType = getType(fileStats);

        // If it's a symlink, also get stats of the target
        let targetStats = fileStats;
        if (fileStats.isSymbolicLink()) {
          try {
            targetStats = await fsStat(safePath);
          } catch {
            // Symlink target doesn't exist — keep lstat data
          }
        }

        const result = {
          size: targetStats.size,
          type: fileType,
          mtime: targetStats.mtime.toISOString(),
          ctime: targetStats.ctime.toISOString(),
          birthtime: targetStats.birthtime.toISOString(),
          mode: targetStats.mode,
          permissions: modeToSymbolic(targetStats.mode),
          owner: targetStats.uid,
          group: targetStats.gid,
        };

        serverStats.increment();

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            { type: 'text', text: `Error stating "${filePath}": ${(err as Error).message}` },
          ],
          isError: true,
        };
      }
    },
  });
}
