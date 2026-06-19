/**
 * tools/template.tool.ts
 * Tool MCP per scaffolding da template di task (FABRICA — Fase 7.3).
 *
 * Espone:
 * - task_scaffold: generate scaffolding from a task template
 *
 * @module tools/template
 */

import type { ToolHandler, ToolResult } from '../types/mcp.js';
import {
  listTemplates,
  getTemplate,
  scaffoldFromTemplate,
} from '../core/task-templates.js';

// ---------------------------------------------------------------------------
// Nomi template validi (per validazione rapida)
// ---------------------------------------------------------------------------

const VALID_TEMPLATES = [
  'new-core-module',
  'new-migration',
  'fix-typescript-error',
  'refactor-extract',
];

// ---------------------------------------------------------------------------
// Tool: task_scaffold
// ---------------------------------------------------------------------------

/**
 * Tool MCP per generare scaffolding da un template di task.
 *
 * Accetta:
 * - template (obbligatorio): nome del template
 * - params (opzionale): parametri per sostituzione {{param}} nei path
 *
 * Se viene passato solo 'template' senza 'params', restituisce i metadati
 * del template richiesto. Se nessun argomento, restituisce l'elenco completo.
 */
export const taskScaffoldToolHandler: ToolHandler = {
  name: 'task_scaffold',
  description: 'Generate scaffolding from a task template (new-core-module, new-migration, fix-typescript-error, refactor-extract)',
  inputSchema: {
    type: 'object',
    properties: {
      template: {
        type: 'string',
        description: 'Template name: new-core-module, new-migration, fix-typescript-error, refactor-extract',
      },
      params: {
        type: 'object',
        description: 'Parameters for {{param}} substitution in paths',
        additionalProperties: { type: 'string' },
      },
    },
    required: ['template'],
  },

  handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
    // Validazione: template è obbligatorio
    if (!args.template || typeof args.template !== 'string') {
      return errorResult('template is required and must be a string');
    }

    const templateName = args.template as string;

    // Se non ci sono params, restituisci informazioni sul template
    if (args.params === undefined) {
      try {
        // Lista tutti i template se richiesto
        if (templateName === '__list__') {
          const templates = listTemplates();
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    success: true,
                    data: {
                      count: templates.length,
                      templates: templates.map((t) => ({
                        name: t.name,
                        description: t.description,
                        files: t.files.map((f) => f.path),
                        steps: t.steps,
                      })),
                    },
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        // Cerca il template specifico
        const template = getTemplate(templateName);
        if (!template) {
          return errorResult(
            `Template not found: '${templateName}'. Available templates: ${listTemplates().map((t) => t.name).join(', ') || '(none)'}`
          );
        }

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  success: true,
                  data: {
                    name: template.name,
                    description: template.description,
                    files: template.files.map((f) => f.path),
                    steps: template.steps,
                  },
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  success: false,
                  error: 'TEMPLATE_INFO_ERROR',
                  message: `Failed to get template info: ${error instanceof Error ? error.message : String(error)}`,
                },
                null,
                2
              ),
            },
          ],
          isError: true,
        };
      }
    }

    // Validazione params
    if (typeof args.params !== 'object' || args.params === null) {
      return errorResult('params must be an object with string key-value pairs');
    }

    // Valida che tutti i valori params siano stringhe
    const params = args.params as Record<string, unknown>;
    for (const [key, value] of Object.entries(params)) {
      if (typeof value !== 'string') {
        return errorResult(`params.${key} must be a string`);
      }
    }

    try {
      const result = scaffoldFromTemplate(
        templateName,
        params as Record<string, string>
      );

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                data: {
                  template: result.template.name,
                  files: result.files,
                  steps: result.steps,
                  instructions: result.instructions,
                },
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: false,
                error: 'SCAFFOLD_ERROR',
                message: `Failed to scaffold from template '${templateName}': ${error instanceof Error ? error.message : String(error)}`,
              },
              null,
              2
            ),
          },
        ],
        isError: true,
      };
    }
  },
};

// ---------------------------------------------------------------------------
// Helper: errore
// ---------------------------------------------------------------------------

/**
 * Crea un ToolResult di errore per validazione fallita.
 */
function errorResult(message: string): ToolResult {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          {
            success: false,
            error: 'VALIDATION_ERROR',
            message,
          },
          null,
          2
        ),
      },
    ],
    isError: true,
  };
}
