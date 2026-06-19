/**
 * fs_merge — Ianus Liminalis
 *
 * 3-way merge testuale: base + ours + theirs con rilevamento conflitti.
 * Usa hashing delle linee per trovare regioni comuni e divergenti,
 * e longest common subsequence per il merge a 3 vie.
 */

import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { resolveSafePath } from '../core/path-utils.js';
import { logToJournal } from '../core/journal-logger.js';
import { stats as serverStats } from '../core/stats.js';
import { toolRegistry } from './registry.js';
import type { ToolDeps } from './types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ConflictRegion {
  ours: { start: number; end: number };
  theirs: { start: number; end: number };
}

interface MergeResult {
  output: string;
  success: boolean;
  totalLines: number;
  conflicts: number;
  conflictLines: ConflictRegion[];
}

// ---------------------------------------------------------------------------
// Line hashing
// ---------------------------------------------------------------------------

function hashLine(line: string): string {
  return createHash('md5').update(line, 'utf-8').digest('hex');
}

/**
 * Crea un array di hash per ogni linea.
 */
function hashLines(lines: string[]): string[] {
  return lines.map(hashLine);
}

// ---------------------------------------------------------------------------
// Longest Common Subsequence (LCS) — trova match tra due sequenze
// ---------------------------------------------------------------------------

interface Match {
  baseIdx: number;
  otherIdx: number;
  length: number;
}

/**
 * Trova matches tra due sequenze di hash usando LCS.
 * Restituisce array di regioni matchate (base ↔ other).
 */
