/**
 * core/schedule-purge.ts
 * Core logic per PURGE scheduling (ADR-037a — Livello 1 e 2).
 *
 * Gestisce la configurazione singleton `_schedule_config`, il calcolo
 * dell'età dell'ultimo purge e la decisione automatica se eseguire PURGE.
 *
 * Dipendenze:
 *   - database.ts (getDatabase) per accesso SQLite
 *   - db-purge.ts (getLastPurgeAgeDays, ecc.) per metriche
 *
 * Safe guards:
 *   - Tabella singleton (id=1) — un solo schedule attivo
 *   - enabled=0 di default — attivazione esplicita richiesta
 *   - shouldAutoPurge() non esegue mai nulla — solo raccomandazione
 *
 * @module core/schedule-purge
 */


// ---------------------------------------------------------------------------
import { getDatabase } from './database.js';


// Tipi pubblici
// ---------------------------------------------------------------------------

/** Tipo di schedule supportato */
export type ScheduleType = 'interval' | 'manual' | 'auto';

/** Configurazione completa dello schedule */
export interface ScheduleConfig {
  scheduleType: ScheduleType;
  intervalDays: number;
  dryRun: boolean;
  olderThan: number;
  keepLastSnapshots: number;
  compactFirst: boolean;
  enabled: boolean;
}

/** Raccomandazione per auto-purge */
export interface AutoPurgeRecommendation {
  needed: boolean;
  reason: string;
  daysSinceLast: number | null;
  stats: {
    lastPurgeAgeDays: number | null;
    configOlderThan: number;
    overThreshold: boolean;
  };
}

// ---------------------------------------------------------------------------
// Costanti
// ---------------------------------------------------------------------------

const DEFAULT_SCHEDULE_TYPE: ScheduleType = 'manual';
const DEFAULT_INTERVAL_DAYS = 30;
const DEFAULT_DRY_RUN = true;
const DEFAULT_OLDER_THAN = 30;
const DEFAULT_KEEP_SNAPSHOTS = 3;
const DEFAULT_COMPACT_FIRST = true;
const DEFAULT_ENABLED = false;

// ---------------------------------------------------------------------------
// Schema SQL _schedule_config
// ---------------------------------------------------------------------------

const SCHEDULE_CONFIG_TABLE_SQL: string = `
  CREATE TABLE IF NOT EXISTS _schedule_config (
    id          INTEGER PRIMARY KEY CHECK (id = 1),  -- singleton
    schedule_type TEXT NOT NULL DEFAULT 'manual',
    interval_days INTEGER DEFAULT 30,
    dry_run     INTEGER NOT NULL DEFAULT 1,
    older_than  INTEGER NOT NULL DEFAULT 30,
    keep_last_snapshots INTEGER DEFAULT 3,
    compact_first INTEGER NOT NULL DEFAULT 1,
    enabled     INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
  )
`;

/**
 * Assicura che la tabella _schedule_config esista.
 * Chiamata automaticamente da tutte le funzioni pubbliche.
 */
function ensureScheduleConfigTable(): void {
  const db = getDatabase();
  db.exec(SCHEDULE_CONFIG_TABLE_SQL);

  // Inserisce riga singleton se non esiste
  const row = db.prepare('SELECT COUNT(*) as cnt FROM _schedule_config').get() as { cnt: number };
  if (row.cnt === 0) {
    db.prepare(`
      INSERT INTO _schedule_config (id, schedule_type, interval_days, dry_run, older_than, keep_last_snapshots, compact_first, enabled)
      VALUES (1, 'manual', 30, 1, 30, 3, 1, 0)
    `).run();
  }
}

// ---------------------------------------------------------------------------
// Schedule management
// ---------------------------------------------------------------------------

/**
 * Legge la configurazione corrente dello schedule dalla tabella _schedule_config.
 * Crea la tabella e la riga singleton se non esistono.
 *
 * @returns ScheduleConfig con valori correnti (default se tabella vuota)
 */
export function getScheduleConfig(): ScheduleConfig {
  ensureScheduleConfigTable();
  const db = getDatabase();

  const row = db.prepare('SELECT * FROM _schedule_config WHERE id = 1').get() as Record<string, unknown> | undefined;

  if (!row) {
    return {
      scheduleType: DEFAULT_SCHEDULE_TYPE,
      intervalDays: DEFAULT_INTERVAL_DAYS,
      dryRun: DEFAULT_DRY_RUN,
      olderThan: DEFAULT_OLDER_THAN,
      keepLastSnapshots: DEFAULT_KEEP_SNAPSHOTS,
      compactFirst: DEFAULT_COMPACT_FIRST,
      enabled: DEFAULT_ENABLED,
    };
  }

  return {
    scheduleType: (row.schedule_type as ScheduleType) ?? DEFAULT_SCHEDULE_TYPE,
    intervalDays: (row.interval_days as number) ?? DEFAULT_INTERVAL_DAYS,
    dryRun: (row.dry_run as number) === 1,
    olderThan: (row.older_than as number) ?? DEFAULT_OLDER_THAN,
    keepLastSnapshots: (row.keep_last_snapshots as number) ?? DEFAULT_KEEP_SNAPSHOTS,
    compactFirst: (row.compact_first as number) === 1,
    enabled: (row.enabled as number) === 1,
  };
}

/**
 * Salva la configurazione dello schedule nella tabella _schedule_config.
 * INSERT OR REPLACE sulla riga singleton (id=1).
 *
 * @param config - Configurazione completa da salvare
 */
