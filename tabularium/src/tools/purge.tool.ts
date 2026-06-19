/**
 * tools/purge.tool.ts
 * Tool MCP per memory purge (MCP² Phase 3 — PURGE).
 *
 * Implementa il tool `tabularium_memory_purge` che elimina eventi raw
 * storici dal database Tabularium con safe guards programmatiche,
 * condensazione automatica in knowledge, dry-run obbligatorio di default
 * e metriche post-operazione.
 *
 * Flow:
 *   1. validateParams — validazione parametri
 *   2. getNextPurgeId → purge_id incrementale
 *   3. getDatabaseSizeKb → db_size_before
 *   4. [compactFirst] suggestKnowledge + detectFaqCandidates
 *   5. countEventsOlderThan + estimateRecoverableSpace
 *   6. [dryRun] → REPORT (conteggi, stima, NO DELETE)
 *   7. [dryRun=false] → EXECUTE delete + maintenance + metrics + journal
 *
 * @module tools/purge
 */

import type { ToolHandler, ToolResult } from '../types/mcp.js';
import {
  countEventsOlderThan,
  deleteEventsOlderThan,
  deleteSessionsOlderThan,
  deleteContextsOlderThan,
  estimateRecoverableSpace,
  getDatabaseSizeKb,
  getNextPurgeId,
  logPurgeRecord,
} from '../core/db-purge.js';
import { suggestKnowledge } from '../core/knowledge-manager.js';
import { detectFaqCandidates, generateFaqFromCandidate } from '../core/faq-manager.js';
import { storeMetric } from '../core/metrics-engine.js';
import { logChange } from '../core/file-journal.js';
import { shouldAutoPurge, getAutoPurgeRecommendation } from '../core/schedule-purge.js';

// ---------------------------------------------------------------------------
// Costanti
// ---------------------------------------------------------------------------

