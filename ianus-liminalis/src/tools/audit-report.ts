/**
 * fs_audit_report — Ianus Liminalis
 *
 * Genera un report audit formattato (JSON o Markdown) dal file change journal.
 * Supporta filtri per periodo, agente, operazione e raggruppamento per day/agent/operation.
 */

import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { stats as serverStats } from '../core/stats.js';
import { toolRegistry } from './registry.js';
import type { ToolDeps } from './types.js';
import type { JournalEntry } from '../core/journal-logger.js';

// ────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────

const JOURNAL_DIR = '.ianus-journal';
const JOURNAL_FILE = 'journal.jsonl';

// ────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────

interface AuditReportJson {
  period: { from: string; to: string };
  totalEntries: number;
  summary: {
    totalFiles: number;
    agents: string[];
    operations: Record<string, number>;
  };
  groups: Array<{
    key: string;
    entries: number;
    files: string[];
  }>;
}

// ────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// ────────────────────────────────────────────────────────────
// Report Generators
// ────────────────────────────────────────────────────────────

function generateMarkdown(
  entries: JournalEntry[],
  from: string,
  to: string,
  groupBy: string,
): string {
  const lines: string[] = [];
  lines.push('# Audit Report');
  lines.push('');
  lines.push(`Period: ${formatDate(new Date(from))} — ${formatDate(new Date(to))}`);
  lines.push('');

  // Summary
  const agents = [...new Set(entries.map((e) => e.agent))];
  const files = [...new Set(entries.map((e) => e.path))].filter(Boolean);
  const operations: Record<string, number> = {};
  for (const e of entries) {
    operations[e.operation] = (operations[e.operation] || 0) + 1;
  }

  lines.push('## Summary');
  lines.push('');
  lines.push(`- Total entries: ${entries.length}`);
  lines.push(`- Files affected: ${files.length}`);
  lines.push(`- Agents: ${agents.join(', ')}`);
  lines.push('');

  // Grouped data
  const groupKey = groupBy as 'day' | 'agent' | 'operation';
  const groups = new Map<string, JournalEntry[]>();

  for (const entry of entries) {
    let key: string;
    if (groupKey === 'day') {
      key = formatDate(new Date(entry.timestamp));
    } else if (groupKey === 'agent') {
      key = entry.agent;
    } else {
      key = entry.operation;
    }
    const group = groups.get(key) || [];
    group.push(entry);
    groups.set(key, group);
  }

  for (const [key, groupEntries] of groups) {
    const groupFiles = [...new Set(groupEntries.map((e) => e.path))].filter(Boolean);
    lines.push(`### ${key} (${groupEntries.length} entries)`);
    lines.push('');
    lines.push('| File | Operation | Agent |');
    lines.push('|------|-----------|-------|');
    for (const e of groupEntries.slice(0, 100)) {
      lines.push(`| ${e.path || '(root)'} | ${e.operation} | ${e.agent} |`);
    }
    if (groupEntries.length > 100) {
      lines.push(`| _... and ${groupEntries.length - 100} more_ | | |`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

function generateJson(
  entries: JournalEntry[],
  from: string,
  to: string,
  groupBy: string,
): AuditReportJson {
  const agents = [...new Set(entries.map((e) => e.agent))];
  const files = [...new Set(entries.map((e) => e.path))].filter(Boolean);
  const operations: Record<string, number> = {};
  for (const e of entries) {
    operations[e.operation] = (operations[e.operation] || 0) + 1;
  }

  const groupKey = groupBy as 'day' | 'agent' | 'operation';
  const groups = new Map<string, JournalEntry[]>();

  for (const entry of entries) {
    let key: string;
    if (groupKey === 'day') {
      key = formatDate(new Date(entry.timestamp));
    } else if (groupKey === 'agent') {
      key = entry.agent;
    } else {
      key = entry.operation;
    }
    const group = groups.get(key) || [];
    group.push(entry);
    groups.set(key, group);
  }

  const reportGroups: AuditReportJson['groups'] = [];
  for (const [key, groupEntries] of groups) {
    reportGroups.push({
      key,
      entries: groupEntries.length,
      files: [...new Set(groupEntries.map((e) => e.path))].filter(Boolean),
    });
  }

  return {
    period: { from, to },
    totalEntries: entries.length,
    summary: {
      totalFiles: files.length,
      agents,
      operations,
    },
    groups: reportGroups,
  };
}

// ────────────────────────────────────────────────────────────
// Tool Registration
// ────────────────────────────────────────────────────────────

export function registerAuditReport(_server: Server, deps: ToolDeps): void {
  toolRegistry.register({
    name: 'fs_audit_report',
    annotations: { readOnlyHint: true },
    description:
      'Generate an audit report (JSON or Markdown) from the file change journal. ' +
      'Supports filtering by date range, agent, and operation, ' +
      'with grouping by day, agent, or operation.',
    inputSchema: {
      type: 'object',
      properties: {
        from: {
          type: 'string',
          description: 'ISO start date (default: 7 days ago)',
        },
        to: {
          type: 'string',
          description: 'ISO end date (default: now)',
        },
        agent: {
          type: 'string',
          description: 'Filter by agent name',
        },
        operation: {
          type: 'string',
          description: 'Filter by operation type (e.g., "write", "delete", "edit")',
        },
        format: {
          type: 'string',
          enum: ['json', 'markdown'],
          default: 'json',
          description: 'Output format (default: json)',
        },
        output: {
          type: 'string',
          description: 'Output file path (optional, prints to stdout if omitted)',
        },
        groupBy: {
          type: 'string',
          enum: ['day', 'agent', 'operation'],
          default: 'day',
          description: 'Group results by (default: day)',
        },
      },
    },
    handler: async (args) => {
      const now = new Date();
      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

      const from = (args.from as string) ?? sevenDaysAgo.toISOString();
      const to = (args.to as string) ?? now.toISOString();
      const agentFilter = args.agent as string | undefined;
      const operationFilter = args.operation as string | undefined;
      const format = (args.format as string) ?? 'json';
      const groupBy = (args.groupBy as string) ?? 'day';

      try {
        const journalPath = join(deps.workspaceRoot, JOURNAL_DIR, JOURNAL_FILE);

        let raw: string;
        try {
          raw = await readFile(journalPath, 'utf-8');
        } catch {
          return {
            content: [{ type: 'text', text: 'No journal file found. No entries recorded yet.' }],
          };
        }

        const lines = raw.split('\n').filter((l) => l.trim().length > 0);
        const allEntries: JournalEntry[] = lines
          .map((line) => {
            try {
              return JSON.parse(line) as JournalEntry;
            } catch {
              return null;
            }
          })
          .filter((e): e is JournalEntry => e !== null);

        // Apply filters
        let filtered = allEntries;

        if (agentFilter) {
          filtered = filtered.filter((e) => e.agent === agentFilter);
        }
        if (operationFilter) {
          filtered = filtered.filter((e) => e.operation === operationFilter);
        }

        const fromDate = new Date(from).getTime();
        const toDate = new Date(to).getTime();
        if (!isNaN(fromDate)) {
          filtered = filtered.filter((e) => new Date(e.timestamp).getTime() >= fromDate);
        }
        if (!isNaN(toDate)) {
          filtered = filtered.filter((e) => new Date(e.timestamp).getTime() <= toDate);
        }

        // Sort by timestamp ascending
        filtered.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

        let outputText: string;
        if (format === 'markdown') {
          outputText = generateMarkdown(filtered, from, to, groupBy);
        } else {
          outputText = JSON.stringify(generateJson(filtered, from, to, groupBy), null, 2);
        }

        // Handle output file if specified
        if (args.output) {
          const { writeFile } = await import('node:fs/promises');
          const { resolveSafePath } = await import('../core/path-utils.js');
          const outputPath = resolveSafePath(args.output as string, deps.workspaceRoot);
          await writeFile(outputPath, outputText, 'utf-8');
        }

        serverStats.increment();

        return {
          content: [{ type: 'text', text: outputText }],
        };
      } catch (err) {
        return {
          content: [{ type: 'text', text: `Error generating audit report: ${(err as Error).message}` }],
          isError: true,
        };
      }
    },
  });
}
