/**
 * fs_symlink — Ianus Liminalis
 *
 * Crea, legge, rimuove ed elenca symlink.
 * Supporta file, directory e junction (Windows) symlink.
 */

import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { symlink, readlink, lstat, unlink, readdir } from 'node:fs/promises';
import { resolve, relative, sep } from 'node:path';
import { resolveSafePath } from '../core/path-utils.js';
import { logToJournal } from '../core/journal-logger.js';
import { stats as serverStats } from '../core/stats.js';
import { toolRegistry } from './registry.js';
import type { ToolDeps } from './types.js';

type SymlinkType = 'file' | 'dir' | 'junction';
const VALID_TYPES: SymlinkType[] = ['file', 'dir', 'junction'];

interface SymlinkEntry {
  path: string;
  target: string;
  type: 'file' | 'dir';
  broken: boolean;
}

/**
 * Estrae il nome directory da un path (evita import path.dirname per coerenza).
 */
function parentDir(p: string): string {
  const idx = p.lastIndexOf(sep);
  if (idx === -1) return '.';
  return p.substring(0, idx) || sep;
}

/**
 * Cammina una directory (1 livello) raccogliendo tutti i symlink.
 */
async function collectSymlinks(dirPath: string, workspaceRoot: string): Promise<SymlinkEntry[]> {
  const results: SymlinkEntry[] = [];
  let entries: string[];

  try {
    entries = await readdir(dirPath);
  } catch {
    return results;
  }

  for (const entry of entries) {
    const fullPath = resolve(dirPath, entry);
    try {
      const stats = await lstat(fullPath);
      if (stats.isSymbolicLink()) {
        const rawTarget = await readlink(fullPath);
        const symlinkType = stats.isDirectory() ? 'dir' : 'file';
        const targetAbs = resolve(parentDir(fullPath), rawTarget);

        let targetExists = false;
        try {
          await lstat(targetAbs);
          targetExists = true;
        } catch {
          // Broken symlink
        }

        results.push({
          path: relative(workspaceRoot, fullPath).replace(/\\/g, '/'),
          target: rawTarget,
          type: symlinkType as 'file' | 'dir',
          broken: !targetExists,
        });
      }
    } catch {
      // Skip inaccessible entries
    }
  }

  return results;
}

