/**
 * fs_format — Ianus Liminalis
 *
 * Formatta/pretty-print un file in-place. Supporta JSON e YAML (rilevati da estensione).
 */

import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { readFile, writeFile, stat } from 'node:fs/promises';
import { extname } from 'node:path';
import { resolveSafePath } from '../core/path-utils.js';
import { stats as serverStats } from '../core/stats.js';
import { logToJournal } from '../core/journal-logger.js';
import { toolRegistry } from './registry.js';
import type { ToolDeps } from './types.js';

type FormatType = 'json' | 'yaml';

/**
 * Format JSON content with 2-space indentation and trailing newline.
 */
function formatJson(content: string): string {
  const parsed = JSON.parse(content);
  return JSON.stringify(parsed, null, 2) + '\n';
}

/**
 * Basic YAML formatter: 2-space indentation, consistent formatting.
 * Without a full YAML parser, this provides normalization:
 * - Trim trailing whitespace per line
 * - Normalize tabs to 2 spaces
 * - Ensure file ends with a single trailing newline
 */
function formatYaml(content: string): string {
  return (
    content
      .split('\n')
      .map((line) => {
        // Trim trailing whitespace
        const trimmed = line.trimEnd();
        // Normalize tabs to 2 spaces
        return trimmed.replace(/\t/g, '  ');
      })
      .join('\n')
      // Ensure exactly one trailing newline
      .replace(/\n*$/, '') + '\n'
  );
}

/**
 * Detect format type from file extension.
 */
function detectFormat(filePath: string): FormatType | null {
  const ext = extname(filePath).toLowerCase();
  if (ext === '.json') return 'json';
  if (ext === '.yaml' || ext === '.yml') return 'yaml';
  return null;
}

export function registerFormatFile(_server: Server, deps: ToolDeps): void {
  toolRegistry.register({
    name: 'fs_format',
    annotations: { destructiveHint: true, idempotentHint: true },
    description:
      'Format/pretty-print a file in-place. Supports JSON and YAML (detected by file extension).',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path of the file to format (relative to workspace)',
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
        return {
          content: [{ type: 'text', text: 'Missing required parameter: "path"' }],
          isError: true,
        };
      }

      // Detect format from extension
      const formatType = detectFormat(filePath);
      if (!formatType) {
        const ext = extname(filePath);
        return {
          content: [
            {
              type: 'text',
              text: `Unsupported file extension "${ext}". Only .json, .yaml, and .yml files are supported.`,
            },
          ],
          isError: true,
        };
      }

      // Permission check
      const callerAgent = (args.agent as string) || 'ianus';
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

        // Read file content
        const content = await readFile(safePath, 'utf-8');

        // Format based on detected type
        let formatted: string;
        try {
          if (formatType === 'json') {
            formatted = formatJson(content);
          } else {
            formatted = formatYaml(content);
          }
        } catch (parseErr) {
          return {
            content: [
              {
                type: 'text',
                text: `Error parsing "${filePath}" as ${formatType.toUpperCase()}: ${(parseErr as Error).message}`,
              },
            ],
            isError: true,
          };
        }

        // Skip write if content is already properly formatted
        if (formatted === content) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  formatted: false,
                  format: formatType,
                  reason: 'already formatted',
                  filePath,
                }),
              },
            ],
          };
        }

        // Create backup before modifying
        let backupId: string | undefined;
        try {
          await stat(safePath);
          const backup = await deps.backup.backup(safePath);
          backupId = backup.id;
        } catch {
          // File doesn't exist — shouldn't happen since we just read it
        }

        // Write formatted content
        await writeFile(safePath, formatted, 'utf-8');

        // Log to journal
        await logToJournal(deps.workspaceRoot, {
          agent: 'ianus',
          operation: 'format',
          path: filePath,
          details: { format: formatType, size: formatted.length, backupId },
        });

        serverStats.increment();

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                formatted: true,
                format: formatType,
                originalSize: content.length,
                formattedSize: formatted.length,
                backupId,
                filePath,
              }),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: 'text',
              text: `Error formatting "${filePath}": ${(err as Error).message}`,
            },
          ],
          isError: true,
        };
      }
    },
  });
}
