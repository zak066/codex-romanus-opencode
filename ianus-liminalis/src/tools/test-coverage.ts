/**
 * fs_test_coverage — Ianus Liminalis
 *
 * Mappa file di test ai file sorgente e identifica file non testati.
 * Supporta pattern matching, rilevamento framework e conteggio test.
 */

import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join, relative, extname, basename, dirname, sep } from 'node:path';
import { minimatch } from 'minimatch';
import { resolveSafePath } from '../core/path-utils.js';
import { stats as serverStats } from '../core/stats.js';
import { toolRegistry } from './registry.js';
import type { ToolDeps } from './types.js';

const DEFAULT_SOURCE_PATTERN = 'src/**/*.ts';
const DEFAULT_TEST_PATTERN = '**/*.test.ts';
const DEFAULT_TEST_SUFFIXES = ['.test.', '.spec.', '_test.'];

interface TestFileInfo {
  path: string;
  framework: string;
  testCount: number;
  matchType: 'exact' | 'partial' | 'pattern';
}

interface SourceFileCoverage {
  source: string;
  tests: TestFileInfo[];
  tested: boolean;
  testCount: number;
}

interface CoverageOutput {
  totalSource: number;
  totalTests: number;
  tested: number;
  untested: number;
  coverage: number;
  files: SourceFileCoverage[];
  untestedFiles: string[];
}

// ─── File walking ────────────────────────────────────────────────────────────

/**
 * Walk a directory recursively and collect file paths matching a glob pattern.
 */
