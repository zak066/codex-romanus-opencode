/**
 * tools/seo.tool.ts
 * Tool MCP per SEO: generazione sitemap e validazione structured data JSON-LD.
 * Come la Naturalis Historia ordinava il sapere in volumi, questi strumenti
 * ordinano i metadati SEO per i motori di ricerca.
 *
 * @module tools/seo
 */

import type { ToolHandler, ToolResult } from '../types/mcp.js';
import {
  generateSitemap,
  validateStructuredData,
} from '../core/seo-builder.js';

// ---------------------------------------------------------------------------
// generate_sitemap
// ---------------------------------------------------------------------------

/**
 * Tool: generate_sitemap
 * Genera una sitemap.xml completa a partire da un URL base e un elenco di path.
 * Restituisce l'XML pronto per essere servito ai crawler.
 */
export const generateSitemapToolHandler: ToolHandler = {
  name: 'generate_sitemap',
  description:
    'Genera sitemap.xml da un elenco di path. Restituisce XML valido con metadati (lastmod, changefreq, priority) per ogni URL.',
  inputSchema: {
    type: 'object',
    properties: {
      baseUrl: {
        type: 'string',
        description: 'URL base del sito (es. https://example.com)',
      },
      paths: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Path da includere nella sitemap (es. ["/", "/about", "/contact"]). Il path root "/" riceve priority=1.0, gli altri 0.8.',
      },
    },
    required: ['baseUrl', 'paths'],
  },

  handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
    const baseUrl = args.baseUrl as string | undefined;
    const paths = args.paths as string[] | undefined;

    // Validazione input
    const inputErrors: string[] = [];
    if (!baseUrl || typeof baseUrl !== 'string') {
      inputErrors.push('baseUrl is required and must be a string');
    }
    if (!paths || !Array.isArray(paths) || paths.length === 0) {
      inputErrors.push('paths is required and must be a non-empty array of strings');
    }

    if (inputErrors.length > 0) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              { valid: false, errors: inputErrors },
              null,
              2
            ),
          },
        ],
        isError: true,
      };
    }

    try {
      const result = generateSitemap(baseUrl!, paths!);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                count: result.count,
                generatedAt: result.generatedAt,
                entries: result.entries.map((e) => ({
                  loc: e.loc,
                  lastmod: e.lastmod,
                  changefreq: e.changefreq,
                  priority: e.priority,
                })),
                xml: result.xml,
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
            text: JSON.stringify({
              valid: false,
              error: `Failed to generate sitemap: ${
                error instanceof Error ? error.message : String(error)
              }`,
            }),
          },
        ],
        isError: true,
      };
    }
  },
};

// ---------------------------------------------------------------------------
// validate_structured_data
// ---------------------------------------------------------------------------

/**
 * Tool: validate_structured_data
 * Valida un JSON-LD strutturato controllando la presenza e correttezza
 * dei campi obbligatori (@context, @type) secondo le specifiche Schema.org.
 */
export const validateStructuredDataToolHandler: ToolHandler = {
  name: 'validate_structured_data',
  description:
    'Valida un JSON-LD strutturato. Verifica parsing JSON, presenza di @context e @type, e che @context sia "https://schema.org".',
  inputSchema: {
    type: 'object',
    properties: {
      jsonLd: {
        type: 'string',
        description: 'JSON-LD da validare (stringa JSON)',
      },
    },
    required: ['jsonLd'],
  },

  handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
    const jsonLd = args.jsonLd as string | undefined;

    if (!jsonLd || typeof jsonLd !== 'string') {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              valid: false,
              errors: ['jsonLd is required and must be a string'],
            }),
          },
        ],
        isError: true,
      };
    }

    try {
      const result = validateStructuredData(jsonLd);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              valid: false,
              errors: [
                `Validation failed: ${
                  error instanceof Error ? error.message : String(error)
                }`,
              ],
            }),
          },
        ],
        isError: true,
      };
    }
  },
};
