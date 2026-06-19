/**
 * tools/schedule.tool.ts
 * Tool MCP per PURGE scheduling (ADR-037a — Livello 1).
 *
 * Implementa il tool `tabularium_memory_purge_schedule` che:
 *   - Legge/configura lo schedule di PURGE periodico
 *   - Valuta se il PURGE è necessario (shouldAutoPurge)
 *   - Esegue PURGE immediato su richiesta
 *   - Restituisce stato completo (età ultimo purge, configurazione, overdue)
 *
 * Flow:
 *   1. validateParams — validazione parametri
 *   2. [action=status] → report configurazione + stato
 *   3. [action=register] → salva configurazione schedule
 *   4. [action=unregister] → disabilita schedule
 *   5. [action=check] → shouldAutoPurge + raccomandazione
 *   6. [action=run] → esegui PURGE immediato (dry-run prima)
 *
 * @module tools/schedule
 */

import type { ToolHandler, ToolResult } from '../types/mcp.js';
import {
  getScheduleConfig,
  setScheduleConfig,
  getLastPurgeAgeDays,
  shouldAutoPurge,
  registerSchedule,
  unregisterSchedule,
  getAutoPurgeRecommendation,
} from '../core/schedule-purge.js';
import type { ScheduleConfig, ScheduleType } from '../core/schedule-purge.js';

// ---------------------------------------------------------------------------
// Costanti per validazione
// ---------------------------------------------------------------------------

