/**
 * tools/alert.tool.ts
 * Tool MCP per il sistema di alert centralizzato (AUTOMATA — Fase 6).
 *
 * Espone tre tool:
 * - alert_list: elenca alert con filtri per status, domain, severity
 * - alert_acknowledge: marca un alert come acknowledged
 * - alert_resolve: risolve un alert (lo chiude definitivamente)
 *
 * @module tools/alert
 */

import type { ToolHandler, ToolResult } from '../types/mcp.js';
import {
  createAlert,
  listAlerts,
  acknowledgeAlert,
  resolveAlert,
  ensureAlertSchema,
} from '../core/alert-manager.js';
import type { AlertSeverity, AlertSource } from '../core/alert-manager.js';

// ---------------------------------------------------------------------------
// Domini e valori validi
// ---------------------------------------------------------------------------

const VALID_DOMAINS = ['quality', 'perf', 'security', 'test', 'seo', 'devops'];

const VALID_SEVERITIES = ['low', 'medium', 'high', 'critical'];

const VALID_STATUSES = ['open', 'acknowledged', 'resolved'];

// ---------------------------------------------------------------------------
// Helper: validazione
// ---------------------------------------------------------------------------

/**
 * Valida il dominio, restituisce un messaggio di errore se non valido.
 */
function validateDomain(domain: unknown): string | null {
  if (domain === undefined || domain === null) {
    return null; // opzionale in alcuni contesti
  }

  if (typeof domain !== 'string') {
    return 'domain must be a string';
  }

  const lower = domain.toLowerCase().trim();
  if (!VALID_DOMAINS.includes(lower)) {
    return `Invalid domain '${domain}'. Supported domains: ${VALID_DOMAINS.join(', ')}`;
  }

  return null;
}

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
 * Valida limit: intero positivo, max 1000.
 */
function validateLimit(limit: unknown): string | null {
  if (limit === undefined || limit === null) {
    return null; // opzionale, default 50
  }

  if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > 1000) {
    return 'limit must be an integer between 1 and 1000';
  }

  return null;
}

/**
 * Valida offset: intero non negativo.
 */
function validateOffset(offset: unknown): string | null {
  if (offset === undefined || offset === null) {
    return null; // opzionale, default 0
  }

  if (typeof offset !== 'number' || !Number.isInteger(offset) || offset < 0) {
    return 'offset must be a non-negative integer';
  }

  return null;
}

/**
 * Valida alertId: stringa non vuota.
 */
function validateAlertId(alertId: unknown): string | null {
  if (!alertId || typeof alertId !== 'string' || alertId.trim().length === 0) {
    return 'alertId is required and must be a non-empty string';
  }

  return null;
}

/**
 * Valida by: stringa non vuota (agente o utente).
 */
function validateBy(by: unknown): string | null {
  if (!by || typeof by !== 'string' || by.trim().length === 0) {
    return 'by is required and must be a non-empty string';
  }

  return null;
}

// ---------------------------------------------------------------------------
// Tool: alert_list
// ---------------------------------------------------------------------------

export const alertListToolHandler: ToolHandler = {
  name: 'alert_list',
  description: 'Elenca alert con filtri per status, domain, severity',
  inputSchema: {
    type: 'object',
    properties: {
      status: {
        type: 'string',
        enum: ['open', 'acknowledged', 'resolved'],
        description: 'Filtra per stato dell\'alert',
      },
      domain: {
        type: 'string',
        description: 'Filtra per dominio: quality, perf, security, test, seo, devops',
      },
      severity: {
        type: 'string',
        enum: ['low', 'medium', 'high', 'critical'],
        description: 'Filtra per severità',
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

    const domainErr = validateDomain(args.domain);
    if (domainErr) return errorResult(domainErr);

    const severityErr = validateSeverity(args.severity);
    if (severityErr) return errorResult(severityErr);

    const limitErr = validateLimit(args.limit);
    if (limitErr) return errorResult(limitErr);

    const offsetErr = validateOffset(args.offset);
    if (offsetErr) return errorResult(offsetErr);

    try {
      // Assicura che lo schema esista
      try {
        ensureAlertSchema();
      } catch {
        // Database non ancora inizializzato
      }

      const result = listAlerts({
        status: args.status as 'open' | 'acknowledged' | 'resolved' | undefined,
        domain: args.domain ? String(args.domain) : undefined,
        severity: args.severity ? String(args.severity) : undefined,
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
                  returned: result.alerts.length,
                  alerts: result.alerts,
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
                error: 'LIST_ERROR',
                message: `Failed to list alerts: ${error instanceof Error ? error.message : String(error)}`,
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
// Tool: alert_acknowledge
// ---------------------------------------------------------------------------

export const alertAcknowledgeToolHandler: ToolHandler = {
  name: 'alert_acknowledge',
  description: 'Marca un alert come acknowledged (preso in carico)',
  inputSchema: {
    type: 'object',
    properties: {
      alertId: {
        type: 'string',
        description: "ID dell'alert da acknowledge",
      },
      by: {
        type: 'string',
        description: "Nome dell'agente o utente che acknowledge",
      },
    },
    required: ['alertId', 'by'],
  },

  handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
    // Validazione
    const idErr = validateAlertId(args.alertId);
    if (idErr) return errorResult(idErr);

    const byErr = validateBy(args.by);
    if (byErr) return errorResult(byErr);

    try {
      // Assicura che lo schema esista
      try {
        ensureAlertSchema();
      } catch {
        // Database non ancora inizializzato
      }

      const alert = acknowledgeAlert(String(args.alertId), String(args.by));

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                data: {
                  id: alert.id,
                  status: alert.status,
                  acknowledged_at: alert.acknowledged_at,
                  acknowledged_by: alert.acknowledged_by,
                },
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error) {
      // Errore atteso: alert non trovato o stato non valido
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: false,
                error: 'ACKNOWLEDGE_ERROR',
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
  },
};

// ---------------------------------------------------------------------------
// Tool: alert_resolve
// ---------------------------------------------------------------------------

export const alertResolveToolHandler: ToolHandler = {
  name: 'alert_resolve',
  description: "Risolvi un alert (lo chiude definitivamente)",
  inputSchema: {
    type: 'object',
    properties: {
      alertId: {
        type: 'string',
        description: "ID dell'alert da risolvere",
      },
      by: {
        type: 'string',
        description: "Nome dell'agente o utente che risolve",
      },
    },
    required: ['alertId', 'by'],
  },

  handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
    // Validazione
    const idErr = validateAlertId(args.alertId);
    if (idErr) return errorResult(idErr);

    const byErr = validateBy(args.by);
    if (byErr) return errorResult(byErr);

    try {
      // Assicura che lo schema esista
      try {
        ensureAlertSchema();
      } catch {
        // Database non ancora inizializzato
      }

      const alert = resolveAlert(String(args.alertId), String(args.by));

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                data: {
                  id: alert.id,
                  status: alert.status,
                  resolved_at: alert.resolved_at,
                  resolved_by: alert.resolved_by,
                },
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error) {
      // Errore atteso: alert non trovato o già risolto
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: false,
                error: 'RESOLVE_ERROR',
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
