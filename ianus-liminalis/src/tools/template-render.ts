/**
 * fs_template_render — Ianus Liminalis
 *
 * Rende template file sostituendo placeholder {{VAR}} con valori da
 * variables d'ambiente, file JSON, o oggetto diretto.
 * Fondamentale per configurazioni DevOps customizzate per ambiente.
 *
 * Priorità variabili (alta → bassa):
 *   1. vars diretto (massima priorità)
 *   2. Variabili da file .env (se specificato)
 *   3. process.env (ambiente di sistema)
 *
 * Supporta:
 *   - Default value: {{VAR_NAME:default}}
 *   - Pipe uppercase: {{VAR_NAME|upper}}
 *   - Pipe lowercase: {{VAR_NAME|lower}}
 */

import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { readFile, stat, writeFile, mkdir } from 'node:fs/promises';
import { dirname, extname, basename } from 'node:path';
import { existsSync } from 'node:fs';
import { resolveSafePath } from '../core/path-utils.js';
import { logToJournal } from '../core/journal-logger.js';
import { stats as serverStats } from '../core/stats.js';
import { toolRegistry } from './registry.js';
import type { ToolDeps } from './types.js';

/**
 * Parses a .env file content into key-value pairs.
 * Lines matching the pattern KEY=VALUE
 */
function parseEnvFile(content: string): Record<string, string> {
  const vars: Record<string, string> = {};
  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (match) {
      let value = match[2];
      // Strip surrounding quotes if present
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      vars[match[1]] = value;
    }
  }
  return vars;
}

/**
 * Regex per matchare placeholder {{...}}
 * Cattura: nome variabile, pipe (|upper/|lower), default value (:default)
 * Supporta: {{ VAR }}, {{VAR|upper}}, {{VAR:default}}, {{VAR|lower:default}}
 */
const PLACEHOLDER_REGEX = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)(\|(upper|lower))?(?:\s*:\s*([^}]+?))?\s*\}\}/g;

interface ParsedPlaceholder {
  full: string;        // Full match including {{ and }}
  name: string;        // Variable name
  pipe?: 'upper' | 'lower';
  defaultValue?: string;
}

/**
 * Parses a single placeholder match into its components.
 */
function parsePlaceholder(full: string, name: string, _pipeMarker: string | undefined, pipeType: string | undefined, defaultVal: string | undefined): ParsedPlaceholder {
  return {
    full,
    name,
    pipe: (pipeType as 'upper' | 'lower') || undefined,
    defaultValue: defaultVal?.trim() || undefined,
  };
}

/**
 * Resolve the output path from template path.
 * If output is explicitly provided, use it.
 * Otherwise, strip .template extension or keep same path with original ext.
 *
 * Examples:
 *   "config.yaml.template"  → "config.yaml"
 *   "greeting.template"     → "greeting"
 *   "sub/dir/app.template"  → "sub/dir/app"
 */
function resolveOutputPath(templatePath: string, output?: string): string {
  if (output) return output;

  const ext = extname(templatePath);

  // If file is like "config.yaml.template" → strip .template
  if (ext === '.template') {
    const base = basename(templatePath, '.template');
    const dir = dirname(templatePath);
    const dirPrefix = dir === '.' ? '' : dir + '/';
    return `${dirPrefix}${base}`;
  }

  // Default: same path — let caller decide
  return templatePath;
}

/**
 * Resolve a variable value from the variable sources in priority order.
 */
function resolveVar(
  name: string,
  vars?: Record<string, string>,
  envVars?: Record<string, string>,
): string | undefined {
  // 1. vars diretto (massima priorità)
  if (vars && name in vars) return vars[name];
  // 2. Variabili da file .env
  if (envVars && name in envVars) return envVars[name];
  // 3. process.env (ambiente di sistema)
  if (name in process.env) return process.env[name];
  return undefined;
}

/**
 * Apply pipe transformation to a value.
 */
function applyPipe(value: string, pipe?: 'upper' | 'lower'): string {
  if (pipe === 'upper') return value.toUpperCase();
  if (pipe === 'lower') return value.toLowerCase();
  return value;
}

interface RenderResult {
  content: string;
  resolved: number;
  unresolved: number;
  missing: string[];
}

/**
 * Renders a template string by replacing all placeholders with resolved values.
 */
function renderTemplate(
  templateContent: string,
  vars?: Record<string, string>,
  envVars?: Record<string, string>,
  missingMode: 'fail' | 'warn' | 'skip' = 'fail',
): RenderResult {
  let resolved = 0;
  const missing: string[] = [];

  const result = templateContent.replace(PLACEHOLDER_REGEX, (_full, name: string, _pm: string | undefined, pipeType: string | undefined, defaultVal: string | undefined) => {
    const pipe = pipeType as 'upper' | 'lower' | undefined;

    // Try to resolve the variable
    let value = resolveVar(name, vars, envVars);

    // If not resolved, try default value
    if (value === undefined && defaultVal !== undefined) {
      value = defaultVal.trim();
    }

    // If still not resolved
    if (value === undefined) {
      if (missingMode === 'fail') {
        throw new Error(`Unresolved placeholder: ${_full}`);
      }
      missing.push(_full);
      if (missingMode === 'warn') {
        // Leave the placeholder intact, will report in output
        return _full;
      }
      // skip: leave intact, no warning
      return _full;
    }

    resolved++;
    return applyPipe(value, pipe);
  });

  return {
    content: result,
    resolved,
    unresolved: missingMode === 'skip' ? 0 : missing.length,
    missing: missingMode !== 'skip' ? missing : [],
  };
}

