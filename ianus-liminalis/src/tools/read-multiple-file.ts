/**
 * fs_read_multiple — Ianus Liminalis
 *
 * Legge più file in una singola chiamata. Supporta encoding e restituisce
 * un array di risultati con contenuto e metadata. Ogni file ha permission
 * check individuale. Gli errori su singoli file non bloccano gli altri.
 */

import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolveSafePath } from '../core/path-utils.js';
import { logToJournal } from '../core/journal-logger.js';
import { stats as serverStats } from '../core/stats.js';
import { toolRegistry } from './registry.js';
import type { ToolDeps } from './types.js';

const MAX_PATHS = 10;

/**
 * Built-in encoding types for fs_read_multiple
 */
type ReadEncoding = 'utf-8' | 'base64' | 'hex';

/**
 * Convert a Buffer to string using the specified encoding.
 */
function formatContent(buffer: Buffer, encoding: ReadEncoding): string {
  switch (encoding) {
    case 'base64':
      return buffer.toString('base64');
    case 'hex':
      return buffer.toString('hex');
    case 'utf-8':
    default:
      return buffer.toString('utf-8');
  }
}

interface FileResult {
  path: string;
  content: string;
  size: number;
  mtime: string;
  hash: string;
}

interface FileError {
  path: string;
  error: string;
}

interface ReadMultipleOutput {
  files: FileResult[];
  total: number;
  errors: FileError[];
}

export function registerReadMultipleFile(_server: Server, deps: ToolDeps): void {
  toolRegistry.register({
    name: 'fs_read_multiple',
    description:
      'Read multiple files from the workspace in a single call. Supports UTF-8, base64, and hex encodings.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        paths: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of file paths to read (relative to workspace)',
        },
        encoding: {
          type: 'string',
          enum: ['utf-8', 'base64', 'hex'],
          default: 'utf-8',
          description: 'Encoding of the output content',
        },
        agent: {
          type: 'string',
          description: 'Nome dell agente chiamante (opzionale, default: "ianus")',
        },
      },
      required: ['paths'],
    },
    handler: async (args) => {
      const paths = args.paths as string[] | undefined;
      if (!paths || !Array.isArray(paths) || paths.length === 0) {
        return {
          content: [{ type: 'text', text: 'Missing required parameter: "paths" must be a non-empty array' }],
          isError: true,
        };
      }

      const encoding = (args.encoding as ReadEncoding) ?? 'utf-8';

      if (!['utf-8', 'base64', 'hex'].includes(encoding)) {
        return {
          content: [{ type: 'text', text: `Invalid encoding "${encoding}". Must be one of: utf-8, base64, hex` }],
          isError: true,
        };
      }

      if (paths.length > MAX_PATHS) {
        return {
          content: [
            {
              type: 'text',
              text: `Too many paths: ${paths.length}. Maximum allowed: ${MAX_PATHS}`,
            },
          ],
          isError: true,
        };
      }

      // Permission check on the first path as general authorisation
      const callerAgent = (args.agent as string) || 'ianus';
      const firstPath = paths[0];
      const permCheck = await deps.permission.checkOperation(
        callerAgent,
        'read',
        firstPath,
        deps.workspaceRoot,
      );
      if (!permCheck.allowed) {
        return {
          content: [{ type: 'text', text: `Permission denied: ${permCheck.reason}` }],
          isError: true,
        };
      }

      const files: FileResult[] = [];
      const errors: FileError[] = [];

      for (const filePath of paths) {
        try {
          const safePath = resolveSafePath(filePath, deps.workspaceRoot);

          // Read file as Buffer
          const buffer = await readFile(safePath);
          const content = formatContent(buffer, encoding);

          // Get file stats
          const stats = await stat(safePath);

          // Compute hash (SHA-256 of raw buffer)
          const hash = createHash('sha256').update(buffer).digest('hex');

          files.push({
            path: filePath,
            content,
            size: stats.size,
            mtime: stats.mtime.toISOString(),
            hash,
          });
        } catch (err) {
          errors.push({
            path: filePath,
            error: (err as Error).message,
          });
        }
      }

      // Log to journal (only if at least one file was read successfully)
      if (files.length > 0) {
        await logToJournal(deps.workspaceRoot, {
          agent: 'ianus',
          operation: 'read',
          path: paths.join(', '),
          details: { filesRead: files.length, errors: errors.length },
        });
      }

      serverStats.increment();

      const output: ReadMultipleOutput = { files, total: files.length, errors };

      return {
        content: [{ type: 'text', text: JSON.stringify(output) }],
      };
    },
  });
}
