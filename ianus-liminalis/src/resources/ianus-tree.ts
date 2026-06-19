/**
 * Resource: ianus://tree/{path}
 *
 * Espone la struttura di una directory in formato JSON.
 */

import type { ToolDeps } from '../tools/types.js';
import { readdir, stat } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import type { ResourceHandler } from './ianus-files.js';

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
): Promise<TreeNode> {
  const name =
    dirPath === basePath
      ? '.'
      : relative(basePath, dirPath).split(/[/\\]/).pop() || '.';
  const relPath = relative(basePath, dirPath).replace(/\\/g, '/') || '.';

  if (depth >= maxDepth) {
    return { name, path: relPath, type: 'directory' };
  }

  let entries: string[];
  try {
    entries = await readdir(dirPath);
  } catch {
    return { name, path: relPath, type: 'directory' };
  }

  const sortedEntries = (
    await Promise.all(
      entries.map(async (entry) => {
        const fullPath = join(dirPath, entry);
        try {
          const s = await stat(fullPath);
          return { name: entry, fullPath, isDirectory: s.isDirectory(), size: s.size };
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
    if (entry.isDirectory) {
      const subtree = await buildTree(entry.fullPath, basePath, depth + 1, maxDepth);
      children.push(subtree);
    } else {
      children.push({ name: entry.name, path: entryRelPath, type: 'file', size: entry.size });
    }
  }

  return { name, path: relPath, type: 'directory', children };
}

export const treeResourceHandler: ResourceHandler = {
  uriTemplate: 'ianus://tree/{path}',
  name: 'Directory tree',
  description: 'Struttura ad albero di una directory nel workspace',

  match(uri: string): string | null {
    const match = uri.match(/^ianus:\/\/tree\/(.*)$/);
    return match ? (match[1] || '.') : null;
  },

  async read(uri: string, deps: ToolDeps) {
    const treePath = this.match(uri)!;
    const resolved = resolve(deps.workspaceRoot, treePath);

    if (!resolved.startsWith(deps.workspaceRoot)) {
      throw new Error('Path traversal');
    }

    const tree = await buildTree(resolved, resolved, 0, 5);
    return {
      uri,
      mimeType: 'application/json',
      text: JSON.stringify({ tree: tree.children ?? [] }, null, 2),
    };
  },
};
