/**
 * Generation Tools — Tool MCP per generazione, rigenerazione e
 * visualizzazione di immagini ComfyUI.
 *
 * Fase 5 (F5): espone 3 tool handler MCP:
 * - generate_image: genera un'immagine eseguendo un workflow template
 * - regenerate: rigenera un job da un prompt_id esistente
 * - view_image: ottiene una thumbnail WebP di un'immagine generata
 *
 * Pattern: Bridge + Adapter — i tool traducono chiamate MCP in operazioni
 * sul dominio ComfyUI tramite dipendenze iniettate.
 */

import { z } from 'zod';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ComfyClient } from '../comfyui/client.js';
import type { WorkflowManager } from '../services/workflow-manager.js';
import type { AssetRegistry } from '../services/asset-registry.js';
import type { ImageHandler } from '../services/image-handler.js';
import type { WorkflowNode, Output, OutputImage } from '../comfyui/types.js';
import { info, error as logError } from '../utils/logger.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface GenerationDeps {
  comfyClient: ComfyClient;
  workflowManager: WorkflowManager;
  assetRegistry?: AssetRegistry;
  imageHandler?: ImageHandler;
}

interface ImageResult {
  asset_id: string | null;
  filename: string;
  thumbnail: string;
  width: number;
  height: number;
  format: string;
  size: number;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const TEXT_TYPE = 'text' as const;
const POLL_INTERVAL_MS = 1000;
const POLL_TIMEOUT_MS = 120_000;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Polling loop: ogni secondo interroga ComfyClient.getHistory() finché
 * il job non risulta completato o scade il timeout.
 *
 * @param comfyClient Istanza del client ComfyUI
 * @param promptId    ID del prompt da monitorare
 * @param timeoutMs   Timeout massimo in millisecondi (default: 120s)
 * @returns           Output del job completato
 * @throws McpError   Se scade il timeout
 */
async function pollForCompletion(
  comfyClient: ComfyClient,
  promptId: string,
  timeoutMs: number = POLL_TIMEOUT_MS,
): Promise<{ outputs: Record<string, Output> }> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

    const history = await comfyClient.getHistory(promptId);
    const entry = history[promptId];

    if (entry?.status?.completed) {
      return { outputs: entry.outputs ?? {} };
    }
  }

  throw new McpError(
    ErrorCode.InternalError,
    `Job ${promptId} timed out after ${timeoutMs / 1000}s`,
  );
}

/**
 * Itera su tutti gli output del job, estrae le immagini e per ognuna:
 * scarica, processa (thumbnail WebP), e registra in AssetRegistry.
 *
 * @param deps         Dipendenze del tool
 * @param outputs      Output map dalla history di ComfyUI
 * @param promptId     ID del prompt (per provenance)
 * @param workflowType Tipo di workflow (per provenance)
 * @returns            Array di risultati immagine
 */
async function processOutputImages(
  deps: GenerationDeps,
  outputs: Record<string, Output>,
  promptId: string,
  workflowType: string,
): Promise<ImageResult[]> {
  const results: ImageResult[] = [];

  for (const nodeOutput of Object.values(outputs)) {
    if (!nodeOutput.images || nodeOutput.images.length === 0) continue;

    for (const img of nodeOutput.images) {
      try {
        const result = await downloadAndProcessImage(
          deps,
          img,
          promptId,
          workflowType,
        );
        results.push(result);
      } catch (err) {
        logError('Failed to process output image', {
          filename: img.filename,
          subfolder: img.subfolder,
          error: (err as Error).message,
        });
        // Salta l'immagine problematica e continua con le altre
      }
    }
  }

  return results;
}

/**
 * Scarica un'immagine da ComfyUI, la processa in thumbnail WebP,
 * ne ricava metadati e la registra in AssetRegistry.
 *
 * @param deps         Dipendenze
 * @param img          OutputImage (filename, subfolder, type)
 * @param promptId     Prompt ID per provenance
 * @param workflowType Workflow type per provenance
 * @returns            ImageResult strutturato
 */
