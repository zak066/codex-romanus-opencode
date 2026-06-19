/**
 * core/cache-warmup.ts
 * Cache Warmup System (ADR-006 — Caching 3 Layer, Task C5).
 *
 * Sistema di preriscaldamento (warmup) delle cache di Tabularium.
 * Permette di registrare task che caricano dati nelle cache all'avvio
 * o periodicamente, in modo che siano già calde ("hot") al primo accesso.
 *
 * Caratteristiche:
 *   - Task con priorità, tag e TTL suggerito
 *   - Esecuzione singola, per tag o completa (in ordine di priorità)
 *   - Scheduler periodico opzionale
 *   - Report dettagliato con durate e status
 *   - Ogni task è indipendente (fallimenti isolati)
 *   - Safe: non crasha se il DB non è disponibile
 *
 * @module core/cache-warmup
 */

import {
  decisionsCache,
  validationCache,
  memorySessionsCache,
  memoryEventsCache,
  memoryKnowledgeCache,
  memoryContextsCache,
} from './cache.js';

import { getDatabase } from './database.js';

// ---------------------------------------------------------------------------
// Tipi pubblici
// ---------------------------------------------------------------------------

/**
 * Task di preriscaldamento.
 * Ogni task rappresenta una fonte di dati da caricare in cache.
 *
 * I task sono indipendenti: se `execute()` fallisce, gli altri continuano.
 *
 * @example
 * ```ts
 * const task: WarmupTask = {
 *   name: 'adr-list',
 *   tags: ['startup'],
 *   priority: 80,
 *   execute: async () => {
 *     const data = await loadAdrList();
 *     decisionsCache.set('adr:list', data, 60_000);
 *   },
 *   ttl: 60_000,
 * };
 * ```
 */
export interface WarmupTask {
  /** Nome logico univoco (es. 'adr-list', 'agent-status') */
  name: string;

  /** Tag per raggruppamento (es. ['startup', 'periodic']) */
  tags: string[];

  /** Priorità 0-100 (più alto = prima durante warmupAll) */
  priority: number;

  /** Funzione che carica i dati in cache */
  execute(): Promise<void>;

  /** TTL suggerito per i dati caricati (ms) — informativo */
  ttl?: number;
}

/**
 * Stato di un task di warmup.
 */
export enum WarmupStatus {
  /** In attesa di esecuzione */
  PENDING = 'pending',
  /** In esecuzione */
  RUNNING = 'running',
  /** Completato con successo */
  COMPLETED = 'completed',
  /** Fallito */
  FAILED = 'failed',
  /** Saltato (es. condizione non soddisfatta) */
  SKIPPED = 'skipped',
}

/**
 * Risultato dell'esecuzione di un singolo task.
 */
export interface WarmupResult {
  /** Nome del task */
  name: string;
  /** Stato finale */
  status: WarmupStatus;
  /** Durata in millisecondi (0 se non eseguito) */
  duration: number;
  /** Messaggio di errore (se status === FAILED) */
  error?: string;
  /** TTL suggerito per i dati caricati */
  ttl?: number;
  /** Timestamp di esecuzione (ISO) */
  executedAt?: string;
}

/**
 * Report completo di un'operazione di warmup.
 */
export interface WarmupReport {
  /** Timestamp dell'avvio */
  startedAt: string;
  /** Durata totale in millisecondi */
  totalDuration: number;
  /** Numero totale di task processati */
  total: number;
  /** Task completati con successo */
  completed: number;
  /** Task falliti */
  failed: number;
  /** Task saltati */
  skipped: number;
  /** Risultati individuali per ogni task */
  results: WarmupResult[];
}

// ---------------------------------------------------------------------------
// Costanti
// ---------------------------------------------------------------------------

/** Default scheduler interval: 5 minuti */
const DEFAULT_SCHEDULER_INTERVAL_MS = 5 * 60 * 1000;

/** Nome del registro dei task di default per lookup */
const DECISIONS_TASK = 'decisions-warmup';
const SCORECARD_TASK = 'scorecard-warmup';
const AGENT_STATUS_TASK = 'agent-status-warmup';
const SESSIONS_WARMUP_TASK = 'sessions-warmup';
const KNOWLEDGE_WARMUP_TASK = 'knowledge-warmup';

// ---------------------------------------------------------------------------
// CacheWarmup — classe principale
// ---------------------------------------------------------------------------

/**
 * Gestore centralizzato del preriscaldamento delle cache.
 *
 * Permette di:
 *   - Registrare/sdoganare task di warmup
 *   - Eseguire task singoli, per tag o tutti (in ordine di priorità)
 *   - Avviare/fermare uno scheduler periodico
 *   - Ottenere report di esecuzione
 *
 * @example
 * ```ts
 * import { cacheWarmup, registerDefaultWarmupTasks } from './core/cache-warmup.js';
 *
 * // Registra task standard
 * registerDefaultWarmupTasks();
 *
 * // Esegue tutti i task di startup
 * const report = await cacheWarmup.warmupByTag('startup');
 * console.log(`Warmup completato: ${report.completed}/${report.total}`);
 * ```
 */
