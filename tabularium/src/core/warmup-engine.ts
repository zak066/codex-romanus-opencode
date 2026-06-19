/**
 * core/warmup-engine.ts
 * Session Warm-up Engine (FABRICA — Fase 7.5).
 *
 * All'avvio di ogni sessione, pre-carica contesto rilevante:
 *   - Ultimi file modificati (da file-journal)
 *   - Bug aperti (da bug-tracker)
 *   - ADR recenti (da tabella decisions nel DB)
 *   - Metriche salienti (da scorecard-engine)
 *   - PURGE health (da schedule-purge per ADR-037a Livello 3)
 *
 * Ogni fonte &egrave; indipendente: se una fallisce, le altre continuano.
 * Non crasha se le tabelle non esistono ancora (graceful degradation).
 *
 * @module core/warmup-engine
 */

import { getRecentChanges } from './file-journal.js';
import { listBugs } from './bug-tracker.js';
import { getDatabase } from './database.js';
import { getScorecard } from './scorecard-engine.js';

// ---------------------------------------------------------------------------
// Tipi pubblici
// ---------------------------------------------------------------------------

/** Health status del PURGE memory (ADR-037a Livello 3) */
export interface PurgeHealth {
  /** Giorni dall'ultimo PURGE effettivo (null = mai eseguito) */
  ageDays: number | null;
  /** Se il PURGE &egrave; in ritardo rispetto alla soglia */
  overdue: boolean;
  /** Giorni oltre la soglia (se overdue) */
  overdueDays: number | null;
  /** Testo del suggerimento operativo */
  recommendation: string;
  /** Soglia configurata in giorni (default: 30) */
  threshold: number;
  /** Emoji indicatore: 🟢 = ok, 🟡 = warning, 🔴 = overdue, ⚪ = sconosciuto */
  icon: string;
}

/** Contesto pre-riscaldato per la sessione corrente */
export interface WarmupContext {
  recentChanges: Array<{
    file: string;
    agent: string;
    summary: string;
    when: string;
  }>;
  openBugs: Array<{
    id: string;
    title: string;
    severity: string;
    component: string;
  }>;
  recentAdrs: Array<{
    id: string;
    title: string;
    status: string;
  }>;
  metricsSnapshot: Array<{
    domain: string;
    score: number;
    grade: string;
  }>;
  /** PURGE memory health (ADR-037a Livello 3) */
  purgeHealth: PurgeHealth;
  generatedAt: string;
  age: string;
}

// ---------------------------------------------------------------------------
// Costanti
// ---------------------------------------------------------------------------

/** Nome della tabella decisions nel database SQLite */
const DECISIONS_TABLE = 'decisions';

// ---------------------------------------------------------------------------
// Pubblica
// ---------------------------------------------------------------------------

/**
 * Genera il contesto pre-riscaldato per la sessione corrente.
 *
 * Raccoglie dati da tutte e 5 le fonti in modo indipendente:
 * 1. file-journal &rarr; getRecentChanges(5)
 * 2. bug-tracker &rarr; listBugs({ status: 'open' })
 * 3. database &rarr; query diretta decisions
 * 4. scorecard-engine &rarr; getScorecard()
 * 5. schedule-purge &rarr; PURGE health (Livello 3 ADR-037a)
 *
 * Se una fonte non &egrave; disponibile (tabella mancante, DB non inizializzato, ecc.),
 * viene saltata silenziosamente senza bloccare le altre.
 *
 * @returns WarmupContext popolato con i dati disponibili
 *
 * @example
 * ```ts
 * const ctx = await generateWarmupContext();
 * console.log(ctx.age); // "2 minuti fa"
 * console.log(ctx.purgeHealth.icon); // "🟢"
 * ```
 */