async function downloadAndProcessImage(
  deps: GenerationDeps,
  img: OutputImage,
  promptId: string,
  workflowType: string,
): Promise<ImageResult> {
  // 1. Download del file immagine da ComfyUI
  const arrayBuffer = await deps.comfyClient.getView(
    img.filename,
    img.subfolder,
    img.type,
  );
  const imageBuffer = Buffer.from(arrayBuffer);

  // 2. Lettura metadati originali (dimensioni, formato)
  let width = 0;
  let height = 0;
  let format = 'png';
  let size = imageBuffer.length;

  if (deps.imageHandler) {
    try {
      const imageInfo = await deps.imageHandler.getImageInfo(imageBuffer);
      width = imageInfo.width;
      height = imageInfo.height;
      format = imageInfo.format;
      size = imageInfo.size;
    } catch {
      // Fallback ai valori predefiniti
    }
  }

  // 3. Processing thumbnail WebP
  let thumbnailUri = '';
  if (deps.imageHandler) {
    try {
      const processed = await deps.imageHandler.processImage(imageBuffer);
      thumbnailUri = deps.imageHandler.toDataUri(
        processed.data,
        processed.mimeType,
      );
    } catch {
      // Thumbnail non disponibile, si procede senza
    }
  }

  // 4. Registrazione in AssetRegistry
  let assetId: string | null = null;
  if (deps.assetRegistry) {
    try {
      const asset = deps.assetRegistry.registerAsset(
        {
          filename: img.filename,
          subfolder: img.subfolder,
          type: img.type,
          width,
          height,
          fileSize: size,
          promptId,
        },
        {
          workflowId: workflowType,
          promptId,
          createdAt: new Date(),
        },
      );
      assetId = asset.id;
    } catch {
      // Registrazione fallita, si prosegue senza asset_id
    }
  }

  return {
    asset_id: assetId,
    filename: img.filename,
    thumbnail: thumbnailUri,
    width,
    height,
    format,
    size,
  };
}

// ─── Register Tools ──────────────────────────────────────────────────────────

/**
 * Registra i 3 tool di generazione immagini sul server MCP.
 *
 * @param server Istanza McpServer su cui registrare i tool
 * @param deps   Dipendenze iniettate
 */