export function setScheduleConfig(config: ScheduleConfig): void {
  ensureScheduleConfigTable();
  const db = getDatabase();

  db.prepare(`
    INSERT OR REPLACE INTO _schedule_config
      (id, schedule_type, interval_days, dry_run, older_than, keep_last_snapshots, compact_first, enabled, updated_at)
    VALUES (1, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `).run(
    config.scheduleType,
    config.intervalDays,
    config.dryRun ? 1 : 0,
    config.olderThan,
    config.keepLastSnapshots,
    config.compactFirst ? 1 : 0,
    config.enabled ? 1 : 0,
  );
}

// ---------------------------------------------------------------------------
// Last Purge Age
// ---------------------------------------------------------------------------

/**
 * Calcola i giorni trascorsi dall'ultimo purge registrato in _purge_log.
 * Se nessun purge è mai stato eseguito, restituisce null.
 *
 * @returns Numero di giorni dall'ultimo purge, o null se mai eseguito
 */
export function getLastPurgeAgeDays(): number | null {
  const db = getDatabase();
  const row = db.prepare(`
    SELECT julianday('now') - julianday(executed_at) AS age_days
    FROM _purge_log
    WHERE dry_run = 0
    ORDER BY executed_at DESC
    LIMIT 1
  `).get() as { age_days: number } | undefined;

  if (!row) {
    return null;
  }

  return Math.round(row.age_days);
}

// ---------------------------------------------------------------------------
// Auto-purge decision
// ---------------------------------------------------------------------------

/**
 * Determina se è necessario eseguire un purge basato sulla configurazione
 * corrente e sull'età dell'ultimo purge.
 *
 * Logica:
 *   - Se nessun purge mai eseguito → needed = true (urgente)
 *   - Se daysSinceLast > config.olderThan → needed = true
 *   - Altrimenti → needed = false
 *
 * @param olderThan - Soglia in giorni (default: dalla configurazione)
 * @returns Oggetto con needed e daysSinceLast
 */
export function shouldAutoPurge(olderThan?: number): { needed: boolean; daysSinceLast: number | null } {
  const daysSinceLast = getLastPurgeAgeDays();
  const threshold = olderThan ?? getScheduleConfig().olderThan;

  // Se nessun purge mai eseguito → necessario
  if (daysSinceLast === null) {
    return { needed: true, daysSinceLast: null };
  }

  return {
    needed: daysSinceLast > threshold,
    daysSinceLast,
  };
}

// ---------------------------------------------------------------------------
// Schedule registration
// ---------------------------------------------------------------------------

/**
 * Registra o aggiorna la configurazione dello schedule.
 * shortcut per setScheduleConfig con parametri specifici di schedule.
 *
 * @param scheduleType - Tipo di schedule ('interval', 'manual', 'auto')
 * @param intervalDays - Giorni tra purge (solo per schedule='interval')
 * @param olderThan - Età eventi da cancellare (default: 30)
 * @param enabled - Se abilitare lo schedule (default: false)
 */
export function registerSchedule(
  scheduleType: ScheduleType,
  intervalDays?: number,
  olderThan?: number,
  enabled?: boolean,
): void {
  const config: ScheduleConfig = {
    scheduleType,
    intervalDays: intervalDays ?? DEFAULT_INTERVAL_DAYS,
    dryRun: DEFAULT_DRY_RUN,
    olderThan: olderThan ?? DEFAULT_OLDER_THAN,
    keepLastSnapshots: DEFAULT_KEEP_SNAPSHOTS,
    compactFirst: DEFAULT_COMPACT_FIRST,
    enabled: enabled ?? false,
  };

  setScheduleConfig(config);
}

/**
 * Disabilita lo schedule corrente senza cancellare la configurazione.
 * Imposta enabled=false.
 */
export function unregisterSchedule(): void {
  const config = getScheduleConfig();
  config.enabled = false;
  setScheduleConfig(config);
}

// ---------------------------------------------------------------------------
// Auto-mode recommendation
// ---------------------------------------------------------------------------

/**
 * Genera una raccomandazione completa per l'esecuzione automatica del PURGE.
 * Include stato, motivazione e statistiche dettagliate.
 *
 * @returns AutoPurgeRecommendation con needed, reason e stats
 */
export function getAutoPurgeRecommendation(): AutoPurgeRecommendation {
  const config = getScheduleConfig();
  const daysSinceLast = getLastPurgeAgeDays();
  const threshold = config.olderThan;

  // Nessun purge mai eseguito
  if (daysSinceLast === null) {
    return {
      needed: true,
      reason: 'No PURGE has ever been executed. Immediate action recommended.',
      daysSinceLast: null,
      stats: {
        lastPurgeAgeDays: null,
        configOlderThan: threshold,
        overThreshold: true,
      },
    };
  }

  const overThreshold = daysSinceLast > threshold;

  let reason: string;
  if (overThreshold) {
    reason = `Last PURGE was ${daysSinceLast} days ago (threshold: ${threshold}d). PURGE is overdue.`;
  } else if (daysSinceLast > threshold - 5) {
    reason = `Last PURGE was ${daysSinceLast} days ago (threshold: ${threshold}d). PURGE recommended within ${threshold - daysSinceLast} days.`;
  } else {
    reason = `Last PURGE was ${daysSinceLast} days ago (threshold: ${threshold}d). No action needed.`;
  }

  return {
    needed: overThreshold,
    reason,
    daysSinceLast,
    stats: {
      lastPurgeAgeDays: daysSinceLast,
      configOlderThan: threshold,
      overThreshold,
    },
  };
}
