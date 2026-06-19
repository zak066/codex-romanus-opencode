/**
 * tools/benchmark-ingest.tool.ts
 * Tool MCP per importare risultati benchmark esterni in Tabularium.
 *
 * Riceve dati benchmark strutturati e li salva come metriche
 * nel database (domain="perf"), utilizzando il benchmark-bridge
 * per la normalizzazione del nome e il metrics-engine per lo storage.
 *
 * @module tools/benchmark-ingest
 */

import type { ToolHandler, ToolResult } from '../types/mcp.js';
import { snapshotBenchmark } from '../core/benchmark-bridge.js';

// ---------------------------------------------------------------------------
// Tool: tabularium_benchmark_ingest
// ---------------------------------------------------------------------------

export const benchmarkIngestToolHandler: ToolHandler = {
  name: 'tabularium_benchmark_ingest',
  description:
    'Importa risultati benchmark esterni in Tabularium. ' +
    'I dati vengono salvati come metriche di performance (domain="perf") ' +
    'e sono immediatamente disponibili per query, trend e report. ' +
    'Supporta tag opzionali per categorizzare i risultati.',
  inputSchema: {
    type: 'object',
    properties: {
      data: {
        type: 'object',
        description:
          'Dati del benchmark da importare. ' +
          'Oggetto singolo con testName, value, unit e tags opzionali.',
        properties: {
          testName: {
            type: 'string',
            description: 'Nome del test benchmark (es. "API /users latency")',
          },
          value: {
            type: 'number',
            description: 'Valore numerico misurato (es. 42.5)',
          },
          unit: {
            type: 'string',
            description:
              "Unità di misura (default: 'ms'). " +
              "Valori supportati: ms, s, ops/s, MB/s, KB, bytes, percent",
          },
          tags: {
            type: 'object',
            description:
              'Tag opzionali per categorizzare il benchmark. ' +
              'Esempio: { "scenario": "load-test", "env": "production" }',
            additionalProperties: { type: 'string' },
          },
        },
        required: ['testName', 'value'],
      },
    },
    required: ['data'],
  },

  handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
    try {
      // Validazione data
      if (!args.data || typeof args.data !== 'object') {
        return errorResult('data is required and must be an object');
      }

      // Accedi al database prima per assicurarci che sia inizializzato
      try {
        const { getDatabase } = await import('../core/database.js');
        getDatabase(); // Verifica connessione
      } catch {
        return errorResult('Database not initialized. Call initDatabase() first.');
      }

      const data = args.data as Record<string, unknown>;

      // Estrai campi
      const testName = data.testName;
      if (!testName || typeof testName !== 'string' || testName.trim().length === 0) {
        return errorResult('data.testName is required and must be a non-empty string');
      }

      const value = data.value;
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        return errorResult('data.value is required and must be a finite number');
      }

      const unit = data.unit && typeof data.unit === 'string' ? data.unit : 'ms';
      const tagsData = data.tags && typeof data.tags === 'object'
        ? data.tags as Record<string, string>
        : {};

      // Salva benchmark
      const metricId = snapshotBenchmark(testName, value, unit, tagsData);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                data: {
                  ingested: true,
                  testName,
                  value,
                  unit,
                  tags: tagsData,
                  metricId,
                  storedAt: new Date().toISOString(),
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
                error: 'BENCHMARK_INGEST_ERROR',
                message: `tabularium_benchmark_ingest failed: ${error instanceof Error ? error.message : String(error)}`,
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
