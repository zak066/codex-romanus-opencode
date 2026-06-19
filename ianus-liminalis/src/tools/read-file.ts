import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolveSafePath } from '../core/path-utils.js';
import { logToJournal } from '../core/journal-logger.js';
import { stats as serverStats } from '../core/stats.js';
import { toolRegistry } from './registry.js';
import type { ToolDeps } from './types.js';

/**
 * Built-in encoding types for fs_read
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

export function registerReadFile(_server: Server, deps: ToolDeps): void {
  toolRegistry.register({
    name: 'fs_read',
    annotations: { readOnlyHint: true },
    description: 'Read content and metadata of a file. Supports UTF-8, base64, and hex encodings.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path of the file to read (relative to workspace)',
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
      required: ['path'],
    },
    handler: async (args) => {
      const filePath = args.path as string | undefined;
      if (!filePath) {
        return { content: [{ type: 'text', text: 'Missing required parameter: "path"' }], isError: true };
      }

      const encoding = (args.encoding as ReadEncoding) ?? 'utf-8';

      // Permission check
      const callerAgent = (args.agent as string) || 'ianus';
      const permCheck = await deps.permission.checkOperation(
        callerAgent,
        'read',
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

        // Read file as Buffer
        const buffer = await readFile(safePath);
        const content = formatContent(buffer, encoding);

        // Get file stats
        const stats = await stat(safePath);

        // Compute hash (SHA-256 of raw buffer)
        const hash = createHash('sha256').update(buffer).digest('hex');

        // Log to journal
        await logToJournal(deps.workspaceRoot, {
          agent: 'ianus',
          operation: 'read',
          path: filePath,
          details: { size: stats.size, hash },
        });

        serverStats.increment();

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                content,
                size: stats.size,
                mtime: stats.mtime.toISOString(),
                hash,
              }),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: 'text',
              text: `Error reading file "${filePath}": ${(err as Error).message}`,
            },
          ],
          isError: true,
        };
      }
    },
  });
}