export class CacheWarmup {
  /** Task registrati, mappati per nome */
  private tasks = new Map<string, WarmupTask>();

  /** Timer dello scheduler periodico */
  private schedulerTimer: ReturnType<typeof setInterval> | null = null;

  /** Report corrente (ultima esecuzione) */
  private lastReport: WarmupReport | null = null;

  // -----------------------------------------------------------------------
  // Registrazione
  // -----------------------------------------------------------------------

  /**
   * Registra un nuovo task di warmup.
   * Se esiste già un task con lo stesso nome, viene sovrascritto.
   *
   * @param task - Task da registrare
   *
   * @example
   * ```ts
   * cacheWarmup.register({
   *   name: 'my-task',
   *   tags: ['startup'],
   *   priority: 50,
   *   execute: async () => { /* ... *\/ },
   * });
   * ```
   */
  register(task: WarmupTask): void {
    this.tasks.set(task.name, task);
  }

  /**
   * Rimuove un task registrato.
   *
   * @param name - Nome del task da rimuovere
   */
  unregister(name: string): void {
    this.tasks.delete(name);
  }

  /**
   * Restituisce true se un task con il nome specificato è registrato.
   *
   * @param name - Nome del task
   */
  has(name: string): boolean {
    return this.tasks.has(name);
  }

  /**
   * Numero di task registrati.
   */
  get taskCount(): number {
    return this.tasks.size;
  }

  // -----------------------------------------------------------------------
  // Esecuzione
  // -----------------------------------------------------------------------

  /**
   * Esegue TUTTI i task registrati, in ordine di priorità decrescente.
   * I task con priorità più alta vengono eseguiti per primi.
   *
   * Ogni task è indipendente: se uno fallisce, gli altri continuano.
   *
   * @returns Report completo dell'operazione
   *
   * @example
   * ```ts
   * const report = await cacheWarmup.warmupAll();
   * console.log(`Fatto ${report.completed}/${report.total} in ${report.totalDuration}ms`);
   * ```
   */
  async warmupAll(): Promise<WarmupReport> {
    const sorted = this.getSortedTasks();
    return this.executeBatch(sorted);
  }

  /**
   * Esegue solo i task che hanno un determinato tag.
   *
   * @param tag - Tag per filtrare i task
   * @returns Report completo dell'operazione
   *
   * @example
   * ```ts
   * // Esegue solo i task di startup
   * const report = await cacheWarmup.warmupByTag('startup');
   *
   * // Esegue solo i task periodici
   * const report = await cacheWarmup.warmupByTag('periodic');
   * ```
   */
  async warmupByTag(tag: string): Promise<WarmupReport> {
    const filtered = this.getSortedTasks().filter((t) => t.tags.includes(tag));
    return this.executeBatch(filtered);
  }

  /**
   * Esegue un singolo task per nome.
   *
   * @param name - Nome del task da eseguire
   * @returns Risultato del singolo task
   *
   * @example
   * ```ts
   * const result = await cacheWarmup.warmupSingle('adr-list');
   * console.log(`Task ${result.name}: ${result.status} (${result.duration}ms)`);
   * ```
   */
  async warmupSingle(name: string): Promise<WarmupResult> {
    const task = this.tasks.get(name);
    if (!task) {
      return {
        name,
        status: WarmupStatus.SKIPPED,
        duration: 0,
        error: `Task '${name}' not registered`,
      };
    }

    return this.executeTask(task);
  }

  // -----------------------------------------------------------------------
  // Scheduling
  // -----------------------------------------------------------------------

  /**
   * Avvia lo scheduler periodico.
   * Esegue `warmupAll()` ogni `intervalMs` millisecondi.
   *
   * Se lo scheduler è già attivo, viene fermato e riavviato
   * con il nuovo intervallo.
   *
   * @param intervalMs - Intervallo in ms (default: 5 minuti)
   *
   * @example
   * ```ts
   * cacheWarmup.startScheduler(300_000); // ogni 5 minuti
   * ```
   */
  startScheduler(intervalMs: number = DEFAULT_SCHEDULER_INTERVAL_MS): void {
    // Ferma scheduler esistente se presente
    this.stopScheduler();

    this.schedulerTimer = setInterval(() => {
      this.warmupAll().catch((err) => {
        console.error('[cache-warmup] Scheduler error:', err instanceof Error ? err.message : String(err));
      });
    }, intervalMs);

    // Non impedisce la chiusura del processo Node.js
    if (this.schedulerTimer && typeof this.schedulerTimer === 'object' && 'unref' in this.schedulerTimer) {
      (this.schedulerTimer as NodeJS.Timeout).unref();
    }
  }

