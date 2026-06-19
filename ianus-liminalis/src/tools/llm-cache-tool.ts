/**
 * llm-cache-tool — Ianus Liminalis
 *
 * MCP tool registration for the two-layer LLM response cache (ADR-006).
 * Provides: llm_get, llm_set, llm_invalidate, llm_invalidate_model,
 *          llm_clear, llm_stats
 *
 * Registered as a standalone tool "llm_cache" (separate from fs_cache).
 */

import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { toolRegistry } from './registry.js';
import type { ToolDeps } from './types.js';
import { getLLMCache } from '../core/llm-cache.js';

export function registerLLMCacheTool(_server: Server, deps: ToolDeps): void {
  const llmCache = getLLMCache(deps.workspaceRoot);

  toolRegistry.register({
    name: 'llm_cache',
    description:
      'Two-layer LLM response cache (L1 memory + L2 file). ' +
      'Key convention: "model::prompt" — use "model" for model-scoped operations. ' +
      'Actions: llm_get, llm_set, llm_invalidate, llm_invalidate_model, ' +
      'llm_clear, llm_stats. ' +
      'L1: in-memory LRU, 10K max entries, 5 min TTL. ' +
      'L2: JSONL file-based (.ianus-cache/llm/), 24 h TTL.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: [
            'llm_get',
            'llm_set',
            'llm_invalidate',
            'llm_invalidate_model',
            'llm_clear',
            'llm_stats',
          ],
          description:
            'llm_get — retrieve value by key from cache\n' +
            'llm_set — store key/value pair in cache\n' +
            'llm_invalidate — remove a specific key from cache\n' +
            'llm_invalidate_model — remove all entries for a model\n' +
            'llm_clear — clear all cached data\n' +
            'llm_stats — return cache statistics',
        },
        key: {
          type: 'string',
          description:
            'Cache key. Convention: "model::prompt" where "model" is the ' +
            'model name (e.g., "gpt-4::What is..."). Required for ' +
            'llm_get, llm_set, llm_invalidate.',
        },
        value: {
          type: 'string',
          description: 'String value to cache (required for llm_set)',
        },
        model: {
          type: 'string',
          description: 'Model name for model-scoped invalidation ' +
            '(required for llm_invalidate_model)',
        },
      },
      required: ['action'],
    },
    handler: async (args: Record<string, unknown>) => {
      const action = args.action as string;

      switch (action) {
        // ── llm_get ──────────────────────────────────────
        case 'llm_get': {
          const key = args.key as string | undefined;
          if (!key) {
            return {
              content: [
                {
                  type: 'text',
                  text: 'Missing required parameter: "key"',
                },
              ],
              isError: true,
            };
          }
          const value = await llmCache.get(key);
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  action: 'llm_get',
                  key,
                  hit: value !== null,
                  value,
                }),
              },
            ],
          };
        }

        // ── llm_set ──────────────────────────────────────
        case 'llm_set': {
          const key = args.key as string | undefined;
          const value = args.value as string | undefined;
          if (!key) {
            return {
              content: [
                {
                  type: 'text',
                  text: 'Missing required parameter: "key"',
                },
              ],
              isError: true,
            };
          }
          if (!value) {
            return {
              content: [
                {
                  type: 'text',
                  text: 'Missing required parameter: "value"',
                },
              ],
              isError: true,
            };
          }
          await llmCache.set(key, value);
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({ action: 'llm_set', key }),
              },
            ],
          };
        }

        // ── llm_invalidate ───────────────────────────────
        case 'llm_invalidate': {
          const key = args.key as string | undefined;
          if (!key) {
            return {
              content: [
                {
                  type: 'text',
                  text: 'Missing required parameter: "key"',
                },
              ],
              isError: true,
            };
          }
          llmCache.invalidate(key);
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({ action: 'llm_invalidate', key }),
              },
            ],
          };
        }

        // ── llm_invalidate_model ─────────────────────────
        case 'llm_invalidate_model': {
          const model = args.model as string | undefined;
          if (!model) {
            return {
              content: [
                {
                  type: 'text',
                  text: 'Missing required parameter: "model"',
                },
              ],
              isError: true,
            };
          }
          llmCache.invalidateModel(model);
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  action: 'llm_invalidate_model',
                  model,
                }),
              },
            ],
          };
        }

        // ── llm_clear ────────────────────────────────────
        case 'llm_clear': {
          llmCache.clear();
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({ action: 'llm_clear', cleared: true }),
              },
            ],
          };
        }

        // ── llm_stats ────────────────────────────────────
        case 'llm_stats': {
          const stats = llmCache.getStats();
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(stats),
              },
            ],
          };
        }

        default:
          return {
            content: [
              {
                type: 'text',
                text:
                  `Unknown llm_cache action: "${action}". ` +
                  'Use: llm_get, llm_set, llm_invalidate, ' +
                  'llm_invalidate_model, llm_clear, llm_stats',
              },
            ],
            isError: true,
          };
      }
    },
  });
}
