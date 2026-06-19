/**
 * fs_watch — Ianus Liminalis
 *
 * Watch cambiamenti di file/directory in tempo reale.
 * Usa fs.watch di Node.js e raccoglie eventi per una durata configurabile.
 * Poiché MCP non supporta subscription-based notifications, implementiamo
 * come polling: avvia watch, raccogli eventi per `duration` ms, ferma e restituisci.
 */

import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { watch } from 'node:fs';
import { resolveSafePath } from '../core/path-utils.js';
import { stats as serverStats } from '../core/stats.js';
import { toolRegistry } from './registry.js';
import type { ToolDeps } from './types.js';

interface WatchEvent {
  type: string;
  filename: string | null;
  timestamp: string;
}

export function registerWatchFile(_server: Server, deps: ToolDeps): void {
  toolRegistry.register({
    name: 'fs_watch',
    description:
      'Watch a file or directory for changes. Collects events for a specified duration (default 30s) and returns them.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to watch (file or directory, relative to workspace)',
    annotations: { readOnlyHint: true },
        },
        recursive: {
          type: 'boolean',
          default: false,
          description: 'Watch subdirectories recursively (macOS and Windows only)',
    annotations: { readOnlyHint: true },
        },
        events: {
          type: 'string',
          enum: ['change', 'rename', 'all'],
          default: 'all',
          description: 'Type of events to listen for',
    annotations: { readOnlyHint: true },
        },
        duration: {
          type: 'number',
          default: 30000,
          description: 'Watch duration in milliseconds (default: 30000 = 30s)',
    annotations: { readOnlyHint: true },
        },
        agent: {
          type: 'string',
          description: 'Nome dell agente chiamante (opzionale, default: "ianus")',
    annotations: { readOnlyHint: true },
        },
      },
      required: ['path'],
    },
    handler: async (args) => {
      const watchPath = args.path as string | undefined;
      if (!watchPath) {
        return { content: [{ type: 'text', text: 'Missing required parameter: "path"' }], isError: true };
      }

      const recursive = args.recursive === true;
      const eventFilter = (args.events as string) ?? 'all';
      const duration = (args.duration as number) ?? 30000;

      if (duration <= 0 || duration > 300000) {
        return {
          content: [{ type: 'text', text: 'Duration must be between 1 and 300000 ms' }],
          isError: true,
        };
      }

      // Permission check
      const callerAgent = (args.agent as string) || 'ianus';
      const permCheck = await deps.permission.checkOperation(
        callerAgent,
        'read',
        watchPath,
        deps.workspaceRoot,
      );
      if (!permCheck.allowed) {
        return {
          content: [{ type: 'text', text: `Permission denied: ${permCheck.reason}` }],
          isError: true,
        };
      }

      try {
        const safePath = resolveSafePath(watchPath, deps.workspaceRoot);

        const collected: WatchEvent[] = [];

        const watcher = watch(
          safePath,
          { recursive },
          (eventType, filename) => {
            // Apply event filter
            if (eventFilter !== 'all' && eventType !== eventFilter) return;

            collected.push({
              type: eventType,
              filename,
              timestamp: new Date().toISOString(),
            });
          },
        );

        // Wait for the specified duration
        await new Promise<void>((resolve) => {
          setTimeout(() => {
            watcher.close();
            resolve();
          }, duration);
        });

        serverStats.increment();

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                events: collected,
                watched: true,
              }),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            { type: 'text', text: `Error watching "${watchPath}": ${(err as Error).message}` },
          ],
          isError: true,
        };
      }
    },
  });
}