  /**
   * Ferma lo scheduler periodico.
   */
  stopScheduler(): void {
    if (this.schedulerTimer) {
      clearInterval(this.schedulerTimer);
      this.schedulerTimer = null;
    }
  }

  /**
   * Indica se lo scheduler è attualmente attivo.
   */
  get isSchedulerActive(): boolean {
    return this.schedulerTimer !== null;
  }

  // -----------------------------------------------------------------------
  // Report
  // -----------------------------------------------------------------------

  /**
   * Restituisce il report dell'ultima esecuzione di warmup.
   * Se nessuna esecuzione è ancora avvenuta, restituisce un report vuoto.
   *
   * @returns Ultimo report disponibile
   *
   * @example
   * ```ts
   * const report = cacheWarmup.getReport();
   * console.log(`Ultimo warmup: ${report.completed}/${report.total}`);
   * ```
   */
  getReport(): WarmupReport {
    if (this.lastReport) {
      return this.lastReport;
    }

    return {
      startedAt: new Date().toISOString(),
      totalDuration: 0,
      total: 0,
      completed: 0,
      failed: 0,
      skipped: 0,
      results: [],
    };
  }

  // -----------------------------------------------------------------------
  // Privato
  // -----------------------------------------------------------------------

  /**
   * Restituisce i task ordinati per priorità decrescente.
   */
  private getSortedTasks(): WarmupTask[] {
    return Array.from(this.tasks.values()).sort((a, b) => b.priority - a.priority);
  }

  /**
   * Esegue un batch di task in sequenza (non in parallelo, per non
   * sovraccaricare il DB).
   *
   * Ogni task è wrappato in try-catch: fallimenti isolati.
   */
  private async executeBatch(tasks: WarmupTask[]): Promise<WarmupReport> {
    const startedAt = new Date().toISOString();
    const startTime = Date.now();
    const results: WarmupResult[] = [];

    for (const task of tasks) {
      const result = await this.executeTask(task);
      results.push(result);
    }

    const totalDuration = Date.now() - startTime;

    const report: WarmupReport = {
      startedAt,
      totalDuration,
      total: results.length,
      completed: results.filter((r) => r.status === WarmupStatus.COMPLETED).length,
      failed: results.filter((r) => r.status === WarmupStatus.FAILED).length,
      skipped: results.filter((r) => r.status === WarmupStatus.SKIPPED).length,
      results,
    };

    this.lastReport = report;
    return report;
  }

