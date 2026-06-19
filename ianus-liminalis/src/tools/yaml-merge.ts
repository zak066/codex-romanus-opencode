/**
 * fs_yaml_merge — Ianus Liminalis
 *
 * Deep-merge di file YAML/JSON in un unico output.
 * Essenziale per configurazioni multi-ambiente (base + override).
 *
 * Logica merge:
 *   - Oggetti: merge ricorsivo chiave per chiave
 *   - Array: "replace" → l'array successivo sostituisce il precedente
 *            "concat" → concatena
 *   - Scalari: vince il valore più recente
 *   - Tipi misti: vince il più recente (con warn se type change)
 */

import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { readFile, stat, writeFile, mkdir } from 'node:fs/promises';
import { extname, dirname } from 'node:path';
import { resolveSafePath } from '../core/path-utils.js';
import { logToJournal } from '../core/journal-logger.js';
import { stats as serverStats } from '../core/stats.js';
import { toolRegistry } from './registry.js';
import type { ToolDeps } from './types.js';

// ─── Mini YAML Parser ────────────────────────────────────────────────────────

type YamlValue = string | number | boolean | null | YamlValue[] | { [key: string]: YamlValue };

interface ProcessedLine {
  indent: number;
  text: string;
}

interface StackEntry {
  indent: number;
  /** The container — either an object or an array */
  container: Record<string, YamlValue> | YamlValue[];
  isArray: boolean;
}

/**
 * Minimal YAML parser for common config structures:
 * - Nested objects (indentation-based)
 * - Inline arrays [a, b, c]
 * - Dash-prefixed array items (- item)
 * - Arrays of objects with sub-keys
 * - Scalars: strings, numbers, booleans, null
 * - Comments (#)
 *
 * Uses lookahead: when a key has an empty value, peeks at the next non-empty
 * line. If it starts with '-', creates an array; otherwise creates a nested object.
 */
