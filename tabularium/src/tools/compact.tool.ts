/**
 * tools/compact.tool.ts
 * Tool MCP per memory compact (MCP² Phase 2 — COMPACT).
 *
 * Implementa il tool `tabularium_memory_compact` che condensa eventi
 * recenti in knowledge entries tramite knowledge_suggest, rileva FAQ
 * tramite faq_detect, crea snapshot post-compact e traccia metriche.
 *
 * Safe guards assolute:
 *   - MAI cancellare eventi (quello e' compito di PURGE)
 *   - MAI toccare knowledge entries esistenti
 *   - MAI modificare ADR / metriche esistenti
 *   - dry-run obbligatorio di default
 *
 * Flow:
 *   1. validateParams — validazione parametri
 *   2. getNextCompactId → compact_id incrementale
 *   3. countEventsForCompact + countKnowledgeEntries
 *   4. [dryRun] → REPORT (conteggi, stima, NO scritture)
 *   5. [dryRun=false] → EXECUTE: suggestKnowledge + faqDetect + snapshot + metriche + journal
 *
 * @module tools/compact
 */

import type { ToolHandler, ToolResult } from '../types/mcp.js';
import {
  countEventsForCompact,
  countKnowledgeEntries,
  getDatabaseSizeKb,
  getNextCompactId,
  getTotalEventCount,
  logCompactRecord,
} from '../core/db-compact.js';
import { suggestKnowledge } from '../core/knowledge-manager.js';
import { detectFaqCandidates, generateFaqFromCandidate } from '../core/faq-manager.js';
import { storeMetric } from '../core/metrics-engine.js';
import { logChange } from '../core/file-journal.js';
import { validateAgentName } from '../messaging/agent-validator.js';

// ---------------------------------------------------------------------------
// Costanti
// ---------------------------------------------------------------------------

const MIN_OLDER_THAN = 1;
const MAX_OLDER_THAN = 365;
const MIN_KNOWLEDGE_LIMIT = 1;
const MAX_KNOWLEDGE_LIMIT = 50;
const DEFAULT_OLDER_THAN = 7;
const DEFAULT_KNOWLEDGE_LIMIT = 10;
const DEFAULT_CREATE_SNAPSHOT = true;
const DEFAULT_DRY_RUN = true;
const DEFAULT_AUTO_MODE = false;

// ---------------------------------------------------------------------------
// Helper: validazione parametri
// ---------------------------------------------------------------------------

/**
 * Valida i parametri di input del tool.
 * Restituisce un messaggio di errore se la validazione fallisce, null se OK.
 *
 * @param args - Parametri grezzi dal chiamante MCP
 * @returns Messaggio di errore o null
 */
function validateParams(args: Record<string, unknown>): string | null {
  // olderThan: intero ≥ 1 e ≤ 365
  if (args.olderThan !== undefined) {
    const olderThan = Number(args.olderThan);
    if (!Number.isInteger(olderThan) || olderThan < MIN_OLDER_THAN || olderThan > MAX_OLDER_THAN) {
      return `olderThan must be an integer between ${MIN_OLDER_THAN} and ${MAX_OLDER_THAN}`;
    }
  }

  // knowledgeLimit: intero ≥ 1 e ≤ 50
  if (args.knowledgeLimit !== undefined) {
    const limit = Number(args.knowledgeLimit);
    if (!Number.isInteger(limit) || limit < MIN_KNOWLEDGE_LIMIT || limit > MAX_KNOWLEDGE_LIMIT) {
      return `knowledgeLimit must be an integer between ${MIN_KNOWLEDGE_LIMIT} and ${MAX_KNOWLEDGE_LIMIT}`;
    }
  }

  // createSnapshot: booleano
  if (args.createSnapshot !== undefined && typeof args.createSnapshot !== 'boolean') {
    return 'createSnapshot must be a boolean';
  }

  // autoMode: booleano
  if (args.autoMode !== undefined && typeof args.autoMode !== 'boolean') {
    return 'autoMode must be a boolean';
  }

  // dryRun: booleano
  if (args.dryRun !== undefined && typeof args.dryRun !== 'boolean') {
    return 'dryRun must be a boolean';
  }

  // agent: validazione formato con validateAgentName
  if (args.agent !== undefined) {
    if (typeof args.agent !== 'string') {
      return 'agent must be a string';
    }
    const agentErr = validateAgentName(String(args.agent));
    if (agentErr) return agentErr;
  }

  return null; // OK
}

// ---------------------------------------------------------------------------
// Helper: errore
// ---------------------------------------------------------------------------