  /**
   * Esegue un singolo task con misurazione della durata e cattura errori.
   */
  private async executeTask(task: WarmupTask): Promise<WarmupResult> {
    const startTime = Date.now();
    const executedAt = new Date().toISOString();

    try {
      await task.execute();
      const duration = Date.now() - startTime;

      return {
        name: task.name,
        status: WarmupStatus.COMPLETED,
        duration,
        ttl: task.ttl,
        executedAt,
      };
    } catch (err) {
      const duration = Date.now() - startTime;
      const errorMessage = err instanceof Error ? err.message : String(err);

      return {
        name: task.name,
        status: WarmupStatus.FAILED,
        duration,
        error: errorMessage,
        ttl: task.ttl,
        executedAt,
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton globale
// ---------------------------------------------------------------------------

/**
 * Istanza singleton di CacheWarmup.
 * Usa questa istanza per registrare task e avviare warmup.
 *
 * @example
 * ```ts
 * import { cacheWarmup, registerDefaultWarmupTasks } from './core/cache-warmup.js';
 * registerDefaultWarmupTasks();
 * await cacheWarmup.warmupByTag('startup');
 * ```
 */
export const cacheWarmup = new CacheWarmup();

// ---------------------------------------------------------------------------
// Default Warmup Tasks
// ---------------------------------------------------------------------------

/**
 * Registra i task di warmup standard per Tabularium.
 *
 * Task registrati:
 *   - **decisions-warmup** (priorità 80): carica la lista ADR in decisionsCache
 *   - **scorecard-warmup** (priorità 70): carica lo scorecard in validationCache
 *   - **agent-status-warmup** (priorità 60): carica lo stato agenti
 *   - **sessions-warmup** (priorità 50): carica le sessioni recenti
 *   - **knowledge-warmup** (priorità 40): carica le knowledge entries recenti
 *
 * Ogni task è safe: se il DB non è inizializzato o le tabelle non esistono,
 * il task fallisce silenziosamente senza bloccare gli altri.
 *
 * Puoi chiamare questa funzione più volte: i task già registrati vengono
 * sovrascritti (idempotente).
 *
 * @example
 * ```ts
 * import { registerDefaultWarmupTasks } from './core/cache-warmup.js';
 * registerDefaultWarmupTasks();
 * ```
 */
export function registerDefaultWarmupTasks(): void {
  // ── decisions-warmup ──────────────────────────────────────────────────
  cacheWarmup.register({
    name: DECISIONS_TASK,
    tags: ['startup', 'periodic'],
    priority: 80,
    ttl: 60_000,
    execute: async () => {
      try {
        const db = getDatabase();

        // Verifica se la tabella decisions esiste
        const tableCheck = db.prepare(`
          SELECT name FROM sqlite_master
          WHERE type='table' AND name=?
        `).get('decisions') as { name: string } | undefined;

        if (!tableCheck) {
          return; // Tabella non ancora creata — skip silenzioso
        }

        const rows = db.prepare(
          `SELECT id, title, status, created_at
           FROM decisions
           ORDER BY created_at DESC
           LIMIT 50`
        ).all();

        decisionsCache.set('decisions:list', rows, 60_000);

        // Cache separata per le decisioni attive
        const activeRows = db.prepare(
          `SELECT id, title, status
           FROM decisions
           WHERE status IN ('proposed', 'accepted')
           ORDER BY created_at DESC`
        ).all();

        decisionsCache.set('decisions:active', activeRows, 60_000);
      } catch {
        // DB non inizializzato o tabella assente — graceful degradation
      }
    },
  });

  // ── scorecard-warmup ──────────────────────────────────────────────────
  cacheWarmup.register({
    name: SCORECARD_TASK,
    tags: ['startup', 'periodic'],
    priority: 70,
    ttl: 120_000,
    execute: async () => {
      try {
        const db = getDatabase();

        const tableCheck = db.prepare(`
          SELECT name FROM sqlite_master
          WHERE type='table' AND name=?
        `).get('metrics') as { name: string } | undefined;

        if (!tableCheck) {
          return;
        }

        const metrics = db.prepare(
          `SELECT domain, metric_name, value, recorded_at
           FROM metrics
           WHERE recorded_at >= datetime('now', '-7 days')
           ORDER BY recorded_at DESC
           LIMIT 200`
        ).all();

        validationCache.set('scorecard:metrics', metrics, 120_000);
      } catch {
        // Graceful degradation
      }
    },
  });

  // ── agent-status-warmup ───────────────────────────────────────────────
  cacheWarmup.register({
    name: AGENT_STATUS_TASK,
    tags: ['startup', 'periodic'],
    priority: 60,
    ttl: 30_000,
    execute: async () => {
      try {
        const db = getDatabase();

        const tableCheck = db.prepare(`
          SELECT name FROM sqlite_master
          WHERE type='table' AND name=?
        `).get('agent_heartbeats') as { name: string } | undefined;

        if (!tableCheck) {
          return;
        }

        const statuses = db.prepare(
          `SELECT agent, status, current_task, last_seen
           FROM agent_heartbeats
           ORDER BY agent`
        ).all();

        validationCache.set('agents:status', statuses, 30_000);
      } catch {
        // Graceful degradation
      }
    },
  });

  // ── sessions-warmup ──────────────────────────────────────────────────
  cacheWarmup.register({
    name: SESSIONS_WARMUP_TASK,
    tags: ['startup'],
    priority: 50,
    ttl: 30_000,
    execute: async () => {
      try {
        const db = getDatabase();

        const tableCheck = db.prepare(`
          SELECT name FROM sqlite_master
          WHERE type='table' AND name=?
        `).get('sessions') as { name: string } | undefined;

        if (!tableCheck) {
          return;
        }

        const sessions = db.prepare(
          `SELECT id, agent_name, status, started_at
           FROM sessions
           WHERE status = 'active'
           ORDER BY started_at DESC
           LIMIT 20`
        ).all();

        memorySessionsCache.set('sessions:active', sessions, 30_000);
      } catch {
        // Graceful degradation
      }
    },
  });

  // ── knowledge-warmup ─────────────────────────────────────────────────
  cacheWarmup.register({
    name: KNOWLEDGE_WARMUP_TASK,
    tags: ['startup'],
    priority: 40,
    ttl: 60_000,
    execute: async () => {
      try {
        const db = getDatabase();

        const tableCheck = db.prepare(`
          SELECT name FROM sqlite_master
          WHERE type='table' AND name=?
        `).get('knowledge_entries') as { name: string } | undefined;

        if (!tableCheck) {
          return;
        }

        const entries = db.prepare(
          `SELECT id, title, category, tags, created_at
           FROM knowledge_entries
           ORDER BY created_at DESC
           LIMIT 50`
        ).all();

        memoryKnowledgeCache.set('knowledge:recent', entries, 60_000);
      } catch {
        // Graceful degradation
      }
    },
  });
}
