/**
 * fs_validate — Ianus Liminalis
 *
 * Valida un file JSON/YAML contro uno schema o regole built-in.
 * Per JSON: parsing + validazione JSON Schema base (senza librerie esterne).
 * Per YAML: parser manuale con verifica indentazione consistente.
 */

import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { readFile } from 'node:fs/promises';
import { extname, basename } from 'node:path';
import { resolveSafePath } from '../core/path-utils.js';
import { logToJournal } from '../core/journal-logger.js';
import { stats as serverStats } from '../core/stats.js';
import { toolRegistry } from './registry.js';
import type { ToolDeps } from './types.js';

// ────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────

interface ValidationError {
  line: number;
  message: string;
}

interface ValidationResult {
  valid: boolean;
  format: 'json' | 'yaml';
  size: number;
  errors?: ValidationError[];
  warnings?: string[];
}

// ────────────────────────────────────────────────────────────
// JSON Schema Subset — Manual validator senza dipendenze
// ────────────────────────────────────────────────────────────

interface SchemaProperty {
  type?: string;
  description?: string;
  properties?: Record<string, SchemaProperty>;
  items?: SchemaProperty;
  required?: string[];
  additionalProperties?: boolean;
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
}

interface JsonSchema {
  type?: string;
  properties?: Record<string, SchemaProperty>;
  required?: string[];
  additionalProperties?: boolean;
  items?: SchemaProperty;
  $schema?: string;
  description?: string;
  enum?: unknown[];
  // Constraint fields (also used at top-level schema)
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
}

/**
 * Valida un valore JSON contro una definizione di schema.
 * Restituisce array di errori con linea approssimativa.
 */
function validateJsonAgainstSchema(
  value: unknown,
  schema: JsonSchema,
  path: string = '$',
  currentLine: number = 1,
): ValidationError[] {
  const errors: ValidationError[] = [];

  // type check al livello corrente
  if (schema.type) {
    const valueType = getJsonType(value);
    if (valueType !== schema.type) {
      errors.push({
        line: currentLine,
        message: `Type mismatch at ${path}: expected "${schema.type}", got "${valueType}"`,
      });
      return errors;
    }
  }

  // enum check
  if (schema.enum && Array.isArray(schema.enum)) {
    if (!schema.enum.includes(value)) {
      errors.push({
        line: currentLine,
        message: `Value at ${path} is not one of the allowed enum values`,
      });
    }
  }

  // Se è un oggetto, valida le proprietà
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;

    // Check required fields
    if (schema.required && Array.isArray(schema.required)) {
      for (const field of schema.required) {
        if (!(field in obj)) {
          errors.push({
            line: currentLine,
            message: `Missing required field at ${path}: "${field}"`,
          });
        }
      }
    }

    // Check additionalProperties
    if (schema.additionalProperties === false && schema.properties) {
      const allowedKeys = new Set(Object.keys(schema.properties));
      for (const key of Object.keys(obj)) {
        if (!allowedKeys.has(key)) {
          errors.push({
            line: currentLine,
            message: `Unexpected field at ${path}: "${key}" (additional properties not allowed)`,
          });
        }
      }
    }

    // Valida ogni proprietà
    if (schema.properties) {
      for (const [key, propSchema] of Object.entries(schema.properties)) {
        if (key in obj) {
          const subPath = `${path}.${key}`;
          // Stima linea (approssimativa — per JSON validato usiamo 1 se non abbiamo tracking)
          const subErrors = validateJsonAgainstSchema(
            obj[key],
            propSchema as unknown as JsonSchema,
            subPath,
            currentLine,
          );
          errors.push(...subErrors);
        }
      }
    }
  }

  // Se è un array, valida gli items
  if (Array.isArray(value) && schema.items) {
    for (let i = 0; i < value.length; i++) {
      const subPath = `${path}[${i}]`;
      const subErrors = validateJsonAgainstSchema(
        value[i],
        schema.items as unknown as JsonSchema,
        subPath,
        currentLine,
      );
      errors.push(...subErrors);
    }
  }

  // Constraints numerici
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) {
      errors.push({
        line: currentLine,
        message: `Value at ${path} (${value}) is less than minimum ${schema.minimum}`,
      });
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      errors.push({
        line: currentLine,
        message: `Value at ${path} (${value}) is greater than maximum ${schema.maximum}`,
      });
    }
  }

  // Constraints stringa
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      errors.push({
        line: currentLine,
        message: `String at ${path} length (${value.length}) is less than minLength ${schema.minLength}`,
      });
    }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      errors.push({
        line: currentLine,
        message: `String at ${path} length (${value.length}) is greater than maxLength ${schema.maxLength}`,
      });
    }
    if (schema.pattern) {
      try {
        const regex = new RegExp(schema.pattern);
        if (!regex.test(value)) {
          errors.push({
            line: currentLine,
            message: `String at ${path} does not match pattern: ${schema.pattern}`,
          });
        }
      } catch {
        errors.push({
          line: currentLine,
          message: `Invalid regex pattern in schema for ${path}: ${schema.pattern}`,
        });
      }
    }
  }

  return errors;
}

