/**
 * tools/trend-report.tool.ts
 * Tool MCP per report trend completo con aggregazioni per dominio.
 *
 * Analizza trend da metriche storiche, raggruppa per dominio e calcola delta.
 * Supporta output in formato JSON o Markdown.
 *
 * @module tools/trend-report
 */

import type { ToolHandler, ToolResult } from '../types/mcp.js';
import { generateTrendReport } from '../core/trend-analyzer.js';

// ---------------------------------------------------------------------------
// Domini validi
// ---------------------------------------------------------------------------

const VALID_DOMAINS = ['quality', 'perf', 'security', 'test', 'seo', 'devops'];

// ---------------------------------------------------------------------------
// Validazione
// ---------------------------------------------------------------------------

function validateDomain(domain: unknown): string | null {
  if (domain === undefined || domain === null) return null;
  if (typeof domain !== 'string') return 'domain must be a string';
  if (!VALID_DOMAINS.includes(domain.toLowerCase())) {
    return `Invalid domain '${domain}'. Supported: ${VALID_DOMAINS.join(', ')}`;
  }
  return null;
}

function validatePositiveInt(value: unknown, name: string, min: number, max: number): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    return `${name} must be an integer between ${min} and ${max}`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Helper: format in Markdown
// ---------------------------------------------------------------------------

function formatMarkdownReport(report: ReturnType<typeof generateTrendReport>): string {
  const lines: string[] = [];
  lines.push('# Trend Report');
  lines.push(`*Generated at: ${report.generatedAt}*`);
  lines.push('');

  // Models
  lines.push('## Model Effectiveness');
  lines.push('| Model | Completed | Failed | Success Rate | Avg Events/Session |');
  lines.push('|-------|-----------|--------|-------------|-------------------|');
  for (const m of report.models) {
    lines.push(`| ${m.model} | ${m.tasksCompleted} | ${m.tasksFailed} | ${m.successRate}% | ${m.avgEventsPerSession} |`);
  }
  lines.push('');

  // Agents
  lines.push('## Agent Productivity');
  lines.push('| Agent | Sessions | Tasks | Decisions | Knowledge | Peak Hour |');
  lines.push('|-------|----------|-------|-----------|-----------|-----------|');
  for (const a of report.agents) {
    lines.push(`| ${a.agent} | ${a.sessionsCount} | ${a.tasksCompleted} | ${a.decisionsMade} | ${a.knowledgeContributed} | ${a.mostActiveHour}:00 |`);
  }
  lines.push('');

  // Errors
  lines.push('## Error Patterns');
  lines.push('| Pattern | Occurrences | Affected Agents | Trend |');
  lines.push('|---------|-------------|-----------------|-------|');
  for (const e of report.errors) {
    lines.push(`| ${e.pattern} | ${e.occurrences} | ${e.affectedAgents.join(', ')} | ${e.trending} |`);
  }
  lines.push('');

  // Metrics (if present)
  if (report.metrics && report.metrics.length > 0) {
    lines.push('## Domain Metric Trends');
    lines.push('| Metric | Previous Avg | Current Avg | Delta | Direction |');
    lines.push('|--------|-------------|-------------|-------|-----------|');
    for (const m of report.metrics) {
      lines.push(`| ${m.metric_name} | ${m.previous_avg} | ${m.current_avg} | ${m.delta_pct}% | ${m.direction} |`);
    }
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Tool: trend_report
// ---------------------------------------------------------------------------

export const trendReportToolHandler: ToolHandler = {
  name: 'trend_report',
  description:
    'Report trend completo con aggregazioni per dominio. ' +
    'Analizza trend da metriche storiche, raggruppa per dominio e calcola delta. ' +
    'Supporta output JSON o Markdown.',
  inputSchema: {
    type: 'object',
    properties: {
      domain: {
        type: 'string',
        description: 'Dominio opzionale per filtrare le metriche (quality, perf, security, test, seo, devops)',
      },
      days: {
        type: 'number',
        description: "Finestra temporale in giorni per l'analisi trend (default: 7)",
      },
      format: {
        type: 'string',
        enum: ['json', 'markdown'],
        description: "Formato dell'output: 'json' (default) o 'markdown'",
      },
    },
  },

  handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
    // Validazione
    const domainErr = validateDomain(args.domain);
    if (domainErr) {
      return errorResult(domainErr);
    }

    const daysErr = validatePositiveInt(args.days, 'days', 1, 365);
    if (daysErr) {
      return errorResult(daysErr);
    }

    try {
      const domain = args.domain ? String(args.domain).toLowerCase() : undefined;
      const days = args.days != null ? Number(args.days) : undefined;
      const format = args.format === 'markdown' ? 'markdown' : 'json';

      // Genera report — se domain è specificato include anche metric trend
      const report = generateTrendReport(domain);

      if (format === 'markdown') {
        return {
          content: [
            {
              type: 'text',
              text: formatMarkdownReport(report),
            },
          ],
        };
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                data: report,
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
                error: 'TREND_REPORT_ERROR',
                message: `trend_report failed: ${error instanceof Error ? error.message : String(error)}`,
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
