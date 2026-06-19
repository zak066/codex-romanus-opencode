/**
 * fs_batch_search_replace — Ianus Liminalis
 *
 * Cerca e sostituisce un pattern regex su MULTIPLI file in una singola chiamata.
 * Supporta glob pattern per selezionare i file, modalità dry-run per preview,
 * e backup atomico per ogni file modificato.
 *
 * Richiesto da: Vulcanus, Catone, Mercurius, Tacito, Plinio (5 agenti)
 */

import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { readFile, readdir, stat as fsStat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { minimatch } from 'minimatch';
import { resolveSafePath } from '../core/path-utils.js';
import { logToJournal } from '../core/journal-logger.js';
import { stats as serverStats } from '../core/stats.js';
import { toolRegistry } from './registry.js';
import type { ToolDeps } from './types.js';
import { writeFileAtomically } from './write-atomic.js';

// ─── Safety limits ──────────────────────────────────────────────────────────
const MAX_FILES = 100;
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

// ─── Helpers ─────────────────────────────────────────────────────────────────

interface FileMatch {
  path: string;
}

/**
 * Walk a directory recursively, collecting file paths matching a glob pattern.
 * Mirrors the logic in find-file.ts to avoid coupling.
 */
async function walkFiles(
  dir: string,
  baseDir: string,
  pattern: string,
  maxFiles: number,
): Promise<FileMatch[]> {
  const results: FileMatch[] = [];

  async function walk(currentPath: string): Promise<void> {
    if (results.length >= maxFiles) return;

    let entries: string[];
    try {
      entries = await readdir(currentPath);
    } catch {
      return; // Skip unreadable directories
    }

    for (const entry of entries) {
      if (results.length >= maxFiles) return;

      const fullPath = join(currentPath, entry);
      try {
        const stats = await fsStat(fullPath);
        if (stats.isDirectory()) {
          await walk(fullPath);
        } else if (stats.isFile()) {
          const relPath = relative(baseDir, fullPath).replace(/\\/g, '/');
          if (minimatch(relPath, pattern, { dot: true })) {
            results.push({ path: relPath });
          }
        }
      } catch {
        // Skip inaccessible entries
      }
    }
  }

  await walk(dir);
  return results;
}

/**
 * Expand a replacement template string with RegExp backreferences.
 * Supports: $& (match), $` (before), $' (after), $1-$99 (groups).
 *
 * This mirrors what String.prototype.replace(regex, replacementString) does natively,
 * but allows us to control match count via exec()-loop.
 *
 * Inspired by the spec at TC39 §21.1.3.17.1 GetSubstitution.
 */
function expandReplacement(template: string, match: RegExpExecArray): string {
  return template.replace(/\$(\d+|&|`|'|$)/g, (m, ref: string) => {
    if (ref === '&') return match[0];
    if (ref === '`') return match.input.slice(0, match.index);
    if (ref === "'") return match.input.slice(match.index + match[0].length);
    if (ref === '$') return '$';

    const n = parseInt(ref, 10);
    if (!isNaN(n) && n > 0 && n < match.length) {
      return match[n] ?? '';
    }
    return m; // Unrecognised pattern — leave as-is
  });
}

/**
 * Apply a limited number of regex replacements to a string.
 * For unlimited (maxCount ≤ 0), delegates to native String.replace which
 * is faster and handles all edge cases.
 */
function applyReplacements(
  input: string,
  regex: RegExp,
  replacement: string,
  maxCount: number,
): { result: string; count: number } {
  // Unlimited — use native (fast, full backreference support)
  if (maxCount <= 0) {
    const count = (input.match(regex) || []).length;
    return { result: input.replace(regex, replacement), count };
  }

  // Limited — use exec() loop with manual backreference expansion
  let result = '';
  let lastIndex = 0;
  let count = 0;
  regex.lastIndex = 0;

  let execMatch: RegExpExecArray | null;
  while ((execMatch = regex.exec(input)) !== null && count < maxCount) {
    result += input.slice(lastIndex, execMatch.index);
    result += expandReplacement(replacement, execMatch);
    lastIndex = regex.lastIndex;
    count++;

    if (!regex.global) break; // Non-global = first match only
  }
  result += input.slice(lastIndex);

  return { result, count };
}

// ─── Tool registration ───────────────────────────────────────────────────────

export function registerBatchSearchReplace(_server: Server, deps: ToolDeps): void {
  toolRegistry.register({
    name: 'fs_batch_search_replace',
    description:
      'Search and replace a regex pattern across MULTIPLE files in a single call. '
      + 'Supports glob pattern for file selection (include), dry-run mode for preview, '
      + 'and atomic backup for each modified file. '
      + 'Requires at least "read" permission on the search path; each modified file '
      + 'also needs "write" permission.',
    annotations: { destructiveHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          description: 'Regex pattern to search for (required)',
        },
        replacement: {
          type: 'string',
          description: 'Replacement text. Supports backreferences: $&, $1, $`, $\' (required)',
        },
        include: {
          type: 'string',
          description:
            'Glob pattern to match files against (e.g. "src/**/*.ts"). Required.',
        },
        path: {
          type: 'string',
          description:
            'Base directory to search in, relative to workspace (default: workspace root)',
          default: '.',
        },
        dryRun: {
          type: 'boolean',
          description: 'If true, preview changes without writing anything (default: false)',
          default: false,
        },
        maxMatches: {
          type: 'number',
          description:
            'Maximum replacements per file (default: 0 = replace all matches). '
            + 'When >0, backreferences in replacement are still supported.',
          default: 0,
        },
        flags: {
          type: 'string',
          description:
            'Regex flags (default: "g" for global). Common values: "g" (global), '
            + '"gi" (global + case-insensitive), "gm" (global + multiline).',
          default: 'g',
        },
        agent: {
          type: 'string',
          description: 'Nome dell agente chiamante (opzionale, default: "ianus")',
        },
      },
      required: ['pattern', 'replacement', 'include'],
    },

    handler: async (args) => {
      // ── Parameter extraction ─────────────────────────────────────────────
      const pattern = args.pattern as string | undefined;
      if (!pattern) {
        return {
          content: [{ type: 'text', text: 'Missing required parameter: "pattern"' }],
          isError: true,
        };
      }

      const replacement = args.replacement as string | undefined;
      if (replacement === undefined) {
        return {
          content: [{ type: 'text', text: 'Missing required parameter: "replacement"' }],
          isError: true,
        };
      }

      const include = args.include as string | undefined;
      if (!include) {
        return {
          content: [{ type: 'text', text: 'Missing required parameter: "include"' }],
          isError: true,
        };
      }

      const searchPath = (args.path as string) ?? '.';
      const dryRun = (args.dryRun as boolean) ?? false;
      const maxMatches = (args.maxMatches as number) ?? 0;
      const flags = (args.flags as string) ?? 'g';
      const callerAgent = (args.agent as string) || 'ianus';

      // ── Permission check (read on base path) ─────────────────────────────
      const readPerm = await deps.permission.checkOperation(
        callerAgent,
        'read',
        searchPath,
        deps.workspaceRoot,
      );
      if (!readPerm.allowed) {
        return {
          content: [{ type: 'text', text: `Permission denied: ${readPerm.reason}` }],
          isError: true,
        };
      }

      // ── Regex validation ─────────────────────────────────────────────────
      let regex: RegExp;
      try {
        regex = new RegExp(pattern, flags);
      } catch (err) {
        return {
          content: [
            {
              type: 'text',
              text: `Invalid regex pattern: ${(err as Error).message}`,
            },
          ],
          isError: true,
        };
      }

      // ── Global execution ─────────────────────────────────────────────────
      try {
        const safePath = resolveSafePath(searchPath, deps.workspaceRoot);

        // Find matching files (capped at MAX_FILES)
        const matchedFiles = await walkFiles(safePath, deps.workspaceRoot, include, MAX_FILES);

        if (matchedFiles.length === 0) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    totalFiles: 0,
                    totalReplacements: 0,
                    ...(dryRun
                      ? { files: [] }
                      : { modifiedFiles: [], failedFiles: [] }),
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        }

        let totalReplacements = 0;
        const failedFiles: Array<{ path: string; error: string }> = [];

        if (dryRun) {
          // ── DRY-RUN: preview only ────────────────────────────────────────
          const filePreviews: Array<{
            path: string;
            replacements: number;
            preview: string;
          }> = [];

          for (const file of matchedFiles) {
            try {
              const absolutePath = resolveSafePath(file.path, deps.workspaceRoot);
              const content = await readFile(absolutePath, 'utf-8');

              if (content.length > MAX_FILE_SIZE_BYTES) {
                failedFiles.push({
                  path: file.path,
                  error: `File exceeds maximum size (${MAX_FILE_SIZE_BYTES / 1024 / 1024} MB)`,
                });
                continue;
              }

              const count = (content.match(regex) || []).length;
              if (count === 0) continue;

              // Build a compact preview around first match
              let preview = '';
              const firstIndex = content.search(regex);
              if (firstIndex >= 0) {
                const matchLen = content.slice(firstIndex).match(regex)?.[0]?.length ?? 0;
                const ctxBefore = 40;
                const ctxAfter = 40;
                const start = Math.max(0, firstIndex - ctxBefore);
                const end = Math.min(content.length, firstIndex + matchLen + ctxAfter);
                preview = content.slice(start, end);
              }

              filePreviews.push({
                path: file.path,
                replacements: count,
                preview: preview || '(matched)',
              });

              totalReplacements += count;
            } catch (err) {
              failedFiles.push({ path: file.path, error: (err as Error).message });
            }
          }

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    totalFiles: matchedFiles.length,
                    totalReplacements,
                    files: filePreviews,
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        }

        // ── WRITE MODE: apply changes with backup ──────────────────────────
        const modifiedFiles: string[] = [];

        for (const file of matchedFiles) {
          try {
            const absolutePath = resolveSafePath(file.path, deps.workspaceRoot);

            // Check write permission per file
            const writePerm = await deps.permission.checkOperation(
              callerAgent,
              'write',
              file.path,
              deps.workspaceRoot,
            );
            if (!writePerm.allowed) {
              failedFiles.push({
                path: file.path,
                error: `Write permission denied: ${writePerm.reason}`,
              });
              continue;
            }

            const content = await readFile(absolutePath, 'utf-8');

            if (content.length > MAX_FILE_SIZE_BYTES) {
              failedFiles.push({
                path: file.path,
                error: `File exceeds maximum size (${MAX_FILE_SIZE_BYTES / 1024 / 1024} MB)`,
              });
              continue;
            }

            // Apply replacement (limited or unlimited)
            const { result: modifiedContent, count: replaceCount } = applyReplacements(
              content,
              regex,
              replacement,
              maxMatches,
            );

            if (replaceCount === 0) continue; // No matches → skip

            // Create backup before modifying (file must exist)
            let backupId: string | undefined;
            try {
              await fsStat(absolutePath);
              const backup = await deps.backup.backup(absolutePath);
              backupId = backup.id;
            } catch {
              // File doesn't exist — not expected since we just read it
            }

            // Write atomically
            await writeFileAtomically(absolutePath, modifiedContent);

            // Log to journal
            await logToJournal(deps.workspaceRoot, {
              agent: 'ianus',
              operation: 'batch_replace',
              path: file.path,
              details: {
                pattern,
                replacement,
                flags,
                count: replaceCount,
                backupId,
                maxMatches,
              },
            });

            modifiedFiles.push(file.path);
            totalReplacements += replaceCount;
            serverStats.increment();
          } catch (err) {
            failedFiles.push({ path: file.path, error: (err as Error).message });
          }
        }

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  totalFiles: matchedFiles.length,
                  totalReplacements,
                  modifiedFiles,
                  failedFiles,
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: 'text',
              text: `Error in batch search/replace: ${(err as Error).message}`,
            },
          ],
          isError: true,
        };
      }
    },
  });
}
