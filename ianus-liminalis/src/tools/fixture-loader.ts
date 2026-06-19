/**
 * fs_fixture_loader — Ianus Liminalis
 *
 * Carica fixture da file JSON/YAML e restituisce come oggetti JavaScript parsati.
 * Supporta $ref per riferimenti tra file, directory recursive e flatten.
 */

import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join, extname, basename, dirname, relative } from 'node:path';
import { resolveSafePath } from '../core/path-utils.js';
import { logToJournal } from '../core/journal-logger.js';
import { stats as serverStats } from '../core/stats.js';
import { toolRegistry } from './registry.js';
import type { ToolDeps } from './types.js';

const MAX_REF_DEPTH = 5;

type FixtureValue =
  | string
  | number
  | boolean
  | null
  | FixtureValue[]
  | { [key: string]: FixtureValue };

interface FixtureEntry {
  name: string;
  data: unknown;
}

// ─── Mini YAML Parser ────────────────────────────────────────────────────────

type YamlValue = string | number | boolean | null | YamlValue[] | { [key: string]: YamlValue };

interface ProcessedLine {
  indent: number;
  text: string;
}

interface StackEntry {
  indent: number;
  container: Record<string, YamlValue> | YamlValue[];
  isArray: boolean;
}

/**
 * Minimal YAML parser for fixture files.
 */
function parseYaml(yaml: string): Record<string, YamlValue> {
  const root: Record<string, YamlValue> = {};

  const processed: ProcessedLine[] = [];
  const rawLines = yaml.split(/\r?\n/);
  for (const rawLine of rawLines) {
    const text = rawLine.trim();
    if (!text) continue;
    if (text.startsWith('#')) continue;
    const clean = removeInlineComment(text);
    if (!clean) continue;
    const indent = rawLine.length - rawLine.trimStart().length;
    processed.push({ indent, text: clean });
  }

  const stack: StackEntry[] = [
    { indent: -1, container: root, isArray: false },
  ];

  let i = 0;
  while (i < processed.length) {
    const { indent, text } = processed[i];

    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) {
      stack.pop();
    }

    const current = stack[stack.length - 1];
    const container = current.container;

    // Dash array item: "- value" or "- key: value"
    const dashMatch = text.match(/^-\s+(.*)$/);
    if (dashMatch) {
      const itemContent = dashMatch[1].trim();

      if (!current.isArray) {
        i++;
        continue;
      }

      const arr = container as YamlValue[];

      const kvMatch = itemContent.match(/^([a-zA-Z_][a-zA-Z0-9_]*):\s*(.*)$/);
      if (kvMatch) {
        const key = kvMatch[1];
        const valuePart = kvMatch[2].trim();

        if (valuePart === '') {
          const next = findNextNonEmpty(processed, i + 1, indent);
          if (next !== null && processed[next].text.startsWith('- ')) {
            const innerArr: YamlValue[] = [];
            (arr as YamlValue[]).push({ [key]: innerArr } as Record<string, YamlValue>);
            stack.push({ indent, container: innerArr, isArray: true });
          } else {
            const inner: Record<string, YamlValue> = {};
            (arr as YamlValue[]).push({ [key]: inner } as Record<string, YamlValue>);
            stack.push({ indent, container: inner, isArray: false });
          }
        } else {
          const obj = { [key]: parseYamlScalar(valuePart) } as Record<string, YamlValue>;
          (arr as YamlValue[]).push(obj);
          stack.push({ indent, container: obj, isArray: false });
        }
      } else {
        (arr as YamlValue[]).push(parseYamlScalar(itemContent));
      }

      i++;
      continue;
    }

    // Key: value pair
    const kvMatch = text.match(/^([a-zA-Z_][a-zA-Z0-9_]*):\s*(.*)$/);
    if (!kvMatch) {
      i++;
      continue;
    }

    const key = kvMatch[1];
    const valuePart = kvMatch[2].trim();

    if (current.isArray) {
      const arr = container as YamlValue[];
      if (arr.length > 0) {
        const lastItem = arr[arr.length - 1];
        if (typeof lastItem === 'object' && lastItem !== null && !Array.isArray(lastItem)) {
          (lastItem as Record<string, YamlValue>)[key] = parseYamlScalar(valuePart);
        }
      }
      i++;
      continue;
    }

    const obj = container as Record<string, YamlValue>;

    if (valuePart.startsWith('[') && valuePart.endsWith(']')) {
      obj[key] = parseYamlInlineArray(valuePart.slice(1, -1));
      i++;
      continue;
    }

    if (valuePart === '') {
      const nextIdx = findNextDeeperLine(processed, i + 1, indent);
      if (nextIdx >= 0 && processed[nextIdx].text.startsWith('- ')) {
        const arr: YamlValue[] = [];
        obj[key] = arr;
        stack.push({ indent, container: arr, isArray: true });
      } else if (nextIdx >= 0) {
        const newObj: Record<string, YamlValue> = {};
        obj[key] = newObj;
        stack.push({ indent, container: newObj, isArray: false });
      } else {
        obj[key] = {};
      }
      i++;
      continue;
    }

    obj[key] = parseYamlScalar(valuePart);
    i++;
  }

  return root;
}