function findMatches(
  baseHashes: string[],
  otherHashes: string[],
): Match[] {
  const m = baseHashes.length;
  const n = otherHashes.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

  // Programmazione dinamica per LCS
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (baseHashes[i - 1] === otherHashes[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack per estrarre i match
  const matches: Match[] = [];
  let i = m;
  let j = n;

  while (i > 0 && j > 0) {
    if (baseHashes[i - 1] === otherHashes[j - 1]) {
      // Cerca la corsa completa di questo match
      let len = 1;
      while (
        i - len > 0 &&
        j - len > 0 &&
        baseHashes[i - 1 - len] === otherHashes[j - 1 - len]
      ) {
        len++;
      }
      matches.push({
        baseIdx: i - len,
        otherIdx: j - len,
        length: len,
      });
      i -= len;
      j -= len;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      i--;
    } else {
      j--;
    }
  }

  return matches.reverse();
}

// ---------------------------------------------------------------------------
// Costruisce regioni dalla sequenza di match
// ---------------------------------------------------------------------------

interface Region {
  type: 'unchanged' | 'ours-only' | 'theirs-only' | 'conflict';
  baseStart: number;
  baseEnd: number;
  oursStart: number;
  oursEnd: number;
  theirsStart: number;
  theirsEnd: number;
}

function buildRegions(
  baseHashes: string[],
  oursHashes: string[],
  theirsHashes: string[],
  oursMatches: Match[],
  theirsMatches: Match[],
): Region[] {
  const regions: Region[] = [];

  let basePos = 0;
  let oursPos = 0;
  let theirsPos = 0;

  // Funzione per processare match comuni
  const mlen = Math.min(oursMatches.length, theirsMatches.length);

  for (let mi = 0; mi < mlen; mi++) {
    const om = oursMatches[mi];
    const tm = theirsMatches[mi];

    // -------------------------------------------
    // Regione prima del match corrente
    // -------------------------------------------
    if (basePos < om.baseIdx || basePos < tm.baseIdx) {
      const baseStart = basePos;
      const baseEnd = Math.min(om.baseIdx, tm.baseIdx);

      const oursStart = oursPos;
      const oursEnd = oursPos + (om.baseIdx - basePos);
      const theirsStart = theirsPos;
      const theirsEnd = theirsPos + (tm.baseIdx - basePos);

      // Verifica se ours e theirs hanno entrambi cambiamenti
      const oursChanged = oursEnd > oursStart;
      const theirsChanged = theirsEnd > theirsStart;

      if (oursChanged && theirsChanged) {
        // Entrambi hanno cambiato → conflitto (a meno che non siano uguali)
        const oursLines = oursHashes.slice(oursStart, oursEnd);
        const theirsLines = theirsHashes.slice(theirsStart, theirsEnd);

        const sameChange =
          oursLines.length === theirsLines.length &&
          oursLines.every((h, idx) => h === theirsLines[idx]);

        if (sameChange) {
          // Stesso cambiamento in entrambi → accetta come unchanged
          regions.push({
            type: 'unchanged',
            baseStart,
            baseEnd,
            oursStart,
            oursEnd,
            theirsStart,
            theirsEnd,
          });
        } else {
          regions.push({
            type: 'conflict',
            baseStart,
            baseEnd,
            oursStart,
            oursEnd,
            theirsStart,
            theirsEnd,
          });
        }
      } else if (oursChanged) {
        regions.push({
          type: 'ours-only',
          baseStart,
          baseEnd,
          oursStart,
          oursEnd,
          theirsStart,
          theirsEnd,
        });
      } else if (theirsChanged) {
        regions.push({
          type: 'theirs-only',
          baseStart,
          baseEnd,
          oursStart,
          oursEnd,
          theirsStart,
          theirsEnd,
        });
      }

      oursPos = oursEnd;
      theirsPos = theirsEnd;
      basePos = baseEnd;
    }

    // -------------------------------------------
    // Regione matchata (unchanged)
    // -------------------------------------------
    const matchLen = Math.min(om.length, tm.length);
    if (matchLen > 0) {
      regions.push({
        type: 'unchanged',
        baseStart: om.baseIdx,
        baseEnd: om.baseIdx + matchLen,
        oursStart: om.otherIdx,
        oursEnd: om.otherIdx + matchLen,
        theirsStart: tm.otherIdx,
        theirsEnd: tm.otherIdx + matchLen,
      });
    }

    basePos = Math.max(om.baseIdx + matchLen, tm.baseIdx + matchLen);
    oursPos = om.otherIdx + matchLen;
    theirsPos = tm.otherIdx + matchLen;
  }

  // -------------------------------------------
  // Regione finale (dopo l'ultimo match)
  // -------------------------------------------
  if (basePos < baseHashes.length || oursPos < oursHashes.length || theirsPos < theirsHashes.length) {
    const oursChanged = oursPos < oursHashes.length;
    const theirsChanged = theirsPos < theirsHashes.length;

    if (oursChanged && theirsChanged) {
      regions.push({
        type: 'conflict',
        baseStart: basePos,
        baseEnd: baseHashes.length,
        oursStart: oursPos,
        oursEnd: oursHashes.length,
        theirsStart: theirsPos,
        theirsEnd: theirsHashes.length,
      });
    } else if (oursChanged) {
      regions.push({
        type: 'ours-only',
        baseStart: basePos,
        baseEnd: baseHashes.length,
        oursStart: oursPos,
        oursEnd: oursHashes.length,
        theirsStart: theirsPos,
        theirsEnd: theirsHashes.length,
      });
    } else if (theirsChanged) {
      regions.push({
        type: 'theirs-only',
        baseStart: basePos,
        baseEnd: baseHashes.length,
        oursStart: oursPos,
        oursEnd: oursHashes.length,
        theirsStart: theirsPos,
        theirsEnd: theirsHashes.length,
      });
    }
  }

  return regions;
}

// ---------------------------------------------------------------------------
// Merge principale
// ---------------------------------------------------------------------------

function performMerge(
  baseLines: string[],
  oursLines: string[],
  theirsLines: string[],
  style: 'diff3' | 'merge',
  markerLength: number,
): { output: string; success: boolean; conflicts: number; conflictLines: ConflictRegion[]; totalLines: number } {
  const baseHashes = hashLines(baseLines);
  const oursHashes = hashLines(oursLines);
  const theirsHashes = hashLines(theirsLines);

  const oursMatches = findMatches(baseHashes, oursHashes);
  const theirsMatches = findMatches(baseHashes, theirsHashes);

  const regions = buildRegions(baseHashes, oursHashes, theirsHashes, oursMatches, theirsMatches);

  const outputLines: string[] = [];
  let conflicts = 0;
  const conflictLines: ConflictRegion[] = [];

  for (const region of regions) {
    switch (region.type) {
      case 'unchanged': {
        // Prendi le linee da ours (sono identiche anche in base e theirs)
        const lines = oursLines.slice(region.oursStart, region.oursEnd);
        outputLines.push(...lines);
        break;
      }

      case 'ours-only': {
        const lines = oursLines.slice(region.oursStart, region.oursEnd);
        outputLines.push(...lines);
        break;
      }

      case 'theirs-only': {
        const lines = theirsLines.slice(region.theirsStart, region.theirsEnd);
        outputLines.push(...lines);
        break;
      }

      case 'conflict': {
        conflicts++;
        const conflictStart = outputLines.length;

        const oursConflict = oursLines.slice(region.oursStart, region.oursEnd);
        const theirsConflict = theirsLines.slice(region.theirsStart, region.theirsEnd);

        const marker = '='.repeat(markerLength);

        if (style === 'diff3') {
          outputLines.push(`<<<<<<< ours`);
          outputLines.push(...oursConflict);
          outputLines.push(`||||||| base`);
          outputLines.push(...baseLines.slice(region.baseStart, region.baseEnd));
          outputLines.push(`=======`);
          outputLines.push(...theirsConflict);
          outputLines.push(`>>>>>>> theirs`);
        } else {
          outputLines.push(`<<<<<<< ours`);
          outputLines.push(...oursConflict);
          outputLines.push(`=======`);
          outputLines.push(...theirsConflict);
          outputLines.push(`>>>>>>> theirs`);
        }

        conflictLines.push({
          ours: { start: conflictStart + 1, end: outputLines.length },
          theirs: { start: region.theirsStart + 1, end: region.theirsEnd },
        });
        break;
      }
    }
  }

  return {
    output: outputLines.join('\n'),
    success: conflicts === 0,
    totalLines: outputLines.length,
    conflicts,
    conflictLines,
  };
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export function registerMerge(_server: Server, deps: ToolDeps): void {
  toolRegistry.register({
    name: 'fs_merge',
    description:
      'Three-way textual merge: base + ours + theirs with conflict detection. Uses line-level LCS to identify common hunches and diverging regions. Supports diff3 and merge conflict style.',
    annotations: { destructiveHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        base: {
          type: 'string',
          description: 'Common base file path (relative to workspace)',
        },
        ours: {
          type: 'string',
          description: 'Our version file path (relative to workspace)',
        },
        theirs: {
          type: 'string',
          description: 'Their version file path (relative to workspace)',
        },
        output: {
          type: 'string',
          description: 'Output file path for the merge result (relative to workspace)',
        },
        style: {
          type: 'string',
          enum: ['diff3', 'merge'],
          default: 'merge',
          description:
            'Conflict style. "merge" (default) shows only ours/theirs. "diff3" also shows the base content between ||||||| markers.',
        },
        markerLength: {
          type: 'number',
          default: 7,
          minimum: 3,
          maximum: 20,
          description: 'Length of conflict markers (default: 7)',
        },
        agent: {
          type: 'string',
          description: 'Agent name (optional, default: "ianus")',
        },
      },
      required: ['base', 'ours', 'theirs', 'output'],
    },
    handler: async (args) => {
      const basePath = args.base as string | undefined;
      const oursPath = args.ours as string | undefined;
      const theirsPath = args.theirs as string | undefined;
      const outputPath = args.output as string | undefined;

      if (!basePath) return { content: [{ type: 'text', text: 'Missing required: "base"' }], isError: true };
      if (!oursPath) return { content: [{ type: 'text', text: 'Missing required: "ours"' }], isError: true };
      if (!theirsPath) return { content: [{ type: 'text', text: 'Missing required: "theirs"' }], isError: true };
      if (!outputPath) return { content: [{ type: 'text', text: 'Missing required: "output"' }], isError: true };

      const style = (args.style as 'diff3' | 'merge') ?? 'merge';
      const markerLength = (args.markerLength as number) ?? 7;
      const callerAgent = (args.agent as string) || 'ianus';

      // Permission check — read sui 3 file, write sull'output
      for (const [label, p] of [['base', basePath], ['ours', oursPath], ['theirs', theirsPath]] as const) {
        const perm = await deps.permission.checkOperation(callerAgent, 'read', p, deps.workspaceRoot);
        if (!perm.allowed) {
          return { content: [{ type: 'text', text: `Permission denied for ${label}: ${perm.reason}` }], isError: true };
        }
      }
      const permOutput = await deps.permission.checkOperation(callerAgent, 'write', outputPath, deps.workspaceRoot);
      if (!permOutput.allowed) {
        return { content: [{ type: 'text', text: `Permission denied for output: ${permOutput.reason}` }], isError: true };
      }

      try {
        const safeBase = resolveSafePath(basePath, deps.workspaceRoot);
        const safeOurs = resolveSafePath(oursPath, deps.workspaceRoot);
        const safeTheirs = resolveSafePath(theirsPath, deps.workspaceRoot);
        const safeOutput = resolveSafePath(outputPath, deps.workspaceRoot);

        const [baseContent, oursContent, theirsContent] = await Promise.all([
          readFile(safeBase, 'utf-8'),
          readFile(safeOurs, 'utf-8'),
          readFile(safeTheirs, 'utf-8'),
        ]);

        const baseLines = baseContent.split('\n');
        // Se l'ultima riga è vuota, rimuovila (tipico di file che finiscono con newline)
        if (baseLines.length > 0 && baseLines[baseLines.length - 1] === '') baseLines.pop();
        const oursLines = oursContent.split('\n');
        if (oursLines.length > 0 && oursLines[oursLines.length - 1] === '') oursLines.pop();
        const theirsLines = theirsContent.split('\n');
        if (theirsLines.length > 0 && theirsLines[theirsLines.length - 1] === '') theirsLines.pop();

        const result = performMerge(baseLines, oursLines, theirsLines, style, markerLength);

        // Scrivi output
        await mkdir(resolve(safeOutput, '..'), { recursive: true });
        await writeFile(safeOutput, result.output, 'utf-8');

        // Log journal
        await logToJournal(deps.workspaceRoot, {
          agent: callerAgent,
          operation: 'merge',
          path: outputPath,
          details: {
            base: basePath,
            ours: oursPath,
            theirs: theirsPath,
            success: result.success,
            conflicts: result.conflicts,
            totalLines: result.totalLines,
          },
        });

        serverStats.increment();

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  output: outputPath,
                  success: result.success,
                  totalLines: result.totalLines,
                  conflicts: result.conflicts,
                  conflictLines: result.conflicts > 0 ? result.conflictLines : undefined,
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
              text: `Merge error: ${(err as Error).message}`,
            },
          ],
          isError: true,
        };
      }
    },
  });
}
