/**
 * System Tools — Tool MCP per informazioni di sistema e configurazione.
 *
 * Fase 6 (F6): espone 4 tool handler MCP:
 * - list_models: elenca modelli/checkpoint installati in ComfyUI
 * - get_system_stats: mostra informazioni sul sistema ComfyUI
 * - get_defaults: mostra valori di default correnti (placeholder)
 * - set_defaults: imposta un valore di default (placeholder)
 *
 * Pattern: Bridge + Adapter — i tool traducono chiamate MCP in operazioni
 * sul dominio ComfyUI tramite dipendenze iniettate.
 */

import { z } from 'zod';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ComfyClient } from '../comfyui/client.js';
import type { ObjectInfoResponse } from '../comfyui/types.js';
import { ComfyUIConnectionError } from '../utils/errors.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SystemDeps {
  comfyClient: ComfyClient;
  defaultsManager?: {
    getDefaults: () => Record<string, unknown>;
    setDefault: (key: string, value: unknown, persist?: boolean) => void;
  };
}

// ─── Constants ───────────────────────────────────────────────────────────────

const TEXT_TYPE = 'text' as const;

const VALID_MODEL_TYPES = [
  'checkpoints',
  'loras',
  'vae',
  'controlnet',
  'embeddings',
  'unet',
] as const;