const VALID_ACTIONS = ['status', 'register', 'unregister', 'check', 'run'] as const;
const VALID_SCHEDULE_TYPES = ['interval', 'manual', 'auto'] as const;
const MIN_INTERVAL_DAYS = 1;
const MAX_INTERVAL_DAYS = 365;
const MIN_OLDER_THAN = 1;
const MAX_OLDER_THAN = 365;
const MIN_KEEP_SNAPSHOTS = 1;
const MAX_KEEP_SNAPSHOTS = 100;

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
  // action: obbligatorio, deve essere uno dei validi
  if (!args.action || typeof args.action !== 'string') {
    return 'action is required and must be one of: status, register, unregister, check, run';
  }
  if (!(VALID_ACTIONS as readonly string[]).includes(args.action)) {
    return `action must be one of: ${VALID_ACTIONS.join(', ')}`;
  }

  // schedule: opzionale, se presente deve essere valido
  if (args.schedule !== undefined) {
    if (typeof args.schedule !== 'string' || !(VALID_SCHEDULE_TYPES as readonly string[]).includes(args.schedule)) {
      return `schedule must be one of: ${VALID_SCHEDULE_TYPES.join(', ')}`;
    }
  }

  // intervalDays: intero ≥ 1 e ≤ 365
  if (args.intervalDays !== undefined) {
    const intervalDays = Number(args.intervalDays);
    if (!Number.isInteger(intervalDays) || intervalDays < MIN_INTERVAL_DAYS || intervalDays > MAX_INTERVAL_DAYS) {
      return `intervalDays must be an integer between ${MIN_INTERVAL_DAYS} and ${MAX_INTERVAL_DAYS}`;
    }
  }

  // olderThan: intero ≥ 1 e ≤ 365
  if (args.olderThan !== undefined) {
    const olderThan = Number(args.olderThan);
    if (!Number.isInteger(olderThan) || olderThan < MIN_OLDER_THAN || olderThan > MAX_OLDER_THAN) {
      return `olderThan must be an integer between ${MIN_OLDER_THAN} and ${MAX_OLDER_THAN}`;
    }
  }

  // dryRun: booleano
  if (args.dryRun !== undefined && typeof args.dryRun !== 'boolean') {
    return 'dryRun must be a boolean';
  }

  // keepLastSnapshots: intero ≥ 1 e ≤ 100
  if (args.keepLastSnapshots !== undefined) {
    const keep = Number(args.keepLastSnapshots);
    if (!Number.isInteger(keep) || keep < MIN_KEEP_SNAPSHOTS || keep > MAX_KEEP_SNAPSHOTS) {
      return `keepLastSnapshots must be an integer between ${MIN_KEEP_SNAPSHOTS} and ${MAX_KEEP_SNAPSHOTS}`;
    }
  }

  // compactFirst: booleano
  if (args.compactFirst !== undefined && typeof args.compactFirst !== 'boolean') {
    return 'compactFirst must be a boolean';
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

export const scheduleToolHandler: ToolHandler = {
  name: 'tabularium_memory_purge_schedule',
  description:
    'Gestisce lo scheduling del PURGE periodico della memoria Tabularium. ' +
    'Supporta azioni: status (leggi config), register (salva config), ' +
    'unregister (disabilita), check (verifica se purge necessario), ' +
    'run (esegui purge immediato). ' +
    'Safe guard: dry-run obbligatorio di default, enabled=false di default.',
  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        description:
          'Azione da eseguire: status (config + stato), register (salva config), unregister (disabilita), check (verifica necessita), run (esegui purge)',
        enum: ['status', 'register', 'unregister', 'check', 'run'],
      },
      schedule: {
        type: 'string',
        description:
          'Tipo di schedule: interval (periodico), manual (solo manuale), auto (auto-mode)',
        enum: ['interval', 'manual', 'auto'],
        default: 'manual',
      },
      intervalDays: {
        type: 'number',
        description:
          'Giorni tra purge periodici (per schedule=interval, min: 1, max: 365, default: 30)',
        minimum: 1,
        maximum: 365,
      },
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
          'Se true (default), solo preview senza DELETE effettivo (per action=run)',
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
          'Esegue knowledge_suggest + detectFaq prima di DELETE (default: true)',
        default: true,
      },
      agent: {
        type: 'string',
        description:
          "Nome dell'agente che richiede l'operazione (per audit trail, max 100 char)",
        maxLength: 100,
      },
    },
    required: ['action'],
  },

  handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
    // ── 1. Validazione parametri ──────────────────────────────
    const validationError = validateParams(args);
    if (validationError) {
      return errorResult(validationError);
    }

    // ── 2. Parametri con default ──────────────────────────────
    const action = String(args.action);
    const agent = args.agent ? String(args.agent) : 'unknown';

    try {
      // ── 3. ACTION: status ───────────────────────────────────
      if (action === 'status') {
        const config = getScheduleConfig();
        const daysSinceLast = getLastPurgeAgeDays();
        const recommendation = getAutoPurgeRecommendation();

        const ageDays = daysSinceLast;
        const overdue =
          ageDays !== null
            ? ageDays > config.olderThan
            : true;

        let statusLabel: string;
        if (!config.enabled) {
          statusLabel = 'disabled';
        } else if (overdue) {
          statusLabel = 'overdue';
        } else if (config.scheduleType === 'manual') {
          statusLabel = 'manual';
        } else {
          statusLabel = 'active';
        }

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  action: 'status',
                  schedule_type: config.scheduleType,
                  interval_days: config.intervalDays,
                  dry_run: config.dryRun,
                  older_than: config.olderThan,
                  keep_last_snapshots: config.keepLastSnapshots,
                  compact_first: config.compactFirst,
                  enabled: config.enabled,
                  last_purge_age_days: ageDays,
                  overdue,
                  status: statusLabel,
                  purge_needed: recommendation.needed,
                  recommendation: recommendation.reason,
                  timestamp: new Date().toISOString(),
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      // ── 4. ACTION: register ─────────────────────────────────
      if (action === 'register') {
        const scheduleType = (args.schedule as ScheduleType) ?? 'interval';
        const intervalDays = args.intervalDays !== undefined
          ? Number(args.intervalDays)
          : 30;
        const olderThan = args.olderThan !== undefined
          ? Number(args.olderThan)
          : 30;
        const dryRun = args.dryRun !== undefined
          ? Boolean(args.dryRun)
          : true;
        const keepLastSnapshots = args.keepLastSnapshots !== undefined
          ? Number(args.keepLastSnapshots)
          : 3;
        const compactFirst = args.compactFirst !== undefined
          ? Boolean(args.compactFirst)
          : true;
        const enabled = args.enabled !== undefined ? Boolean(args.enabled) : false;

        // Default enabled=false per safety — attivazione esplicita
        const config: ScheduleConfig = {
          scheduleType,
          intervalDays,
          dryRun,
          olderThan,
          keepLastSnapshots,
          compactFirst,
          enabled,
        };

        setScheduleConfig(config);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  action: 'register',
                  schedule_type: scheduleType,
                  interval_days: intervalDays,
                  older_than: olderThan,
                  dry_run: dryRun,
                  keep_last_snapshots: keepLastSnapshots,
                  compact_first: compactFirst,
                  enabled,
                  message:
                    'Schedule configuration saved. Use enabled=true to activate automatic PURGE.',
                  timestamp: new Date().toISOString(),
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      // ── 5. ACTION: unregister ───────────────────────────────
      if (action === 'unregister') {
        unregisterSchedule();

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  action: 'unregister',
                  enabled: false,
                  message: 'Schedule has been disabled. Configuration retained.',
                  timestamp: new Date().toISOString(),
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      // ── 6. ACTION: check ────────────────────────────────────
      if (action === 'check') {
        const olderThan = args.olderThan !== undefined
          ? Number(args.olderThan)
          : undefined;
        const config = getScheduleConfig();
        const threshold = olderThan ?? config.olderThan;
        const decision = shouldAutoPurge(threshold);
        const recommendation = getAutoPurgeRecommendation();

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  action: 'check',
                  older_than_threshold: threshold,
                  days_since_last_purge: decision.daysSinceLast,
                  purge_needed: decision.needed,
                  reason: recommendation.reason,
                  stats: recommendation.stats,
                  timestamp: new Date().toISOString(),
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      // ── 7. ACTION: run ──────────────────────────────────────
      if (action === 'run') {
        // Esegue PURGE immediato chiamando il tool esistente
        const olderThan = args.olderThan !== undefined
          ? Number(args.olderThan)
          : 30;
        const dryRun = args.dryRun !== undefined
          ? Boolean(args.dryRun)
          : true;
        const keepLastSnapshots = args.keepLastSnapshots !== undefined
          ? Number(args.keepLastSnapshots)
          : 3;
        const compactFirst = args.compactFirst !== undefined
          ? Boolean(args.compactFirst)
          : true;

        // Import dinamico per evitare dipendenza circolare
        const { memoryPurgeToolHandler } = await import('./purge.tool.js');
        const purgeResult = await memoryPurgeToolHandler.handler({
          olderThan,
          dryRun,
          keepLastSnapshots,
          compactFirst,
          agent,
        });

        // Se dry-run, restituisce il risultato del purge tool
        if (dryRun) {
          return purgeResult;
        }

        // Se esecuzione effettiva, arricchisci con info schedule
        const purgeData = JSON.parse(purgeResult.content[0].text);

        // Registra nel purge_schedule_log (update last run time)
        // La schedule config viene aggiornata con updated_at tramite setScheduleConfig
        const config = getScheduleConfig();
        if (config.enabled) {
          // Touch per aggiornare updated_at
          setScheduleConfig(config);
        }

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  action: 'run',
                  schedule_id: 1,
                  trigger: agent !== 'unknown' ? 'manual' : 'scheduler',
                  purge_result: purgeData,
                  timestamp: new Date().toISOString(),
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      // ── 8. Fallback (non dovrebbe mai accadere) ──────────────
      return errorResult(`Unknown action: ${action}`);
    } catch (error: unknown) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: false,
                error: 'SCHEDULE_ERROR',
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
