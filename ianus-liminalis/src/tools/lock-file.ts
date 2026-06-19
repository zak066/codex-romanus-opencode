/**
 * fs_lock, fs_unlock, fs_get_locks — Ianus Liminalis
 *
 * Tool handlers per la gestione atomica dei file lock.
 * Previene race condition quando più agenti modificano gli stessi file.
 * Si appoggia al core layer file-lock.ts per la logica di lock/unlock.
 */

import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { resolveSafePath } from '../core/path-utils.js';
import { stats as serverStats } from '../core/stats.js';
import { logToJournal } from '../core/journal-logger.js';
import { toolRegistry } from './registry.js';
import type { ToolDeps } from './types.js';
import { acquireLock, releaseLock, listLocks } from '../core/file-lock.js';

// ─── fs_lock ─────────────────────────────────────────────────────────────

/**
 * fs_lock — Acquisisce un lock esclusivo su un file.
 *
 * Strategia:
 *  1. Validazione parametri obbligatori (path, owner)
 *  2. Permission check (write)
 *  3. resolveSafePath → acquireLock
 *  4. Se success → journal + stats
 *  5. Se fallimento → isError con dettaglio
 */
export function registerLockFile(_server: Server, deps: ToolDeps): void {
  toolRegistry.register({
    name: 'fs_lock',
    description: 'Lock a file exclusively to prevent concurrent modifications',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'File path relative to workspace',
        },
        owner: {
          type: 'string',
          description: 'Agent name requesting the lock',
        },
        ttl_minutes: {
          type: 'number',
          default: 15,
          description: 'Lock duration in minutes (default: 15)',
        },
        agent: {
          type: 'string',
          description: 'Calling agent name (optional, default: "ianus")',
        },
      },
      required: ['path', 'owner'],
    },
    handler: async (args) => {
      const filePath = args.path as string | undefined;
      if (!filePath) {
        return { content: [{ type: 'text', text: 'Missing required parameter: "path"' }], isError: true };
      }

      const owner = args.owner as string | undefined;
      if (!owner) {
        return { content: [{ type: 'text', text: 'Missing required parameter: "owner"' }], isError: true };
      }

      const ttlMinutes = (args.ttl_minutes as number) ?? 15;
      const callerAgent = (args.agent as string) || 'ianus';

      // Permission check — write required to lock a file
      const permCheck = await deps.permission.checkOperation(
        callerAgent,
        'write',
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
        const result = await acquireLock(safePath, owner, { ttlMinutes });

        if (!result.success) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ success: false, error: result.error, lock: result.lock }) }],
            isError: true,
          };
        }

        // Log to journal
        await logToJournal(deps.workspaceRoot, {
          agent: 'ianus',
          operation: 'lock',
          path: filePath,
          details: { owner, ttlMinutes, forcedAcquire: result.forcedAcquire },
        });

        serverStats.increment();

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                lock: result.lock,
                forcedAcquire: result.forcedAcquire,
              }),
            },
          ],
        };
      } catch (err) {
        return {
          content: [{ type: 'text', text: `Error locking file "${filePath}": ${(err as Error).message}` }],
          isError: true,
        };
      }
    },
  });
}

// ─── fs_unlock ───────────────────────────────────────────────────────────

/**
 * fs_unlock — Rilascia un lock su un file.
 *
 * Regole:
 *  - Solo l'owner del lock può rilasciarlo
 *  - Se il lock non esiste → success (no-op)
 *  - Owner mismatch → isError con dettaglio
 */
export function registerUnlockFile(_server: Server, deps: ToolDeps): void {
  toolRegistry.register({
    name: 'fs_unlock',
    description: 'Release a file lock',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'File path relative to workspace',
        },
        owner: {
          type: 'string',
          description: 'Owner of the lock to release',
        },
        agent: {
          type: 'string',
          description: 'Calling agent name (optional, default: "ianus")',
        },
      },
      required: ['path', 'owner'],
    },
    handler: async (args) => {
      const filePath = args.path as string | undefined;
      if (!filePath) {
        return { content: [{ type: 'text', text: 'Missing required parameter: "path"' }], isError: true };
      }

      const owner = args.owner as string | undefined;
      if (!owner) {
        return { content: [{ type: 'text', text: 'Missing required parameter: "owner"' }], isError: true };
      }

      const callerAgent = (args.agent as string) || 'ianus';

      // Permission check — write required to release a lock
      const permCheck = await deps.permission.checkOperation(
        callerAgent,
        'write',
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
        const result = await releaseLock(safePath, owner);

        if (!result.success) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ success: false, error: result.error }) }],
            isError: true,
          };
        }

        // Log to journal
        await logToJournal(deps.workspaceRoot, {
          agent: 'ianus',
          operation: 'unlock',
          path: filePath,
          details: { owner },
        });

        serverStats.increment();

        return {
          content: [{ type: 'text', text: JSON.stringify({ success: true }) }],
        };
      } catch (err) {
        return {
          content: [{ type: 'text', text: `Error unlocking file "${filePath}": ${(err as Error).message}` }],
          isError: true,
        };
      }
    },
  });
}

// ─── fs_get_locks ────────────────────────────────────────────────────────

/**
 * fs_get_locks — Elenca tutti i lock attivi nel workspace.
 *
 * Logica:
 *  1. Permission check (read) sul path richiesto (o root di default)
 *  2. Se directory fornita → resolveSafePath
 *  3. listLocks con/senza includeStale
 *  4. Journal + stats
 */
export function registerGetLocks(_server: Server, deps: ToolDeps): void {
  toolRegistry.register({
    name: 'fs_get_locks',
    description: 'List all active file locks in the workspace',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        directory: {
          type: 'string',
          description: 'Directory to scan (optional, default: workspace root)',
        },
        include_stale: {
          type: 'boolean',
          default: false,
          description: 'Include stale/expired locks (default: false)',
        },
        agent: {
          type: 'string',
          description: 'Calling agent name (optional, default: "ianus")',
        },
      },
      required: [],
    },
    handler: async (args) => {
      const directory = args.directory as string | undefined;
      const includeStale = (args.include_stale as boolean) ?? false;
      const callerAgent = (args.agent as string) || 'ianus';

      // Permission check — read required to list locks
      const targetForPermCheck = directory || '.';
      const permCheck = await deps.permission.checkOperation(
        callerAgent,
        'read',
        targetForPermCheck,
        deps.workspaceRoot,
      );
      if (!permCheck.allowed) {
        return {
          content: [{ type: 'text', text: `Permission denied: ${permCheck.reason}` }],
          isError: true,
        };
      }

      // Resolve directory path (safe)
      let resolvedDir: string;
      try {
        if (directory) {
          resolvedDir = resolveSafePath(directory, deps.workspaceRoot);
        } else {
          resolvedDir = deps.workspaceRoot;
        }
      } catch (err) {
        return {
          content: [{ type: 'text', text: `Invalid directory path: ${(err as Error).message}` }],
          isError: true,
        };
      }

      try {
        const locks = await listLocks(resolvedDir, { includeStale });

        // Log to journal
        await logToJournal(deps.workspaceRoot, {
          agent: 'ianus',
          operation: 'get_locks',
          path: directory || '.',
          details: { includeStale, count: locks.length },
        });

        serverStats.increment();

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ locks, count: locks.length }),
            },
          ],
        };
      } catch (err) {
        return {
          content: [{ type: 'text', text: `Error listing locks: ${(err as Error).message}` }],
          isError: true,
        };
      }
    },
  });
}
