/**
 * tools/quality-gate-stream.tool.ts
 * Tool MCP per quality gate con streaming step-by-step (report progressivo).
 *
 * Esegue il quality gate completo e restituisce i risultati progressivi
 * step-by-step (lint → TSC → test → coverage → audit) con durata per step.
 *
 * @module tools/quality-gate-stream
 */

import type { ToolHandler, ToolResult } from '../types/mcp.js';
import { runQualityGate, type GateStep, type GateThreshold } from '../core/quality-gate.js';

// ---------------------------------------------------------------------------
// Tool: quality_gate_stream
// ---------------------------------------------------------------------------

export const qualityGateStreamToolHandler: ToolHandler = {
  name: 'quality_gate_stream',
  description:
    'Quality gate con streaming step-by-step (report progressivo). ' +
    'Esegue la pipeline lint → TSC → test → coverage → audit e restituisce ' +
    'risultati progressivi con dettaglio per ogni step.',
  inputSchema: {
    type: 'object',
    properties: {
      projectPath: {
        type: 'string',
        description: 'Percorso del progetto da analizzare',
      },
      thresholds: {
        type: 'object',
        properties: {
          maxLintErrors: {
            type: 'number',
            description: 'Max errori lint consentiti (default: 0)',
          },
          maxLintWarnings: {
            type: 'number',
            description: 'Max warning lint consentiti (default: 10)',
          },
          maxTsErrors: {
            type: 'number',
            description: 'Max errori TypeScript consentiti (default: 0)',
          },
          minCoverage: {
            type: 'number',
            description: 'Copertura minima percentuale (default: 80)',
          },
          maxTestFails: {
            type: 'number',
            description: 'Max test falliti consentiti (default: 0)',
          },
          maxVulnerabilities: {
            type: 'number',
            description: 'Max vulnerabilità consentite (default: 0)',
          },
        },
      },
    },
    required: ['projectPath'],
  },

  handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
    // Validazione
    if (!args.projectPath || typeof args.projectPath !== 'string') {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: false,
                error: 'VALIDATION_ERROR',
                message: 'projectPath is required and must be a string',
              },
              null,
              2
            ),
          },
        ],
        isError: true,
      };
    }

    try {
      const projectPath = args.projectPath as string;
      const thresholds = args.thresholds
        ? (args.thresholds as GateThreshold)
        : undefined;

      // Esegui quality gate
      const result = runQualityGate(projectPath, thresholds);

      // Costruisci risposta con step progressivi
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                data: {
                  status: result.status,
                  projectPath: result.projectPath,
                  startedAt: result.startedAt,
                  completedAt: result.completedAt,
                  totalDurationMs: result.totalDurationMs,
                  steps: result.steps.map((step: GateStep) => ({
                    name: step.name,
                    status: step.status,
                    durationMs: step.durationMs,
                    output: step.output,
                    value: step.value,
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
                error: 'QUALITY_GATE_STREAM_ERROR',
                message: `quality_gate_stream failed: ${error instanceof Error ? error.message : String(error)}`,
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
