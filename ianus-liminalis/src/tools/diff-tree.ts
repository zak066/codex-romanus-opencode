/**
 * fs_diff_tree — Ianus Liminalis
 *
 * Diff strutturale tra due directory: identifica file aggiunti, rimossi,
 * modificati (per hash SHA-256 o mtime+size) e invariati.
 * READ-ONLY tool — mai modifiche.
 */

import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { readFile, stat, opendir } from 'node:fs/promises';
import { resolve, relative, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { createTwoFilesPatch } from 'diff';
import { minimatch } from 'minimatch';
import { resolveSafePath } from '../core/path-utils.js';
import { logToJournal } from '../core/journal-logger.js';
import { stats as serverStats } from '../core/stats.js';
import { toolRegistry } from './registry.js';
import type { ToolDeps } from './types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FileInfo {
  path: string;       // Path relativo alla directory root
  fullPath: string;   // Path assoluto
  hash?: string;      // SHA-256 esadecimale
  mtimeMs: number;
  size: number;
}

type DiffStatus = 'added' | 'removed' | 'modified' | 'unchanged';

interface DiffFileEntry {
  path: string;
  status: DiffStatus;
  sourceHash?: string;
  targetHash?: string;
  diff?: string;
}

interface DiffTreeResult {
  source: string;
  target: string;
  summary: {
    added: number;
    removed: number;
    modified: number;
    unchanged: number;
  };
  files: DiffFileEntry[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Calcola SHA-256 di un file.
 */
async function sha256(filePath: string): Promise<string> {
  const content = await readFile(filePath);
  return createHash('sha256').update(content).digest('hex');
}

/**
 * Cammina ricorsivamente una directory e restituisce FileInfo per ogni file.
 * Applica include/exclude glob pattern sul path relativo.
 */
async function walkDirectory(
  dirAbs: string,
  root: string,
  include?: string,
  exclude?: string,
): Promise<Map<string, FileInfo>> {
  const result = new Map<string, FileInfo>();

  async function walk(currentAbs: string): Promise<void> {
    let dir;
    try {
      dir = await opendir(currentAbs);
    } catch {
      return; // Salta directory non accessibili
    }

    for await (const entry of dir) {
      const absPath = resolve(currentAbs, entry.name);
      const relPath = relative(root, absPath).replace(/\\/g, '/');

      let entryStat;
      try {
        entryStat = await stat(absPath);
      } catch {
        continue; // Salta file non accessibili
      }

      if (entryStat.isDirectory()) {
        await walk(absPath);
      } else if (entryStat.isFile()) {
        // Applica include/exclude glob
        if (include && !minimatch(relPath, include, { dot: true })) continue;
        if (exclude && minimatch(relPath, exclude, { dot: true })) continue;

        result.set(relPath, {
          path: relPath,
          fullPath: absPath,
          mtimeMs: entryStat.mtimeMs,
          size: entryStat.size,
        });
      }
    }
  }

  await walk(dirAbs);
  return result;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export function registerDiffTree(_server: Server, deps: ToolDeps): void {
  toolRegistry.register({
    name: 'fs_diff_tree',
    description:
      'Compare two directories and identify added, removed, modified (by SHA-256 hash or mtime+size), and unchanged files. Optionally includes unified diff for modified files.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        source: {
          type: 'string',
          description: 'Source directory path (relative to workspace)',
        },
        target: {
          type: 'string',
          description: 'Target directory path (relative to workspace)',
        },
        include: {
          type: 'string',
          description: 'Glob pattern to include files (e.g., "src/**/*.ts")',
        },
        exclude: {
          type: 'string',
          description: 'Glob pattern to exclude files (e.g., "**/node_modules/**")',
        },
        compareContent: {
          type: 'boolean',
          default: true,
          description:
            'If true (default), compare by SHA-256 hash. If false, compare by mtime + file size only.',
        },
        agent: {
          type: 'string',
          description: 'Agent name (optional, default: "ianus")',
        },
      },
      required: ['source', 'target'],
    },
    handler: async (args) => {
      const sourceDir = args.source as string | undefined;
      const targetDir = args.target as string | undefined;
      if (!sourceDir) {
        return { content: [{ type: 'text', text: 'Missing required parameter: "source"' }], isError: true };
      }
      if (!targetDir) {
        return { content: [{ type: 'text', text: 'Missing required parameter: "target"' }], isError: true };
      }

      const include = args.include as string | undefined;
      const exclude = args.exclude as string | undefined;
      const compareContent = (args.compareContent as boolean) ?? true;
      const callerAgent = (args.agent as string) || 'ianus';

      // Permission check — read su entrambe le directory
      const permSource = await deps.permission.checkOperation(callerAgent, 'read', sourceDir, deps.workspaceRoot);
      if (!permSource.allowed) {
        return { content: [{ type: 'text', text: `Permission denied for source: ${permSource.reason}` }], isError: true };
      }
      const permTarget = await deps.permission.checkOperation(callerAgent, 'read', targetDir, deps.workspaceRoot);
      if (!permTarget.allowed) {
        return { content: [{ type: 'text', text: `Permission denied for target: ${permTarget.reason}` }], isError: true };
      }

      try {
        const safeSource = resolveSafePath(sourceDir, deps.workspaceRoot);
        const safeTarget = resolveSafePath(targetDir, deps.workspaceRoot);

        // Walk entrambe le directory
        const [sourceFiles, targetFiles] = await Promise.all([
          walkDirectory(safeSource, safeSource, include, exclude),
          walkDirectory(safeTarget, safeTarget, include, exclude),
        ]);

        const result: DiffTreeResult = {
          source: sourceDir,
          target: targetDir,
          summary: { added: 0, removed: 0, modified: 0, unchanged: 0 },
          files: [],
        };

        // Tutti i path unici
        const allPaths = new Set<string>([...sourceFiles.keys(), ...targetFiles.keys()]);

        for (const relPath of allPaths) {
          const inSource = sourceFiles.get(relPath);
          const inTarget = targetFiles.get(relPath);

          if (inSource && !inTarget) {
            // Rimosso: in source ma non in target
            result.summary.removed++;
            result.files.push({
              path: relPath,
              status: 'removed',
              sourceHash: compareContent ? await sha256(inSource.fullPath) : undefined,
            });
          } else if (!inSource && inTarget) {
            // Aggiunto: in target ma non in source
            result.summary.added++;
            result.files.push({
              path: relPath,
              status: 'added',
              targetHash: compareContent ? await sha256(inTarget.fullPath) : undefined,
            });
          } else if (inSource && inTarget) {
            if (compareContent) {
              // Confronto per hash SHA-256
              const sourceHash = await sha256(inSource.fullPath);
              const targetHash = await sha256(inTarget.fullPath);

              if (sourceHash === targetHash) {
                result.summary.unchanged++;
                result.files.push({
                  path: relPath,
                  status: 'unchanged',
                  sourceHash,
                  targetHash,
                });
              } else {
                result.summary.modified++;
                const entry: DiffFileEntry = {
                  path: relPath,
                  status: 'modified',
                  sourceHash,
                  targetHash,
                };

                // Genera diff unificato solo per file modificati (testuali)
                try {
                  const sourceContent = await readFile(inSource.fullPath, 'utf-8');
                  const targetContent = await readFile(inTarget.fullPath, 'utf-8');
                  entry.diff = createTwoFilesPatch(
                    `a/${relPath}`,
                    `b/${relPath}`,
                    sourceContent,
                    targetContent,
                  );
                } catch {
                  // Se non è un file testuale, ometti il diff
                }

                result.files.push(entry);
              }
            } else {
              // Confronto per mtime + size
              const sameSize = inSource.size === inTarget.size;
              const sameMtime = Math.abs(inSource.mtimeMs - inTarget.mtimeMs) < 1000; // tolleranza 1s

              if (sameSize && sameMtime) {
                result.summary.unchanged++;
                result.files.push({ path: relPath, status: 'unchanged' });
              } else {
                result.summary.modified++;
                result.files.push({ path: relPath, status: 'modified' });
              }
            }
          }
        }

        // Log journal
        await logToJournal(deps.workspaceRoot, {
          agent: callerAgent,
          operation: 'diff_tree',
          path: `${sourceDir} ↔ ${targetDir}`,
          details: { summary: result.summary },
        });

        serverStats.increment();

        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        return {
          content: [
            {
              type: 'text',
              text: `Error diffing directories "${sourceDir}" and "${targetDir}": ${(err as Error).message}`,
            },
          ],
          isError: true,
        };
      }
    },
  });
}
