import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { readdir, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { minimatch } from 'minimatch';
import { resolveSafePath } from '../core/path-utils.js';
import { stats as serverStats } from '../core/stats.js';
import { toolRegistry } from './registry.js';
import type { ToolDeps } from './types.js';

interface TreeNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
  children?: TreeNode[];
}

async function buildTree(
  dirPath: string,
  basePath: string,
  depth: number,
  maxDepth: number,
  includePattern?: string,
  excludePattern?: string,
): Promise<TreeNode> {
  const name = dirPath === basePath ? '.' : relative(basePath, dirPath).split(/[/\\]/).pop() || '.';
  const relPath = relative(basePath, dirPath).replace(/\\/g, '/') || '.';

  // Exclude check on the directory itself
  if (excludePattern && minimatch(relPath, excludePattern, { dot: true })) {
    return { name, path: relPath, type: 'directory' };
  }

  if (depth >= maxDepth) {
    return { name, path: relPath, type: 'directory' };
  }

  let entries: string[];
  try {
    entries = await readdir(dirPath);
  } catch {
    return { name, path: relPath, type: 'directory' };
  }

  // Sort entries: directories first, then files alphabetically
  const sortedEntries = (
    await Promise.all(
      entries.map(async (entry) => {
        const fullPath = join(dirPath, entry);
        try {
          const stats = await stat(fullPath);
          return { name: entry, fullPath, isDirectory: stats.isDirectory(), size: stats.size };
        } catch {
          return null;
        }
      }),
    )
  ).filter((e): e is NonNullable<typeof e> => e !== null);

  sortedEntries.sort((a, b) => {
    if (a.isDirectory && !b.isDirectory) return -1;
    if (!a.isDirectory && b.isDirectory) return 1;
    return a.name.localeCompare(b.name);
  });

  const children: TreeNode[] = [];

  for (const entry of sortedEntries) {
    const entryRelPath = relative(basePath, entry.fullPath).replace(/\\/g, '/');

    // Apply include pattern
    if (includePattern && !minimatch(entryRelPath, includePattern, { dot: true })) {
      // Still recurse into directories even if they don't match — their children might
      if (entry.isDirectory) {
        const subtree = await buildTree(
          entry.fullPath,
          basePath,
          depth + 1,
          maxDepth,
          includePattern,
          excludePattern,
        );
        if (subtree.children && subtree.children.length > 0) {
          children.push(subtree);
        }
      }
      continue;
    }

    // Apply exclude pattern
    if (excludePattern && minimatch(entryRelPath, excludePattern, { dot: true })) {
      continue;
    }

    if (entry.isDirectory) {
      const subtree = await buildTree(
        entry.fullPath,
        basePath,
        depth + 1,
        maxDepth,
        includePattern,
        excludePattern,
      );
      children.push(subtree);
    } else {
      children.push({
        name: entry.name,
        path: entryRelPath,
        type: 'file',
        size: entry.size,
      });
    }
  }

  return {
    name,
    path: relPath,
    type: 'directory',
    children,
  };
}

export function registerTreeFile(_server: Server, deps: ToolDeps): void {
  toolRegistry.register({
    name: 'fs_tree',
    description:
      'List directory contents in a tree structure with configurable depth. Supports include/exclude glob patterns.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          default: '.',
          description: 'Directory path to explore (relative to workspace)',
    annotations: { readOnlyHint: true },
        },
        depth: {
          type: 'number',
          default: 3,
          description: 'Maximum recursion depth',
    annotations: { readOnlyHint: true },
        },
        include: {
          type: 'string',
          description: 'Glob pattern to include (e.g., *.ts)',
    annotations: { readOnlyHint: true },
        },
        exclude: {
          type: 'string',
          description: 'Glob pattern to exclude (e.g., node_modules/**)',
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
      const treePath = (args.path as string) ?? '.';
      const depth = (args.depth as number) ?? 3;
      const includePattern = args.include as string | undefined;
      const excludePattern = args.exclude as string | undefined;

      // Permission check
      const callerAgent = (args.agent as string) || 'ianus';
      const permCheck = await deps.permission.checkOperation(
        callerAgent,
        'read',
        treePath,
        deps.workspaceRoot,
      );
      if (!permCheck.allowed) {
        return {
          content: [{ type: 'text', text: `Permission denied: ${permCheck.reason}` }],
          isError: true,
        };
      }

      try {
        const safePath = resolveSafePath(treePath, deps.workspaceRoot);

        const tree = await buildTree(
          safePath,
          safePath,
          0,
          depth,
          includePattern,
          excludePattern,
        );

        serverStats.increment();

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ tree: tree.children ?? [] }),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            { type: 'text', text: `Error building tree for "${treePath}": ${(err as Error).message}` },
          ],
          isError: true,
        };
      }
    },
  });
}
