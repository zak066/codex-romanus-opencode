/**
 * fs_api_doc_extractor — Ianus Liminalis
 *
 * Estrae commenti JSDoc/TSDoc da file TypeScript/JavaScript e li restituisce
 * in formato JSON strutturato o Markdown. Supporta tag: @param, @returns,
 * @example, @deprecated, @see, @since, @throws.
 */

import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { readFile } from 'node:fs/promises';
import { join, relative, extname } from 'node:path';
import { resolveSafePath } from '../core/path-utils.js';
import { logToJournal } from '../core/journal-logger.js';
import { stats as serverStats } from '../core/stats.js';
import { toolRegistry } from './registry.js';
import type { ToolDeps } from './types.js';

// ────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────

interface ParamTag {
  name: string;
  type?: string;
  description?: string;
  optional?: boolean;
}

interface ReturnsTag {
  type?: string;
  description?: string;
}

interface Declaration {
  name: string;
  type: 'function' | 'interface' | 'type' | 'class' | 'const';
  description: string;
  exported: boolean;
  params?: ParamTag[];
  returns?: ReturnsTag;
  examples?: string[];
  deprecated?: boolean;
  since?: string;
  see?: string[];
  throws?: string[];
  line: number;
}

interface FileResult {
  path: string;
  declarations: Declaration[];
}

interface ApiDocResult {
  files: FileResult[];
  totalFiles: number;
  totalDeclarations: number;
}

// ────────────────────────────────────────────────────────────
// JSDoc regex patterns
// ────────────────────────────────────────────────────────────

/**
 * Matches a complete JSDoc/TSDoc comment followed by the next declaration.
 * Group 1: entire comment body (without /** and *\/)
 * Group 2: optional "export " keyword
 * Group 3: declaration keyword (function, interface, type, class, const, export, default function)
 * Group 4: declaration name
 */
const JSDOC_BLOCK_REGEX =
  /\/\*\*([\s\S]*?)\*\/\s*(export\s+)?(function|interface|type|class|const|default\s+function)\s+(\w+)/g;

/**
 * Matches lines within a JSDoc block.
 * Captures leading whitespace, optional @tag, and the rest.
 */
const TAG_LINE_REGEX = /^\s*\*?\s*(@\w+)\s*(.*)$/gm;

/**
 * Matches @param {type} name - description
 */
const PARAM_REGEX = /@param\s+\{([^}]+)\}\s+(\w+)\??\s*(?:-\s+)?(.*)/;

/**
 * Matches @returns {type} description
 */
const RETURNS_REGEX = /@returns?\s+\{([^}]+)\}\s*(.*)/;

/**
 * Matches @throws {type} description
 */
const THROWS_REGEX = /@throws\s+\{([^}]+)\}\s*(.*)/;

/**
 * Matches @since version
 */
const SINCE_REGEX = /@since\s+(.+)/;

/**
 * Matches @see reference
 */
const SEE_REGEX = /@see\s+(.+)/;

/**
 * Matches @deprecated (optionally with a message)
 */
const DEPRECATED_REGEX = /@deprecated\b\s*(.*)/;

// ────────────────────────────────────────────────────────────
// Parser utilities
// ────────────────────────────────────────────────────────────

/**
 * Normalize glob patterns for the walker.
 */
const DEFAULT_INCLUDE = '{**/*.ts,**/*.tsx,**/*.js,**/*.jsx}';

/**
 * Extract the description (text before any @tag) from a JSDoc block body.
 */
function extractDescription(body: string): string {
  const lines: string[] = [];
  for (const line of body.split('\n')) {
    const trimmed = line.replace(/^\s*\*?\s?/, '').trim();
    if (!trimmed || trimmed.startsWith('@')) break;
    if (trimmed) lines.push(trimmed);
  }
  return lines.join(' ').trim();
}

/**
 * Parse a single JSDoc block and return structured declaration info.
 */