export async function generateWarmupContext(): Promise<WarmupContext> {
  const generatedAt = new Date().toISOString();
  const age = formatAge(generatedAt);

  // Raccogli dati da tutte e 5 le fonti in parallelo
  const [recentChanges, openBugs, recentAdrs, scorecard, purgeHealth] = await Promise.all([
    collectRecentChanges(),
    collectOpenBugs(),
    collectRecentAdrs(),
    collectScorecardMetrics(),
    collectPurgeHealth(),
  ]);

  return {
    recentChanges,
    openBugs,
    recentAdrs,
    metricsSnapshot: scorecard,
    purgeHealth,
    generatedAt,
    age,
  };
}

/**
 * Formatta una data ISO in stringa leggibile "X tempo fa".
 *
 * Supporta:
 *   - "pochi secondi fa" (< 1 min)
 *   - "N minuti fa" (< 1 ora)
 *   - "N ore fa" (< 24 ore)
 *   - "ieri" / "N giorni fa"
 *   - "N settimane fa"
 *   - "N mesi fa"
 *
 * @param isoDate - Data in formato ISO string
 * @returns Stringa leggibile tipo "2 minuti fa"
 *
 * @example
 * ```ts
 * formatAge(new Date(Date.now() - 120_000).toISOString()) // "2 minuti fa"
 * formatAge(new Date(Date.now() - 3600_000).toISOString()) // "1 ora fa"
 * ```
 */
