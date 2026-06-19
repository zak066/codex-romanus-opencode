/**
 * tools/sbom.tool.ts
 * Tool MCP per lo SBOM Tracker — Fase 8 PANTHEON.
 *
 * Espone tre tool:
 * - sbom_capture: cattura uno snapshot delle dipendenze del progetto
 * - sbom_diff: confronta due snapshot di dipendenze
 * - sbom_list: elenca gli snapshot disponibili
 *
 * @module tools/sbom
 */

import type { ToolHandler, ToolResult } from '../types/mcp.js';
import {
  captureSnapshot,
  listSnapshots,
  diffSnapshots,
} from '../core/sbom-tracker.js';

// ---------------------------------------------------------------------------
// Helper: validazione
// ---------------------------------------------------------------------------

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
// Tool: sbom_capture
// ---------------------------------------------------------------------------

export const sbomCaptureToolHandler: ToolHandler = {
  name: 'sbom_capture',
  description: 'Cattura uno snapshot delle dipendenze del progetto (SBOM)',
  inputSchema: {
    type: 'object',
    properties: {
      projectPath: {
        type: 'string',
        description: 'Percorso del progetto (default: project root)',
      },
    },
  },

  handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
    try {
      const projectPath = args.projectPath ? String(args.projectPath) : undefined;

      const snapshot = captureSnapshot(projectPath);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                data: {
                  id: snapshot.id,
                  totalCount: snapshot.totalCount,
                  generatedAt: snapshot.generatedAt,
                  dependencies: snapshot.dependencies,
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
                error: 'CAPTURE_ERROR',
                message: `Failed to capture SBOM snapshot: ${error instanceof Error ? error.message : String(error)}`,
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
// Tool: sbom_list
// ---------------------------------------------------------------------------

export const sbomListToolHandler: ToolHandler = {
  name: 'sbom_list',
  description: 'Elenca gli snapshot SBOM disponibili',
  inputSchema: {
    type: 'object',
    properties: {
      limit: {
        type: 'number',
        description: 'Numero massimo di snapshot da restituire (default: 10, max: 100)',
      },
    },
  },

  handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
    try {
      const limitErr = validatePositiveInt(args.limit, 'limit', 1, 100);
      if (limitErr) return errorResult(limitErr);

      const snapshots = listSnapshots(
        args.limit != null ? Number(args.limit) : undefined,
      );

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                data: {
                  total: snapshots.length,
                  snapshots: snapshots.map((s) => ({
                    id: s.id,
                    totalCount: s.totalCount,
                    generatedAt: s.generatedAt,
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
                error: 'LIST_ERROR',
                message: `Failed to list snapshots: ${error instanceof Error ? error.message : String(error)}`,
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
// Tool: sbom_diff
// ---------------------------------------------------------------------------

export const sbomDiffToolHandler: ToolHandler = {
  name: 'sbom_diff',
  description: 'Confronta due snapshot di dipendenze (aggiunte, rimosse, cambiate)',
  inputSchema: {
    type: 'object',
    properties: {
      snapshotId1: {
        type: 'string',
        description: 'ID del primo snapshot (base)',
      },
      snapshotId2: {
        type: 'string',
        description: 'ID del secondo snapshot (da confrontare)',
      },
    },
    required: ['snapshotId1', 'snapshotId2'],
  },

  handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
    // Validazione campi obbligatori
    const id1Err = validateRequiredString(args.snapshotId1, 'snapshotId1');
    if (id1Err) return errorResult(id1Err);

    const id2Err = validateRequiredString(args.snapshotId2, 'snapshotId2');
    if (id2Err) return errorResult(id2Err);

    try {
      const diff = diffSnapshots(
        String(args.snapshotId1),
        String(args.snapshotId2),
      );

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                data: {
                  summary: {
                    added: diff.added.length,
                    removed: diff.removed.length,
                    changed: diff.changed.length,
                  },
                  added: diff.added,
                  removed: diff.removed,
                  changed: diff.changed,
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
                error: 'DIFF_ERROR',
                message: `Failed to diff snapshots: ${error instanceof Error ? error.message : String(error)}`,
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
