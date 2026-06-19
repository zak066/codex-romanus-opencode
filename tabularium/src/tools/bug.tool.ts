/**
 * tools/bug.tool.ts
 * Tool MCP per il sistema di bug tracking strutturato (FABRICA — Fase 7).
 *
 * Espone tre tool:
 * - bug_report: registra un nuovo bug nel tracker
 * - bug_query: interroga bug con filtri per status, severity, component, assigned_to
 * - bug_trend: analisi trend bug chiusi nel tempo
 *
 * @module tools/bug
 */

import type { ToolHandler, ToolResult } from '../types/mcp.js';
import {
  reportBug,
  listBugs,
  updateBugStatus,
  getBugTrend,
  ensureBugSchema,
} from '../core/bug-tracker.js';

// ---------------------------------------------------------------------------
// Valori validi
// ---------------------------------------------------------------------------

const VALID_SEVERITIES = ['cosmetic', 'minor', 'major', 'critical', 'blocker'];

const VALID_STATUSES = ['open', 'in_progress', 'fixed', 'verified', 'closed'];

// ---------------------------------------------------------------------------
// Helper: validazione
// ---------------------------------------------------------------------------

/**
 * Valida severity, restituisce un messaggio di errore se non valida.
 */
function validateSeverity(severity: unknown): string | null {
  if (severity === undefined || severity === null) {
    return null; // opzionale
  }

  if (typeof severity !== 'string') {
    return 'severity must be a string';
  }

  const lower = severity.toLowerCase().trim();
  if (!VALID_SEVERITIES.includes(lower)) {
    return `Invalid severity '${severity}'. Supported values: ${VALID_SEVERITIES.join(', ')}`;
  }

  return null;
}

/**
 * Valida status, restituisce un messaggio di errore se non valido.
 */
function validateStatus(status: unknown): string | null {
  if (status === undefined || status === null) {
    return null; // opzionale
  }

  if (typeof status !== 'string') {
    return 'status must be a string';
  }

  const lower = status.toLowerCase().trim();
  if (!VALID_STATUSES.includes(lower)) {
    return `Invalid status '${status}'. Supported values: ${VALID_STATUSES.join(', ')}`;
  }

  return null;
}

/**
 * Valida una stringa non vuota.
 */
function validateRequiredString(value: unknown, name: string): string | null {
  if (!value || typeof value !== 'string' || value.trim().length === 0) {
    return `${name} is required and must be a non-empty string`;
  }
  return null;
}

/**
 * Valida un numero intero positivo, opzionale.
 */
function validatePositiveInt(value: unknown, name: string, min: number, max: number): string | null {
  if (value === undefined || value === null) {
    return null; // opzionale
  }

  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    return `${name} must be an integer between ${min} and ${max}`;
  }

  return null;
}

/**
 * Valida un array di stringhe, opzionale.
 */
