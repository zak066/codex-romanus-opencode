/**
 * fs_temp_sandbox — Ianus Liminalis
 *
 * Crea una directory temporanea isolata nel workspace,
 * con supporto cleanup automatico dopo TTL.
 */

import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { resolveSafePath } from '../core/path-utils.js';
import { logToJournal } from '../core/journal-logger.js';
import { stats as serverStats } from '../core/stats.js';
import { toolRegistry } from './registry.js';
import type { ToolDeps } from './types.js';

/** Mappa globale per tenere traccia dei timeout di cleanup attivi */
const cleanupTimers = new Map<string, ReturnType<typeof setTimeout>>();

function generateSandboxId(): string {
  return randomUUID().slice(0, 8);
}

export function registerTempSandbox(_server: Server, deps: ToolDeps): void {
  toolRegistry.register({
    name: 'fs_temp_sandbox',
    annotations: { idempotentHint: true },
    description:
      'Create an isolated temporary directory in the workspace. ' +
      'Supports automatic cleanup after TTL and optional seed files.',
    inputSchema: {
      type: 'object',
      properties: {
        prefix: {
          type: 'string',
          default: 'sandbox',
          description:
            'Prefix for the directory name (default: "sandbox")',
        },
        ttl: {
          type: 'number',
          default: 30,
          description:
            'Minutes before automatic cleanup (default: 30, max: 1440)',
        },
        seed: {
          type: 'object',
          properties: {
            files: {
              type: 'object',
              additionalProperties: { type: 'string' },
              description:
                'Initial files to create inside the sandbox. ' +
                'Nested paths (e.g. "subdir/file.json") create subdirectories.',
            },
          },
          description: 'Optional seed files to bootstrap the sandbox',
        },
        agent: {
          type: 'string',
          description:
            'Nome dell agente chiamante (opzionale, default: "ianus")',
        },
      },
      required: [],
    },
    handler: async (args) => {
      const prefix = (args.prefix as string) || 'sandbox';
      let ttl = typeof args.ttl === 'number' ? args.ttl : 30;
      if (ttl < 1) ttl = 1;
      if (ttl > 1440) ttl = 1440;
      const seed = args.seed as
        | { files?: Record<string, string> }
        | undefined;

      const callerAgent = (args.agent as string) || 'ianus';

      // Root temp directory inside workspace
      const tempRoot = join(deps.workspaceRoot, '.ianus-temp');
      const safeTempRoot = resolveSafePath('.ianus-temp', deps.workspaceRoot);

      // Permission check — write is required to create the sandbox
      const permCheck = await deps.permission.checkOperation(
        callerAgent,
        'write',
        '.ianus-temp',
        deps.workspaceRoot,
      );
      if (!permCheck.allowed) {
        return {
          content: [
            {
              type: 'text',
              text: `Permission denied: ${permCheck.reason}`,
            },
          ],
          isError: true,
        };
      }

      try {
        // Ensure .ianus-temp exists
        await mkdir(safeTempRoot, { recursive: true });

        // Create sandbox directory: <prefix>_<timestamp>_<random>
        const timestamp = Date.now();
        const sandboxId = generateSandboxId();
        const dirName = `${prefix}_${timestamp}_${sandboxId}`;
        const sandboxPath = join(safeTempRoot, dirName);
        const relativeSandboxPath = join('.ianus-temp', dirName);

        await mkdir(sandboxPath, { recursive: true });

        // Create seed files if specified
        if (seed?.files) {
          for (const [filePath, content] of Object.entries(seed.files)) {
            const fullPath = join(sandboxPath, filePath);
            // Ensure parent directory exists for nested paths
            await mkdir(dirname(fullPath), { recursive: true });
            await writeFile(fullPath, content, 'utf-8');
          }
        }

        // Schedule automatic cleanup
        const cleanupTimeout = setTimeout(async () => {
          try {
            const { rm } = await import('node:fs/promises');
            await rm(sandboxPath, { recursive: true, force: true });
            cleanupTimers.delete(sandboxId);
          } catch {
            // Cleanup failures are non-fatal — log and move on
          }
        }, ttl * 60 * 1000);

        // Make the timeout unref so it doesn't keep the process alive
        cleanupTimeout.unref();

        cleanupTimers.set(sandboxId, cleanupTimeout);

        // Log to journal
        await logToJournal(deps.workspaceRoot, {
          agent: 'ianus',
          operation: 'temp_sandbox',
          path: relativeSandboxPath,
          details: {
            sandboxId,
            ttl,
            prefix,
            seedFiles: seed?.files ? Object.keys(seed.files).length : 0,
          },
        });

        serverStats.increment();

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                path: relativeSandboxPath.replace(/\\/g, '/'),
                sandboxId,
                ttl,
              }),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: 'text',
              text: `Error creating temp sandbox: ${(err as Error).message}`,
            },
          ],
          isError: true,
        };
      }
    },
  });
}

/**
 * Cancella manualmente il timer di cleanup per una sandbox.
 * Utile se la sandbox viene eliminata prima dello scadere del TTL.
 */
export function cancelCleanup(sandboxId: string): boolean {
  const timer = cleanupTimers.get(sandboxId);
  if (timer) {
    clearTimeout(timer);
    cleanupTimers.delete(sandboxId);
    return true;
  }
  return false;
}