export function registerGenerationTools(
  server: McpServer,
  deps: GenerationDeps,
): void {
  const { comfyClient, workflowManager } = deps;

  // ─── Tool 1: generate_image ──────────────────────────────────────

  server.tool(
    'generate_image',
    'Generate an image by executing a ComfyUI workflow template (txt2img, img2img, or upscale) with specified parameters',
    {
      workflow: z
        .enum(['txt2img', 'img2img', 'upscale'])
        .describe('Workflow template to execute'),
      params: z
        .record(z.unknown())
        .optional()
        .describe(
          'Optional parameters. Flat key-value pairs resolve PARAM_* placeholders; ' +
            'node-level objects (e.g., { "3": { inputs: { seed: 42 } } }) apply direct node overrides.',
        ),
      wait: z
        .boolean()
        .optional()
        .default(true)
        .describe(
          'If true, poll until completion (default). If false, return immediately after queuing.',
        ),
    },
    async (args) => {
      try {
        const workflowType = args.workflow;
        const params = args.params ?? {};
        const wait = args.wait;

        // ── 1. Ottieni template ──────────────────────────────────
        const definition = workflowManager.getWorkflow(workflowType);
        if (!definition) {
          throw new McpError(
            ErrorCode.InvalidParams,
            `Workflow template '${workflowType}' not found. ` +
              'Ensure templates are loaded before use.',
          );
        }

        // ── 2. Resolve PARAM_* placeholders ──────────────────────
        let rendered: Record<string, WorkflowNode>;
        try {
          rendered = await workflowManager.renderWorkflow(workflowType, params);
        } catch (renderErr) {
          throw new McpError(
            ErrorCode.InvalidParams,
            `Failed to render workflow: ${(renderErr as Error).message}`,
          );
        }

        // ── 3. Applica node-level overrides ──────────────────────
        if (Object.keys(params).length > 0) {
          rendered = workflowManager.applyOverrides(
            rendered,
            params as Record<string, Partial<WorkflowNode>>,
          );
        }

        // ── 4. Valida ────────────────────────────────────────────
        const validation = workflowManager.validateWorkflow(rendered);
        if (!validation.valid) {
          throw new McpError(
            ErrorCode.InvalidParams,
            `Workflow validation failed: ${validation.errors.map((e) => e.message).join('; ')}`,
          );
        }

        // ── 5. Estrai parametri per descrizione prompt ───────────
        const parsedParams = workflowManager.parseParameters(rendered);
        info('Template parameters resolved', {
          workflow: workflowType,
          paramCount: parsedParams.length,
        });

        // ── 6. Invia a ComfyUI ───────────────────────────────────
        info('Queueing workflow', { workflow: workflowType });
        const response = await comfyClient.queuePrompt(rendered);
        const promptId = response.prompt_id;

        // ── 7. Modalità fire-and-forget (wait=false) ─────────────
        if (!wait) {
          return {
            content: [
              {
                type: TEXT_TYPE,
                text: JSON.stringify({
                  prompt_id: promptId,
                  status: 'queued',
                  images: [],
                }),
              },
            ],
          };
        }

        // ── 8. Polling fino al completamento ─────────────────────
        const { outputs } = await pollForCompletion(comfyClient, promptId);

        // ── 9. Processa le immagini di output ────────────────────
        const images = await processOutputImages(
          deps,
          outputs,
          promptId,
          workflowType,
        );

        info('Image generation completed', {
          prompt_id: promptId,
          images_count: images.length,
        });

        return {
          content: [
            {
              type: TEXT_TYPE,
              text: JSON.stringify({
                prompt_id: promptId,
                status: 'completed',
                images,
              }),
            },
          ],
        };
      } catch (err) {
        if (err instanceof McpError) throw err;
        logError('Image generation failed', {
          error: (err as Error).message,
        });
        throw new McpError(
          ErrorCode.InternalError,
          `Image generation failed: ${(err as Error).message}`,
        );
      }
    },
  );

  // ─── Tool 2: regenerate ─────────────────────────────────────────

  server.tool(
    'regenerate',
    'Regenerate a previously executed job from its prompt_id with optional parameter overrides',
    {
      prompt_id: z
        .string()
        .min(1, { error: 'prompt_id is required' })
        .describe('Prompt ID of the job to regenerate'),
      params: z
        .record(z.unknown())
        .optional()
        .describe(
          'Optional parameter overrides to apply on top of the original job',
        ),
      wait: z
        .boolean()
        .optional()
        .default(true)
        .describe(
          'If true, poll until completion (default). If false, return immediately after queuing.',
        ),
    },
    async (args) => {
      try {
        const { prompt_id, wait } = args;
        const params = args.params ?? {};

        // ── 1. Recupera history del job originale ─────────────────
        const history = await comfyClient.getHistory(prompt_id);
        const entry = history[prompt_id];

        if (!entry) {
          throw new McpError(
            ErrorCode.InvalidParams,
            `Job not found: ${prompt_id}`,
          );
        }

        // ── 2. Estrai workflow originale dalla history ────────────
        const originalWorkflow = entry.prompt as Record<string, WorkflowNode>;

        // ── 3. Applica nuovi override ─────────────────────────────
        let rendered = originalWorkflow;
        if (Object.keys(params).length > 0) {
          rendered = workflowManager.applyOverrides(
            rendered,
            params as Record<string, Partial<WorkflowNode>>,
          );
        }

        // ── 4. Valida ────────────────────────────────────────────
        const validation = workflowManager.validateWorkflow(rendered);
        if (!validation.valid) {
          throw new McpError(
            ErrorCode.InvalidParams,
            `Workflow validation failed: ${validation.errors.map((e) => e.message).join('; ')}`,
          );
        }

        // ── 5. Invia a ComfyUI ───────────────────────────────────
        info('Regenerating workflow', {
          original_prompt_id: prompt_id,
          param_overrides: Object.keys(params).length > 0,
        });
        const response = await comfyClient.queuePrompt(rendered);
        const newPromptId = response.prompt_id;

        // ── 6. Modalità fire-and-forget ──────────────────────────
        if (!wait) {
          return {
            content: [
              {
                type: TEXT_TYPE,
                text: JSON.stringify({
                  prompt_id: newPromptId,
                  status: 'queued',
                  images: [],
                }),
              },
            ],
          };
        }

        // ── 7. Polling fino al completamento ─────────────────────
        const { outputs } = await pollForCompletion(comfyClient, newPromptId);

        // ── 8. Processa le immagini di output ────────────────────
        const images = await processOutputImages(
          deps,
          outputs,
          newPromptId,
          'regenerated',
        );

        info('Regeneration completed', {
          original_prompt_id: prompt_id,
          new_prompt_id: newPromptId,
          images_count: images.length,
        });

        return {
          content: [
            {
              type: TEXT_TYPE,
              text: JSON.stringify({
                prompt_id: newPromptId,
                status: 'completed',
                images,
              }),
            },
          ],
        };
      } catch (err) {
        if (err instanceof McpError) throw err;
        logError('Regeneration failed', {
          original_prompt_id: args.prompt_id,
          error: (err as Error).message,
        });
        throw new McpError(
          ErrorCode.InternalError,
          `Regeneration failed: ${(err as Error).message}`,
        );
      }
    },
  );

  // ─── Tool 3: view_image ─────────────────────────────────────────

  server.tool(
    'view_image',
    'Get a WebP thumbnail of a generated image by asset_id or filename/subfolder pair',
    {
      asset_id: z
        .string()
        .optional()
        .describe('Asset ID from a previous generate_image/regenerate response'),
      filename: z
        .string()
        .optional()
        .describe('Filename of the image (e.g., ComfyUI_00001_.png)'),
      subfolder: z
        .string()
        .optional()
        .default('')
        .describe('Subfolder within ComfyUI output (default: "")'),
      width: z
        .number()
        .optional()
        .default(256)
        .describe('Thumbnail max width (default: 256)'),
      height: z
        .number()
        .optional()
        .default(256)
        .describe('Thumbnail max height (default: 256)'),
      quality: z
        .number()
        .optional()
        .default(60)
        .describe('WebP quality 1-100 (default: 60)'),
    },
    async (args) => {
      try {
        let filename: string | undefined = args.filename;
        let subfolder = args.subfolder ?? '';
        let type: 'output' | 'input' | 'temp' = 'output';

        // ── 1. Se asset_id fornito, cerca nel registro ──────────
        if (args.asset_id) {
          if (deps.assetRegistry) {
            const asset = deps.assetRegistry.getAsset(args.asset_id);
            if (asset) {
              filename = asset.identity.filename;
              subfolder = asset.identity.subfolder;
              type = asset.identity.type;
            }
          }
          // Se asset_id non è stato risolto (registry assente o asset non trovato),
          // continua con filename/subfolder espliciti
        }

        // ── 2. Deve esserci un filename a questo punto ──────────
        if (!filename) {
          throw new McpError(
            ErrorCode.InvalidParams,
            'Provide asset_id or filename',
          );
        }

        // ── 3. Scarica immagine da ComfyUI ──────────────────────
        const arrayBuffer = await comfyClient.getView(
          filename,
          subfolder,
          type,
        );
        const imageBuffer = Buffer.from(arrayBuffer);

        // ── 4. Processa thumbnail WebP ──────────────────────────
        let thumbnailUri = '';
        let finalWidth = args.width ?? 256;
        let finalHeight = args.height ?? 256;

        if (deps.imageHandler) {
          const processed = await deps.imageHandler.processImage(imageBuffer, {
            maxWidth: finalWidth,
            maxHeight: finalHeight,
            quality: args.quality ?? 60,
            format: 'webp',
          });
          thumbnailUri = deps.imageHandler.toDataUri(
            processed.data,
            processed.mimeType,
          );
          finalWidth = processed.width;
          finalHeight = processed.height;
        }

        return {
          content: [
            {
              type: TEXT_TYPE,
              text: JSON.stringify({
                asset_id: args.asset_id ?? null,
                filename,
                thumbnail: thumbnailUri,
                width: finalWidth,
                height: finalHeight,
              }),
            },
          ],
        };
      } catch (err) {
        if (err instanceof McpError) throw err;
        logError('Failed to view image', {
          error: (err as Error).message,
        });
        throw new McpError(
          ErrorCode.InternalError,
          `Failed to view image: ${(err as Error).message}`,
        );
      }
    },
  );
}
