/**
 * tools/query-profile.tool.ts
 * Tool MCP per profiling query SQL: EXPLAIN QUERY PLAN + timing esecuzione.
 *
 * Esegue EXPLAIN QUERY PLAN per analizzare il piano di esecuzione
 * di una query SQL, e opzionalmente esegue la query reale con timing
 * per misurare la latenza effettiva.
 *
 * @module tools/query-profile
 */

import type { ToolHandler, ToolResult } from '../types/mcp.js';
import { getDatabase } from '../core/database.js';

// ---------------------------------------------------------------------------
// Tool: tabularium_query_profile
// ---------------------------------------------------------------------------

export const queryProfileToolHandler: ToolHandler = {
  name: 'tabularium_query_profile',
  description:
    'Profiling query SQL con EXPLAIN QUERY PLAN e timing esecuzione. ' +
    'Analizza il piano di esecuzione per identificare colli di bottiglia, ' +
    'full table scan, mancanza di indici, e stima dei costi. ' +
    'Opzionalmente esegue anche la query reale con misurazione latenza.',
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description:
          'Query SQL da profilare. Può essere qualsiasi statement SELECT ' +
          'o DML supportato da SQLite. Non eseguire DROP/ALTER/DELETE senza WHERE.',
      },
      params: {
        type: 'array',
        description:
          'Parametri opzionali per query parametrizzate (posizionali). ' +
          'Esempio: ["value1", 42]',
        items: {
          type: 'object',
          description: 'Valore del parametro (stringa, numero, booleano o null)',
        },
      },
    },
    required: ['query'],
  },

  handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
    try {
      // Validazione query
      const query = args.query;
      if (!query || typeof query !== 'string' || query.trim().length === 0) {
        return errorResult('query is required and must be a non-empty string');
      }

      const trimmedQuery = query.trim();

      // Validazione sicurezza: blocca operazioni pericolose
      const dangerousPatterns = [
        /^\s*DROP\s/i,
        /^\s*ALTER\s/i,
        /^\s*TRUNCATE\s/i,
        /^\s*CREATE\s/i,
        /^\s*DELETE\s(?!FROM\s+\w+\s+WHERE)/i,
        /^\s*UPDATE\s(?!\w+\s+SET\s+.*\s+WHERE)/i,
        /^\s*INSERT\s/i,
        /^\s*REINDEX\s/i,
        /^\s*VACUUM/i,
        /^\s*PRAGMA/i,
      ];

      const isDangerous = dangerousPatterns.some((p) => p.test(trimmedQuery));
      if (isDangerous) {
        return errorResult(
          'Query non consentita: profiling supporta solo query SELECT sicure. ' +
          'Per DDL/DML usa i tool dedicati (db_maintenance, config_write).'
        );
      }

      // Leggi params
      let params: unknown[] = [];
      if (args.params !== undefined) {
        if (Array.isArray(args.params)) {
          params = args.params;
        } else {
          return errorResult('params must be an array of values');
        }
      }

      // Verifica database
      let db;
      try {
        db = getDatabase();
      } catch {
        return errorResult('Database not initialized. Call initDatabase() first.');
      }

      // 1. EXPLAIN QUERY PLAN
      const explainStart = performance.now();
      const planRows = db.prepare(`EXPLAIN QUERY PLAN ${trimmedQuery}`).all(...params) as Array<Record<string, unknown>>;
      const explainDuration = performance.now() - explainStart;

      // 2. Esegui la query reale con timing (solo SELECT)
      const isSelect = /^\s*SELECT\s/i.test(trimmedQuery);
      let executionResult: Record<string, unknown> | null = null;
      let queryDuration: number | null = null;

      if (isSelect) {
        try {
          const queryStart = performance.now();
          const resultSet = db.prepare(trimmedQuery).all(...params);
          queryDuration = performance.now() - queryStart;

          executionResult = {
            rowCount: Array.isArray(resultSet) ? resultSet.length : 0,
            durationMs: Number(queryDuration.toFixed(3)),
            sampleResults: Array.isArray(resultSet)
              ? resultSet.slice(0, 5) // Primi 5 risultati come sample
              : [],
            truncated: Array.isArray(resultSet) && resultSet.length > 5,
          };
        } catch (execError) {
          executionResult = {
            error: execError instanceof Error ? execError.message : String(execError),
            durationMs: null,
          };
        }
      }

      // Analizza piano per raccomandazioni
      const recommendations = analyzePlan(planRows, trimmedQuery);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                data: {
                  query: trimmedQuery,
                  params,
                  explain: {
                    plan: planRows.map((row: Record<string, unknown>) => ({
                      id: row.id,
                      parent: row.parent,
                      detail: row.detail,
                    })),
                    analysisTimeMs: Number(explainDuration.toFixed(3)),
                    totalPlanSteps: planRows.length,
                  },
                  execution: executionResult,
                  recommendations: recommendations.length > 0 ? recommendations : ['Query plan appears optimal'],
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
                error: 'QUERY_PROFILE_ERROR',
                message: `tabularium_query_profile failed: ${error instanceof Error ? error.message : String(error)}`,
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
// Analisi piano
// ---------------------------------------------------------------------------

/**
 * Analizza il piano EXPLAIN e produce raccomandazioni.
 *
 * Cerca pattern noti di performance:
 * - Full table scan (SCAN)
 * - Mancanza di indici
 * - Ordinamento costoso
 */
function analyzePlan(planRows: Array<Record<string, unknown>>, query: string): string[] {
  const recommendations: string[] = [];
  const details = planRows
    .map((r) => String(r.detail ?? ''))
    .filter(Boolean);

  let scanCount = 0;
  let searchCount = 0;

  for (const detail of details) {
    if (detail.includes('SCAN')) {
      scanCount++;
    }
    if (detail.includes('SEARCH')) {
      searchCount++;
    }
  }

  // Se tutte le tabelle sono SCAN, suggerisci indici
  if (searchCount === 0 && scanCount > 0) {
    recommendations.push(
      'Potential performance issue: all table accesses use SCAN (full table scan). ' +
      'Consider adding indexes on columns used in WHERE clauses.'
    );
  }

  // Cerca pattern specifici
  if (/SCAN\s+\w+\s+USING\s+COVERING\s+INDEX/i.test(details.join(' '))) {
    recommendations.push('Good: some queries use covering indexes (no data table access needed).');
  }

  return recommendations;
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