function parseJsdocBlock(
  body: string,
  declType: string,
  declName: string,
  isExport: boolean,
  line: number,
): Declaration {
  const description = extractDescription(body);
  const params: ParamTag[] = [];
  let returns: ReturnsTag | undefined;
  const examples: string[] = [];
  let deprecated = false;
  let since: string | undefined;
  const see: string[] = [];
  const throws: string[] = [];

  // Collect all @example blocks first
  const exampleBlocks: string[] = [];
  let currentExample: string[] | null = null;

  for (const lineText of body.split('\n')) {
    const trimmed = lineText.replace(/^\s*\*?\s?/, '').trim();

    if (trimmed.startsWith('@example')) {
      if (currentExample !== null) {
        exampleBlocks.push(currentExample.join('\n').trim());
      }
      const rest = trimmed.replace(/^@example\s*/, '').trim();
      currentExample = rest ? [rest] : [];
    } else if (currentExample !== null && !trimmed.startsWith('@')) {
      currentExample.push(trimmed);
    } else if (trimmed.startsWith('@')) {
      if (currentExample !== null) {
        exampleBlocks.push(currentExample.join('\n').trim());
        currentExample = null;
      }
    }
  }

  if (currentExample !== null) {
    exampleBlocks.push(currentExample.join('\n').trim());
  }

  const processedLines = new Set<number>();

  // Parse @param
  let paramMatch: RegExpExecArray | null;
  const paramRegex = new RegExp(PARAM_REGEX.source, 'g');
  while ((paramMatch = paramRegex.exec(body)) !== null) {
    const type = paramMatch[1].trim();
    const rawName = paramMatch[2].trim();
    const desc = paramMatch[3].trim();
    const optional = rawName.endsWith('?');
    params.push({
      name: optional ? rawName.slice(0, -1) : rawName,
      type: type || undefined,
      description: desc || undefined,
      optional,
    });
  }

  // Parse @returns
  const returnsMatch = RETURNS_REGEX.exec(body);
  if (returnsMatch) {
    returns = {
      type: returnsMatch[1].trim() || undefined,
      description: returnsMatch[2].trim() || undefined,
    };
  }

  // Parse @throws
  let throwsMatch: RegExpExecArray | null;
  const throwsRegex = new RegExp(THROWS_REGEX.source, 'g');
  while ((throwsMatch = throwsRegex.exec(body)) !== null) {
    throws.push(`${throwsMatch[1].trim()}: ${throwsMatch[2].trim()}`);
  }

  // Parse @since
  const sinceMatch = SINCE_REGEX.exec(body);
  if (sinceMatch) {
    since = sinceMatch[1].trim();
  }

  // Parse @see
  let seeMatch: RegExpExecArray | null;
  const seeRegex = new RegExp(SEE_REGEX.source, 'g');
  while ((seeMatch = seeRegex.exec(body)) !== null) {
    see.push(seeMatch[1].trim());
  }

  // Parse @deprecated
  const deprecatedMatch = DEPRECATED_REGEX.exec(body);
  if (deprecatedMatch) {
    deprecated = true;
  }

  // Normalize the declaration type
  let normalizedType: Declaration['type'] = 'function';
  const dt = declType.trim();
  if (dt === 'interface') normalizedType = 'interface';
  else if (dt === 'type') normalizedType = 'type';
  else if (dt === 'class') normalizedType = 'class';
  else if (dt === 'const') normalizedType = 'const';
  else normalizedType = 'function';

  return {
    name: declName,
    type: normalizedType,
    description,
    exported: isExport,
    params: params.length > 0 ? params : undefined,
    returns,
    examples: exampleBlocks.length > 0 ? exampleBlocks : undefined,
    deprecated,
    since,
    see: see.length > 0 ? see : undefined,
    throws: throws.length > 0 ? throws : undefined,
    line,
  };
}

/**
 * Find all .ts/.tsx/.js/.jsx files matching the include pattern.
 */