export function registerSymlink(_server: Server, deps: ToolDeps): void {
  toolRegistry.register({
    name: 'fs_symlink',
    description:
      'Create, read, remove, and list symbolic links. Supports file, directory, and junction (Windows) symlinks.',
    annotations: { destructiveHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        operation: {
          type: 'string',
          enum: ['create', 'read', 'remove', 'list'],
          description: 'Symlink operation to perform',
        },
        target: {
          type: 'string',
          description: 'Target path (required for "create" operation)',
        },
        path: {
          type: 'string',
          description:
            'Symlink path (for create/read/remove) or directory to scan (for list)',
        },
        type: {
          type: 'string',
          enum: ['file', 'dir', 'junction'],
          default: 'file',
          description:
            'Symlink type (default: "file", "junction" is Windows-only)',
        },
        agent: {
          type: 'string',
          description:
            'Nome dell agente chiamante (opzionale, default: "ianus")',
        },
      },
      required: ['operation', 'path'],
    },
    handler: async (args) => {
      const operation = args.operation as string | undefined;
      if (!operation || !['create', 'read', 'remove', 'list'].includes(operation)) {
        return {
          content: [
            {
              type: 'text',
              text:
                'Missing or invalid required parameter: "operation". Must be one of: create, read, remove, list',
            },
          ],
          isError: true,
        };
      }

      const rawPath = args.path as string | undefined;
      if (!rawPath) {
        return {
          content: [{ type: 'text', text: 'Missing required parameter: "path"' }],
          isError: true,
        };
      }

      const callerAgent = (args.agent as string) || 'ianus';
      const symlinkType = (args.type as string) || 'file';

      if (!VALID_TYPES.includes(symlinkType as SymlinkType)) {
        return {
          content: [
            {
              type: 'text',
              text: `Invalid symlink type "${symlinkType}". Must be one of: file, dir, junction`,
            },
          ],
          isError: true,
        };
      }

      try {
        switch (operation) {
          case 'create':
            return await handleCreate(args, rawPath, symlinkType, callerAgent, deps);
          case 'read':
            return await handleRead(rawPath, callerAgent, deps);
          case 'remove':
            return await handleRemove(rawPath, callerAgent, deps);
          case 'list':
            return await handleList(rawPath, callerAgent, deps);
          default:
            return {
              content: [{ type: 'text', text: `Unknown operation: "${operation}"` }],
              isError: true,
            };
        }
      } catch (err) {
        const nodeErr = err as NodeJS.ErrnoException;
        if (nodeErr.code === 'EPERM') {
          return {
            content: [
              {
                type: 'text',
                text:
                  `Permission denied: symlink operation requires elevated privileges. ` +
                  `On Windows, enable Developer Mode or run as Administrator. Error: ${nodeErr.message}`,
              },
            ],
            isError: true,
          };
        }
        if (nodeErr.code === 'ENOENT') {
          return {
            content: [{ type: 'text', text: `Path not found: ${nodeErr.message}` }],
            isError: true,
          };
        }
        if (nodeErr.code === 'EEXIST') {
          return {
            content: [{ type: 'text', text: `Path already exists: ${nodeErr.message}` }],
            isError: true,
          };
        }
        if (nodeErr.code === 'EINVAL') {
          return {
            content: [
              {
                type: 'text',
                text:
                  `Invalid argument: ${nodeErr.message}. ` +
                  `On Windows, junction type requires a directory target.`,
              },
            ],
            isError: true,
          };
        }
        return {
          content: [
            { type: 'text', text: `Symlink error: ${nodeErr.message}` },
          ],
          isError: true,
        };
      }
    },
  });
}

async function handleCreate(
  args: Record<string, unknown>,
  rawPath: string,
  symlinkType: string,
  callerAgent: string,
  deps: ToolDeps,
) {
  const target = args.target as string | undefined;
  if (!target) {
    return {
      content: [
        {
          type: 'text',
          text: 'Missing required parameter: "target" (required for "create" operation)',
        },
      ],
      isError: true,
    };
  }

  // Permission check — write
  const permCheck = await deps.permission.checkOperation(
    callerAgent,
    'write',
    rawPath,
    deps.workspaceRoot,
  );
  if (!permCheck.allowed) {
    return {
      content: [{ type: 'text', text: `Permission denied: ${permCheck.reason}` }],
      isError: true,
    };
  }

  const safePath = resolveSafePath(rawPath, deps.workspaceRoot);

  // Verify target exists
  const targetPath = resolveSafePath(target, deps.workspaceRoot);
  try {
    await lstat(targetPath);
  } catch {
    return {
      content: [
        { type: 'text', text: `Target does not exist: "${target}"` },
      ],
      isError: true,
    };
  }

  // Verify path doesn't already exist
  try {
    await lstat(safePath);
    return {
      content: [
        {
          type: 'text',
          text: `Path already exists: "${rawPath}". Cannot create symlink — file or directory already exists.`,
        },
      ],
      isError: true,
    };
  } catch {
    // Path doesn't exist — proceed
  }

  // Map type string to Node.js fs.symlink type parameter
  const fsType: SymlinkType =
    symlinkType === 'junction' ? 'junction' : (symlinkType as 'file' | 'dir');

  // Create symlink
  await symlink(targetPath, safePath, fsType);

  // Verify symlink was created
  const stats = await lstat(safePath);
  if (!stats.isSymbolicLink()) {
    return {
      content: [
        {
          type: 'text',
          text: 'Symlink creation failed: path exists but is not a symbolic link',
        },
      ],
      isError: true,
    };
  }

  const resolvedTarget = resolve(parentDir(safePath), target);

  // Log to journal
  await logToJournal(deps.workspaceRoot, {
    agent: 'ianus',
    operation: 'symlink_create',
    path: rawPath,
    details: { target, type: symlinkType },
  });

  serverStats.increment();

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          path: rawPath,
          target,
          resolvedTarget: relative(deps.workspaceRoot, resolvedTarget).replace(/\\/g, '/'),
          type: symlinkType,
        }),
      },
    ],
  };
}

