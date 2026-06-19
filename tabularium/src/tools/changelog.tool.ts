/**
 * tools/changelog.tool.ts
 * Tool MCP per la generazione automatica del CHANGELOG.md
 * in formato Keep a Changelog dagli eventi registrati.
 *
 * @module tools/changelog
 */

import type { ToolHandler, ToolResult } from '../types/mcp.js';
import { generateChangelog } from '../core/changelog-generator.js';

// ---------------------------------------------------------------------------
// Tool Handler
// ---------------------------------------------------------------------------

export const changelogToolHandler: ToolHandler = {
  name: 'generate_changelog',
  description:
    'Genera CHANGELOG.md in formato Keep a Changelog dagli eventi registrati ' +
    'nel database Tabularium. Legge eventi (task_completed, file_created, ' +
    'decision_made, ecc.) e li mappa alle sezioni Added, Changed, Fixed, Security. ' +
    'Supporta deduplicazione automatica (stesso tipo + descrizione entro 24h).',
  inputSchema: {
    type: 'object',
    properties: {
      fromDate: {
        type: 'string',
        description:
          'Data inizio ISO o YYYY-MM-DD (default: 30 giorni fa). ' +
          'Esempi: "2026-05-01", "2026-05-01T00:00:00.000Z"',
      },
      toDate: {
        type: 'string',
        description:
          'Data fine ISO o YYYY-MM-DD (default: oggi). ' +
          'Esempi: "2026-05-26", "2026-05-26T23:59:59.000Z"',
      },
      groupByAgent: {
        type: 'boolean',
        description:
          'Raggruppa le entry per agente invece che per sezione ' +
          '(default: false)',
      },
    },
  },

  handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
    try {
      // Leggi parametri
      const fromDate = args.fromDate ? String(args.fromDate) : undefined;
      const toDate = args.toDate ? String(args.toDate) : undefined;
      const groupByAgent = args.groupByAgent === true;

      // Genera changelog
      const result = generateChangelog({
        fromDate,
        toDate,
        groupByAgent,
      });

      // Costruisci risposta
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                data: {
                  markdown: result.markdown,
                  entries_count: result.entries.length,
                  from_date: result.fromDate,
                  to_date: result.toDate,
                  entries: result.entries,
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
                error: `generate_changelog failed: ${error instanceof Error ? error.message : String(error)}`,
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
