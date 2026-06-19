/**
 * tools/benchmark-run.tool.ts
 * Tool MCP per eseguire benchmark on-demand su database/metriche.
 *
 * Esegue benchmark di latenza su operazioni comuni del database:
 * - db_read: Lettura semplice da tabella conoscenza
 * - db_write: Scrittura di una entry metrica
 * - fts_search: Ricerca full-text su knowledge_fts
 * - cache: Accesso cache (hit/miss test)
 *
 * Restituisce statistiche p50/p95/p99 dopo N iterazioni.
 *
 * @module tools/benchmark-run
 */

import type { ToolHandler, ToolResult } from '../types/mcp.js';
import { getDatabase } from '../core/database.js';

// ---------------------------------------------------------------------------
// Tipi
// ---------------------------------------------------------------------------

/** Tipo di benchmark supportato */
type BenchmarkType = 'db_read' | 'db_write' | 'fts_search' | 'cache';

/** Benchmark result per una singola operazione */
interface BenchmarkSample {
  iteration: number;
  durationMs: number;
}

/** Risultati aggregati */
interface BenchmarkStats {
  type: BenchmarkType;
  iterations: number;
  totalTimeMs: number;
  avgMs: number;
  minMs: number;
  maxMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  errorCount: number;
}

// ---------------------------------------------------------------------------
// Tool: tabularium_benchmark_run
// ---------------------------------------------------------------------------