async function handleRead(
  rawPath: string,
  callerAgent: string,
  deps: ToolDeps,
) {
  // Permission check — read
  const permCheck = await deps.permission.checkOperation(
    callerAgent,
    'read',
    rawPath,
    deps.workspaceRoot,
  );
  if (!permCheck.allowed) {
    return {
      content: [{ type: 'text', text: `Permission denied: ${permCheck.reason}` }],
      isError: true,
    };
  }

  const safePath = resolveSafePath(rawPath, deps.workspaceRoot);

  // Verify it's a symlink
  const stats = await lstat(safePath);
  if (!stats.isSymbolicLink()) {
    return {
      content: [
        { type: 'text', text: `Not a symbolic link: "${rawPath}"` },
      ],
      isError: true,
    };
  }

  // Read link target
  const rawTarget = await readlink(safePath);

  // Resolve to absolute path
  const absoluteTarget = resolve(parentDir(safePath), rawTarget);

  // Check if target still exists
  let targetExists = false;
  try {
    await lstat(absoluteTarget);
    targetExists = true;
  } catch {
    // Broken symlink
  }

  // Log to journal
  await logToJournal(deps.workspaceRoot, {
    agent: 'ianus',
    operation: 'symlink_read',
    path: rawPath,
  });

  serverStats.increment();

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          path: rawPath,
          target: rawTarget,
          absoluteTarget: relative(deps.workspaceRoot, absoluteTarget).replace(/\\/g, '/'),
          exists: targetExists,
        }),
      },
    ],
  };
}

async function handleRemove(
  rawPath: string,
  callerAgent: string,
  deps: ToolDeps,
) {
  // Permission check — delete
  const permCheck = await deps.permission.checkOperation(
    callerAgent,
    'delete',
    rawPath,
    deps.workspaceRoot,
  );
  if (!permCheck.allowed) {
    return {
      content: [{ type: 'text', text: `Permission denied: ${permCheck.reason}` }],
      isError: true,
    };
  }

  const safePath = resolveSafePath(rawPath, deps.workspaceRoot);

  // Verify it's a symlink
  const stats = await lstat(safePath);
  if (!stats.isSymbolicLink()) {
    return {
      content: [
        { type: 'text', text: `Not a symbolic link: "${rawPath}"` },
      ],
      isError: true,
    };
  }

  // Remove symlink (unlink removes the symlink itself, not the target)
  await unlink(safePath);

  // Log to journal
  await logToJournal(deps.workspaceRoot, {
    agent: 'ianus',
    operation: 'symlink_remove',
    path: rawPath,
  });

  serverStats.increment();

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          path: rawPath,
          removed: true,
        }),
      },
    ],
  };
}

async function handleList(
  rawPath: string,
  callerAgent: string,
  deps: ToolDeps,
) {
  // Permission check — read
  const permCheck = await deps.permission.checkOperation(
    callerAgent,
    'read',
    rawPath,
    deps.workspaceRoot,
  );
  if (!permCheck.allowed) {
    return {
      content: [{ type: 'text', text: `Permission denied: ${permCheck.reason}` }],
      isError: true,
    };
  }

  const safePath = resolveSafePath(rawPath, deps.workspaceRoot);

  // Verify it's a directory
  const stats = await lstat(safePath);
  if (!stats.isDirectory()) {
    return {
      content: [
        { type: 'text', text: `Not a directory: "${rawPath}"` },
      ],
      isError: true,
    };
  }

  const symlinks = await collectSymlinks(safePath, deps.workspaceRoot);

  // Log to journal
  await logToJournal(deps.workspaceRoot, {
    agent: 'ianus',
    operation: 'symlink_list',
    path: rawPath,
    details: { total: symlinks.length },
  });

  serverStats.increment();

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          path: rawPath,
          symlinks,
          total: symlinks.length,
        }),
      },
    ],
  };
}