function parseYaml(yaml: string): Record<string, YamlValue> {
  const root: Record<string, YamlValue> = {};

  // Pre-process: strip inline comments, skip empty/comment-only lines
  const processed: ProcessedLine[] = [];
  const rawLines = yaml.split(/\r?\n/);
  for (const rawLine of rawLines) {
    const trimmed = rawLine.trimEnd();
    const text = trimmed.trim();
    if (!text) continue;
    if (text.startsWith('#')) continue;
    const clean = removeInlineComment(text);
    if (!clean) continue;
    const indent = rawLine.length - rawLine.trimStart().length;
    processed.push({ indent, text: clean });
  }

  // Stack tracks nesting context.
  // For objects: entries at deeper indent are children.
  // For arrays: entries at the same indent are siblings (next array item);
  //   entries at deeper indent are sub-keys of the last array item.
  const stack: StackEntry[] = [
    { indent: -1, container: root, isArray: false },
  ];

  let i = 0;
  while (i < processed.length) {
    const { indent, text } = processed[i];

    // ── Pop stack ──────────────────────────────────────────────────────────
    // Pop containers whose indent is >= current (siblings or shallower).
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) {
      stack.pop();
    }

    const current = stack[stack.length - 1];
    const container = current.container;

    // ── Dash array item: "- value" or "- key: value" ───────────────────────
    const dashMatch = text.match(/^-\s+(.*)$/);
    if (dashMatch) {
      const itemContent = dashMatch[1].trim();

      if (!current.isArray) {
        // Defensive: should not happen with lookahead
        i++;
        continue;
      }

      const arr = container as YamlValue[];

      // Check if it's a "key: value" pair inside the dash item
      const kvMatch = itemContent.match(/^([a-zA-Z_][a-zA-Z0-9_]*):\s*(.*)$/);
      if (kvMatch) {
        const key = kvMatch[1];
        const valuePart = kvMatch[2].trim();

        if (valuePart === '') {
          // "- key:" with empty value → lookahead for nested object vs array
          const next = findNextNonEmpty(processed, i + 1, indent);
          if (next !== null && processed[next].text.startsWith('- ')) {
            // Nested array: create {key: []}
            const innerArr: YamlValue[] = [];
            (arr as YamlValue[]).push({ [key]: innerArr } as Record<string, YamlValue>);
            // Push inner array for subsequent dash items
            stack.push({ indent, container: innerArr, isArray: true });
          } else {
            // Nested object: create {key: {}}
            const inner: Record<string, YamlValue> = {};
            (arr as YamlValue[]).push({ [key]: inner } as Record<string, YamlValue>);
            // Push inner object for sub-keys
            stack.push({ indent, container: inner, isArray: false });
          }
        } else {
          // "key: value" — single-key object
          const obj = { [key]: parseScalar(valuePart) } as Record<string, YamlValue>;
          (arr as YamlValue[]).push(obj);
          // Push for subsequent sub-keys at deeper indent
          stack.push({ indent, container: obj, isArray: false });
        }
      } else {
        // Simple scalar array item
        (arr as YamlValue[]).push(parseScalar(itemContent));
        // Don't push to stack — scalars have no sub-keys
      }

      i++;
      continue;
    }

    // ── Key: value pair ────────────────────────────────────────────────────
    const kvMatch = text.match(/^([a-zA-Z_][a-zA-Z0-9_]*):\s*(.*)$/);
    if (!kvMatch) {
      i++;
      continue;
    }

    const key = kvMatch[1];
    const valuePart = kvMatch[2].trim();

    // ── We're in an array container: this key belongs to the last array item ─
    if (current.isArray) {
      const arr = container as YamlValue[];
      if (arr.length > 0) {
        const lastItem = arr[arr.length - 1];
        if (typeof lastItem === 'object' && lastItem !== null && !Array.isArray(lastItem)) {
          (lastItem as Record<string, YamlValue>)[key] = parseScalar(valuePart);
        }
      }
      i++;
      continue;
    }

    // ── We're in an object container ───────────────────────────────────────
    const obj = container as Record<string, YamlValue>;

    // Inline array: key: [a, b, c]
    if (valuePart.startsWith('[') && valuePart.endsWith(']')) {
      obj[key] = parseInlineArray(valuePart.slice(1, -1));
      i++;
      continue;
    }

    // Empty value — look ahead to decide object vs array
    if (valuePart === '') {
      const nextIdx = findNextDeeperLine(processed, i + 1, indent);
      if (nextIdx >= 0 && processed[nextIdx].text.startsWith('- ')) {
        // Next deeper line starts with '-' → array
        const arr: YamlValue[] = [];
        obj[key] = arr;
        stack.push({ indent, container: arr, isArray: true });
      } else if (nextIdx >= 0) {
        // Next deeper line doesn't start with '-' → nested object
        const newObj: Record<string, YamlValue> = {};
        obj[key] = newObj;
        stack.push({ indent, container: newObj, isArray: false });
      } else {
        // No deeper content → empty object
        obj[key] = {};
      }
      i++;
      continue;
    }

    // Has inline scalar value
    obj[key] = parseScalar(valuePart);
    i++;
  }

  return root;
}

/**
 * Find the next line index starting from `startIdx` that is at a deeper
 * indent than `baseIndent`. Returns -1 if no deeper line is found before
 * a line at the same or shallower indent (or end of input).
 */
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

/**
 * Find the next line index starting from `startIdx` that is at a deeper
 * indent than `baseIndent`. Returns null if no deeper line is found before
 * a line at or above baseIndent (or end of input).
 */
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

/**
 * Remove inline comments (everything after # that's not inside a quoted string).
 */
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

/**
 * Parse inline array content: "a, b, c" or "a, b, [c, d]"
 */
function parseInlineArray(content: string): YamlValue[] {
  const items: YamlValue[] = [];
  let current = '';
  let depth = 0;

  for (let i = 0; i < content.length; i++) {
    const ch = content[i];
    if (ch === '[') {
      depth++;
      current += ch;
    } else if (ch === ']') {
      depth--;
      current += ch;
    } else if (ch === ',' && depth === 0) {
      const trimmed = current.trim();
      if (trimmed) items.push(parseScalar(trimmed));
      current = '';
    } else {
      current += ch;
    }
  }

  const trimmed = current.trim();
  if (trimmed) items.push(parseScalar(trimmed));

  return items;
}

