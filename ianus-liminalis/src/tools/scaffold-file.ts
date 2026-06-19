/**
 * fs_scaffold — Ianus Liminalis
 *
 * Crea struttura directory + file da template predefiniti con variabili.
 * I template vivono in <workspaceRoot>/.ianus-templates/<templateName>/
 * Supporta placeholder {{VAR_NAME}}, {{name}}, {{PascalName}}, {{CamelName}}.
 */

import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { readdir, stat, readFile, mkdir, writeFile } from 'node:fs/promises';
import { join, relative, extname, dirname, basename } from 'node:path';
import { resolveSafePath } from '../core/path-utils.js';
import { logToJournal } from '../core/journal-logger.js';
import { stats as serverStats } from '../core/stats.js';
import { toolRegistry } from './registry.js';
import type { ToolDeps } from './types.js';

const TEMPLATES_DIR = '.ianus-templates';

/**
 * Converte una stringa in PascalCase.
 * Esempio: "my-module" → "MyModule", "hello_world" → "HelloWorld"
 */
function toPascalCase(str: string): string {
  return str
    .replace(/[^a-zA-Z0-9]+(.)/g, (_, chr) => chr.toUpperCase())
    .replace(/^(.)/, (chr) => chr.toUpperCase());
}

/**
 * Converte una stringa in camelCase.
 * Esempio: "my-module" → "myModule", "HelloWorld" → "helloWorld"
 */
function toCamelCase(str: string): string {
  const pascal = toPascalCase(str);
  return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}

/**
 * Sostituisce tutti i placeholder {{...}} nel contenuto con i valori forniti.
 * Placeholder built-in: {{name}}, {{PascalName}}, {{CamelName}}
 * Placeholder custom: da vars parameter
 */
function replacePlaceholders(
  content: string,
  name: string,
  vars?: Record<string, string>,
): string {
  const pascalName = toPascalCase(name);
  const camelName = toCamelCase(name);

  let result = content;
  // Sostituisci {{name}} con il valore name
  result = result.replace(/\{\{name\}\}/g, name);
  // Sostituisci {{PascalName}}
  result = result.replace(/\{\{PascalName\}\}/g, pascalName);
  // Sostituisci {{CamelName}}
  result = result.replace(/\{\{CamelName\}\}/g, camelName);
  // Sostituisci eventuali variabili custom
  if (vars) {
    for (const [key, value] of Object.entries(vars)) {
      result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
    }
  }
  return result;
}

/**
 * Sostituisce i placeholder anche nel nome del file.
 * Esempio: "{{name}}.controller.ts" con name="user" → "user.controller.ts"
 */
function replaceFileName(fileName: string, name: string, vars?: Record<string, string>): string {
  return replacePlaceholders(fileName, name, vars);
}

interface TemplateFile {
  relativePath: string;
  content: string;
}

/**
 * Legge ricorsivamente la directory del template e restituisce tutti i file
 * con il loro path relativo e contenuto.
 */
async function readTemplateDir(
  templatePath: string,
  basePath: string,
): Promise<TemplateFile[]> {
  const entries: TemplateFile[] = [];
  const dirEnts = await readdir(templatePath, { withFileTypes: true });

  for (const entry of dirEnts) {
    const fullPath = join(templatePath, entry.name);
    const relPath = join(relative(basePath, templatePath), entry.name);

    if (entry.isDirectory()) {
      const subEntries = await readTemplateDir(fullPath, basePath);
      entries.push(...subEntries);
    } else if (entry.isFile()) {
      const content = await readFile(fullPath, 'utf-8');
      entries.push({ relativePath: relPath, content });
    }
  }

  return entries;
}