export function registerTemplateRender(_server: Server, deps: ToolDeps): void {
  toolRegistry.register({
    name: 'fs_template_render',
    description:
      'Render a template file by replacing {{VAR}} placeholders with values from environment variables, .env files, or a direct vars object. ' +
      'Supports default values ({{VAR:default}}), uppercase pipe ({{VAR|upper}}), and lowercase pipe ({{VAR|lower}}). ' +
      'Essential for DevOps environment-specific configuration templating.',
    annotations: { destructiveHint: true, idempotentHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path of the template file (relative to workspace, required)',
        },
        output: {
          type: 'string',
          description: 'Output file path (default: strips .template extension or keeps original path)',
        },
        vars: {
          type: 'object',
          additionalProperties: { type: 'string' },
          description: 'Direct key-value pairs for placeholder substitution (highest priority)',
        },
        env: {
          type: 'string',
          description: 'Path to .env file to load variables from (e.g., ".env", ".env.local", ".env.production")',
        },
        overwrite: {
          type: 'boolean',
          default: false,
          description: 'Overwrite output file if it already exists (default: false)',
        },
        missingMode: {
          type: 'string',
          enum: ['fail', 'warn', 'skip'],
          default: 'fail',
          description: 'What to do with unresolved placeholders: "fail" (throw error), "warn" (log + keep intact), "skip" (keep intact silently)',
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

      const outputPathArg = args.output as string | undefined;
      const vars = args.vars as Record<string, string> | undefined;
      const envPath = args.env as string | undefined;
      const overwrite = (args.overwrite as boolean) ?? false;
      const missingMode = (args.missingMode as 'fail' | 'warn' | 'skip') ?? 'fail';
      const callerAgent = (args.agent as string) || 'ianus';

      // Permission check on source template
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
        // 1. Read template file
        const safeTemplatePath = resolveSafePath(filePath, deps.workspaceRoot);
        const templateContent = await readFile(safeTemplatePath, 'utf-8');

        // 2. Resolve output path
        const resolvedOutput = resolveOutputPath(filePath, outputPathArg);
        const safeOutputPath = resolveSafePath(resolvedOutput, deps.workspaceRoot);

        // 3. Check if output exists
        let outputExists = false;
        try {
          await stat(safeOutputPath);
          outputExists = true;
        } catch {
          // File doesn't exist
        }

        if (outputExists && !overwrite) {
          return {
            content: [
              {
                type: 'text',
                text: `Output file already exists: "${resolvedOutput}". Set overwrite=true to overwrite.`,
              },
            ],
            isError: true,
          };
        }

        // 4. Load .env file if specified
        let envVars: Record<string, string> | undefined;
        if (envPath) {
          const safeEnvPath = resolveSafePath(envPath, deps.workspaceRoot);
          try {
            const envContent = await readFile(safeEnvPath, 'utf-8');
            envVars = parseEnvFile(envContent);
          } catch (err) {
            return {
              content: [
                {
                  type: 'text',
                  text: `Error reading .env file "${envPath}": ${(err as Error).message}`,
                },
              ],
              isError: true,
            };
          }
        }

        // 5. Render the template
        const renderResult = renderTemplate(templateContent, vars, envVars, missingMode);

        // 6. Write output file
        await mkdir(dirname(safeOutputPath), { recursive: true });
        const buffer = Buffer.from(renderResult.content, 'utf-8');
        await writeFile(safeOutputPath, buffer, 'utf-8');

        // 7. Log to journal
        await logToJournal(deps.workspaceRoot, {
          agent: 'ianus',
          operation: 'template_render',
          path: resolvedOutput,
          details: {
            template: filePath,
            resolved: renderResult.resolved,
            unresolved: renderResult.unresolved,
            size: buffer.length,
          },
        });

        serverStats.increment();

        // 8. Return result
        const result: Record<string, unknown> = {
          path: resolvedOutput,
          size: buffer.length,
          resolved: renderResult.resolved,
          unresolved: renderResult.unresolved,
        };
        if (renderResult.missing.length > 0) {
          result.missing = renderResult.missing;
        }

        return {
          content: [{ type: 'text', text: JSON.stringify(result) }],
        };
      } catch (err) {
        return {
          content: [
            {
              type: 'text',
              text: `Error rendering template "${filePath}": ${(err as Error).message}`,
            },
          ],
          isError: true,
        };
      }
    },
  });
}
