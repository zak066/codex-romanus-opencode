/**
 * tools/tool-analytics.tool.ts
 * Tool MCP per statistiche uso tool MCP.
 *
 * Query event_log per uso tool, raggruppa per tool/giorno
 * e restituisce frequenza, trend e metriche aggregate.
 *
 * @module tools/tool-analytics
 */

import type { ToolHandler, ToolResult } from '../types/mcp.js';
import { getDatabase } from '../core/database.js';

// ---------------------------------------------------------------------------
// Tool: tool_analytics
// ---------------------------------------------------------------------------

export const toolAnalyticsToolHandler: ToolHandler = {
  name: 'tool_analytics',
  description:
    'Statistiche uso tool MCP. ' +
    "Analizza event_log per frequenza d'uso dei tool, " +
    'raggruppa per tool/giorno e calcola trend temporale.',
  inputSchema: {
    type: 'object',
    properties: {
      tool_name: {
        type: 'string',
        description: 'Filtra per nome specifico del tool (opzionale, default: tutti)',
      },
      days: {
        type: 'number',
        description: "Finestra temporale in giorni per l'analisi (default: 30, max: 365)",
      },
    },
  },

  handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
    // Validazione days
    let days = 30;
    if (args.days !== undefined && args.days !== null) {
      if (typeof args.days !== 'number' || !Number.isInteger(args.days) || args.days < 1 || args.days > 365) {
        return errorResult('days must be an integer between 1 and 365');
      }
      days = args.days;
    }

    try {
      const db = getDatabase();

      // Tool name filter
      const toolName = args.tool_name ? String(args.tool_name) : null;

      // Calcola data inizio
      const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

      let rows: Array<Record<string, unknown>>;

      if (toolName) {
        // Query per tool specifico
        rows = db.prepare(`
          SELECT
            DATE(timestamp) as day,
            COUNT(*) as call_count
          FROM events
          WHERE event_type = 'query_executed'
            AND summary LIKE ?
            AND timestamp >= ?
          GROUP BY DATE(timestamp)
          ORDER BY day ASC
        `).all(`%${toolName}%`, startDate) as Array<Record<string, unknown>>;
      } else {
        // Query per tutti i tool — raggruppa per tool e giorno
        rows = db.prepare(`
          SELECT
            COALESCE(
              CASE
                WHEN summary LIKE 'tool:%' THEN SUBSTR(summary, 6)
                ELSE summary
              END,
              'unknown'
            ) as tool_name,
            DATE(timestamp) as day,
            COUNT(*) as call_count
          FROM events
          WHERE event_type IN ('query_executed', 'tool_called')
            AND timestamp >= ?
          GROUP BY tool_name, DATE(timestamp)
          ORDER BY call_count DESC, day ASC
        `).all(startDate) as Array<Record<string, unknown>>;
      }

      // Rielabora risultati
      const toolMap = new Map<string, { totalCalls: number; days: Array<{ date: string; count: number }> }>();

      if (toolName) {
        // Tool specifico — raggruppa per giorno
        const entry = toolMap.get(toolName) ?? { totalCalls: 0, days: [] };
        for (const row of rows) {
          const count = Number(row.call_count ?? 0);
          entry.totalCalls += count;
          entry.days.push({ date: String(row.day ?? ''), count });
        }
        toolMap.set(toolName, entry);
      } else {
        // Tutti i tool
        for (const row of rows) {
          const name = String(row.tool_name ?? 'unknown');
          const day = String(row.day ?? '');
          const count = Number(row.call_count ?? 0);

          if (!toolMap.has(name)) {
            toolMap.set(name, { totalCalls: 0, days: [] });
          }
          const entry = toolMap.get(name)!;
          entry.totalCalls += count;
          entry.days.push({ date: day, count });
        }
      }

      // Converti in array ordinato
      const tools = Array.from(toolMap.entries())
        .map(([name, data]) => ({
          tool_name: name,
          totalCalls: data.totalCalls,
          dailyBreakdown: data.days,
          avgCallsPerDay: days > 0
            ? Number((data.totalCalls / days).toFixed(2))
            : data.totalCalls,
        }))
        .sort((a, b) => b.totalCalls - a.totalCalls);

      // Statistiche aggregate
      const totalCalls = tools.reduce((s, t) => s + t.totalCalls, 0);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                data: {
                  periodDays: days,
                  totalCalls,
                  uniqueTools: tools.length,
                  tools,
                  generatedAt: new Date().toISOString(),
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
                error: 'TOOL_ANALYTICS_ERROR',
                message: `tool_analytics failed: ${error instanceof Error ? error.message : String(error)}`,
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

/**
 * Crea un ToolResult di errore.
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