export function formatAge(isoDate: string): string {
  const now = Date.now();
  const then = new Date(isoDate).getTime();

  if (Number.isNaN(then)) {
    return 'data sconosciuta';
  }

  const diffMs = now - then;

  if (diffMs < 0) {
    return 'pochi secondi fa';
  }

  const seconds = Math.floor(diffMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const weeks = Math.floor(days / 7);
  const months = Math.floor(days / 30);

  if (seconds < 60) {
    return 'pochi secondi fa';
  }

  if (minutes < 60) {
    return minutes === 1 ? '1 minuto fa' : `${minutes} minuti fa`;
  }

  if (hours < 24) {
    return hours === 1 ? '1 ora fa' : `${hours} ore fa`;
  }

  if (days === 1) {
    return 'ieri';
  }

  if (days < 7) {
    return `${days} giorni fa`;
  }

  if (weeks < 5) {
    return weeks === 1 ? '1 settimana fa' : `${weeks} settimane fa`;
  }

  return months === 1 ? '1 mese fa' : `${months} mesi fa`;
}

// ---------------------------------------------------------------------------
// Collection helpers (ogni fonte &egrave; indipendente)
// ---------------------------------------------------------------------------

/**
 * Raccolglie le ultime 5 modifiche ai file dal journal.
 * In caso di errore (es. tabella mancante), restituisce array vuoto.
 */
async function collectRecentChanges(): Promise<WarmupContext['recentChanges']> {
  try {
    const changes = getRecentChanges(5);
    return changes.map((c) => ({
      file: c.file_path,
      agent: c.agent,
      summary: c.summary,
      when: c.created_at,
    }));
  } catch {
    // Tabella file_changes non ancora creata o DB non inizializzato
    return [];
  }
}

/**
 * Raccolglie i bug aperti dal bug tracker.
 * In caso di errore (es. tabella mancante), restituisce array vuoto.
 */
async function collectOpenBugs(): Promise<WarmupContext['openBugs']> {
  try {
    const { bugs } = listBugs({ status: 'open' });
    return bugs.map((b) => ({
      id: b.id,
      title: b.title,
      severity: b.severity,
      component: b.component,
    }));
  } catch {
    // Tabella bugs non ancora creata o DB non inizializzato
    return [];
  }
}

/**
 * Raccolglie le ultime 3 ADR dalla tabella decisions del database.
 * Utilizza una query SQL diretta come richiesto dalle specifiche.
 *
 * Se la tabella non esiste ancora, restituisce array vuoto
 * senza lanciare errore (graceful degradation).
 */
async function collectRecentAdrs(): Promise<WarmupContext['recentAdrs']> {
  try {
    const db = getDatabase();

    // Verifica se la tabella esiste per evitare errori SQL
    const tableCheck = db.prepare(`
      SELECT name FROM sqlite_master
      WHERE type='table' AND name=?
    `).get(DECISIONS_TABLE) as { name: string } | undefined;

    if (!tableCheck) {
      return [];
    }

    const rows = db.prepare(
      `SELECT id, title, status FROM ${DECISIONS_TABLE} ORDER BY created_at DESC LIMIT 3`
    ).all() as Array<{ id: string; title: string; status: string }>;

    return rows.map((r) => ({
      id: String(r.id ?? ''),
      title: String(r.title ?? ''),
      status: String(r.status ?? 'draft'),
    }));
  } catch {
    // Tabella decisions non ancora creata o DB non inizializzato
    return [];
  }
}

/**
 * Raccolglie le metriche dalla scorecard.
 * Trasforma il breakdown in un array di { domain, score, grade }.
 * In caso di errore, restituisce array vuoto.
 */
async function collectScorecardMetrics(): Promise<WarmupContext['metricsSnapshot']> {
  try {
    const scorecard = await getScorecard();

    const domains: Array<{ domain: string; score: number; grade: string }> = [];

    const breakdown = scorecard.breakdown;
    if (breakdown) {
      for (const [domain, item] of Object.entries(breakdown)) {
        domains.push({
          domain,
          score: Math.round(item.score * 100) / 100,
          grade: scorecard.grade,
        });
      }
    }

    return domains;
  } catch {
    // Scorecard non disponibile o metriche assenti
    return [];
  }
}

/**
 * Raccolglie lo stato del PURGE memory health (ADR-037a Livello 3).
 *
 * Utilizza getLastPurgeAgeDays() e getScheduleConfig() da schedule-purge
 * per determinare:
 *   - ageDays: giorni dall'ultimo PURGE (null = mai eseguito)
 *   - overdue: true se oltre la soglia configurata
 *   - overdueDays: giorni di ritardo (se overdue)
 *   - threshold: soglia configurata
 *   - icon: 🟢 (ok), 🟡 (warning), 🔴 (overdue), ⚪ (errore)
 *   - recommendation: testo operativo per l'agente
 *
 * Soglie ADR-037a:
 *   - ageDays > threshold &rarr; 🔴 overdue
 *   - ageDays > threshold - 5 &rarr; 🟡 warning
 *   - altrimenti &rarr; 🟢 ok
 *
 * @returns PurgeHealth con stato corrente (o fallback su errore)
 */
async function collectPurgeHealth(): Promise<PurgeHealth> {
  try {
    const { getLastPurgeAgeDays, getScheduleConfig } = await import('./schedule-purge.js');
    const config = getScheduleConfig();
    const ageDays = getLastPurgeAgeDays();
    const threshold = config.olderThan;

    // Mai eseguito — urgente
    if (ageDays === null) {
      return {
        ageDays: null,
        overdue: true,
        overdueDays: null,
        recommendation: 'No PURGE has ever been executed. Run `tabularium_memory_purge_schedule action=run`',
        threshold,
        icon: '🔴',
      };
    }

    const overdue = ageDays > threshold;
    const overdueDays = overdue ? ageDays - threshold : null;

    let icon: string;
    let recommendation: string;

    if (overdue) {
      icon = '🔴';
      recommendation = `PURGE is overdue by ${overdueDays} day(s). Run \`tabularium_memory_purge_schedule action=run\``;
    } else if (ageDays > threshold - 5) {
      icon = '🟡';
      recommendation = `PURGE recommended within ${threshold - ageDays} day(s). Consider running \`tabularium_memory_purge_schedule action=check\``;
    } else {
      icon = '🟢';
      recommendation = `PURGE is healthy. Next recommended in ${threshold - ageDays} day(s)`;
    }

    return {
      ageDays,
      overdue,
      overdueDays,
      recommendation,
      threshold,
      icon,
    };
  } catch {
    // Schedule-purge non disponibile (DB non inizializzato, tabella mancante, ecc.)
    return {
      ageDays: null,
      overdue: false,
      overdueDays: null,
      recommendation: 'PURGE health check unavailable. Memory health monitoring is degraded.',
      threshold: 30,
      icon: '⚪',
    };
  }
}