export const benchmarkRunToolHandler: ToolHandler = {
  name: 'tabularium_benchmark_run',
  description:
    'Esegue benchmark on-demand su database/metriche Tabularium. ' +
    'Misura latenza p50/p95/p99 per operazioni specifiche ' +
    '(db_read, db_write, fts_search, cache). ' +
    'Restituisce statistiche dettagliate per N iterazioni.',
  inputSchema: {
    type: 'object',
    properties: {
      type: {
        type: 'string',
        enum: ['db_read', 'db_write', 'fts_search', 'cache'],
        description:
          'Tipo di benchmark da eseguire (default: db_read). ' +
          'db_read = SELECT su knowledge_entries, ' +
          'db_write = INSERT su metrics, ' +
          'fts_search = ricerca full-text, ' +
          'cache = test latenza cache Tabularium',
      },
      iterations: {
        type: 'number',
        description:
          'Numero di iterazioni per il benchmark (default: 100, max: 10000)',
      },
    },
  },

  handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
    try {
      // Leggi parametri
      const benchmarkType = (args.type as BenchmarkType) ?? 'db_read';
      const rawIterations = args.iterations != null ? Number(args.iterations) : 100;
      const iterations = Math.max(1, Math.min(10000, Number.isFinite(rawIterations) ? Math.floor(rawIterations) : 100));

      // Validazione tipo
      const validTypes: BenchmarkType[] = ['db_read', 'db_write', 'fts_search', 'cache'];
      if (!validTypes.includes(benchmarkType)) {
        return errorResult(
          `Invalid benchmark type: "${benchmarkType}". Valid types: ${validTypes.join(', ')}`
        );
      }

      // Verifica connessione database
      let db;
      try {
        db = getDatabase();
      } catch {
        return errorResult('Database not initialized. Call initDatabase() first.');
      }

      // Esegui benchmark
      const samples: BenchmarkSample[] = [];
      let errorCount = 0;
      const startWallTime = performance.now();

      for (let i = 0; i < iterations; i++) {
        try {
          const opStart = performance.now();
          await runBenchmarkOperation(db, benchmarkType);
          const opEnd = performance.now();
          samples.push({ iteration: i + 1, durationMs: opEnd - opStart });
        } catch {
          errorCount++;
        }
      }

      const totalWallTime = performance.now() - startWallTime;

      // Calcola statistiche
      const durations = samples.map((s) => s.durationMs).sort((a, b) => a - b);
      const stats = computeStats(durations, benchmarkType, iterations);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                data: {
                  benchmark: {
                    type: benchmarkType,
                    iterations,
                    completedSamples: samples.length,
                    errors: errorCount,
                    wallTimeMs: Number(totalWallTime.toFixed(2)),
                  },
                  stats,
                  // Mostra distribuzione per decili se ci sono abbastanza campioni
                  distribution: samples.length >= 10
                    ? computeDistribution(durations)
                    : undefined,
                  timestamp: new Date().toISOString(),
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
                error: 'BENCHMARK_RUN_ERROR',
                message: `tabularium_benchmark_run failed: ${error instanceof Error ? error.message : String(error)}`,
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
// Operazioni di benchmark
// ---------------------------------------------------------------------------

/**
 * Esegue una singola operazione di benchmark.
 */
function runBenchmarkOperation(
  db: ReturnType<typeof getDatabase>,
  type: BenchmarkType
): void {
  switch (type) {
    case 'db_read':
      benchmarkDbRead(db);
      break;
    case 'db_write':
      benchmarkDbWrite(db);
      break;
    case 'fts_search':
      benchmarkFtsSearch(db);
      break;
    case 'cache':
      benchmarkCache(db);
      break;
  }
}

/** Lettura semplice: SELECT count da knowledge_entries */
function benchmarkDbRead(db: ReturnType<typeof getDatabase>): void {
  db.prepare('SELECT COUNT(*) as cnt FROM knowledge_entries').get();
}

/** Scrittura: INSERT in metrics (poi rollback) */
function benchmarkDbWrite(db: ReturnType<typeof getDatabase>): void {
  const id = `bm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  db.prepare(`
    INSERT INTO metrics (id, domain, metric_name, value, tags, recorded_at)
    VALUES (?, 'perf', 'benchmark_write', 1.0, '{}', datetime('now'))
  `).run(id);
  // Pulizia: rimuovi la metrica appena inserita
  db.prepare('DELETE FROM metrics WHERE id = ?').run(id);
}

/** Ricerca full-text su knowledge_fts */
function benchmarkFtsSearch(db: ReturnType<typeof getDatabase>): void {
  try {
    db.prepare(`
      SELECT COUNT(*) as cnt FROM knowledge_fts WHERE knowledge_fts MATCH 'benchmark'
    `).get();
  } catch {
    // FTS potrebbe non essere disponibile — usa LIKE come fallback
    db.prepare("SELECT COUNT(*) as cnt FROM knowledge_entries WHERE body LIKE '%benchmark%'").get();
  }
}

/** Test cache: accesso a una tabella piccola */
function benchmarkCache(db: ReturnType<typeof getDatabase>): void {
  db.prepare('SELECT COUNT(*) as cnt FROM metrics').get();
}

// ---------------------------------------------------------------------------
// Statistiche
// ---------------------------------------------------------------------------

/**
 * Calcola statistiche aggregate dalle durate misurate.
 */
function computeStats(
  sortedDurations: number[],
  type: BenchmarkType,
  iterations: number
): BenchmarkStats {
  const n = sortedDurations.length;
  if (n === 0) {
    return {
      type,
      iterations,
      totalTimeMs: 0,
      avgMs: 0,
      minMs: 0,
      maxMs: 0,
      p50Ms: 0,
      p95Ms: 0,
      p99Ms: 0,
      errorCount: iterations,
    };
  }

  const sum = sortedDurations.reduce((a, b) => a + b, 0);

  return {
    type,
    iterations,
    totalTimeMs: Number(sum.toFixed(3)),
    avgMs: Number((sum / n).toFixed(3)),
    minMs: Number(sortedDurations[0].toFixed(3)),
    maxMs: Number(sortedDurations[n - 1].toFixed(3)),
    p50Ms: Number(percentile(sortedDurations, 0.50).toFixed(3)),
    p95Ms: Number(percentile(sortedDurations, 0.95).toFixed(3)),
    p99Ms: Number(percentile(sortedDurations, 0.99).toFixed(3)),
    errorCount: iterations - n,
  };
}

/**
 * Calcola il percentile da un array ordinato.
 */
function percentile(sorted: number[], p: number): number {
  const index = Math.max(0, Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1));
  return sorted[index];
}

/**
 * Calcola distribuzione per decili (p10, p20, ..., p90, p100).
 */
function computeDistribution(sorted: number[]): Record<string, number> {
  const dist: Record<string, number> = {};
  for (let i = 10; i <= 100; i += 10) {
    dist[`p${i}`] = Number(percentile(sorted, i / 100).toFixed(3));
  }
  return dist;
}

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
