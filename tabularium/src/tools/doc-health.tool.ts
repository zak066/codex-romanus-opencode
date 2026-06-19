/**
 * tools/doc-health.tool.ts
 * Tool MCP per health check della documentazione (score freschezza).
 *
 * Scansiona i file .md nella directory docs/ e calcola un punteggio
 * di freschezza (0-100) basato sulla data dell'ultima modifica
 * rispetto ai file sorgente .ts in src/.
 *
 * @module tools/doc-health
 */

import type { ToolHandler, ToolResult } from '../types/mcp.js';
import { analyzeDocFreshness } from '../core/doc-freshness.js';

// ---------------------------------------------------------------------------
// Tool: doc_health
// ---------------------------------------------------------------------------

export const docHealthToolHandler: ToolHandler = {
  name: 'doc_health',
  description:
    'Health check documentazione (score freschezza). ' +
    'Scansiona file .md, calcola freshness score (0-100) confrontando ' +
    'le date di modifica con i file sorgente .ts. ' +
    'Identifica documenti stale (7-30gg) e missing (>30gg o nessun .md).',
  inputSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: "Percorso base del progetto per cercare docs/ e src/ (default: '.' — directory corrente)",
      },
      minScore: {
        type: 'number',
        description: 'Punteggio minimo per considerare la documentazione healthy (default: 70)',
      },
    },
  },

  handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
    try {
      const basePath = args.path ? String(args.path) : '.';
      const minScore = args.minScore != null ? Number(args.minScore) : 70;

      // Esegui analisi freschezza
      const report = analyzeDocFreshness(
        basePath + '/docs',
        basePath + '/src'
      );

      // Overall health status
      const isHealthy = report.overallScore >= minScore;

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                data: {
                  healthy: isHealthy,
                  minScore,
                  overallScore: report.overallScore,
                  totalDocs: report.totalDocs,
                  freshCount: report.freshCount,
                  staleCount: report.staleCount,
                  missingCount: report.missingCount,
                  generatedAt: report.generatedAt,
                  entries: report.entries.map((e) => ({
                    filePath: e.filePath,
                    status: e.status,
                    daysSinceUpdate: e.daysSinceUpdate === Infinity ? null : e.daysSinceUpdate,
                    score: e.score,
                    sourceFiles: e.sourceFiles.map((s) => s.path),
                  })),
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
                error: 'DOC_HEALTH_ERROR',
                message: `doc_health failed: ${error instanceof Error ? error.message : String(error)}`,
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
