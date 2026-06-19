/**
 * tools/cache-metrics.tool.ts
 * Tool MCP per report metriche caching (hit/miss ratio, latenza, TTL, per-tipo).
 *
 * Legge metriche cache da cache-metrics collector e calcola statistiche
 * aggregate per tutte le cache registrate.
 *
 * @module tools/cache-metrics
 */

import type { ToolHandler, ToolResult } from '../types/mcp.js';
import { cacheMetrics } from '../core/cache-metrics.js';
import { openCodeCache, progressCache, decisionsCache } from '../core/cache.js';
import { fromCache } from '../core/cache-metrics.js';

// ---------------------------------------------------------------------------
// Tool: cache_metrics
// ---------------------------------------------------------------------------

export const cacheMetricsToolHandler: ToolHandler = {
  name: 'cache_metrics',
  description:
    'Report metriche caching (hit/miss ratio, latenza, TTL, per-tipo). ' +
    'Legge metriche cache da metrics_store e calcola statistiche ' +
    'per tutte le cache registrate.',
  inputSchema: {
    type: 'object',
    properties: {},
  },

  handler: async (): Promise<ToolResult> => {
    try {
      // Registra le cache built-in se non già registrate
      // Usa try-catch per evitare errori se già registrate
      try {
        cacheMetrics.register(fromCache('openCodeCache', openCodeCache));
      } catch {
        // Già registrata
      }
      try {
        cacheMetrics.register(fromCache('progressCache', progressCache));
      } catch {
        // Già registrata
      }
      try {
        cacheMetrics.register(fromCache('decisionsCache', decisionsCache));
      } catch {
        // Già registrata
      }

      // Raccogli report on-demand
      const report = await cacheMetrics.report();

      // Calcola statistiche aggregate
      const totalHits = report.caches.reduce((s, c) => s + c.snapshot.hits, 0);
      const totalMisses = report.caches.reduce((s, c) => s + c.snapshot.misses, 0);
      const totalSize = report.caches.reduce((s, c) => s + c.snapshot.size, 0);
      const overallHitRate = totalHits + totalMisses > 0
        ? Number(((totalHits / (totalHits + totalMisses)) * 100).toFixed(2))
        : 0;

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                data: {
                  timestamp: report.timestamp,
                  overall: {
                    totalCaches: report.caches.length,
                    totalHits,
                    totalMisses,
                    totalEvictions: report.caches.reduce((s, c) => s + c.snapshot.evictionCount, 0),
                    totalStaleHits: report.caches.reduce((s, c) => s + c.snapshot.staleHits, 0),
                    totalCoalesced: report.caches.reduce((s, c) => s + c.snapshot.coalescedFetches, 0),
                    totalSize,
                    overallHitRate,
                  },
                  caches: report.caches.map((c) => ({
                    name: c.name,
                    hitRate: c.hitRate,
                    size: c.snapshot.size,
                    hits: c.snapshot.hits,
                    misses: c.snapshot.misses,
                    staleHits: c.snapshot.staleHits,
                    evictions: c.snapshot.evictionCount,
                    coalescedFetches: c.snapshot.coalescedFetches,
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
                error: 'CACHE_METRICS_ERROR',
                message: `cache_metrics failed: ${error instanceof Error ? error.message : String(error)}`,
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
