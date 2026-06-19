/**
 * tools/incident.tool.ts
 * Tool MCP per il sistema di Incident Management (PANTHEON — Fase 8).
 *
 * Espone tre tool:
 * - incident_create: registra un nuovo incidente
 * - incident_list: elenca incidenti con filtri per status, severity, domain
 * - incident_update: aggiorna stato incidente (mitigate o resolve)
 *
 * @module tools/incident
 */

import type { ToolHandler, ToolResult } from '../types/mcp.js';
import {
  createIncident,
  listIncidents,
  mitigateIncident,
  resolveIncident,
  ensureIncidentSchema,
} from '../core/incident-manager.js';

// ---------------------------------------------------------------------------
// Valori validi
// ---------------------------------------------------------------------------

const VALID_SEVERITIES = ['minor', 'major', 'critical'];

const VALID_STATUSES = ['detected', 'mitigated', 'resolved'];

const VALID_DOMAINS = ['quality', 'perf', 'security', 'test', 'devops'];

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
 * Valida il dominio, restituisce un messaggio di errore se non valido.
 */
function validateDomain(domain: unknown): string | null {
  if (domain === undefined || domain === null) {
    return null; // opzionale
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
 * Valida incidentId: stringa non vuota.
 */
function validateIncidentId(incidentId: unknown): string | null {
  if (!incidentId || typeof incidentId !== 'string' || incidentId.trim().length === 0) {
    return 'incidentId is required and must be a non-empty string';
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
// Tool: incident_create
// ---------------------------------------------------------------------------

export const incidentCreateToolHandler: ToolHandler = {
  name: 'incident_create',
  description: 'Registra un nuovo incidente',
  inputSchema: {
    type: 'object',
    properties: {
      title: {
        type: 'string',
        description: 'Titolo dell\'incidente',
      },
      description: {
        type: 'string',
        description: 'Descrizione dettagliata dell\'incidente',
      },
      severity: {
        type: 'string',
        enum: ['minor', 'major', 'critical'],
        description: 'Severità dell\'incidente',
      },
      domain: {
        type: 'string',
        description: 'Dominio di competenza: quality, perf, security, test, devops',
      },
      source: {
        type: 'string',
        description: 'Fonte dell\'incidente: quality_gate, regression_detector, manual',
      },
    },
    required: ['title', 'description', 'severity'],
  },

  handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
    // Validazione campi obbligatori
    const titleErr = validateRequiredString(args.title, 'title');
    if (titleErr) return errorResult(titleErr);

    const descErr = validateRequiredString(args.description, 'description');
    if (descErr) return errorResult(descErr);

    const sevErr = validateSeverity(args.severity);
    if (sevErr) return errorResult(sevErr);

    if (args.severity === undefined || args.severity === null) {
      return errorResult('severity is required');
    }

    // Validazione campi opzionali
    const domainErr = validateDomain(args.domain);
    if (domainErr) return errorResult(domainErr);

    try {
      // Assicura che lo schema esista
      try {
        ensureIncidentSchema();
      } catch {
        // Database non ancora inizializzato
      }

      const incident = createIncident({
        title: String(args.title),
        description: String(args.description),
        severity: String(args.severity),
        domain: args.domain ? String(args.domain) : undefined,
        source: args.source ? String(args.source) : undefined,
      });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                data: {
                  id: incident.id,
                  title: incident.title,
                  severity: incident.severity,
                  status: incident.status,
                  domain: incident.domain,
                  source: incident.source,
                  detected_at: incident.detected_at,
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
                error: 'CREATE_ERROR',
                message: `Failed to create incident: ${error instanceof Error ? error.message : String(error)}`,
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
// Tool: incident_list
// ---------------------------------------------------------------------------

export const incidentListToolHandler: ToolHandler = {
  name: 'incident_list',
  description: 'Elenca incidenti con filtri per status, severity, domain',
  inputSchema: {
    type: 'object',
    properties: {
      status: {
        type: 'string',
        enum: ['detected', 'mitigated', 'resolved'],
        description: "Filtra per stato dell'incidente",
      },
      severity: {
        type: 'string',
        enum: ['minor', 'major', 'critical'],
        description: 'Filtra per severità',
      },
      domain: {
        type: 'string',
        description: 'Filtra per dominio: quality, perf, security, test, devops',
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

    const domainErr = validateDomain(args.domain);
    if (domainErr) return errorResult(domainErr);

    const limitErr = validatePositiveInt(args.limit, 'limit', 1, 1000);
    if (limitErr) return errorResult(limitErr);

    const offsetErr = validatePositiveInt(args.offset, 'offset', 0, 1000000);
    if (offsetErr) return errorResult(offsetErr);

    try {
      // Assicura che lo schema esista
      try {
        ensureIncidentSchema();
      } catch {
        // Database non ancora inizializzato
      }

      const result = listIncidents({
        status: args.status ? String(args.status) : undefined,
        severity: args.severity ? String(args.severity) : undefined,
        domain: args.domain ? String(args.domain) : undefined,
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
                  returned: result.incidents.length,
                  incidents: result.incidents,
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
                message: `Failed to list incidents: ${error instanceof Error ? error.message : String(error)}`,
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
// Tool: incident_update
// ---------------------------------------------------------------------------

export const incidentUpdateToolHandler: ToolHandler = {
  name: 'incident_update',
  description: 'Aggiorna stato incidente (mitigate o resolve)',
  inputSchema: {
    type: 'object',
    properties: {
      incidentId: {
        type: 'string',
        description: "ID dell'incidente da aggiornare",
      },
      action: {
        type: 'string',
        enum: ['mitigate', 'resolve'],
        description: "Azione da eseguire: 'mitigate' per mitigare, 'resolve' per risolvere",
      },
      by: {
        type: 'string',
        description: "Nome dell'agente o utente che esegue l'azione",
      },
      rootCause: {
        type: 'string',
        description: 'Causa radice identificata (per resolve)',
      },
      actionTaken: {
        type: 'string',
        description: "Azione intrapresa (per mitigate o resolve)",
      },
    },
    required: ['incidentId', 'action', 'by'],
  },

  handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
    // Validazione
    const idErr = validateIncidentId(args.incidentId);
    if (idErr) return errorResult(idErr);

    const actionErr = validateRequiredString(args.action, 'action');
    if (actionErr) return errorResult(actionErr);

    const byErr = validateBy(args.by);
    if (byErr) return errorResult(byErr);

    // Valida action
    const action = String(args.action).toLowerCase();
    if (action !== 'mitigate' && action !== 'resolve') {
      return errorResult("action must be 'mitigate' or 'resolve'");
    }

    try {
      // Assicura che lo schema esista
      try {
        ensureIncidentSchema();
      } catch {
        // Database non ancora inizializzato
      }

      let incident;

      if (action === 'mitigate') {
        incident = mitigateIncident(
          String(args.incidentId),
          String(args.by),
          args.actionTaken ? String(args.actionTaken) : undefined,
        );
      } else {
        incident = resolveIncident(
          String(args.incidentId),
          String(args.by),
          args.rootCause ? String(args.rootCause) : undefined,
          args.actionTaken ? String(args.actionTaken) : undefined,
        );
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                data: {
                  id: incident.id,
                  status: incident.status,
                  mitigated_at: incident.mitigated_at,
                  mitigated_by: incident.mitigated_by,
                  resolved_at: incident.resolved_at,
                  resolved_by: incident.resolved_by,
                  root_cause: incident.root_cause,
                  action_taken: incident.action_taken,
                },
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error) {
      // Errore atteso: incidente non trovato, transizione non valida, ecc.
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: false,
                error: 'UPDATE_ERROR',
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
