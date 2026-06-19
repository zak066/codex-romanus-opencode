import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { readFile, stat } from 'node:fs/promises';
import { resolveSafePath } from '../core/path-utils.js';
import { logToJournal } from '../core/journal-logger.js';
import { stats as serverStats } from '../core/stats.js';
import { toolRegistry } from './registry.js';
import type { ToolDeps } from './types.js';
import { writeFileAtomically } from './write-atomic.js';

type EditOperation = 'replace' | 'insert' | 'delete';

export function registerEditFile(_server: Server, deps: ToolDeps): void {
  toolRegistry.register({
    name: 'fs_edit',
    description:
      'Edit a file with replace (regex), insert after line, or delete line operations. Creates a backup before modification.',
    annotations: { destructiveHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path of the file to edit (relative to workspace)',
    annotations: { destructiveHint: true },
        },
        operation: {
          type: 'string',
          enum: ['replace', 'insert', 'delete'],
          description: 'Edit operation to perform',
    annotations: { destructiveHint: true },
        },
        pattern: {
          type: 'string',
          description: 'Regex pattern (for replace) or reference string',
    annotations: { destructiveHint: true },
        },
        content: {
          type: 'string',
          description: 'New content (for replace/insert)',
    annotations: { destructiveHint: true },
        },
        line: {
          type: 'number',
          description: 'Line number for insert/delete (1-based)',
    annotations: { destructiveHint: true },
        },
        agent: {
          type: 'string',
          description: 'Nome dell agente chiamante (opzionale, default: "ianus")',
    annotations: { destructiveHint: true },
        },
      },
      required: ['path', 'operation'],
    },
    handler: async (args) => {
      const filePath = args.path as string | undefined;
      if (!filePath) {
        return { content: [{ type: 'text', text: 'Missing required parameter: "path"' }], isError: true };
      }

      const operation = args.operation as EditOperation | undefined;
      if (!operation || !['replace', 'insert', 'delete'].includes(operation)) {
        return {
          content: [{ type: 'text', text: 'Invalid or missing "operation". Must be one of: replace, insert, delete' }],
          isError: true,
        };
      }

      // Permission check
      const callerAgent = (args.agent as string) || 'ianus';
      const permCheck = await deps.permission.checkOperation(
        callerAgent,
        'edit',
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

        // Read current content
        const currentContent = await readFile(safePath, 'utf-8');
        const normalizedContent = currentContent.replace(/\r\n/g, '\n');
        const lines = normalizedContent.split('\n');

        let modified = false;
        let modifiedContent: string;

        switch (operation) {
          case 'replace': {
            const pattern = args.pattern as string | undefined;
            if (!pattern) {
              return { content: [{ type: 'text', text: 'Missing "pattern" for replace operation' }], isError: true };
            }
            const newContent = args.content as string;
            if (newContent === undefined) {
              return { content: [{ type: 'text', text: 'Missing "content" for replace operation' }], isError: true };
            }

            // Validate regex pattern to prevent ReDoS
            if (!pattern || typeof pattern !== 'string' || pattern.length > 200) {
              return { content: [{ type: 'text', text: 'Invalid regex pattern: must be a non-empty string up to 200 characters' }], isError: true };
            }
            let regex: RegExp;
            try {
              regex = new RegExp(pattern, 'g');
            } catch (err) {
              return { content: [{ type: 'text', text: `Invalid regex pattern: ${(err as Error).message}` }], isError: true };
            }
            const replaced = currentContent.replace(regex, () => newContent);
            if (replaced === currentContent) {
              return {
                content: [
                  { type: 'text', text: JSON.stringify({ modified: false, linesChanged: 0 }) },
                ],
              };
            }
            modifiedContent = replaced;
            modified = true;
            break;
          }

          case 'insert': {
            const lineNum = args.line as number | undefined;
            if (lineNum === undefined || typeof lineNum !== 'number') {
              return { content: [{ type: 'text', text: 'Missing or invalid "line" number for insert operation' }], isError: true };
            }
            const insertContent = args.content as string | undefined;
            if (insertContent === undefined) {
              return { content: [{ type: 'text', text: 'Missing "content" for insert operation' }], isError: true };
            }

            if (lineNum < 1 || lineNum > lines.length) {
              return {
                content: [
                  {
                    type: 'text',
                    text: `Line number ${lineNum} out of range. File has ${lines.length} lines.`,
                  },
                ],
                isError: true,
              };
            }

            const insertLines = insertContent.split('\n');
            lines.splice(lineNum - 1, 0, ...insertLines);
            modifiedContent = lines.join('\n');
            modified = true;
            break;
          }

          case 'delete': {
            const lineNum = args.line as number | undefined;
            if (lineNum === undefined || typeof lineNum !== 'number') {
              return { content: [{ type: 'text', text: 'Missing or invalid "line" number for delete operation' }], isError: true };
            }

            if (lineNum < 1 || lineNum > lines.length) {
              return {
                content: [
                  {
                    type: 'text',
                    text: `Line number ${lineNum} out of range. File has ${lines.length} lines.`,
                  },
                ],
                isError: true,
              };
            }

            lines.splice(lineNum - 1, 1); // lines are 0-indexed
            modifiedContent = lines.join('\n');
            modified = true;
            break;
          }

          default:
            return {
              content: [{ type: 'text', text: `Unknown operation: ${operation}` }],
              isError: true,
            };
        }

        // Create backup before modifying
        let backupId: string | undefined;
        try {
          await stat(safePath);
          const backup = await deps.backup.backup(safePath);
          backupId = backup.id;
        } catch (err) {
          // Se il file non esiste, non è un errore
          if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') {
            console.error(`Warning: backup failed for "${filePath}": ${(err as Error).message}`);
          }
        }

        // Write modified content atomically
        await writeFileAtomically(safePath, modifiedContent!);

        const newLines = modifiedContent!.split('\n');
        const linesChanged = Math.abs(newLines.length - lines.length) || 1;
        const originalSize = currentContent.length;
        const newSize = modifiedContent!.length;
        const bytesChanged = Math.abs(newSize - originalSize);


        // Log to journal
        await logToJournal(deps.workspaceRoot, {
          agent: 'ianus',
          operation: 'edit',
          path: filePath,
                    details: { operation, backupId, linesChanged, bytesChanged },
        });

        serverStats.increment();

        return {
          content: [
            {
              type: 'text',
                            text: JSON.stringify({ modified, linesChanged, bytesChanged, backupId }),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            { type: 'text', text: `Error editing file "${filePath}": ${(err as Error).message}` },
          ],
          isError: true,
        };
      }
    },
  });
}