export function registerScaffoldFile(_server: Server, deps: ToolDeps): void {
  toolRegistry.register({
    name: 'fs_scaffold',
    description:
      'Create directory structure + files from predefined templates with variable substitution. ' +
      'Templates live in <workspace>/.ianus-templates/<templateName>/. ' +
      'Supports {{name}}, {{PascalName}}, {{CamelName}} and custom {{VAR}} placeholders.',
    annotations: { destructiveHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        template: {
          type: 'string',
          description: 'Name of the template directory under .ianus-templates/ (required)',
        },
        name: {
          type: 'string',
          description: 'Name of the project/module (required)',
        },
        output: {
          type: 'string',
          description: 'Destination path (relative to workspace)',
        },
        vars: {
          type: 'object',
          additionalProperties: { type: 'string' },
          description: 'Additional variables for {{PLACEHOLDER}} substitution',
        },
        agent: {
          type: 'string',
          description: 'Nome dell agente chiamante (opzionale, default: "ianus")',
        },
      },
      required: ['template', 'name', 'output'],
    },
    handler: async (args) => {
      const templateName = args.template as string | undefined;
      if (!templateName) {
        return { content: [{ type: 'text', text: 'Missing required parameter: "template"' }], isError: true };
      }

      const name = args.name as string | undefined;
      if (!name) {
        return { content: [{ type: 'text', text: 'Missing required parameter: "name"' }], isError: true };
      }

      const outputPath = args.output as string | undefined;
      if (!outputPath) {
        return { content: [{ type: 'text', text: 'Missing required parameter: "output"' }], isError: true };
      }

      const vars = args.vars as Record<string, string> | undefined;

      const callerAgent = (args.agent as string) || 'ianus';

      // Permission check sull'output
      const permCheck = await deps.permission.checkOperation(
        callerAgent,
        'write',
        outputPath,
        deps.workspaceRoot,
      );
      if (!permCheck.allowed) {
        return {
          content: [{ type: 'text', text: `Permission denied: ${permCheck.reason}` }],
          isError: true,
        };
      }

      try {
        // Verifica che la directory .ianus-templates esista
        const templatesRoot = join(deps.workspaceRoot, TEMPLATES_DIR);
        let templatesRootExists = false;
        try {
          const tStat = await stat(templatesRoot);
          templatesRootExists = tStat.isDirectory();
        } catch {
          // Non esiste
        }

        if (!templatesRootExists) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  error: 'Templates directory not found',
                  message: `No templates directory found at .ianus-templates/. Create it with template subdirectories.`,
                  templatesRoot,
                  availableTemplates: [],
                }),
              },
            ],
            isError: true,
          };
        }

        // Verifica che il template specificato esista
        const templateDir = join(templatesRoot, templateName);
        let templateExists = false;
        try {
          const tmplStat = await stat(templateDir);
          templateExists = tmplStat.isDirectory();
        } catch {
          // Non esiste
        }

        if (!templateExists) {
          // Elenca i template disponibili
          let availableTemplates: string[] = [];
          try {
            const entries = await readdir(templatesRoot, { withFileTypes: true });
            availableTemplates = entries
              .filter((e) => e.isDirectory())
              .map((e) => e.name)
              .sort();
          } catch {
            // Fallback
          }

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  error: 'Template not found',
                  message: `Template "${templateName}" not found in .ianus-templates/`,
                  availableTemplates,
                }),
              },
            ],
            isError: true,
          };
        }

        // Leggi ricorsivamente i file del template
        const templateFiles = await readTemplateDir(templateDir, templateDir);

        if (templateFiles.length === 0) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  error: 'Empty template',
                  message: `Template "${templateName}" contains no files.`,
                }),
              },
            ],
            isError: true,
          };
        }

        // Risolvi il path di output
        const safeOutputPath = resolveSafePath(outputPath, deps.workspaceRoot);

        // Crea i file con sostituzione placeholder
        const createdFiles: string[] = [];
        for (const tmplFile of templateFiles) {
          // Sostituisci placeholder nel path relativo (nomi di file e directory)
          const segments = tmplFile.relativePath.split(/[/\\]/);
          const resolvedSegments = segments.map((seg) => replaceFileName(seg, name, vars));
          const outputRelPath = resolvedSegments.join('/');
          const outputFilePath = join(safeOutputPath, outputRelPath);
          const outputDir = dirname(outputFilePath);

          // Crea directory di destinazione
          await mkdir(outputDir, { recursive: true });

          // Sostituisci placeholder nel contenuto
          const fileContent = replacePlaceholders(tmplFile.content, name, vars);

          // Scrivi il file
          await writeFile(outputFilePath, fileContent, 'utf-8');

          // Salva path relativo per l'output
          const relPath = join(outputPath, outputRelPath);
          createdFiles.push(relPath.replace(/\\/g, '/'));
        }

        // Log to journal
        await logToJournal(deps.workspaceRoot, {
          agent: 'ianus',
          operation: 'scaffold',
          path: outputPath,
          details: {
            template: templateName,
            name,
            filesCreated: createdFiles.length,
          },
        });

        serverStats.increment();

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                created: createdFiles,
                template: templateName,
                name,
              }),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: 'text',
              text: `Error running scaffold template "${templateName}": ${(err as Error).message}`,
            },
          ],
          isError: true,
        };
      }
    },
  });
}