const MIN_OLDER_THAN = 1;
const MAX_OLDER_THAN = 365;
const MIN_KEEP_SNAPSHOTS = 1;
const MAX_KEEP_SNAPSHOTS = 100;
const DEFAULT_OLDER_THAN = 30;
const DEFAULT_KEEP_SNAPSHOTS = 3;
const DEFAULT_DRY_RUN = true;
const DEFAULT_COMPACT_FIRST = true;

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

  // keepLastSnapshots: intero ≥ 1 e ≤ 100
  if (args.keepLastSnapshots !== undefined) {
    const keep = Number(args.keepLastSnapshots);
    if (!Number.isInteger(keep) || keep < MIN_KEEP_SNAPSHOTS || keep > MAX_KEEP_SNAPSHOTS) {
      return `keepLastSnapshots must be an integer between ${MIN_KEEP_SNAPSHOTS} and ${MAX_KEEP_SNAPSHOTS}`;
    }
  }

  // dryRun: booleano
  if (args.dryRun !== undefined && typeof args.dryRun !== 'boolean') {
    return 'dryRun must be a boolean';
  }

  // compactFirst: booleano
  if (args.compactFirst !== undefined && typeof args.compactFirst !== 'boolean') {
    return 'compactFirst must be a boolean';
  }

  // mode: 'auto' | 'manual'
  if (args.mode !== undefined) {
    if (typeof args.mode !== 'string' || !['auto', 'manual'].includes(String(args.mode))) {
      return "mode must be either 'auto' or 'manual'";
    }
  }

  // agent: stringa ≤ 100 caratteri
  if (args.agent !== undefined) {
    if (typeof args.agent !== 'string') {
      return 'agent must be a string';
    }
    if (String(args.agent).length > 100) {
      return 'agent must be a string with max 100 characters';
    }
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

export const memoryPurgeToolHandler: ToolHandler = {
  name: 'tabularium_memory_purge',
  description:
    'Elimina eventi raw storici con safe guards, condensazione automatica e dry-run. ' +
    'Safe guards: MAI cancella knowledge/ADR/metriche, preserva ultimi N snapshot, ' +
    'dry-run obbligatorio di default.',
  inputSchema: {
    type: 'object',
    properties: {
      olderThan: {
        type: 'number',
        description:
          'Elimina eventi piu vecchi di N giorni (min: 1, max: 365, default: 30)',
        minimum: 1,
        maximum: 365,
      },
      dryRun: {
        type: 'boolean',
        description:
          'Se true (default), solo preview senza DELETE effettivo',
        default: true,
      },
      keepLastSnapshots: {
        type: 'number',
        description:
          'Numero di snapshot recenti da preservare (min: 1, default: 3)',
        minimum: 1,
        maximum: 100,
      },
      compactFirst: {
        type: 'boolean',
        description:
          'Esegue knowledge_suggest + detectFaq prima di DELETE per condensare eventi in conoscenza (default: true)',
        default: true,
      },
      mode: {
        type: 'string',
        description:
          "Modalità di esecuzione: 'manual' (default, comportamento attuale) o 'auto' (esegue solo se memory_last_purge_age_days > olderThan)",
        enum: ['auto', 'manual'],
      },
      agent: {
        type: 'string',
        description:
          "Nome dell'agente che richiede il purge (per audit trail, max 100 char)",
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
    const olderThan = args.olderThan !== undefined
      ? Number(args.olderThan)
      : DEFAULT_OLDER_THAN;
    const dryRun = args.dryRun !== undefined
      ? Boolean(args.dryRun)
      : DEFAULT_DRY_RUN;
    const keepLastSnapshots = args.keepLastSnapshots !== undefined
      ? Number(args.keepLastSnapshots)
      : DEFAULT_KEEP_SNAPSHOTS;
    const compactFirst = args.compactFirst !== undefined
      ? Boolean(args.compactFirst)
      : DEFAULT_COMPACT_FIRST;
    const agent = args.agent ? String(args.agent) : 'unknown';
    const mode = args.mode !== undefined ? String(args.mode) : 'manual';

    try {
      // ── 2b. AUTO-MODE: verifica se PURGE è necessario ───────
      if (mode === 'auto') {
        const { needed, daysSinceLast } = shouldAutoPurge(olderThan);

        if (!needed) {
          const rec = getAutoPurgeRecommendation();
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    mode: 'auto',
                    purge_necessary: false,
                    age_days_since_last_purge: daysSinceLast,
                    threshold_days: olderThan,
                    message: rec.reason,
                    triggered: false,
                    recommendation: 'No action needed at this time.',
                    timestamp: new Date().toISOString(),
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        }

        // Se needed=true, continua con flusso normale
        // Logga che è auto-triggerato (agent viene prefixato)
        console.error(`[purge] auto-mode triggered: daysSinceLast=${daysSinceLast}, threshold=${olderThan}`);
      }

      // ── 3. PURGE_ID incrementale ───────────────────────────
      const purgeId = getNextPurgeId();

      // ── 4. DB size pre-purge ────────────────────────────────
      const dbSizeBeforeKb = getDatabaseSizeKb();

      // ── 5. Condensazione (compactFirst) ─────────────────────
      let knowledgeCondensed = 0;

      if (compactFirst) {
        // 5a. suggestKnowledge — condensa eventi in knowledge entries
        try {
          const suggestions = suggestKnowledge(
            `eventi ante ${olderThan} giorni memory purge`,
            20,
          );
          knowledgeCondensed = suggestions.length;
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[purge] knowledge_suggest failed: ${msg}`);
          // Non bloccare — logga warning e prosegue
        }

        // 5b. detectFaqCandidates — rileva pattern ricorrenti
        try {
          const faqCandidates = detectFaqCandidates(5);
          if (faqCandidates.length > 0 && agent !== 'unknown') {
            for (const candidate of faqCandidates) {
              try {
                generateFaqFromCandidate(candidate, agent);
                knowledgeCondensed++;
              } catch {
                // Ignora fallimenti su singoli candidati FAQ
              }
            }
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[purge] faq_detect failed: ${msg}`);
          // Non bloccare — logga warning e prosegue
        }
      }

      // ── 6. Conteggio elementi da eliminare + stima spazio ──
      const counts = countEventsOlderThan(olderThan);
      const estimatedSpaceKb = estimateRecoverableSpace(olderThan);

      // ── 7. DRY-RUN: report senza modifiche ──────────────────
      if (dryRun) {
        const totalPending =
          counts.events + counts.sessions + counts.contexts;

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  mode: mode,
                  dry_run: true,
                  purge_id: purgeId,
                  timestamp: new Date().toISOString(),
                  older_than_days: olderThan,
                  keep_last_snapshots: keepLastSnapshots,
                  compact_first: compactFirst,
                  knowledge_condensed: knowledgeCondensed,
                  events_pending: counts.events,
                  sessions_pending: counts.sessions,
                  snapshots_pending: counts.contexts,
                  estimated_space_kb: estimatedSpaceKb,
                  db_size_before_kb: dbSizeBeforeKb,
                  message:
                    totalPending > 0
                      ? `Preview: ${counts.events} events, ${counts.sessions} sessions, ${counts.contexts} snapshots would be deleted. Pass dryRun=false to execute.`
                      : 'No records to delete — database is clean.',
                  recommendation:
                    totalPending > 0
                      ? 'Run with dryRun=false to execute purgation.'
                      : 'No action needed.',
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      // ── 8. ESECUZIONE DELETE ────────────────────────────────
      const eventsDeleted = deleteEventsOlderThan(olderThan);
      const sessionsDeleted = deleteSessionsOlderThan(
        olderThan,
        keepLastSnapshots,
      );
      const contextsDeleted = deleteContextsOlderThan(
        olderThan,
        keepLastSnapshots,
      );

      // ── 9. MANUTENZIONE post-delete ─────────────────────────
      try {
        const { getDatabase } = await import('../core/database.js');
        const db = getDatabase();
        db.exec('PRAGMA optimize');
        db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get();
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[purge] Maintenance failed: ${msg}`);
        // Non bloccare — la manutenzione è best-effort
      }

      // ── 10. DB size post-purge ──────────────────────────────
      const dbSizeAfterKb = getDatabaseSizeKb();
      const spaceRecoveredKb = Math.max(0, dbSizeBeforeKb - dbSizeAfterKb);

      // ── 11. Metrica: memory_db_size_kb ──────────────────────
      try {
        storeMetric('memory', 'memory_db_size_kb', dbSizeAfterKb, {
          purge_id: String(purgeId),
          agent,
          dry_run: 'false',
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[purge] Failed to store memory_db_size_kb metric: ${msg}`);
      }

      // ── 12. Metrica: space_recovered_kb ─────────────────────
      try {
        storeMetric('memory', 'space_recovered_kb', spaceRecoveredKb, {
          purge_id: String(purgeId),
          agent,
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[purge] Failed to store space_recovered_kb metric: ${msg}`);
      }

      // ── 13. PURGE log su _purge_log ─────────────────────────
      logPurgeRecord(purgeId, false, {
        olderThan,
        eventsDeleted,
        sessionsDeleted,
        contextsDeleted,
        spaceRecoveredKb,
        dbSizeBeforeKb,
        dbSizeAfterKb,
        knowledgeCondensed,
        agent,
      });

      // ── 14. Journal entry (audit trail) ─────────────────────
      try {
        logChange({
          file_path: 'tabularium/memory.db',
          agent,
          change_type: 'modified',
          summary:
            `PURGE #${purgeId}: ${eventsDeleted} events, ` +
            `${sessionsDeleted} sessions, ${contextsDeleted} snapshots deleted ` +
            `(older_than=${olderThan}d, dry_run=false)`,
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[purge] Failed to log journal entry: ${msg}`);
      }

      // ── 15. OUTPUT ──────────────────────────────────────────
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                mode: mode,
                dry_run: false,
                purge_id: purgeId,
                timestamp: new Date().toISOString(),
                older_than_days: olderThan,
                keep_last_snapshots: keepLastSnapshots,
                events_deleted: eventsDeleted,
                sessions_deleted: sessionsDeleted,
                snapshots_deleted: contextsDeleted,
                total_deleted:
                  eventsDeleted + sessionsDeleted + contextsDeleted,
                space_recovered_kb: spaceRecoveredKb,
                knowledge_condensed: knowledgeCondensed,
                db_size_before_kb: dbSizeBeforeKb,
                db_size_after_kb: dbSizeAfterKb,
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
                error: 'PURGE_ERROR',
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