async function findFiles(
  basePath: string,
  includePattern: string,
  recursive: boolean,
  workspaceRoot: string,
): Promise<string[]> {
  const { glob } = await import('node:fs/promises');
  // Use a simple recursive approach
  const { readdir, stat } = await import('node:fs/promises');
  const { join, extname } = await import('node:path');

  const results: string[] = [];

  async function walk(dir: string): Promise<void> {
    const safeDir = resolveSafePath(dir, workspaceRoot);
    let entries;
    try {
      entries = await readdir(safeDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = join(dir, entry.name).replace(/\\/g, '/');

      if (entry.isDirectory() && recursive && !entry.name.startsWith('.')) {
        await walk(fullPath);
      } else if (entry.isFile()) {
        const ext = extname(entry.name).toLowerCase();
        if (['.ts', '.tsx', '.js', '.jsx'].includes(ext)) {
          // Apply simple glob matching if pattern is not the default
          if (includePattern === DEFAULT_INCLUDE) {
            results.push(fullPath);
          } else {
            // Basic glob matching — check if path matches the pattern
            const patternParts = includePattern.replace(/\*\*/g, '__RECURSIVE__').replace(/\*/g, '[^/]*').replace(/__RECURSIVE__/g, '.*');
            try {
              const regex = new RegExp(`^${patternParts}$`);
              if (regex.test(fullPath)) {
                results.push(fullPath);
              }
            } catch {
              results.push(fullPath);
            }
          }
        }
      }
    }
  }

  const statResult = await stat(resolveSafePath(basePath, workspaceRoot));
  if (statResult.isFile()) {
    results.push(basePath);
  } else if (statResult.isDirectory()) {
    await walk(basePath);
  }

  return results.sort();
}

/**
 * Extract JSDoc/TSDoc declarations from a single file.
 */
async function extractFromFile(
  filePath: string,
  workspaceRoot: string,
): Promise<FileResult> {
  const fullPath = resolveSafePath(filePath, workspaceRoot);
  const content = await readFile(fullPath, 'utf-8');
  const declarations: Declaration[] = [];

  // Reset lastIndex for global regex
  JSDOC_BLOCK_REGEX.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = JSDOC_BLOCK_REGEX.exec(content)) !== null) {
    const body = match[1];
    const isExport = !!match[2];
    const declKeyword = match[3].trim();
    const declName = match[4];

    // Calculate line number
    const fullMatch = match[0];
    const matchIndex = match.index;
    const line = (content.slice(0, matchIndex).match(/\n/g) || []).length + 1;

    declarations.push(
      parseJsdocBlock(body, declKeyword, declName, isExport, line),
    );
  }

  return {
    path: filePath,
    declarations,
  };
}

// ────────────────────────────────────────────────────────────
// Output Formatters
// ────────────────────────────────────────────────────────────

/**
 * Format extracted documentation as JSON.
 */
function formatJson(result: ApiDocResult): string {
  return JSON.stringify(result, null, 2);
}

/**
 * Format extracted documentation as Markdown.
 */
function formatMarkdown(result: ApiDocResult): string {
  const lines: string[] = [];

  lines.push('# API Documentation\n');
  lines.push(`> Auto-generated from ${result.totalFiles} file(s) — ${result.totalDeclarations} declaration(s)\n`);
  lines.push('---\n');

  for (const file of result.files) {
    if (file.declarations.length === 0) continue;

    lines.push(`## 📁 \`${file.path}\`\n`);

    for (const decl of file.declarations) {
      const exportBadge = decl.exported ? '`export`' : '';
      lines.push(`### ${decl.type} \`${decl.name}\` ${exportBadge}\n`);

      if (decl.description) {
        lines.push(`${decl.description}\n`);
      }

      if (decl.params && decl.params.length > 0) {
        lines.push('**Parameters:**\n');
        lines.push('| Name | Type | Optional | Description |');
        lines.push('|------|------|----------|-------------|');
        for (const param of decl.params) {
          lines.push(
            `| ${param.name} | ${param.type ?? '—'} | ${param.optional ? '✅' : '❌'} | ${param.description ?? '—'} |`,
          );
        }
        lines.push('');
      }

      if (decl.returns) {
        lines.push('**Returns:**');
        if (decl.returns.type) {
          lines.push(`> \`${decl.returns.type}\``);
        }
        if (decl.returns.description) {
          lines.push(`> ${decl.returns.description}`);
        }
        lines.push('');
      }

      if (decl.examples && decl.examples.length > 0) {
        lines.push('**Examples:**\n');
        for (const example of decl.examples) {
          lines.push('```typescript');
          lines.push(example);
          lines.push('```\n');
        }
      }

      if (decl.deprecated) {
        lines.push('> ⚠️ **Deprecated**\n');
      }

      if (decl.since) {
        lines.push(`> **Since:** ${decl.since}\n`);
      }

      if (decl.see && decl.see.length > 0) {
        lines.push('**See also:**\n');
        for (const ref of decl.see) {
          lines.push(`- \`${ref}\``);
        }
        lines.push('');
      }

      if (decl.throws && decl.throws.length > 0) {
        lines.push('**Throws:**\n');
        for (const t of decl.throws) {
          lines.push(`- \`${t}\``);
        }
        lines.push('');
      }

      lines.push(`> *Line ${decl.line}*\n`);
      lines.push('---\n');
    }
  }

  return lines.join('\n');
}

// ────────────────────────────────────────────────────────────
// Tool Registration
// ────────────────────────────────────────────────────────────