/** Mappa tipo modello → nodi ComfyUI da cui estrarre i nomi. */
const LOADER_NODE_MAP: Record<string, string[]> = {
  checkpoints: ['CheckpointLoaderSimple'],
  loras: ['LoraLoader'],
  vae: ['VAELoader'],
  controlnet: ['ControlNetLoader'],
  unet: ['UnetLoaderGGUF', 'UNETLoader'],
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Estrae i valori (nomi modello) dai campi required di un nodo ComfyUI.
 * I campi combo (select) hanno field[0] di tipo string[].
 */
function extractValuesFromNode(
  nodeDef: { input: { required: Record<string, [string | string[]] | [string | string[], Record<string, unknown>]> } },
): string[] {
  const values: string[] = [];
  for (const key of Object.keys(nodeDef.input.required)) {
    const field = nodeDef.input.required[key];
    if (Array.isArray(field[0])) {
      for (const val of field[0]) {
        if (typeof val === 'string' && !values.includes(val)) {
          values.push(val);
        }
      }
    }
  }
  return values;
}

/**
 * Recupera i modelli da objectInfo per un dato tipo loader.
 */
function getModelsFromObjectInfo(
  objectInfo: ObjectInfoResponse,
  loaderType: string,
): Array<{ name: string; type: string }> {
  const nodeNames = LOADER_NODE_MAP[loaderType];
  if (!nodeNames) return [];

  const models: Array<{ name: string; type: string }> = [];
  for (const nodeName of nodeNames) {
    const nodeDef = objectInfo[nodeName];
    if (!nodeDef) continue;
    const names = extractValuesFromNode(nodeDef);
    for (const name of names) {
      models.push({ name, type: loaderType });
    }
  }
  return models;
}

// ─── Register Tools ──────────────────────────────────────────────────────────

/**
 * Registra i 4 tool di sistema sul server MCP.
 *
 * @param server Istanza McpServer su cui registrare i tool
 * @param deps   Dipendenze iniettate (comfyClient, defaultsManager opzionale)
 */
export function registerSystemTools(
  server: McpServer,
  deps: SystemDeps,
): void {
  const { comfyClient } = deps;

  // ─── Tool 1: list_models ────────────────────────────────────────────────

  server.tool(
    'list_models',
    'List installed models/checkpoints in ComfyUI',
    {
      type: z
        .enum(VALID_MODEL_TYPES)
        .optional()
        .describe('Optional filter: checkpoints, loras, vae, controlnet, embeddings, unet'),
    },
    async (args) => {
      try {
        const filterType = args.type;

        // Caso speciale: embeddings (usa API dedicata)
        if (filterType === 'embeddings') {
          const embeddings = await comfyClient.getEmbeddings();
          return {
            content: [
              {
                type: TEXT_TYPE,
                text: JSON.stringify({
                  models: embeddings.map((name) => ({ name, type: 'embeddings' })),
                }),
              },
            ],
          };
        }

        // Per tutti gli altri tipi, usa objectInfo
        const objectInfo = await comfyClient.getObjectInfo();
        let models: Array<{ name: string; type: string }> = [];

        if (filterType) {
          // Filtra per tipo specifico
          models = getModelsFromObjectInfo(objectInfo, filterType);
        } else {
          // Nessun filtro → tutti i tipi (esclusi embeddings, che richiede chiamata separata)
          for (const t of ['checkpoints', 'loras', 'vae', 'controlnet', 'unet'] as const) {
            models.push(...getModelsFromObjectInfo(objectInfo, t));
          }
        }

        return {
          content: [
            {
              type: TEXT_TYPE,
              text: JSON.stringify({ models }),
            },
          ],
        };
      } catch (err) {
        if (err instanceof McpError) throw err;
        throw new McpError(
          ErrorCode.InternalError,
          `Failed to list models: ${(err as Error).message}`,
        );
      }
    },
  );

  // ─── Tool 2: get_system_stats ───────────────────────────────────────────

  server.tool(
    'get_system_stats',
    'Show ComfyUI system information (OS, Python version, devices, VRAM)',
    {},
    async () => {
      try {
        const stats = await comfyClient.getSystemStats();

        return {
          content: [
            {
              type: TEXT_TYPE,
              text: JSON.stringify({
                system: {
                  os: stats.system.os,
                  python_version: stats.system.python_version,
                  comfyui_version: stats.system.comfyui_version,
                },
                devices: stats.devices.map((d) => ({
                  name: d.name,
                  type: d.type,
                  vram_total: d.vram_total ?? 0,
                  vram_free: d.vram_free ?? 0,
                })),
                device_count: stats.devices.length,
              }),
            },
          ],
        };
      } catch (err) {
        if (err instanceof McpError) throw err;
        if (err instanceof ComfyUIConnectionError) {
          throw new McpError(
            ErrorCode.InternalError,
            `Cannot connect to ComfyUI: ${(err as Error).message}`,
          );
        }
        throw new McpError(
          ErrorCode.InternalError,
          `Failed to get system stats: ${(err as Error).message}`,
        );
      }
    },
  );

  // ─── Tool 3: get_defaults ───────────────────────────────────────────────

  server.tool(
    'get_defaults',
    'Show current default configuration values',
    {},
    async () => {
      return {
        content: [
          {
            type: TEXT_TYPE,
            text: JSON.stringify({
              defaults: deps.defaultsManager?.getDefaults() ?? {},
              note: 'Not yet implemented',
            }),
          },
        ],
      };
    },
  );

  // ─── Tool 4: set_defaults ───────────────────────────────────────────────

  server.tool(
    'set_defaults',
    'Set a default configuration value',
    {
      key: z.string().min(1, { error: 'key is required' }),
      value: z.any(),
      persist: z.boolean().optional().default(false),
    },
    async (args) => {
      try {
        if (deps.defaultsManager) {
          deps.defaultsManager.setDefault(args.key, args.value, args.persist);
          return {
            content: [
              {
                type: TEXT_TYPE,
                text: JSON.stringify({
                  updated: true,
                  message: `Default '${args.key}' set successfully`,
                }),
              },
            ],
          };
        }

        return {
          content: [
            {
              type: TEXT_TYPE,
              text: JSON.stringify({
                updated: false,
                message: 'Not yet implemented',
              }),
            },
          ],
        };
      } catch (err) {
        if (err instanceof McpError) throw err;
        throw new McpError(
          ErrorCode.InternalError,
          `Failed to set default: ${(err as Error).message}`,
        );
      }
    },
  );
}