function validateStringArray(value: unknown, name: string): string | null {
  if (value === undefined || value === null) {
    return null; // opzionale
  }

  if (!Array.isArray(value)) {
    return `${name} must be an array of strings`;
  }

  for (const item of value) {
    if (typeof item !== 'string') {
      return `${name} must contain only strings`;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Tool: bug_report
// ---------------------------------------------------------------------------

export const bugReportToolHandler: ToolHandler = {
  name: 'bug_report',
  description: 'Registra un nuovo bug nel tracker',
  inputSchema: {
    type: 'object',
    properties: {
      title: {
        type: 'string',
        description: 'Titolo del bug',
      },
      description: {
        type: 'string',
        description: 'Descrizione dettagliata del bug',
      },
      component: {
        type: 'string',
        description: 'Modulo o area colpita (es. auth, database, frontend)',
      },
      severity: {
        type: 'string',
        enum: ['cosmetic', 'minor', 'major', 'critical', 'blocker'],
        description: 'Severità del bug',
      },
      root_cause_category: {
        type: 'string',
        description: 'Categoria della causa radice: logic, typo, regression, config, external, unknown',
      },
      affected_files: {
        type: 'array',
        items: { type: 'string' },
        description: 'File coinvolti dal bug',
      },
      reported_by: {
        type: 'string',
        description: "Nome dell'agente che riporta il bug",
      },
      assigned_to: {
        type: 'string',
        description: "Nome dell'agente assegnato al bug",
      },
      tags: {
        type: 'object',
        description: 'Tags opzionali (oggetto chiave-valore)',
      },
    },
    required: ['title', 'description', 'component', 'severity', 'reported_by'],
  },

  handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
    // Validazione campi obbligatori
    const titleErr = validateRequiredString(args.title, 'title');
    if (titleErr) return errorResult(titleErr);

    const descErr = validateRequiredString(args.description, 'description');
    if (descErr) return errorResult(descErr);

    const compErr = validateRequiredString(args.component, 'component');
    if (compErr) return errorResult(compErr);

    const sevErr = validateSeverity(args.severity);
    if (sevErr) return errorResult(sevErr);

    const reporterErr = validateRequiredString(args.reported_by, 'reported_by');
    if (reporterErr) return errorResult(reporterErr);

    const filesErr = validateStringArray(args.affected_files, 'affected_files');
    if (filesErr) return errorResult(filesErr);

    try {
      // Assicura che lo schema esista
      try {
        ensureBugSchema();
      } catch {
        // Database non ancora inizializzato
      }

      const bug = reportBug({
        title: String(args.title),
        description: String(args.description),
        component: String(args.component),
        severity: String(args.severity),
        root_cause_category: args.root_cause_category ? String(args.root_cause_category) : undefined,
        affected_files: args.affected_files ? (args.affected_files as string[]) : undefined,
        reported_by: String(args.reported_by),
        assigned_to: args.assigned_to ? String(args.assigned_to) : undefined,
        tags: args.tags ? (args.tags as Record<string, unknown>) : undefined,
      });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                data: {
                  id: bug.id,
                  title: bug.title,
                  severity: bug.severity,
                  status: bug.status,
                  component: bug.component,
                  reported_by: bug.reported_by,
                  created_at: bug.created_at,
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
                error: 'REPORT_ERROR',
                message: `Failed to report bug: ${error instanceof Error ? error.message : String(error)}`,
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
// Tool: bug_query
// ---------------------------------------------------------------------------

export const bugQueryToolHandler: ToolHandler = {
  name: 'bug_query',
  description: 'Interroga bug con filtri per status, severity, component, assigned_to',
  inputSchema: {
    type: 'object',
    properties: {
      status: {
        type: 'string',
        enum: ['open', 'in_progress', 'fixed', 'verified', 'closed'],
        description: "Filtra per stato del bug",
      },
      severity: {
        type: 'string',
        enum: ['cosmetic', 'minor', 'major', 'critical', 'blocker'],
        description: 'Filtra per severità',
      },
      component: {
        type: 'string',
        description: 'Filtra per modulo o area colpita',
      },
      assigned_to: {
        type: 'string',
        description: "Filtra per agente assegnato",
      },
      limit: {
        type: 'number',
        description: 'Numero massimo di risultati (default: 50, max: 1000)',
      },
      offset: {
        type: 'number',
        description: 'Offset per paginazione (default: 0)',
      },
    },
  },

  handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
    // Validazione
    const statusErr = validateStatus(args.status);
    if (statusErr) return errorResult(statusErr);

    const severityErr = validateSeverity(args.severity);
    if (severityErr) return errorResult(severityErr);

    const limitErr = validatePositiveInt(args.limit, 'limit', 1, 1000);
    if (limitErr) return errorResult(limitErr);

    const offsetErr = validatePositiveInt(args.offset, 'offset', 0, 1000000);
    if (offsetErr) return errorResult(offsetErr);

    try {
      // Assicura che lo schema esista
      try {
        ensureBugSchema();
      } catch {
        // Database non ancora inizializzato
      }

      // Valida assigned_to come stringa
      let assignedTo: string | undefined;
      if (args.assigned_to !== undefined && args.assigned_to !== null) {
        if (typeof args.assigned_to !== 'string') {
          return errorResult('assigned_to must be a string');
        }
        assignedTo = String(args.assigned_to);
      }

      const result = listBugs({
        status: args.status ? String(args.status) : undefined,
        severity: args.severity ? String(args.severity) : undefined,
        component: args.component ? String(args.component) : undefined,
        assigned_to: assignedTo,
        limit: args.limit != null ? Number(args.limit) : undefined,
        offset: args.offset != null ? Number(args.offset) : undefined,
      });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                data: {
                  total: result.total,
                  returned: result.bugs.length,
                  bugs: result.bugs,
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
                error: 'QUERY_ERROR',
                message: `Failed to query bugs: ${error instanceof Error ? error.message : String(error)}`,
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
// Tool: bug_trend
// ---------------------------------------------------------------------------

export const bugTrendToolHandler: ToolHandler = {
  name: 'bug_trend',
  description: "Analisi trend bug chiusi e aperti nel tempo",
  inputSchema: {
    type: 'object',
    properties: {
      component: {
        type: 'string',
        description: 'Filtra per componente specifico (opzionale)',
      },
      days: {
        type: 'number',
        description: 'Finestra in giorni per l\'analisi (default: 30, max: 365)',
      },
    },
  },

  handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
    // Validazione
    const daysErr = validatePositiveInt(args.days, 'days', 1, 365);
    if (daysErr) return errorResult(daysErr);

    try {
      // Assicura che lo schema esista
      try {
        ensureBugSchema();
      } catch {
        // Database non ancora inizializzato
      }

      const trend = getBugTrend(
        args.component ? String(args.component) : undefined,
        args.days != null ? Number(args.days) : undefined,
      );

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                data: trend,
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
                error: 'TREND_ERROR',
                message: `Failed to get bug trend: ${error instanceof Error ? error.message : String(error)}`,
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
 * Crea un ToolResult di errore con formato consistente.
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