export function registerApiDocExtractor(_server: Server, deps: ToolDeps): void {
  toolRegistry.register({
    name: 'fs_api_doc_extractor',
    description:
      'Extract JSDoc/TSDoc comments from TypeScript and JavaScript files and return ' +
      'structured documentation in JSON or Markdown format. Supports @param, @returns, ' +
      '@example, @deprecated, @see, @since, and @throws tags.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'File or directory path to scan (required)',
        },
        include: {
          type: 'string',
          default: DEFAULT_INCLUDE,
          description:
            'Glob pattern to filter files (default: **/*.{ts,tsx,js,jsx})',
        },
        format: {
          type: 'string',
          enum: ['json', 'markdown'],
          default: 'json',
          description: 'Output format: json or markdown (default: json)',
        },
        output: {
          type: 'string',
          description:
            'Optional file path to write the output to (relative to workspace)',
        },
        recursive: {
          type: 'boolean',
          default: true,
          description:
            'Search directories recursively (default: true)',
        },
        agent: {
          type: 'string',
          description:
            'Nome dell agente chiamante (opzionale, default: "ianus")',
        },
      },
      required: ['path'],
    },
    handler: async (args) => {
      const inputPath = args.path as string | undefined;
      if (!inputPath) {
        return {
          content: [
            { type: 'text', text: 'Missing required parameter: "path"' },
          ],
          isError: true,
        };
      }

      const includePattern = (args.include as string) ?? DEFAULT_INCLUDE;
      const format = (args.format as 'json' | 'markdown') ?? 'json';
      const outputPath = args.output as string | undefined;
      const recursive = (args.recursive as boolean) ?? true;
      const callerAgent = (args.agent as string) || 'ianus';

      // Permission check (read-only)
      const permCheck = await deps.permission.checkOperation(
        callerAgent,
        'read',
        inputPath,
        deps.workspaceRoot,
      );
      if (!permCheck.allowed) {
        return {
          content: [
            {
              type: 'text',
              text: `Permission denied: ${permCheck.reason}`,
            },
          ],
          isError: true,
        };
      }

      try {
        // Find files
        const files = await findFiles(
          inputPath,
          includePattern,
          recursive,
          deps.workspaceRoot,
        );

        if (files.length === 0) {
          return {
            content: [
              {
                type: 'text',
                text: `No matching files found in "${inputPath}" with pattern "${includePattern}"`,
              },
            ],
            isError: true,
          };
        }

        // Extract declarations from all files
        const fileResults: FileResult[] = [];
        let totalDeclarations = 0;

        for (const file of files) {
          const relPath = relative(deps.workspaceRoot, file).replace(/\\/g, '/');
          const fileResult = await extractFromFile(file, deps.workspaceRoot);
          fileResult.path = relPath;
          totalDeclarations += fileResult.declarations.length;
          fileResults.push(fileResult);
        }

        const apiDocResult: ApiDocResult = {
          files: fileResults,
          totalFiles: files.length,
          totalDeclarations,
        };

        // Format output
        let outputText: string;
        if (format === 'markdown') {
          outputText = formatMarkdown(apiDocResult);
        } else {
          outputText = formatJson(apiDocResult);
        }

        // Write to file if output path is specified
        if (outputPath) {
          const safeOutput = resolveSafePath(outputPath, deps.workspaceRoot);
          const { writeFile, mkdir } = await import('node:fs/promises');
          const { dirname } = await import('node:path');
          await mkdir(dirname(safeOutput), { recursive: true });
          await writeFile(safeOutput, outputText, 'utf-8');

          // Log to journal
          await logToJournal(deps.workspaceRoot, {
            agent: 'ianus',
            operation: 'api_doc_extractor',
            path: outputPath,
            details: {
              source: inputPath,
              filesFound: files.length,
              declarationsFound: totalDeclarations,
              format,
            },
          });

          serverStats.increment();

          return {
            content: [
              {
                type: 'text',
                text: `Documentation written to "${outputPath}" (${files.length} files, ${totalDeclarations} declarations)`,
              },
            ],
          };
        }

        // Log to journal
        await logToJournal(deps.workspaceRoot, {
          agent: 'ianus',
          operation: 'api_doc_extractor',
          path: inputPath,
          details: {
            filesFound: files.length,
            declarationsFound: totalDeclarations,
            format,
          },
        });

        serverStats.increment();

        return {
          content: [{ type: 'text', text: outputText }],
        };
      } catch (err) {
        return {
          content: [
            {
              type: 'text',
              text: `Error extracting API documentation: ${(err as Error).message}`,
            },
          ],
          isError: true,
        };
      }
    },
  });
}
