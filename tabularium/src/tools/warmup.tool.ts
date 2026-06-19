/**
 * tools/warmup.tool.ts
 * Tool MCP per il Session Warm-up Engine (FABRICA — Fase 7.5).
 *
 * Espone il tool:
 * - warmup_context: genera contesto pre-riscaldato per la sessione corrente
 *
 * Stesso pattern di journal.tool.ts e bug.tool.ts:
 *   - Validazione input
 *   - Try/catch con messaggi di errore strutturati
 *   - Risultati in JSON formattato
 *
 * @module tools/warmup
 */

import type { ToolHandler, ToolResult } from '../types/mcp.js';
import { generateWarmupContext } from '../core/warmup-engine.js';

// ---------------------------------------------------------------------------
// Tool: warmup_context
// ---------------------------------------------------------------------------

export const warmupContextToolHandler: ToolHandler = {
  name: 'warmup_context',
  description: 'Genera contesto pre-riscaldato per la sessione corrente',
  inputSchema: {
    type: 'object',
    properties: {},
    required: [],
  },

  handler: async (_args: Record<string, unknown>): Promise<ToolResult> => {
    try {
      const context = await generateWarmupContext();

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                data: context,
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
                error: 'WARMUP_ERROR',
                message: `Failed to generate warmup context: ${error instanceof Error ? error.message : String(error)}`,
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