async function walkFiles(
  dir: string,
  baseDir: string,
  pattern: string,
  maxFiles: number = 10000,
): Promise<string[]> {
  const results: string[] = [];

  async function walk(currentPath: string): Promise<void> {
    if (results.length >= maxFiles) return;

    let entries: string[];
    try {
      entries = await readdir(currentPath);
    } catch {
      return;
    }

    for (const entry of entries) {
      if (results.length >= maxFiles) return;

      const fullPath = join(currentPath, entry);
      try {
        const stats = await stat(fullPath);
        if (stats.isDirectory()) {
          await walk(fullPath);
        } else if (stats.isFile()) {
          const relPath = relative(baseDir, fullPath).replace(/\\/g, '/');
          if (minimatch(relPath, pattern, { dot: true })) {
            results.push(relPath);
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

// ─── Framework detection ─────────────────────────────────────────────────────

/**
 * Detect test framework from file content.
 *
 * Cerca import/require di framework conosciuti e pattern sintattici.
 */
function detectFramework(content: string): string {
  // Check for explicit imports/requires
  if (
    content.includes('from "vitest"') ||
    content.includes("from 'vitest'") ||
    content.includes('require("vitest")') ||
    content.includes("require('vitest')")
  ) {
    return 'vitest';
  }

  if (
    content.includes('@jest/globals') ||
    content.includes('jest.mock') ||
    content.includes('jest.fn') ||
    content.includes('jest.spyOn') ||
    content.includes('jest.setTimeout')
  ) {
    return 'jest';
  }

  if (
    content.includes('mocha') &&
    (content.includes('describe') || content.includes('it'))
  ) {
    return 'mocha';
  }

  if (content.includes('tap') && /t\.\s*(test|ok|equal|same)/.test(content)) {
    return 'tap';
  }

  // Syntax-based detection
  const hasDescribe = /describe\s*\(/.test(content);
  const hasIt = /it\s*\(/.test(content);
  const hasTest = /\btest\s*\(/.test(content);
  const hasSuite = /suite\s*\(/.test(content);
  const hasExpect = /expect\s*\(/.test(content);

  if (hasDescribe && hasIt && hasExpect) return 'jest';
  if (hasTest && hasExpect) return 'vitest';
  if (hasDescribe && hasIt) return 'jasmine';
  if (hasSuite && hasTest) return 'tap';
  if (hasSuite) return 'mocha';
  if (hasDescribe) return 'jest';
  if (hasTest) return 'vitest';

  return 'unknown';
}

/**
 * Count the number of test cases in a file.
 * Conta le occorrenze di test(, it(, describe(, suite(.
 */
function countTests(content: string): number {
  let count = 0;

  // Count test() calls (but not describe-only patterns)
  const testMatches = content.match(/\btest\s*\(/g);
  if (testMatches) count += testMatches.length;

  // Count it() calls  
  const itMatches = content.match(/\bit\s*\(/g);
  if (itMatches) count += itMatches.length;

  // describe() counts as a suite but we count it too
  // (describe blocks contain test/it calls, but we count them all separately)
  const describeMatches = content.match(/\bdescribe\s*\(/g);
  if (describeMatches) count += describeMatches.length;

  // suite() calls (mocha/tap style)
  const suiteMatches = content.match(/\bsuite\s*\(/g);
  if (suiteMatches) count += suiteMatches.length;

  return count;
}

// ─── Matching logic ──────────────────────────────────────────────────────────

/**
 * Generate all candidate test file paths for a given source file.
 *
 * Esempi:
 *   src/utils/string.ts →
 *     src/utils/string.test.ts       (suffix per estensione)
 *     src/utils/string.spec.ts
 *     src/utils/__tests__/string.test.ts
 *     src/utils/__tests__/string.spec.ts
 *     __tests__/utils/string.test.ts
 *     test/utils/string.test.ts
 *     tests/utils/string.test.ts
 */
function generateTestCandidates(
  sourceRelPath: string,
  suffixes: string[],
): string[] {
  const candidates: string[] = [];
  const dir = dirname(sourceRelPath);
  const base = basename(sourceRelPath);
  const ext = extname(base);
  const nameWithoutExt = base.slice(0, -ext.length);

  // In the source dir: name.suffix.ext
  for (const suffix of suffixes) {
    candidates.push(`${dir}/${nameWithoutExt}${suffix}ts`);
    candidates.push(`${dir}/${nameWithoutExt}${suffix}tsx`);
    candidates.push(`${dir}/${nameWithoutExt}${suffix}js`);
    candidates.push(`${dir}/${nameWithoutExt}${suffix}jsx`);
  }

  // In __tests__ subdirectory
  for (const suffix of suffixes) {
    candidates.push(`${dir}/__tests__/${nameWithoutExt}${suffix}ts`);
    candidates.push(`${dir}/__tests__/${nameWithoutExt}${suffix}tsx`);
    candidates.push(`${dir}/__tests__/${nameWithoutExt}${suffix}js`);
    candidates.push(`${dir}/__tests__/${nameWithoutExt}${suffix}jsx`);
    candidates.push(`${dir}/__tests__/${base}${suffixes[0]}ts`);
    candidates.push(`${dir}/__tests__/${base}`);
  }

  // In __tests__ mirror (replace first dir with __tests__)
  if (dir !== '.') {
    const parts = dir.split('/');
    for (let i = 0; i < parts.length; i++) {
      const mirrorDir = [...parts.slice(0, i), '__tests__', ...parts.slice(i)].join('/');
      for (const suffix of suffixes) {
        candidates.push(`${mirrorDir}/${nameWithoutExt}${suffix}ts`);
        candidates.push(`${mirrorDir}/${nameWithoutExt}${suffix}tsx`);
        candidates.push(`${mirrorDir}/${nameWithoutExt}${suffix}js`);
        candidates.push(`${mirrorDir}/${nameWithoutExt}${suffix}jsx`);
      }
    }
  }

  // In test/ and tests/ dirs (mirror of source dir)
  const sourceDirPrefix = sourceRelPath.startsWith('src/') ? 'src/' : '';
  const relativeDir = sourceDirPrefix ? dir.slice(4) : dir;
  for (const testDir of ['test', 'tests']) {
    for (const suffix of suffixes) {
      candidates.push(`${testDir}/${relativeDir}/${nameWithoutExt}${suffix}ts`);
      candidates.push(`${testDir}/${relativeDir}/${nameWithoutExt}${suffix}tsx`);
      candidates.push(`${testDir}/${relativeDir}/${nameWithoutExt}${suffix}js`);
      candidates.push(`${testDir}/${relativeDir}/${nameWithoutExt}${suffix}jsx`);
    }
  }

  return candidates;
}

/**
 * Match a source file against a list of test files.
 * Returns the match type and the matched test files.
 */
function matchSourceToTests(
  sourceRelPath: string,
  testFiles: string[],
  testSuffixes: string[],
  strict: boolean,
): Array<{ testPath: string; matchType: 'exact' | 'partial' | 'pattern' }> {
  const matches: Array<{ testPath: string; matchType: 'exact' | 'partial' | 'pattern' }> = [];
  const testSet = new Set(testFiles);
  const candidates = generateTestCandidates(sourceRelPath, testSuffixes);

  // Check exact candidates
  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (testSet.has(candidate) && !seen.has(candidate)) {
      seen.add(candidate);
      matches.push({ testPath: candidate, matchType: 'exact' });
    }
  }

  // If no exact match, try partial
  if (matches.length === 0 || strict) {
    const dir = dirname(sourceRelPath);
    const base = basename(sourceRelPath);
    const ext = extname(base);
    const nameWithoutExt = base.slice(0, -ext.length);
    const sourceDirPrefix = sourceRelPath.startsWith('src/') ? 'src/' : '';
    const relativeDir = sourceDirPrefix ? dir.slice(4) : dir;

    for (const testPath of testFiles) {
      if (seen.has(testPath)) continue;

      const testBase = basename(testPath);
      const testName = testBase.replace(extname(testBase), '');

      // Partial match: test filename contains the source filename
      if (testName.includes(nameWithoutExt) || nameWithoutExt.includes(testName)) {
        seen.add(testPath);

        // Determine if pattern (in __tests__/test/tests dir) or partial
        const testDir = dirname(testPath);
        const isPattern =
          testDir.includes('__tests__') ||
          testDir.startsWith('test/') ||
          testDir.startsWith('tests/');

        matches.push({
          testPath,
          matchType: isPattern ? 'pattern' : 'partial',
        });
      }

      // Also check if directory structure mirrors
      if (!seen.has(testPath) && testPath.replace(/\\/g, '/').includes(relativeDir)) {
        seen.add(testPath);
        matches.push({ testPath, matchType: 'pattern' });
      }
    }
  }

  // Deduplicate by keeping best match type
  const bestMatches: Array<{ testPath: string; matchType: 'exact' | 'partial' | 'pattern' }> = [];
  const bestByPath = new Map<string, 'exact' | 'partial' | 'pattern'>();

  for (const m of matches) {
    const existing = bestByPath.get(m.testPath);
    const rank: Record<string, number> = { exact: 3, partial: 2, pattern: 1 };
    if (!existing || (rank[m.matchType] ?? 0) > (rank[existing] ?? 0)) {
      bestByPath.set(m.testPath, m.matchType);
    }
  }

  for (const [testPath, matchType] of bestByPath) {
    bestMatches.push({ testPath, matchType });
  }

  return bestMatches;
}

// ─── Tool registration ───────────────────────────────────────────────────────

export function registerTestCoverage(_server: Server, deps: ToolDeps): void {
  toolRegistry.register({
    name: 'fs_test_coverage',
    description:
      'Map test files to source files and identify untested files. ' +
      'Scans source and test directories using glob patterns, ' +
      'matches test files to source files by path conventions, ' +
      'detects test framework (jest/vitest/mocha/jasmine/tap), ' +
      'counts test cases, and reports coverage statistics.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path base del progetto (obbligatorio)',
        },
        sourcePattern: {
          type: 'string',
          default: 'src/**/*.ts',
          description: 'Glob pattern per file sorgente (default: "src/**/*.ts")',
        },
        testPattern: {
          type: 'string',
          default: '**/*.test.ts',
          description: 'Glob pattern per file test (default: "**/*.test.ts")',
        },
        testSuffixes: {
          type: 'array',
          items: { type: 'string' },
          default: ['.test.', '.spec.', '_test.'],
          description:
            'Suffixes used to identify test files ' +
            '(default: [".test.", ".spec.", "_test."])',
        },
        strict: {
          type: 'boolean',
          default: false,
          description:
            'Strict mode: segnala anche warning per match parziali',
        },
      },
      required: ['path'],
    },
    handler: async (args) => {
      const basePath = args.path as string | undefined;
      if (!basePath) {
        return {
          content: [{ type: 'text', text: 'Missing required parameter: "path"' }],
          isError: true,
        };
      }

      const sourcePattern = (args.sourcePattern as string) ?? DEFAULT_SOURCE_PATTERN;
      const testPattern = (args.testPattern as string) ?? DEFAULT_TEST_PATTERN;
      const testSuffixes =
        (args.testSuffixes as string[]) ?? DEFAULT_TEST_SUFFIXES;
      const strict = (args.strict as boolean) ?? false;

      // Permission check: read access to the path
      const callerAgent = (args.agent as string) || 'ianus';
      const permCheck = await deps.permission.checkOperation(
        callerAgent,
        'read',
        basePath,
        deps.workspaceRoot,
      );
      if (!permCheck.allowed) {
        return {
          content: [
            { type: 'text', text: `Permission denied: ${permCheck.reason}` },
          ],
          isError: true,
        };
      }

      try {
        const safePath = resolveSafePath(basePath, deps.workspaceRoot);

        // Collect source files
        const sourceFiles = await walkFiles(
          safePath,
          deps.workspaceRoot,
          sourcePattern,
        );

        // Collect test files
        const testFiles = await walkFiles(
          safePath,
          deps.workspaceRoot,
          testPattern,
        );

        // Also check for alternative test patterns if the main one found nothing
        let allTestFiles = [...testFiles];
        if (testFiles.length === 0) {
          // Try common test patterns
          for (const altPattern of [
            '**/*.spec.ts',
            '**/__tests__/**/*.ts',
            '**/*.test.tsx',
            '**/*.spec.tsx',
            '**/*.test.js',
            '**/*.spec.js',
          ]) {
            const altMatches = await walkFiles(safePath, deps.workspaceRoot, altPattern);
            for (const f of altMatches) {
              if (!allTestFiles.includes(f)) allTestFiles.push(f);
            }
          }
        }

        // Build test set for quick lookup
        const testSet = new Set(allTestFiles);

        // Process each source file
        const files: SourceFileCoverage[] = [];
        let testedCount = 0;

        for (const sourcePath of sourceFiles) {
          // Skip if the source file itself looks like a test file
          const isTestLike = testSet.has(sourcePath);
          if (isTestLike) continue;

          const matches = matchSourceToTests(
            sourcePath,
            allTestFiles,
            testSuffixes,
            strict,
          );

          const testInfos: TestFileInfo[] = [];

          for (const match of matches) {
            const fullTestPath = join(deps.workspaceRoot, match.testPath);
            let framework = 'unknown';
            let testCount = 0;

            try {
              const content = await readFile(fullTestPath, 'utf-8');
              framework = detectFramework(content);
              testCount = countTests(content);
            } catch {
              // If file can't be read, skip counting
            }

            testInfos.push({
              path: match.testPath,
              framework,
              testCount,
              matchType: match.matchType,
            });
          }

          const totalTestCount = testInfos.reduce((sum, t) => sum + t.testCount, 0);
          const tested = testInfos.length > 0;

          if (tested) testedCount++;

          files.push({
            source: sourcePath,
            tests: testInfos,
            tested,
            testCount: totalTestCount,
          });
        }

        const totalSource = files.length;
        const untestedCount = totalSource - testedCount;
        const coveragePercent =
          totalSource > 0
            ? Math.round((testedCount / totalSource) * 10000) / 100
            : 0;

        const output: CoverageOutput = {
          totalSource,
          totalTests: allTestFiles.length,
          tested: testedCount,
          untested: untestedCount,
          coverage: coveragePercent,
          files,
          untestedFiles: files
            .filter((f) => !f.tested)
            .map((f) => f.source),
        };

        serverStats.increment();

        return {
          content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
        };
      } catch (err) {
        return {
          content: [
            {
              type: 'text',
              text: `Error analyzing test coverage: ${(err as Error).message}`,
            },
          ],
          isError: true,
        };
      }
    },
  });
}
