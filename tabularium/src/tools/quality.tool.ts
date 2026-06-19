/**
 * tools/quality.tool.ts
 * Tool MCP per il quality monitoring (AUTOMATA — Fase 6).
 *
 * Espone:
 * - regression_detect: analizza metriche recenti e rileva regressioni
 *
 * @module tools/quality
 */

import type { ToolHandler, ToolResult } from '../types/mcp.js';
import { detectRegressions } from '../core/regression-detector.js';
import { runQualityGate } from '../core/quality-gate.js';

// ---------------------------------------------------------------------------
// Domini validi
// ---------------------------------------------------------------------------

const VALID_DOMAINS = ['quality', 'perf', 'test', 'security', 'seo'];

// ---------------------------------------------------------------------------
// Tool: regression_detect
// ---------------------------------------------------------------------------

export const regressionDetectToolHandler: ToolHandler = {
  name: 'regression_detect',
  description: 'Analyze recent metrics and detect regressions against historical baseline',
  inputSchema: {
    type: 'object',
    properties: {
      baselineWindow: {
        type: 'number',
        description: 'Number of historical runs for baseline average (default: 10, range: 3-100)',
      },
      deviationThreshold: {
        type: 'number',
        description: 'Deviation threshold as decimal (default: 0.20 = 20%, range: 0.01-2.00)',
      },
      domains: {
        type: 'array',
        items: { type: 'string' },
        description: 'Domains to analyze: quality, perf, test, security, seo (default: all)',
      },
    },
  },

  handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
    // Validazione parametri opzionali
    if (args.baselineWindow !== undefined) {
      if (typeof args.baselineWindow !== 'number' || !Number.isInteger(args.baselineWindow) || args.baselineWindow < 3 || args.baselineWindow > 100) {
        return errorResult('baselineWindow must be an integer between 3 and 100');
      }
    }

    if (args.deviationThreshold !== undefined) {
      if (typeof args.deviationThreshold !== 'number' || args.deviationThreshold < 0.01 || args.deviationThreshold > 2.0) {
        return errorResult('deviationThreshold must be a number between 0.01 and 2.0');
      }
    }

    if (args.domains !== undefined) {
      if (!Array.isArray(args.domains) || args.domains.length === 0) {
        return errorResult('domains must be a non-empty array of strings');
      }

      const validDomains = args.domains.every(
        (d) => typeof d === 'string' && VALID_DOMAINS.includes(d.toLowerCase())
      );

      if (!validDomains) {
        return errorResult(`Invalid domain(s). Supported domains: ${VALID_DOMAINS.join(', ')}`);
      }
    }

    try {
      const result = detectRegressions({
        baselineWindow: args.baselineWindow !== undefined ? Number(args.baselineWindow) : undefined,
        deviationThreshold: args.deviationThreshold !== undefined ? Number(args.deviationThreshold) : undefined,
        domains: args.domains !== undefined
          ? (args.domains as string[]).map((d) => d.toLowerCase())
          : undefined,
      });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                data: result,
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
                error: 'REGRESSION_DETECT_ERROR',
                message: `Failed to detect regressions: ${error instanceof Error ? error.message : String(error)}`,
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
// Tool: quality_gate_run
// ---------------------------------------------------------------------------

export const qualityGateRunToolHandler: ToolHandler = {
  name: 'quality_gate_run',
  description: 'Execute complete quality gate pipeline (lint → TSC → test → coverage → audit)',
  inputSchema: {
    type: 'object',
    properties: {
      projectPath: { type: 'string', description: 'Path to project directory' },
      thresholds: {
        type: 'object',
        properties: {
          maxLintErrors: { type: 'number', description: 'Max allowed lint errors (default: 0)' },
          maxLintWarnings: { type: 'number', description: 'Max allowed lint warnings (default: 10)' },
          maxTsErrors: { type: 'number', description: 'Max allowed TypeScript errors (default: 0)' },
          minCoverage: { type: 'number', description: 'Minimum coverage percentage (default: 80)' },
          maxTestFails: { type: 'number', description: 'Max allowed test failures (default: 0)' },
          maxVulnerabilities: { type: 'number', description: 'Max allowed vulnerabilities (default: 0)' },
        },
      },
    },
    required: ['projectPath'],
  },
  handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
    // Validazione
    if (!args.projectPath || typeof args.projectPath !== 'string') {
      return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: 'VALIDATION_ERROR', message: 'projectPath is required and must be a string' }) }], isError: true };
    }

    try {
      const result = runQualityGate(args.projectPath as string, args.thresholds as any);
      return {
        content: [{ type: 'text', text: JSON.stringify({ success: true, data: result }, null, 2) }],
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ success: false, error: 'QUALITY_GATE_ERROR', message: error instanceof Error ? error.message : String(error) }) }],
        isError: true,
      };
    }
  },
};

// ---------------------------------------------------------------------------
// Helper: errore
// ---------------------------------------------------------------------------

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