/**
 * Parse a scalar YAML value (string, number, boolean, null).
 */
function parseScalar(value: string): YamlValue {
  const trimmed = value.trim();

  // Empty
  if (!trimmed) return '';

  // Null / null aliases
  if (/^(null|Null|NULL|~)$/.test(trimmed)) return null;

  // Booleans (YAML 1.1)
  if (/^(true|True|TRUE|yes|Yes|YES|on|On|ON)$/.test(trimmed)) return true;
  if (/^(false|False|FALSE|no|No|NO|off|Off|OFF)$/.test(trimmed)) return false;

  // Numbers (integer or float)
  if (/^-?\d+$/.test(trimmed)) return parseInt(trimmed, 10);
  if (/^-?\d+\.\d+$/.test(trimmed)) return parseFloat(trimmed);

  // Quoted strings: remove surrounding quotes
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }

  return trimmed;
}

/**
 * Serialize a parsed YAML value back to YAML string.
 */
function serializeYaml(value: YamlValue, indent: number = 0): string {
  const pad = '  '.repeat(indent);

  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number' || typeof value === 'string') {
    // Check if string needs quoting
    if (typeof value === 'string') {
      if (/[:\{\}\[\],&\*\?\|<>=!%@`#]/.test(value) || value.includes(' ') || value === '') {
        return JSON.stringify(value);
      }
      return value;
    }
    return String(value);
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    const items = value.map((item) => {
      if (typeof item === 'object' && item !== null && !Array.isArray(item)) {
        // Object items in array: - key: value
        const obj = item as Record<string, YamlValue>;
        const keys = Object.keys(obj);
        if (keys.length === 1) {
          const k = keys[0];
          const v = serializeYaml(obj[k], indent + 1);
          // Check if v is multi-line
          if (v.includes('\n')) {
            return `${pad}- ${k}:\n${v.split('\n').map(l => pad + '  ' + l).join('\n')}`;
          }
          return `${pad}- ${k}: ${v}`;
        }
        // Multi-key objects in array
        const lines = [`${pad}-`];
        for (const k of keys) {
          const v = serializeYaml(obj[k], indent + 2);
          if (v.includes('\n')) {
            lines.push(`${pad}  ${k}:`);
            for (const l of v.split('\n')) {
              lines.push(`${pad}    ${l}`);
            }
          } else {
            lines.push(`${pad}  ${k}: ${v}`);
          }
        }
        return lines.join('\n');
      }
      // Simple array item (scalar)
      return `${pad}- ${serializeYaml(item, indent + 1)}`;
    });
    return items.join('\n');
  }

  // Object
  const obj = value as Record<string, YamlValue>;
  const keys = Object.keys(obj);
  if (keys.length === 0) return '{}';

  const lines: string[] = [];
  for (const k of keys) {
    const v = serializeYaml(obj[k], indent + 1);
    if (v.includes('\n')) {
      lines.push(`${pad}${k}:`);
      for (const l of v.split('\n')) {
        lines.push(`${l}`);
      }
    } else {
      lines.push(`${pad}${k}: ${v}`);
    }
  }
  return lines.join('\n');
}

/**
 * Serialize to JSON string.
 */
function serializeJson(value: YamlValue, pretty: boolean = true): string {
  return JSON.stringify(value, null, pretty ? 2 : undefined);
}

// ─── Deep Merge Logic ────────────────────────────────────────────────────────

interface SourceField {
  field: string;
  fromFile: number;
  mergeType: 'override' | 'deep' | 'concat';
}

/**
 * Deep-merge two values, tracking field provenance.
 */
function deepMerge(
  base: YamlValue,
  override: YamlValue,
  fileIndex: number,
  fieldPath: string,
  arrayMode: 'replace' | 'concat',
  source: SourceField[],
): YamlValue {
  // If both are plain objects (not arrays, not null)
  if (
    typeof base === 'object' && base !== null && !Array.isArray(base) &&
    typeof override === 'object' && override !== null && !Array.isArray(override)
  ) {
    const baseObj = base as Record<string, YamlValue>;
    const overrideObj = override as Record<string, YamlValue>;
    const merged: Record<string, YamlValue> = { ...baseObj };

    for (const key of Object.keys(overrideObj)) {
      const childPath = fieldPath ? `${fieldPath}.${key}` : key;
      if (key in baseObj) {
        merged[key] = deepMerge(baseObj[key], overrideObj[key], fileIndex, childPath, arrayMode, source);
      } else {
        merged[key] = overrideObj[key];
        source.push({ field: childPath, fromFile: fileIndex, mergeType: 'override' });
      }
    }
    return merged;
  }

  // If both are arrays
  if (Array.isArray(base) && Array.isArray(override)) {
    if (arrayMode === 'concat') {
      source.push({ field: fieldPath, fromFile: fileIndex, mergeType: 'concat' });
      return [...base, ...override];
    }
    // replace
    source.push({ field: fieldPath, fromFile: fileIndex, mergeType: 'override' });
    return override;
  }

  // Scalar or mixed types: override wins
  if (typeof base !== typeof override || base === null || override === null ||
      Array.isArray(base) !== Array.isArray(override)) {
    // Type change — warn via source tracking
    source.push({ field: fieldPath, fromFile: fileIndex, mergeType: 'override' });
  } else {
    source.push({ field: fieldPath, fromFile: fileIndex, mergeType: 'override' });
  }

  return override;
}

/**
 * Merges multiple parsed documents sequentially.
 */
function mergeDocuments(
  docs: YamlValue[],
  arrayMode: 'replace' | 'concat',
): { merged: YamlValue; source: SourceField[] } {
  if (docs.length === 0) return { merged: {}, source: [] };

  let merged = docs[0];
  const source: SourceField[] = [];

  // Initialize source for first document's top-level keys
  if (typeof merged === 'object' && merged !== null && !Array.isArray(merged)) {
    for (const key of Object.keys(merged as Record<string, YamlValue>)) {
      source.push({ field: key, fromFile: 0, mergeType: 'override' });
    }
  }

  for (let i = 1; i < docs.length; i++) {
    merged = deepMerge(merged, docs[i], i, '', arrayMode, source);
  }

  return { merged, source };
}

/**
 * Detect format from file extension or explicit format.
 */
function detectFormat(
  filePath: string,
  format?: 'auto' | 'json' | 'yaml',
): 'json' | 'yaml' {
  if (format && format !== 'auto') return format;

  const ext = extname(filePath).toLowerCase();
  if (ext === '.json') return 'json';
  return 'yaml'; // .yaml, .yml, or unknown → yaml
}

/**
 * Parse a file's content based on its extension.
 */
function parseFileContent(content: string, ext: string): Record<string, YamlValue> {
  const lowerExt = ext.toLowerCase();
  if (lowerExt === '.json') {
    const parsed = JSON.parse(content);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return { root: parsed as YamlValue };
    }
    return parsed as Record<string, YamlValue>;
  }
  // YAML / YML
  return parseYaml(content);
}

// ─── Tool Registration ───────────────────────────────────────────────────────

export function registerYamlMerge(_server: Server, deps: ToolDeps): void {
  toolRegistry.register({
    name: 'fs_yaml_merge',
    description:
      'Deep-merge YAML/JSON configuration files into a single output. ' +
      'Files are processed in order with increasing priority (last file wins). ' +
      'Supports nested object deep-merge, array replace/concat, and field-level provenance tracking. ' +
      'Essential for multi-environment configuration management (base + override).',
    annotations: { destructiveHint: true, idempotentHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        files: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of file paths to merge, in order of increasing priority (last wins). Each path is relative to workspace.',
        },
        output: {
          type: 'string',
          description: 'Output file path (optional — if omitted, result is printed to stdout)',
        },
        arrayMode: {
          type: 'string',
          enum: ['replace', 'concat'],
          default: 'replace',
          description: 'How to handle arrays on conflict: "replace" (last wins) or "concat" (concatenate)',
        },
        format: {
          type: 'string',
          enum: ['auto', 'json', 'yaml'],
          default: 'auto',
          description: 'Output format: "auto" (infer from output extension), "json", or "yaml"',
        },
        agent: {
          type: 'string',
          description: 'Nome dell agente chiamante (opzionale, default: "ianus")',
        },
      },
      required: ['files'],
    },
    handler: async (args) => {
      const files = args.files as string[] | undefined;
      if (!files || !Array.isArray(files) || files.length === 0) {
        return { content: [{ type: 'text', text: 'Missing required parameter: "files" (non-empty array)' }], isError: true };
      }

      const outputPathArg = args.output as string | undefined;
      const arrayMode = (args.arrayMode as 'replace' | 'concat') ?? 'replace';
      const format = (args.format as 'auto' | 'json' | 'yaml') ?? 'auto';
      const callerAgent = (args.agent as string) || 'ianus';

      // Determine output format
      let outputFormat: 'json' | 'yaml';
      if (outputPathArg) {
        outputFormat = detectFormat(outputPathArg, format);
      } else {
        // Infer from first file or default to yaml
        outputFormat = format === 'auto' ? detectFormat(files[0]) : format;
      }

      try {
        // Read and parse all files
        const docs: YamlValue[] = [];
        const resolvedPaths: string[] = [];

        for (const filePath of files) {
          // Permission check for read
          const permCheck = await deps.permission.checkOperation(
            callerAgent,
            'read',
            filePath,
            deps.workspaceRoot,
          );
          if (!permCheck.allowed) {
            return {
              content: [{ type: 'text', text: `Permission denied for "${filePath}": ${permCheck.reason}` }],
              isError: true,
            };
          }

          const safePath = resolveSafePath(filePath, deps.workspaceRoot);
          const content = await readFile(safePath, 'utf-8');
          const ext = extname(filePath).toLowerCase();
          const parsed = parseFileContent(content, ext);
          docs.push(parsed);
          resolvedPaths.push(filePath);
        }

        // Deep merge
        const { merged, source } = mergeDocuments(docs, arrayMode);

        // Count total fields in result
        function countFields(value: YamlValue): number {
          if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
            let count = 0;
            for (const key of Object.keys(value as Record<string, YamlValue>)) {
              count++;
              count += countFields((value as Record<string, YamlValue>)[key]);
            }
            return count;
          }
          if (Array.isArray(value)) {
            return value.length;
          }
          return 0;
        }
        const fieldsCount = countFields(merged);

        // Serialize output
        let outputContent: string;
        if (outputFormat === 'json') {
          outputContent = serializeJson(merged);
        } else {
          outputContent = serializeYaml(merged);
        }

        // Build result
        const result: Record<string, unknown> = {
          files: resolvedPaths,
          format: outputFormat,
          fieldsCount,
          source,
        };

        // Write or return
        if (outputPathArg) {
          const safeOutputPath = resolveSafePath(outputPathArg, deps.workspaceRoot);
          await mkdir(dirname(safeOutputPath), { recursive: true });
          await writeFile(safeOutputPath, outputContent, 'utf-8');

          // Log to journal
          await logToJournal(deps.workspaceRoot, {
            agent: 'ianus',
            operation: 'yaml_merge',
            path: outputPathArg,
            details: {
              files: resolvedPaths,
              fieldsCount,
              format: outputFormat,
            },
          });

          serverStats.increment();

          result.output = outputPathArg;
          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          };
        }

        // No output path — include merged content in result
        result.content = outputContent;
        serverStats.increment();

        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        return {
          content: [
            {
              type: 'text',
              text: `Error merging YAML/JSON files: ${(err as Error).message}`,
            },
          ],
          isError: true,
        };
      }
    },
  });
}
