/**
 * tools/secret.tool.ts
 * Tool MCP per il Secret Scanner (Custos Secret Monitor) — Fase 8 PANTHEON.
 *
 * Espone tre tool:
 * - secret_scan: scansiona una directory alla ricerca di segreti hardcodati
 * - secret_list: elenca i segreti trovati con filtri
 * - secret_update_status: aggiorna lo status di un finding
 *
 * @module tools/secret
 */

import type { ToolHandler, ToolResult } from '../types/mcp.js';
import {
  scanDirectory,
  listFindings,
  updateFindingStatus,
  ensureSecretSchema,
} from '../core/secret-scanner.js';

// ---------------------------------------------------------------------------
// Valori validi
// ---------------------------------------------------------------------------

const VALID_STATUSES = ['open', 'acknowledged', 'false_positive', 'fixed'];

// ---------------------------------------------------------------------------
// Helper: validazione
// ---------------------------------------------------------------------------

/**
 * Valida status, restituisce un messaggio di errore se non valido.
 */
function validateStatus(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null; // opzionale
  }

  if (typeof value !== 'string') {
    return 'status must be a string';
  }

  const lower = value.toLowerCase().trim();
  if (!VALID_STATUSES.includes(lower)) {
    return `Invalid status '${value}'. Supported values: ${VALID_STATUSES.join(', ')}`;
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

// ---------------------------------------------------------------------------
// Tool: secret_scan
// ---------------------------------------------------------------------------

export const secretScanToolHandler: ToolHandler = {
  name: 'secret_scan',
  description: 'Scansiona una directory alla ricerca di segreti hardcodati (API key, password, token, private key, connection string)',
  inputSchema: {
    type: 'object',
    properties: {
      dirPath: {
        type: 'string',
        description: 'Directory da scansionare (default: project root)',
      },
    },
  },

  handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
    try {
      // Assicura che lo schema esista
      try {
        ensureSecretSchema();
      } catch {
        // Database non ancora inizializzato
      }

      const dirPath = args.dirPath ? String(args.dirPath) : undefined;

      const result = scanDirectory(dirPath);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                data: {
                  findingsCount: result.findings.length,
                  filesScanned: result.filesScanned,
                  durationMs: result.durationMs,
                  findings: result.findings.map((f) => ({
                    id: f.id,
                    file_path: f.file_path,
                    line_number: f.line_number,
                    secret_type: f.secret_type,
                    severity: f.severity,
                    description: f.description,
                    content: f.content,
                    status: f.status,
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
                error: 'SCAN_ERROR',
                message: `Failed to scan directory: ${error instanceof Error ? error.message : String(error)}`,
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
// Tool: secret_list
// ---------------------------------------------------------------------------

export const secretListToolHandler: ToolHandler = {
  name: 'secret_list',
  description: 'Elenca i segreti trovati con filtri per status e tipo',
  inputSchema: {
    type: 'object',
    properties: {
      status: {
        type: 'string',
        enum: ['open', 'acknowledged', 'false_positive', 'fixed'],
        description: 'Filtra per stato del finding',
      },
      secretType: {
        type: 'string',
        description: 'Filtra per tipo di segreto (api_key, password, token, private_key, connection_string, aws_key, github_token)',
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
    try {
      // Validazione
      const statusErr = validateStatus(args.status);
      if (statusErr) return errorResult(statusErr);

      const limitErr = validatePositiveInt(args.limit, 'limit', 1, 1000);
      if (limitErr) return errorResult(limitErr);

      const offsetErr = validatePositiveInt(args.offset, 'offset', 0, 1000000);
      if (offsetErr) return errorResult(offsetErr);

      // Assicura che lo schema esista
      try {
        ensureSecretSchema();
      } catch {
        // Database non ancora inizializzato
      }

      const result = listFindings(
        args.status ? String(args.status) : undefined,
        args.secretType ? String(args.secretType) : undefined,
        args.limit != null ? Number(args.limit) : undefined,
        args.offset != null ? Number(args.offset) : undefined,
      );

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                data: {
                  total: result.total,
                  returned: result.findings.length,
                  findings: result.findings,
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
                message: `Failed to list findings: ${error instanceof Error ? error.message : String(error)}`,
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
// Tool: secret_update_status
// ---------------------------------------------------------------------------

export const secretUpdateStatusToolHandler: ToolHandler = {
  name: 'secret_update_status',
  description: 'Aggiorna lo status di un finding segreto',
  inputSchema: {
    type: 'object',
    properties: {
      findingId: {
        type: 'string',
        description: 'ID del finding da aggiornare',
      },
      status: {
        type: 'string',
        enum: ['open', 'acknowledged', 'false_positive', 'fixed'],
        description: 'Nuovo stato del finding',
      },
    },
    required: ['findingId', 'status'],
  },

  handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
    // Validazione campi obbligatori
    const idErr = validateRequiredString(args.findingId, 'findingId');
    if (idErr) return errorResult(idErr);

    const statusErr = validateStatus(args.status);
    if (statusErr) return errorResult(statusErr);

    try {
      // Assicura che lo schema esista
      try {
        ensureSecretSchema();
      } catch {
        // Database non ancora inizializzato
      }

      const updated = updateFindingStatus(
        String(args.findingId),
        String(args.status),
      );

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                data: {
                  id: updated.id,
                  file_path: updated.file_path,
                  secret_type: updated.secret_type,
                  severity: updated.severity,
                  status: updated.status,
                  resolved_at: updated.resolved_at,
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
                error: 'UPDATE_ERROR',
                message: `Failed to update finding status: ${error instanceof Error ? error.message : String(error)}`,
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