/**
 * Crea un ToolResult di errore per validazione fallita.
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
          2,
        ),
      },
    ],
    isError: true,
  };
}

// ---------------------------------------------------------------------------
// Tool Handler
// ---------------------------------------------------------------------------

export const memoryCompactToolHandler: ToolHandler = {
  name: 'tabularium_memory_compact',
  description:
    'Condensa eventi recenti in knowledge entries con knowledge_suggest e ' +
    'faq_detect, crea snapshot post-compact e traccia metriche. ' +
    'Safe guards: MAI cancella eventi/knowledge/ADR/metriche, ' +
    'dry-run obbligatorio di default, createSnapshot=true di default.',
  inputSchema: {
    type: 'object',
    properties: {
      olderThan: {
        type: 'number',
        description:
          'Condensa eventi piu vecchi di N giorni (min: 1, max: 365, default: 7)',
        minimum: 1,
        maximum: 365,
      },
      knowledgeLimit: {
        type: 'number',
        description:
          'Massimo numero di knowledge entries da generare (min: 1, max: 50, default: 10)',
        minimum: 1,
        maximum: 50,
      },
      createSnapshot: {
        type: 'boolean',
        description:
          'Se true (default), crea uno snapshot post-compact con tag compact_id',
        default: true,
      },
      autoMode: {
        type: 'boolean',
        description:
          'Se true, esecuzione automatica da Lex Agentium CHECKPOINT (forza olderThan ≥ 7)',
        default: false,
      },
      dryRun: {
        type: 'boolean',
        description:
          'Se true (default), solo preview senza condensazione effettiva',
        default: true,
      },
      agent: {
        type: 'string',
        description:
          "Nome dell'agente che richiede il compact (per audit trail, max 100 char)",
        maxLength: 100,
      },
    },
  },

  handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
    // ── 1. Validazione parametri ──────────────────────────────
    const validationError = validateParams(args);
    if (validationError) {
      return errorResult(validationError);
    }

    // ── 2. Parametri con default ──────────────────────────────
    let olderThan = args.olderThan !== undefined
      ? Number(args.olderThan)
      : DEFAULT_OLDER_THAN;
    const knowledgeLimit = args.knowledgeLimit !== undefined
      ? Number(args.knowledgeLimit)
      : DEFAULT_KNOWLEDGE_LIMIT;
    const createSnapshotFlag = args.createSnapshot !== undefined
      ? Boolean(args.createSnapshot)
      : DEFAULT_CREATE_SNAPSHOT;
    const autoMode = args.autoMode !== undefined
      ? Boolean(args.autoMode)
      : DEFAULT_AUTO_MODE;
    const dryRun = args.dryRun !== undefined
      ? Boolean(args.dryRun)
      : DEFAULT_DRY_RUN;
    const agent = args.agent ? String(args.agent) : 'unknown';

    // ── 2b. autoMode: forza olderThan ≥ 7 ─────────────────────
    if (autoMode && olderThan < 7) {
      olderThan = 7;
    }

    try {
      // ── 3. COMPACT_ID incrementale ─────────────────────────
      const compactId = getNextCompactId();

      // ── 4. DB size pre-compact ──────────────────────────────
      const dbSizeKb = getDatabaseSizeKb();

      // ── 5. Conteggio eventi + knowledge ─────────────────────
      const counts = countEventsForCompact(olderThan);
      const knowledgeBefore = countKnowledgeEntries();
      const eventCountBefore = getTotalEventCount();

      // ── 6. DRY-RUN: report senza modifiche ──────────────────
      if (dryRun) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  dry_run: true,
                  compact_id: compactId,
                  timestamp: new Date().toISOString(),
                  auto_mode: autoMode,
                  older_than_days: olderThan,
                  knowledge_limit: knowledgeLimit,
                  create_snapshot: createSnapshotFlag,
                  events_in_window: counts.total,
                  events_recent: counts.recent,
                  events_knowledge_ready: counts.knowledgeReady,
                  knowledge_entries_before: knowledgeBefore,
                  db_size_kb: dbSizeKb,
                  message:
                    counts.total > 0
                      ? `Preview: ${counts.total} events in window, ` +
                        `${counts.knowledgeReady} knowledge-ready. ` +
                        `Pass dryRun=false to execute compact.`
                      : 'No events in window to compact — database is clean.',
                  recommendation:
                    counts.total > 0
                      ? 'Run with dryRun=false to execute condensation.'
                      : 'No action needed.',
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      // ── 7. ESECUZIONE COMPACT ───────────────────────────────

      let knowledgeCreated: Array<{ id: string; title: string; category: string }> = [];
      let faqCreated: Array<{ id: string; title: string; occurrences: number }> = [];
      let snapshotId: string | null = null;
      let snapshotSkipped = false;

      // 7a. suggestKnowledge — condensa eventi in knowledge entries
      try {
        const suggestions = suggestKnowledge(
          `eventi ante ${olderThan} giorni memory compact`,
          knowledgeLimit,
        );
        knowledgeCreated = suggestions.map((s) => ({
          id: s.id,
          title: s.title,
          category: s.category,
        }));
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[compact] knowledge_suggest failed: ${msg}`);
        // Non bloccare — logga warning e prosegue
      }

      // 7b. detectFaqCandidates — rileva pattern ricorrenti
      try {
        const faqCandidates = detectFaqCandidates(3);
        if (faqCandidates.length > 0) {
          for (const candidate of faqCandidates) {
            try {
              generateFaqFromCandidate(candidate, agent);
              faqCreated.push({
                id: `faq_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
                title: candidate.suggestedTitle,
                occurrences: candidate.occurrences,
              });
            } catch {
              // Ignora fallimenti su singoli candidati FAQ
            }
          }
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[compact] faq_detect failed: ${msg}`);
        // Non blocca — logga warning e prosegue
      }

      // 7c. createSnapshot — snapshot post-compact
      if (createSnapshotFlag) {
        try {
          // Crea uno snapshot tramite il modulo memory (tool handler interno)
          // Invece di chiamare direttamente il tool MCP, creiamo uno snapshot
          // manuale inserendo un contesto di tipo 'snapshot'
          const { getDatabase } = await import('../core/database.js');
          const db = getDatabase();
          const snapshotContent = JSON.stringify({
            compact_id: compactId,
            timestamp: new Date().toISOString(),
            older_than_days: olderThan,
            agent,
            auto_mode: autoMode,
            knowledge_created_count: knowledgeCreated.length,
            faq_created_count: faqCreated.length,
          });
          const ctxId = `ctx_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

          db.prepare(`
            INSERT INTO contexts (id, session_id, agent_name, context_type, content, created_at)
            VALUES (?, ?, ?, 'snapshot', ?, datetime('now'))
          `).run(ctxId, `compact_${compactId}`, agent, snapshotContent);

          snapshotId = ctxId;
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[compact] snapshot creation failed: ${msg}`);
          // Non blocca — logga warning e prosegue
        }
      } else {
        snapshotSkipped = true;
      }

      // ── 8. Metrica: memory_event_count ──────────────────────
      try {
        storeMetric('memory', 'memory_event_count', eventCountBefore, {
          compact_id: String(compactId),
          agent,
          auto_mode: String(autoMode),
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[compact] Failed to store memory_event_count metric: ${msg}`);
      }

      // ── 9. Metrica: memory_last_compact_age_days ────────────
      try {
        storeMetric('memory', 'memory_last_compact_age_days', 0, {
          compact_id: String(compactId),
          agent,
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[compact] Failed to store memory_last_compact_age_days metric: ${msg}`);
      }

      // ── 10. COMPACT log su _compact_log ─────────────────────
      logCompactRecord(compactId, false, {
        olderThan,
        knowledgeLimit,
        snapshotCreated: snapshotId ? 1 : 0,
        knowledgeCreated: knowledgeCreated.length,
        faqCreated: faqCreated.length,
        snapshotId: snapshotId ?? '',
        dbSizeKb,
        eventCountBefore,
        agent,
      });

      // ── 11. Journal entry (audit trail) ─────────────────────
      try {
        logChange({
          file_path: 'tabularium/memory.db',
          agent,
          change_type: 'modified',
          summary:
            `COMPACT #${compactId}: ${knowledgeCreated.length} knowledge, ` +
            `${faqCreated.length} FAQ created, snapshot=${snapshotId ?? 'none'} ` +
            `(autoMode=${autoMode}, olderThan=${olderThan}d, dry_run=false)`,
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[compact] Failed to log journal entry: ${msg}`);
      }

      // ── 12. OUTPUT ──────────────────────────────────────────
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                compact_id: compactId,
                timestamp: new Date().toISOString(),
                auto_mode: autoMode,
                older_than_days: olderThan,
                knowledge_limit: knowledgeLimit,
                knowledge_created: knowledgeCreated,
                faq_created: faqCreated,
                snapshot_id: snapshotId,
                snapshot_skipped: snapshotSkipped,
                event_count_before: eventCountBefore,
                event_count_after: eventCountBefore,
                knowledge_limit_reached: knowledgeCreated.length >= knowledgeLimit,
                db_size_kb: dbSizeKb,
              },
              null,
              2,
            ),
          },
        ],
      };
    } catch (error: unknown) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: false,
                error: 'COMPACT_ERROR',
                message:
                  error instanceof Error
                    ? error.message
                    : String(error),
              },
              null,
              2,
            ),
          },
        ],
        isError: true,
      };
    }
  },
};


