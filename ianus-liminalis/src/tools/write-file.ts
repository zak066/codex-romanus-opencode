import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { open, mkdir, rename, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { resolveSafePath } from '../core/path-utils.js';
import { logToJournal } from '../core/journal-logger.js';
import { stats as serverStats } from '../core/stats.js';
import { toolRegistry } from './registry.js';
import type { ToolDeps } from './types.js';

type WriteEncoding = 'utf-8' | 'base64' | 'hex';

/**
 * Convert content string to Buffer using the specified encoding.
 */
function contentToBuffer(content: string, encoding: WriteEncoding): Buffer {
  switch (encoding) {
    case 'base64':
      return Buffer.from(content, 'base64');
    case 'hex':
      return Buffer.from(content, 'hex');
    case 'utf-8':
    default:
      return Buffer.from(content, 'utf-8');
  }
}

export function registerWriteFile(_server: Server, deps: ToolDeps): void {
  toolRegistry.register({
    name: 'fs_write',
    description:
      'Write content to a file atomically. Creates parent directories if needed. A backup is created before writing.',
    annotations: { destructiveHint: true, idempotentHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path of the file to write (relative to workspace)',
    annotations: { destructiveHint: true, idempotentHint: true },
        },
        content: {
          type: 'string',
          description: 'Content to write to the file',
    annotations: { destructiveHint: true, idempotentHint: true },
        },
        encoding: {
          type: 'string',
          enum: ['utf-8', 'base64', 'hex'],
          default: 'utf-8',
          description: 'Encoding of the input content',
    annotations: { destructiveHint: true, idempotentHint: true },
        },
        agent: {
          type: 'string',
          description: 'Nome dell agente chiamante (opzionale, default: "ianus")',
    annotations: { destructiveHint: true, idempotentHint: true },
        },
      },
      required: ['path', 'content'],
    },
    handler: async (args) => {
      const filePath = args.path as string | undefined;
      if (!filePath) {
        return { content: [{ type: 'text', text: 'Missing required parameter: "path"' }], isError: true };
      }

      const content = args.content as string | undefined;
      if (content === undefined) {
        return { content: [{ type: 'text', text: 'Missing required parameter: "content"' }], isError: true };
      }

      const encoding = (args.encoding as WriteEncoding) ?? 'utf-8';

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

        // Create backup before writing (if file exists)
        let backupId: string | undefined;
        try {
          await stat(safePath);
          const backup = await deps.backup.backup(safePath);
          backupId = backup.id;
        } catch {
          // File doesn't exist yet — no backup needed
        }

        // Ensure parent directory exists
        await mkdir(dirname(safePath), { recursive: true });

        // Atomic write: temp file → fsync → rename
        const buffer = contentToBuffer(content, encoding);
        const tempPath = safePath + '.tmp';
        const handle = await open(tempPath, 'w');
        try {
          await handle.writeFile(buffer);
          await handle.sync();
        } finally {
          await handle.close();
        }
        await rename(tempPath, safePath);

        // Log to journal
        await logToJournal(deps.workspaceRoot, {
          agent: 'ianus',
          operation: 'write',
          path: filePath,
          details: { size: buffer.length, backupId },
        });

        serverStats.increment();

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                size: buffer.length,
                backupId,
              }),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            { type: 'text', text: `Error writing file "${filePath}": ${(err as Error).message}` },
          ],
          isError: true,
        };
      }
    },
  });
}
