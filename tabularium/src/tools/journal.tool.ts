/**
 * tools/journal.tool.ts
 * Tool MCP per il File Change Journal (FABRICA — Fase 7.2).
 *
 * Espone due tool:
 * - journal_log: registra una modifica a un file nel journal
 * - journal_query: interroga il file change journal con filtri
 *
 * @module tools/journal
 */

import type { ToolHandler, ToolResult } from '../types/mcp.js';
import {
  logChange,
  queryChanges,
  getChangesByFile,
  getRecentChanges,
  ensureFileJournalSchema,
} from '../core/file-journal.js';

// ---------------------------------------------------------------------------
// Valori validi
// ---------------------------------------------------------------------------

const VALID_CHANGE_TYPES = ['created', 'modified', 'deleted', 'renamed'];

// ---------------------------------------------------------------------------
// Helper: validazione
// ---------------------------------------------------------------------------

/**
 * Valida change_type, restituisce un messaggio di errore se non valido.
 */
function validateChangeType(changeType: unknown): string | null {
  if (changeType === undefined || changeType === null) {
    return null; // opzionale
  }

  if (typeof changeType !== 'string') {
    return 'change_type must be a string';
  }

  const lower = changeType.toLowerCase().trim();
  if (!VALID_CHANGE_TYPES.includes(lower)) {
    return `Invalid change_type '${changeType}'. Supported values: ${VALID_CHANGE_TYPES.join(', ')}`;
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

// ---------------------------------------------------------------------------
// Tool: journal_log
// ---------------------------------------------------------------------------

export const journalLogToolHandler: ToolHandler = {
  name: 'journal_log',
  description: 'Registra una modifica a un file nel journal',
  inputSchema: {
    type: 'object',
    properties: {
      file_path: {
        type: 'string',
        description: 'Percorso relativo del file modificato',
      },
      agent: {
        type: 'string',
        description: "Nome dell'agente che ha effettuato la modifica",
      },
      change_type: {
        type: 'string',
        enum: ['created', 'modified', 'deleted', 'renamed'],
        description: 'Tipo di modifica',
      },
      summary: {
        type: 'string',
        description: 'Descrizione della modifica',
      },
      session_id: {
        type: 'string',
        description: 'ID della sessione (opzionale)',
      },
      task_id: {
        type: 'string',
        description: 'ID del task associato (opzionale)',
      },
      diff: {
        type: 'string',
        description: 'Diff testuale della modifica (opzionale)',
      },
    },
    required: ['file_path', 'agent', 'change_type', 'summary'],
  },

  handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
    // Validazione campi obbligatori
    const filePathErr = validateRequiredString(args.file_path, 'file_path');
    if (filePathErr) return errorResult(filePathErr);

    const agentErr = validateRequiredString(args.agent, 'agent');
    if (agentErr) return errorResult(agentErr);

    const changeTypeErr = validateChangeType(args.change_type);
    if (changeTypeErr) return errorResult(changeTypeErr);

    const summaryErr = validateRequiredString(args.summary, 'summary');
    if (summaryErr) return errorResult(summaryErr);

    try {
      // Assicura che lo schema esista
      try {
        ensureFileJournalSchema();
      } catch {
        // Database non ancora inizializzato
      }

      const record = logChange({
        file_path: String(args.file_path),
        agent: String(args.agent),
        change_type: String(args.change_type),
        summary: String(args.summary),
        session_id: args.session_id ? String(args.session_id) : undefined,
        task_id: args.task_id ? String(args.task_id) : undefined,
        diff: args.diff ? String(args.diff) : undefined,
      });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                data: {
                  id: record.id,
                  file_path: record.file_path,
                  agent: record.agent,
                  change_type: record.change_type,
                  summary: record.summary,
                  created_at: record.created_at,
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
                error: 'LOG_ERROR',
                message: `Failed to log change: ${error instanceof Error ? error.message : String(error)}`,
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
// Tool: journal_query
// ---------------------------------------------------------------------------

export const journalQueryToolHandler: ToolHandler = {
  name: 'journal_query',
  description: 'Interroga il file change journal con filtri',
  inputSchema: {
    type: 'object',
    properties: {
      file_path: {
        type: 'string',
        description: 'Filtra per percorso file',
      },
      agent: {
        type: 'string',
        description: "Filtra per nome dell'agente",
      },
      task_id: {
        type: 'string',
        description: 'Filtra per ID del task',
      },
      change_type: {
        type: 'string',
        enum: ['created', 'modified', 'deleted', 'renamed'],
        description: 'Filtra per tipo di modifica',
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
    const changeTypeErr = validateChangeType(args.change_type);
    if (changeTypeErr) return errorResult(changeTypeErr);

    const limitErr = validatePositiveInt(args.limit, 'limit', 1, 1000);
    if (limitErr) return errorResult(limitErr);

    const offsetErr = validatePositiveInt(args.offset, 'offset', 0, 1000000);
    if (offsetErr) return errorResult(offsetErr);

    try {
      // Assicura che lo schema esista
      try {
        ensureFileJournalSchema();
      } catch {
        // Database non ancora inizializzato
      }

      const result = queryChanges({
        file_path: args.file_path ? String(args.file_path) : undefined,
        agent: args.agent ? String(args.agent) : undefined,
        task_id: args.task_id ? String(args.task_id) : undefined,
        change_type: args.change_type ? String(args.change_type) : undefined,
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
                  returned: result.changes.length,
                  changes: result.changes,
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
                message: `Failed to query journal: ${error instanceof Error ? error.message : String(error)}`,
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