function findNextDeeperLine(
  processed: ProcessedLine[],
  startIdx: number,
  baseIndent: number,
): number {
  for (let j = startIdx; j < processed.length; j++) {
    if (processed[j].indent > baseIndent) return j;
    if (processed[j].indent <= baseIndent) return -1;
  }
  return -1;
}

function findNextNonEmpty(
  processed: ProcessedLine[],
  startIdx: number,
  baseIndent: number,
): number | null {
  for (let j = startIdx; j < processed.length; j++) {
    if (processed[j].indent > baseIndent) return j;
    if (processed[j].indent <= baseIndent) return null;
  }
  return null;
}

function removeInlineComment(line: string): string {
  let result = '';
  let inSingleQuote = false;
  let inDoubleQuote = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      result += ch;
    } else if (ch === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      result += ch;
    } else if (ch === '#' && !inSingleQuote && !inDoubleQuote) {
      break;
    } else {
      result += ch;
    }
  }

  return result.trimEnd();
}

function parseYamlInlineArray(content: string): YamlValue[] {
  const items: YamlValue[] = [];
  let current = '';
  let depth = 0;

  for (let i = 0; i < content.length; i++) {
    const ch = content[i];
    if (ch === '[') { depth++; current += ch; }
    else if (ch === ']') { depth--; current += ch; }
    else if (ch === ',' && depth === 0) {
      const trimmed = current.trim();
      if (trimmed) items.push(parseYamlScalar(trimmed));
      current = '';
    } else {
      current += ch;
    }
  }

  const trimmed = current.trim();
  if (trimmed) items.push(parseYamlScalar(trimmed));

  return items;
}

function parseYamlScalar(value: string): YamlValue {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (/^(null|Null|NULL|~)$/.test(trimmed)) return null;
  if (/^(true|True|TRUE|yes|Yes|YES|on|On|ON)$/.test(trimmed)) return true;
  if (/^(false|False|FALSE|no|No|NO|off|Off|OFF)$/.test(trimmed)) return false;
  if (/^-?\d+$/.test(trimmed)) return parseInt(trimmed, 10);
  if (/^-?\d+\.\d+$/.test(trimmed)) return parseFloat(trimmed);
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

// ─── Fixture loading ─────────────────────────────────────────────────────────

/**
 * Validate and parse a JSON string.
 * Returns the parsed data or throws on invalid JSON.
 */
function parseJson(json: string): unknown {
  return JSON.parse(json);
}

/**
 * Parse file content based on extension.
 */
function parseFileContent(
  content: string,
  ext: string,
): Record<string, unknown> {
  const lowerExt = ext.toLowerCase();
  if (lowerExt === '.json') {
    const parsed = parseJson(content);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return { root: parsed };
    }
    return parsed as Record<string, unknown>;
  }
  // .yaml / .yml
  return parseYaml(content) as unknown as Record<string, unknown>;
}

/**
 * Check if a value is a plain object (not array, not null).
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Resolve $ref references in a parsed fixture.
 *
 * $ref: "./other-file.json" carica e merge quel file.
 * Percorso relativo risolto rispetto al file che contiene $ref.
 * Protezione da cicli (max 5 livelli di profondità).
 */