/**
 * Ottiene il tipo JSON semplificato per un valore.
 */
function getJsonType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

/**
 * Trova il numero di linea approssimativo per una posizione in una stringa JSON.
 */
function findLineNumber(jsonString: string, key: string, startIndex: number = 0): number {
  const lines = jsonString.substring(0, startIndex).split('\n');
  return lines.length;
}

// ────────────────────────────────────────────────────────────
// YAML Manual Parser (struttura base)
// ────────────────────────────────────────────────────────────

interface YamlToken {
  indent: number;
  key: string;
  value: string | null;
  line: number;
  isList: boolean;
  raw: string;
}

/**
 * Parser YAML manuale minimale.
 * Supporta: indentazione, chiavi: valori, liste (- item),
 * commenti (#), valori scalari (stringhe, numeri, booleani, null).
 */
function parseYamlBasic(content: string): { tokens: YamlToken[]; errors: ValidationError[] } {
  const lines = content.split('\n');
  const tokens: YamlToken[] = [];
  const errors: ValidationError[] = [];

  let previousIndent: number | null = null;
  const indentStack: number[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // Salta linee vuote
    if (line.trim() === '') continue;

    // Salta commenti
    if (line.trim().startsWith('#')) continue;

    // Calcola indentazione (solo spazi, niente tab)
    const indentMatch = line.match(/^(\s*)/);
    const indent = indentMatch ? indentMatch[1].length : 0;

    // Verifica che non ci siano tab al posto di spazi
    if (/\t/.test(line)) {
      errors.push({
        line: lineNum,
        message: 'YAML: tabs are not allowed for indentation. Use spaces.',
      });
      continue;
    }

    // List item: "- key: value" o "- value"
    const listMatch = line.match(/^(\s*)-\s+(.*)$/);
    if (listMatch) {
      const listIndent = listMatch[1].length;
      const rest = listMatch[2].trim();

      // Può essere "- key: value" oppure "- scalar value"
      const kvMatch = rest.match(/^([^:]+?):\s*(.*)$/);
      if (kvMatch) {
        tokens.push({
          indent: listIndent,
          key: kvMatch[1].trim(),
          value: kvMatch[2].trim() || null,
          line: lineNum,
          isList: true,
          raw: line,
        });
      } else {
        tokens.push({
          indent: listIndent,
          key: '',
          value: rest,
          line: lineNum,
          isList: true,
          raw: line,
        });
      }

      if (previousIndent !== null && listIndent !== previousIndent) {
        // Transizione indent — verifica consistenza
        checkIndentConsistency(listIndent, indentStack, lineNum, errors);
      }
      updateIndentStack(listIndent, indentStack);
      previousIndent = listIndent;
      continue;
    }

    // Key-value standard: "key: value"
    const kvMatch = line.match(/^(\s*)([^:#\s][^:]*?):\s*(.*)$/);
    if (kvMatch) {
      const keyIndent = kvMatch[1].length;
      const key = kvMatch[2].trim();
      const value = kvMatch[3].trim();

      tokens.push({
        indent: keyIndent,
        key,
        value: value || null,
        line: lineNum,
        isList: false,
        raw: line,
      });

      if (previousIndent !== null && keyIndent !== previousIndent) {
        checkIndentConsistency(keyIndent, indentStack, lineNum, errors);
      }
      updateIndentStack(keyIndent, indentStack);
      previousIndent = keyIndent;
      continue;
    }

    // Linea non riconosciuta
    errors.push({
      line: lineNum,
      message: `YAML: unrecognized line format: "${line.trim()}"`,
    });
  }

  return { tokens, errors };
}

function checkIndentConsistency(
  indent: number,
  indentStack: number[],
  lineNum: number,
  errors: ValidationError[],
): void {
  if (indentStack.length === 0) return;

  const lastIndent = indentStack[indentStack.length - 1];

  if (indent > lastIndent) {
    // Nuovo livello — ok, ma verifica che sia multiplo consistente
    if (indentStack.length >= 2) {
      const prevIndent = indentStack[indentStack.length - 2];
      const step = lastIndent - prevIndent;
      if (step > 0 && (indent - lastIndent) % step !== 0) {
        errors.push({
          line: lineNum,
          message: `YAML: inconsistent indentation. Expected multiple of ${step} spaces, got offset ${indent - lastIndent}.`,
        });
      }
    }
  }
}

function updateIndentStack(indent: number, stack: number[]): void {
  if (stack.length === 0) {
    stack.push(indent);
    return;
  }

  const last = stack[stack.length - 1];

  if (indent > last) {
    stack.push(indent);
  } else if (indent < last) {
    // Torna indietro di uno o più livelli
    while (stack.length > 0 && stack[stack.length - 1] > indent) {
      stack.pop();
    }
    if (stack.length === 0 || stack[stack.length - 1] !== indent) {
      stack.push(indent);
    }
  }
}

// ────────────────────────────────────────────────────────────
// Format detection
// ────────────────────────────────────────────────────────────

type SupportedFormat = 'json' | 'yaml';

function detectFormat(filePath: string, forceFormat?: string): SupportedFormat {
  if (forceFormat === 'json' || forceFormat === 'yaml') {
    return forceFormat;
  }

  const ext = extname(filePath).toLowerCase();
  if (ext === '.json') return 'json';
  if (ext === '.yaml' || ext === '.yml') return 'yaml';

  // Fallback su estensione
  throw new Error(
    `Unable to detect format for "${basename(filePath)}". ` +
    `Supported extensions: .json, .yaml, .yml. Use "format" parameter to force.`,
  );
}

// ────────────────────────────────────────────────────────────
// JSON Validation
// ────────────────────────────────────────────────────────────

function validateJsonContent(
  content: string,
  filePath: string,
  schemaContent?: string,
): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: string[] = [];

  // 1. Parsing JSON
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (err) {
    const msg = (err as Error).message;
    // Estrai numero di linea dal messaggio di errore JSON (es. "position 123" o "line 5 column 10")
    let line = 1;
    const posMatch = msg.match(/position\s+(\d+)/);
    if (posMatch) {
      const pos = parseInt(posMatch[1], 10);
      line = content.substring(0, pos).split('\n').length;
    }
    const lineMatch = msg.match(/line\s+(\d+)/);
    if (lineMatch) {
      line = parseInt(lineMatch[1], 10);
    }

    errors.push({ line, message: `JSON parse error: ${msg}` });
    return {
      valid: false,
      format: 'json',
      size: content.length,
      errors,
    };
  }

  const size = content.length;

  // 2. Validazione schema (se fornito)
  if (schemaContent) {
    let schema: JsonSchema;
    try {
      schema = JSON.parse(schemaContent) as JsonSchema;
    } catch (err) {
      return {
        valid: false,
        format: 'json',
        size,
        errors: [{ line: 1, message: `Schema parse error: ${(err as Error).message}` }],
      };
    }

    const schemaErrors = validateJsonAgainstSchema(parsed, schema, '$', 1);

    if (schemaErrors.length > 0) {
      return {
        valid: false,
        format: 'json',
        size,
        errors: schemaErrors,
      };
    }

    warnings.push('Schema validation passed');
  }

  return {
    valid: true,
    format: 'json',
    size,
    errors: errors.length > 0 ? errors : undefined,
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}

// ────────────────────────────────────────────────────────────
// YAML Validation
// ────────────────────────────────────────────────────────────

function validateYamlContent(content: string): ValidationResult {
  const errors: ValidationError[] = [];

  const size = content.length;

  // Linee vuote / solo commenti = YAML valido ma vuoto
  const nonEmptyLines = content
    .split('\n')
    .filter((l) => l.trim() !== '' && !l.trim().startsWith('#'));

  if (nonEmptyLines.length === 0) {
    return {
      valid: true,
      format: 'yaml',
      size,
      warnings: ['YAML file is empty or contains only comments'],
    };
  }

  // Parsing base
  const result = parseYamlBasic(content);
  errors.push(...result.errors);

  // Verifica consistenza keys duplicate a stesso livello
  const seenKeys = new Map<string, number[]>();
  for (const token of result.tokens) {
    if (token.key) {
      const key = `${token.indent}:${token.key}`;
      if (seenKeys.has(key)) {
        seenKeys.get(key)!.push(token.line);
      } else {
        seenKeys.set(key, [token.line]);
      }
    }
  }

  for (const [key, lines] of seenKeys.entries()) {
    if (lines.length > 1) {
      const keyName = key.split(':')[1];
      errors.push({
        line: lines[1],
        message: `YAML: duplicate key "${keyName}" (also on line ${lines[0]})`,
      });
    }
  }

  // Verifica che i valori scalari siano ben formati
  for (const token of result.tokens) {
    if (token.value !== null) {
      validateYamlScalar(token.value, token.line, errors);
    }
  }

  return {
    valid: errors.length === 0,
    format: 'yaml',
    size,
    errors: errors.length > 0 ? errors : undefined,
  };
}

/**
 * Validazione base per valori scalari YAML.
 * Verifica booleani, null e numeri malformati.
 */
function validateYamlScalar(value: string, line: number, errors: ValidationError[]): void {
  // Verifica booleani misti
  if (/^(true|false|yes|no|on|off)$/i.test(value)) {
    // Valido — YAML li tratta come booleani
    return;
  }

  // Verifica null
  if (/^(null|~)$/i.test(value)) {
    return;
  }

  // Verifica numeri
  const numValue = Number(value);
  if (!isNaN(numValue) && value.trim() !== '') {
    // Sembra un numero — ok se non ci sono problemi di formato
    if (value.includes(',') && value.includes('.')) {
      errors.push({
        line,
        message: `YAML: suspicious numeric value "${value}" mixing comma and dot`,
      });
    }
  }

  // Verifica stringhe multilinea non racchiuse
  if (value.includes('\n') && !value.startsWith('|') && !value.startsWith('>')) {
    errors.push({
      line,
      message: `YAML: multiline string without block indicator (| or >) at line ${line}`,
    });
  }
}

// ────────────────────────────────────────────────────────────
// Tool Registration
// ────────────────────────────────────────────────────────────

export function registerValidateFile(_server: Server, deps: ToolDeps): void {
  toolRegistry.register({
    name: 'fs_validate',
    description:
      'Validate a JSON/YAML file against a schema or built-in rules. ' +
      'For JSON: validates syntax + optional JSON Schema (required fields, types, constraints). ' +
      'For YAML: validates syntax, indentation consistency, duplicate keys. ' +
      'No external libraries required.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path of the file to validate (relative to workspace)',
        },
        schema: {
          type: 'string',
          description: 'Path to JSON schema file (optional, JSON only)',
        },
        format: {
          type: 'string',
          enum: ['json', 'yaml'],
          description: 'Force format detection (optional, auto-detected from extension)',
        },
        agent: {
          type: 'string',
          description: 'Nome dell agente chiamante (opzionale, default: "ianus")',
        },
      },
      required: ['path'],
    },
    handler: async (args) => {
      const filePath = args.path as string | undefined;
      if (!filePath) {
        return { content: [{ type: 'text', text: 'Missing required parameter: "path"' }], isError: true };
      }

      const forceFormat = args.format as string | undefined;
      const schemaPath = args.schema as string | undefined;

      const callerAgent = (args.agent as string) || 'ianus';

      // Permission check (read)
      const permCheck = await deps.permission.checkOperation(
        callerAgent,
        'read',
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
        // Leggi il file
        const safePath = resolveSafePath(filePath, deps.workspaceRoot);
        const content = await readFile(safePath, 'utf-8');

        // Rileva formato
        let format: SupportedFormat;
        try {
          format = detectFormat(filePath, forceFormat);
        } catch (err) {
          return {
            content: [{ type: 'text', text: (err as Error).message }],
            isError: true,
          };
        }

        let result: ValidationResult;

        if (format === 'json') {
          // Leggi schema se fornito
          let schemaContent: string | undefined;
          if (schemaPath) {
            try {
              const schemaSafePath = resolveSafePath(schemaPath, deps.workspaceRoot);
              schemaContent = await readFile(schemaSafePath, 'utf-8');
            } catch (err) {
              return {
                content: [{ type: 'text', text: `Error reading schema file: ${(err as Error).message}` }],
                isError: true,
              };
            }
          }
          result = validateJsonContent(content, filePath, schemaContent);
        } else {
          result = validateYamlContent(content);
        }

        // Log to journal (solo per validazioni)
        await logToJournal(deps.workspaceRoot, {
          agent: 'ianus',
          operation: 'validate',
          path: filePath,
          details: {
            format: result.format,
            valid: result.valid,
            errorCount: result.errors?.length ?? 0,
          },
        });

        serverStats.increment();

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                valid: false,
                format: 'unknown',
                size: 0,
                errors: [{ line: 1, message: (err as Error).message }],
              }),
            },
          ],
          isError: true,
        };
      }
    },
  });
}
