/**
 * fs_journal — Ianus Liminalis
 *
 * Interroga il file journal (JSONL) con filtri per agente, path,
 * operazione, intervallo di date e limite risultati.
 */

import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { stats as serverStats } from '../core/stats.js';
import { toolRegistry } from './registry.js';
import type { ToolDeps } from './types.js';
import type { JournalEntry } from '../core/journal-logger.js';

const JOURNAL_DIR = '.ianus-journal';
const JOURNAL_FILE = 'journal.jsonl';

export function registerJournalQuery(_server: Server, deps: ToolDeps): void {
  toolRegistry.register({
    name: 'fs_journal',
    annotations: { readOnlyHint: true },
    description: 'Query the file operation journal. Supports filtering by agent, path, operation, and date range.',
    inputSchema: {
      type: 'object',
      properties: {
        agent: {
          type: 'string',
          description: 'Filter by agent name (e.g., "ianus")',
        },
        path: {
          type: 'string',
          description: 'Filter by file path (substring match)',
        },
        operation: {
          type: 'string',
          description: 'Filter by operation type (e.g., "read", "write", "backup")',
        },
        from: {
          type: 'string',
          description: 'Start date ISO string (e.g., "2026-01-01T00:00:00.000Z")',
        },
        to: {
          type: 'string',
          description: 'End date ISO string (e.g., "2026-12-31T23:59:59.000Z")',
        },
        limit: {
          type: 'number',
          default: 50,
          description: 'Maximum number of entries to return',
        },
      },
    },
    handler: async (args) => {
      const agentFilter = args.agent as string | undefined;
      const pathFilter = args.path as string | undefined;
      const operationFilter = args.operation as string | undefined;
      const fromFilter = args.from as string | undefined;
      const toFilter = args.to as string | undefined;
      const limit = (args.limit as number) ?? 50;

      try {
        const journalPath = join(deps.workspaceRoot, JOURNAL_DIR, JOURNAL_FILE);

        let raw: string;
        try {
          raw = await readFile(journalPath, 'utf-8');
        } catch {
          // Journal file doesn't exist yet — return empty
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({ entries: [], total: 0 }),
              },
            ],
          };
        }

        // Parse JSONL into entries
        const lines = raw.split('\n').filter((l) => l.trim().length > 0);
        const allEntries: JournalEntry[] = lines.map((line) => {
          try {
            return JSON.parse(line) as JournalEntry;
          } catch {
            return null;
          }
        }).filter((e): e is JournalEntry => e !== null);

        // Apply filters
        let filtered = allEntries;

        if (agentFilter) {
          filtered = filtered.filter((e) => e.agent === agentFilter);
        }
        if (pathFilter) {
          filtered = filtered.filter((e) => e.path.includes(pathFilter));
        }
        if (operationFilter) {
          filtered = filtered.filter((e) => e.operation === operationFilter);
        }
        if (fromFilter) {
          const fromDate = new Date(fromFilter).getTime();
          if (!isNaN(fromDate)) {
            filtered = filtered.filter((e) => new Date(e.timestamp).getTime() >= fromDate);
          }
        }
        if (toFilter) {
          const toDate = new Date(toFilter).getTime();
          if (!isNaN(toDate)) {
            filtered = filtered.filter((e) => new Date(e.timestamp).getTime() <= toDate);
          }
        }

        // Sort by timestamp descending
        filtered.sort(
          (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
        );

        // Apply limit
        const entries = filtered.slice(0, limit);

        // Normalize: strip details? No, include them as-is
        const result = entries.map((e) => ({
          id: e.id,
          agent: e.agent,
          operation: e.operation,
          path: e.path,
          timestamp: e.timestamp,
          details: e.details,
        }));

        serverStats.increment();

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ entries: result, total: result.length }),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            { type: 'text', text: `Error querying journal: ${(err as Error).message}` },
          ],
          isError: true,
        };
      }
    },
  });
}