async function resolveRefs(
  data: unknown,
  currentDir: string,
  workspaceRoot: string,
  depth: number = 0,
  visited: Set<string> = new Set(),
): Promise<unknown> {
  if (depth > MAX_REF_DEPTH) {
    return data; // Stop recursion at max depth
  }

  if (!isPlainObject(data)) {
    return data;
  }

  const obj = data as Record<string, unknown>;

  // Check for $ref
  if (typeof obj.$ref === 'string') {
    const refPath = obj.$ref as string;

    // Resolve relative to current directory
    const resolvedRef = join(currentDir, refPath);
    const normalizedRef = resolvedRef.replace(/\\/g, '/');

    if (visited.has(normalizedRef)) {
      // Cycle detected — return a marker
      return { __cycle_detected__: true, ref: refPath };
    }

    visited.add(normalizedRef);

    try {
      const fullPath = resolveSafePath(normalizedRef, workspaceRoot);
      const content = await readFile(fullPath, 'utf-8');
      const ext = extname(normalizedRef).toLowerCase();
      const refDir = dirname(normalizedRef);
      const parsed = parseFileContent(content, ext);

      // Recursively resolve refs in the loaded file
      const resolved = await resolveRefs(parsed, refDir, workspaceRoot, depth + 1, visited);

      // Merge remaining fields from the original ref object
      // (for cases like: { $ref: "./base.json", override: true })
      const result: Record<string, unknown> = isPlainObject(resolved)
        ? { ...(resolved as Record<string, unknown>) }
        : { root: resolved as unknown };

      for (const [key, val] of Object.entries(obj)) {
        if (key !== '$ref') {
          result[key] = val;
        }
      }

      return result;
    } catch {
      // If ref can't be resolved, return original with error marker
      return { ...obj, __ref_error__: `Could not resolve $ref: "${refPath}"` };
    }
  }

  // Recursively process all values
  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(obj)) {
    if (Array.isArray(val)) {
      const resolvedArr: unknown[] = [];
      for (const item of val) {
        if (isPlainObject(item)) {
          const itemDir = currentDir;
          resolvedArr.push(
            await resolveRefs(item, itemDir, workspaceRoot, depth, new Set(visited)),
          );
        } else {
          resolvedArr.push(item);
        }
      }
      result[key] = resolvedArr;
    } else if (isPlainObject(val)) {
      result[key] = await resolveRefs(val, currentDir, workspaceRoot, depth, new Set(visited));
    } else {
      result[key] = val;
    }
  }

  return result;
}

/**
 * Recursively resolve $ref in an array of items.
 */
async function resolveRefsInArray(
  arr: unknown[],
  currentDir: string,
  workspaceRoot: string,
  depth: number = 0,
): Promise<unknown[]> {
  const result: unknown[] = [];
  for (const item of arr) {
    if (isPlainObject(item)) {
      result.push(await resolveRefs(item, currentDir, workspaceRoot, depth));
    } else {
      result.push(item);
    }
  }
  return result;
}

/**
 * Load a single fixture file.
 */
async function loadFixtureFile(
  filePath: string,
  workspaceRoot: string,
  validate: boolean,
): Promise<{ data: unknown; format: 'json' | 'yaml' }> {
  const fullPath = resolveSafePath(filePath, workspaceRoot);
  const ext = extname(filePath).toLowerCase();
  const format: 'json' | 'yaml' = ext === '.json' ? 'json' : 'yaml';

  const content = await readFile(fullPath, 'utf-8');

  if (validate) {
    // Validation for JSON
    if (format === 'json') {
      try {
        JSON.parse(content);
      } catch (err) {
        throw new Error(`Invalid JSON in "${filePath}": ${(err as Error).message}`);
      }
    }
    // YAML validation is done during parsing
  }

  const parsed = parseFileContent(content, ext);

  // Resolve $ref references
  const fileDir = dirname(filePath);
  const resolved = await resolveRefs(parsed, fileDir, workspaceRoot, 0);

  return { data: resolved, format };
}

/**
 * Recursively find fixture files in a directory.
 */
async function findFixtureFiles(
  dirPath: string,
  workspaceRoot: string,
  recursive: boolean,
): Promise<string[]> {
  const fullPath = resolveSafePath(dirPath, workspaceRoot);
  const entries = await readdir(fullPath, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const relPath = join(dirPath, entry.name).replace(/\\/g, '/');

    if (entry.isDirectory() && recursive) {
      const subFiles = await findFixtureFiles(relPath, workspaceRoot, recursive);
      files.push(...subFiles);
    } else if (entry.isFile()) {
      const ext = extname(entry.name).toLowerCase();
      if (ext === '.json' || ext === '.yaml' || ext === '.yml') {
        files.push(relPath);
      }
    }
  }

  return files.sort();
}

// ─── Tool registration ───────────────────────────────────────────────────────

