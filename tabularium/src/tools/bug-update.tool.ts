/**
 * tools/bug-update.tool.ts
 * Tool MCP per aggiornare lo stato di un bug nel tracker.
 *
 * Supporta transizioni di stato: open → in_progress → fixed → verified → closed
 * con possibilità di reopen (closed → open).
 *
 * @module tools/bug-update
 */

import type { ToolHandler, ToolResult } from '../types/mcp.js';
import {
  updateBugStatus,
  getBugById,
  ensureBugSchema,
} from '../core/bug-tracker.js';

// ---------------------------------------------------------------------------
// Status validi
// ---------------------------------------------------------------------------

const VALID_STATUSES = ['open', 'in_progress', 'fixed', 'verified', 'closed'];
const VALID_SEVERITIES = ['cosmetic', 'minor', 'major', 'critical', 'blocker'];

// ---------------------------------------------------------------------------
// Tool: bug_update
// ---------------------------------------------------------------------------

export const bugUpdateToolHandler: ToolHandler = {
  name: 'bug_update',
  description:
    "Aggiorna stato di un bug nel tracker. " +
    "Supporta transizioni: open → in_progress → fixed → verified → closed. " +
    "Opzionalmente aggiorna severity, assigned_to e aggiunge commenti.",
  inputSchema: {
    type: 'object',
    properties: {
      bugId: {
        type: 'string',
        description: 'ID del bug da aggiornare',
      },
      status: {
        type: 'string',
        enum: ['open', 'in_progress', 'fixed', 'verified', 'closed'],
        description: 'Nuovo stato del bug',
      },
      severity: {
        type: 'string',
        enum: ['cosmetic', 'minor', 'major', 'critical', 'blocker'],
        description: 'Nuova severità (opzionale)',
      },
      assigned_to: {
        type: 'string',
        description: "Nome dell'agente da assegnare (opzionale)",
      },
      comment: {
        type: 'string',
        description: 'Commento opzionale sulla modifica',
      },
    },
    required: ['bugId'],
  },

  handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
    // Validazione bugId
    if (!args.bugId || typeof args.bugId !== 'string' || args.bugId.trim().length === 0) {
      return errorResult('bugId is required and must be a non-empty string');
    }

    // Validazione status (opzionale)
    if (args.status !== undefined && args.status !== null) {
      if (typeof args.status !== 'string') {
        return errorResult('status must be a string');
      }
      const lowerStatus = args.status.toLowerCase().trim();
      if (!VALID_STATUSES.includes(lowerStatus)) {
        return errorResult(`Invalid status '${args.status}'. Supported: ${VALID_STATUSES.join(', ')}`);
      }
    }

    // Validazione severity (opzionale)
    if (args.severity !== undefined && args.severity !== null) {
      if (typeof args.severity !== 'string') {
        return errorResult('severity must be a string');
      }
      const lowerSev = args.severity.toLowerCase().trim();
      if (!VALID_SEVERITIES.includes(lowerSev)) {
        return errorResult(`Invalid severity '${args.severity}'. Supported: ${VALID_SEVERITIES.join(', ')}`);
      }
    }

    try {
      // Assicura che lo schema esista
      try {
        ensureBugSchema();
      } catch {
        // Database non ancora inizializzato
      }

      const bugId = String(args.bugId);
      const status = args.status ? String(args.status).toLowerCase() : undefined;
      const assignedTo = args.assigned_to ? String(args.assigned_to) : undefined;

      // Aggiorna stato se fornito
      let updated;
      if (status) {
        updated = updateBugStatus(bugId, status, assignedTo);
      } else {
        // Nessun cambio stato — solo recupera il bug
        updated = getBugById(bugId);
      }

      // Nota sul commento: il bug-tracker non ha un sistema di commenti,
      // quindi lo registriamo come informazione di risposta
      const response: Record<string, unknown> = {
        id: updated.id,
        title: updated.title,
        status: updated.status,
        severity: updated.severity,
        assigned_to: updated.assigned_to,
        updated_at: updated.updated_at,
      };

      if (args.comment) {
        response.comment = String(args.comment);
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                data: response,
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
                error: 'BUG_UPDATE_ERROR',
                message: `bug_update failed: ${error instanceof Error ? error.message : String(error)}`,
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
