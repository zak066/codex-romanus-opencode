import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { minimatch } from 'minimatch';
import { resolveSafePath } from '../core/path-utils.js';
import { stats as serverStats } from '../core/stats.js';
import { toolRegistry } from './registry.js';
import type { ToolDeps } from './types.js';

interface SearchResult {
  file: string;
  line: number;
  column: number;
  match: string;
}

/**
 * Walk directory recursively, collecting file paths that match the include glob.
 */
async function walkFiles(
  dir: string,
  baseDir: string,
  includePattern?: string,
  maxResults?: number,
): Promise<string[]> {
  const files: string[] = [];

  async function walk(currentPath: string): Promise<void> {
    if (maxResults !== undefined && files.length >= maxResults) return;

    let entries: string[];
    try {
      entries = await readdir(currentPath);
    } catch {
      return; // Skip directories we can't read
    }

    for (const entry of entries) {
      if (maxResults !== undefined && files.length >= maxResults) return;

      const fullPath = join(currentPath, entry);
      try {
        const stats = await stat(fullPath);
        if (stats.isDirectory()) {
          await walk(fullPath);
        } else if (stats.isFile()) {
          const relPath = relative(baseDir, fullPath).replace(/\\/g, '/');
          if (!includePattern || minimatch(relPath, includePattern, { dot: true })) {
            files.push(fullPath);
          }
        }
      } catch {
        // Skip inaccessible entries
      }
    }
  }

  await walk(dir);
  return files;
}

export function registerSearchFile(_server: Server, deps: ToolDeps): void {
  toolRegistry.register({
    name: 'fs_search',
    description:
      'Search for a regex pattern across files matching a glob pattern. Returns matching lines with file, line, and column.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          description: 'Regex pattern to search for',
    annotations: { readOnlyHint: true },
        },
        path: {
          type: 'string',
          default: '.',
          description: 'Base directory to search (relative to workspace)',
    annotations: { readOnlyHint: true },
        },
        include: {
          type: 'string',
          description: 'Glob pattern to filter files (e.g., *.ts, **/*.js)',
    annotations: { readOnlyHint: true },
        },
        maxResults: {
          type: 'number',
          default: 50,
          description: 'Maximum number of results to return',
    annotations: { readOnlyHint: true },
        },
        agent: {
          type: 'string',
          description: 'Nome dell agente chiamante (opzionale, default: "ianus")',
    annotations: { readOnlyHint: true },
        },
      },
      required: ['pattern'],
    },
    handler: async (args) => {
      const pattern = args.pattern as string | undefined;
      if (!pattern) {
        return { content: [{ type: 'text', text: 'Missing required parameter: "pattern"' }], isError: true };
      }

      const searchPath = (args.path as string) ?? '.';
      const includePattern = args.include as string | undefined;
      const maxResults = (args.maxResults as number) ?? 50;

      // Permission check
      const callerAgent = (args.agent as string) || 'ianus';
      const permCheck = await deps.permission.checkOperation(
        callerAgent,
        'read',
        searchPath,
        deps.workspaceRoot,
      );
      if (!permCheck.allowed) {
        return {
          content: [{ type: 'text', text: `Permission denied: ${permCheck.reason}` }],
          isError: true,
        };
      }

      try {
        const safePath = resolveSafePath(searchPath, deps.workspaceRoot);

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

        const files = await walkFiles(safePath, deps.workspaceRoot, includePattern, maxResults);

        const results: SearchResult[] = [];
        for (const filePath of files) {
          if (results.length >= maxResults) break;

          try {
            const content = await readFile(filePath, 'utf-8');
            const lines = content.split('\n');
            const relPath = relative(deps.workspaceRoot, filePath).replace(/\\/g, '/');

            for (let i = 0; i < lines.length; i++) {
              if (results.length >= maxResults) break;

              // Reset regex for each line
              regex.lastIndex = 0;
              const match = regex.exec(lines[i]);
              if (match) {
                results.push({
                  file: relPath,
                  line: i + 1,
                  column: match.index + 1,
                  match: lines[i].substring(
                    Math.max(0, match.index - 30),
                    match.index + match[0].length + 30,
                  ),
                });
              }
            }
          } catch {
            // Skip unreadable files
          }
        }

        serverStats.increment();

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ results, total: results.length }),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            { type: 'text', text: `Error searching "${pattern}": ${(err as Error).message}` },
          ],
          isError: true,
        };
      }
    },
  });
}