export function registerFixtureLoader(_server: Server, deps: ToolDeps): void {
  toolRegistry.register({
    name: 'fs_fixture_loader',
    description:
      'Load fixtures from JSON/YAML files and return parsed JavaScript objects. ' +
      'Supports single files or directories (recursive), $ref resolution between files, ' +
      'flatten mode for directories, and validation. Useful for test fixtures and mock data.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path file fixture o directory (obbligatorio)',
        },
        recursive: {
          type: 'boolean',
          default: false,
          description:
            'Carica ricorsivamente se directory (default: false)',
        },
        flatten: {
          type: 'boolean',
          description:
            'Appiattisci in un unico oggetto con key=filename ' +
            '(default: true se directory, false se file singolo)',
        },
        validate: {
          type: 'boolean',
          default: true,
          description:
            'Valida JSON/YAML prima di parsare (default: true)',
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

      const recursive = (args.recursive as boolean) ?? false;
      const validate = (args.validate as boolean) ?? true;
      // Default flatten: true for directory, false for single file
      const flatten = args.flatten as boolean | undefined;

      // Permission check
      const callerAgent = (args.agent as string) || 'ianus';
      const permCheck = await deps.permission.checkOperation(
        callerAgent,
        'read',
        inputPath,
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
        const safePath = resolveSafePath(inputPath, deps.workspaceRoot);
        const pathStat = await stat(safePath);

        const errors: Array<{ file: string; message: string }> = [];

        if (pathStat.isFile()) {
          // Single file
          const { data, format } = await loadFixtureFile(
            inputPath,
            deps.workspaceRoot,
            validate,
          );

          const result = {
            loaded: true,
            format,
            entries: 1,
            data,
          };

          // Log to journal
          await logToJournal(deps.workspaceRoot, {
            agent: 'ianus',
            operation: 'fixture_loader',
            path: inputPath,
            details: { format, entries: 1 },
          });

          serverStats.increment();

          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          };
        } else if (pathStat.isDirectory()) {
          // Directory
          const fixtureFiles = await findFixtureFiles(
            inputPath,
            deps.workspaceRoot,
            recursive,
          );

          const shouldFlatten =
            flatten !== undefined ? flatten : true;

          if (shouldFlatten) {
            // Flatten mode: single object with key = filename without ext
            const flatData: Record<string, unknown> = {};

            for (const file of fixtureFiles) {
              try {
                const { data, format } = await loadFixtureFile(
                  file,
                  deps.workspaceRoot,
                  validate,
                );
                const fileName = basename(file);
                const fileNameNoExt = fileName.replace(/\.[^.]+$/, '');
                flatData[fileNameNoExt] = data;
              } catch (err) {
                errors.push({
                  file,
                  message: (err as Error).message,
                });
              }
            }

            const result = {
              loaded: errors.length === 0,
              format: 'json' as const,
              entries: fixtureFiles.length,
              data: flatData,
            };

            if (errors.length > 0) {
              result.loaded = false;
              (result as Record<string, unknown>).errors = errors;
            }

            // Log to journal
            await logToJournal(deps.workspaceRoot, {
              agent: 'ianus',
              operation: 'fixture_loader',
              path: inputPath,
              details: {
                entries: fixtureFiles.length,
                recursive,
                flatten: true,
              },
            });

            serverStats.increment();

            return {
              content: [
                { type: 'text', text: JSON.stringify(result, null, 2) },
              ],
            };
          } else {
            // Array mode: array of { name, data }
            const entries: FixtureEntry[] = [];

            for (const file of fixtureFiles) {
              try {
                const { data, format } = await loadFixtureFile(
                  file,
                  deps.workspaceRoot,
                  validate,
                );
                const fileName = basename(file);
                const fileNameNoExt = fileName.replace(/\.[^.]+$/, '');
                entries.push({ name: fileNameNoExt, data });
              } catch (err) {
                errors.push({
                  file,
                  message: (err as Error).message,
                });
              }
            }

            const result: Record<string, unknown> = {
              loaded: errors.length === 0,
              format: 'json',
              entries: entries.length,
              data: entries,
            };

            if (errors.length > 0) {
              result.loaded = false;
              result.errors = errors;
            }

            // Log to journal
            await logToJournal(deps.workspaceRoot, {
              agent: 'ianus',
              operation: 'fixture_loader',
              path: inputPath,
              details: {
                entries: entries.length,
                recursive,
                flatten: false,
              },
            });

            serverStats.increment();

            return {
              content: [
                { type: 'text', text: JSON.stringify(result, null, 2) },
              ],
            };
          }
        } else {
          return {
            content: [
              {
                type: 'text',
                text: `Path is not a file or directory: "${inputPath}"`,
              },
            ],
            isError: true,
          };
        }
      } catch (err) {
        return {
          content: [
            {
              type: 'text',
              text: `Error loading fixture from "${inputPath}": ${(err as Error).message}`,
            },
          ],
          isError: true,
        };
      }
    },
  });
}
