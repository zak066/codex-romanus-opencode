/**
 * core/bug-tracker.ts
 * Sistema di bug tracking strutturato per la Fase 7 FABRICA.
 *
 * Gestisce il ciclo di vita dei bug: report, update, query e trend analysis.
 * I bug sono memorizzati nella tabella SQLite `bugs` e hanno un ciclo
 * di vita: open → in_progress → fixed → verified → closed.
 *
 * Pattern:
 *   - Stesso stile di alert-manager.ts (better-sqlite3, prepared statements)
 *   - Cache-aside con Cache<T> e TTL 30 secondi
 *   - Prefisso ID: bug_{uuid}
 *
 * @module core/bug-tracker
 */

import crypto from 'node:crypto';
import { getDatabase } from './database.js';
import { Cache } from './cache.js';

// ---------------------------------------------------------------------------
// Tipi pubblici
// ---------------------------------------------------------------------------

/** Severità di un bug */
export type BugSeverity = 'cosmetic' | 'minor' | 'major' | 'critical' | 'blocker';

/** Stato del ciclo di vita */
export type BugStatus = 'open' | 'in_progress' | 'fixed' | 'verified' | 'closed';

/** Categoria della root cause */
export type RootCauseCategory = 'logic' | 'typo' | 'regression' | 'config' | 'external' | 'unknown';

/** Record completo di un bug (corrisponde a una riga della tabella bugs) */
export interface BugRecord {
  id: string;
  title: string;
  description: string;
  component: string;
  severity: BugSeverity;
  status: BugStatus;
  root_cause_category?: RootCauseCategory;
  affected_files?: string[];
  fix_ref?: string;
  reported_by: string;
  assigned_to?: string;
  created_at: string;
  updated_at: string;
  closed_at?: string;
  tags?: Record<string, unknown>;
}

/** Parametri per la creazione di un nuovo bug */
export interface CreateBugParams {
  title: string;
  description: string;
  component: string;
  severity: string;
  root_cause_category?: string;
  affected_files?: string[];
  reported_by: string;
  assigned_to?: string;
  tags?: Record<string, unknown>;
}

/** Filtri per listBugs */
export interface ListBugsParams {
  status?: string;
  severity?: string;
  component?: string;
  assigned_to?: string;
  limit?: number;
  offset?: number;
}

/** Risultato di listBugs */
export interface ListBugsResult {
  bugs: BugRecord[];
  total: number;
}

/** Dato di trend per un singolo giorno */
export interface TrendDay {
  date: string;
  closed: number;
  opened: number;
}

/** Risultato di getBugTrend */
export interface BugTrend {
  days: TrendDay[];
  total_closed: number;
  total_opened: number;
  avg_per_day: number;
  component?: string;
  period_days: number;
}

// ---------------------------------------------------------------------------
// Costanti
// ---------------------------------------------------------------------------

/** Severità valide */
const VALID_SEVERITIES: BugSeverity[] = ['cosmetic', 'minor', 'major', 'critical', 'blocker'];

/** Status validi per il ciclo di vita */
const VALID_STATUSES: BugStatus[] = ['open', 'in_progress', 'fixed', 'verified', 'closed'];

/** Transizioni di stato consentite */
const STATUS_TRANSITIONS: Record<BugStatus, BugStatus[]> = {
  open: ['in_progress', 'closed'],
  in_progress: ['fixed', 'closed'],
  fixed: ['verified', 'open', 'closed'],
  verified: ['closed', 'open'],
  closed: ['open'],
};

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

/**
 * Cache per bug — TTL 30 secondi.
 * I bug cambiano con operazioni di update/create, quindi un TTL breve
 * garantisce dati freschi senza impattare le performance.
 */
const bugsCache = new Cache<unknown>(30_000);

/** Prefisso per chiavi cache */
const CACHE_PREFIX = 'bugs:';

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

/**
 * Crea la tabella `bugs` e gli indici se non esistono.
 * Chiamata all'avvio del server o al primo utilizzo per garantire
 * che lo schema sia presente (fallback se la migration non è ancora passata).
 *
 * Usa `CREATE TABLE IF NOT EXISTS` e `CREATE INDEX IF NOT EXISTS`
 * per essere idempotente.
 */
export function ensureBugSchema(): void {
  const db = getDatabase();

  db.exec(`
    CREATE TABLE IF NOT EXISTS bugs (
      id                TEXT PRIMARY KEY,
      title             TEXT NOT NULL,
      description       TEXT NOT NULL,
      component         TEXT NOT NULL,
      severity          TEXT NOT NULL
                        CHECK(severity IN ('cosmetic','minor','major','critical','blocker')),
      status            TEXT NOT NULL DEFAULT 'open'
                        CHECK(status IN ('open','in_progress','fixed','verified','closed')),
      root_cause_category TEXT,
      affected_files      TEXT,
      fix_ref             TEXT,
      reported_by         TEXT NOT NULL,
      assigned_to         TEXT,
      created_at          TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at          TEXT NOT NULL DEFAULT (datetime('now')),
      closed_at           TEXT,
      tags                TEXT
    )
  `);

  db.exec('CREATE INDEX IF NOT EXISTS idx_bugs_status ON bugs(status)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_bugs_severity ON bugs(severity)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_bugs_component ON bugs(component)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_bugs_created_at ON bugs(created_at)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_bugs_assigned_to ON bugs(assigned_to)');
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

/**
 * Registra un nuovo bug nel database.
 *
 * @param params - Parametri per la creazione del bug
 * @returns Il bug appena creato
 *
 * @example
 * ```ts
 * const bug = reportBug({
 *   title: 'Null pointer in login flow',
 *   description: 'When user submits empty form...',
 *   component: 'auth',
 *   severity: 'major',
 *   reported_by: 'vulcanus-senior-dev',
 *   affected_files: ['src/auth/login.ts'],
 * });
 * ```
 */
export function reportBug(params: CreateBugParams): BugRecord {
  const db = getDatabase();

  // Validazione severity
  const severity = params.severity.toLowerCase() as BugSeverity;
  if (!VALID_SEVERITIES.includes(severity)) {
    throw new Error(
      `Invalid severity '${params.severity}'. Supported values: ${VALID_SEVERITIES.join(', ')}`
    );
  }

  const id = `bug_${crypto.randomUUID()}`;
  const affectedFilesJson = params.affected_files
    ? JSON.stringify(params.affected_files)
    : null;
  const tagsJson = params.tags ? JSON.stringify(params.tags) : null;
  const rootCauseCategory = params.root_cause_category
    ? params.root_cause_category.toLowerCase()
    : null;

  db.prepare(`
    INSERT INTO bugs (id, title, description, component, severity,
                      root_cause_category, affected_files, reported_by,
                      assigned_to, tags)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    params.title,
    params.description,
    params.component,
    severity,
    rootCauseCategory,
    affectedFilesJson,
    params.reported_by,
    params.assigned_to ?? null,
    tagsJson,
  );

  // Invalida cache

  // Invia notifica messaging per bug (fire-and-forget)
  (async () => {
    try {
      const { emit } = await import('../messaging/event-bus.js');
      const { getChannelByName } = await import('../messaging/db-channels.js');
      const { sendMessage } = await import('../messaging/db-messages.js');

      const bugsChannel = getChannelByName('bugs');
      if (bugsChannel) {
        const msg = sendMessage(bugsChannel.id, 'system',
          `🐛 Bug reported: ${params.title} [${severity}]`,
          { bug_id: id, severity }
        );
        emit({
          type: 'message_sent',
          payload: { message: msg, channel: '#bugs' },
          timestamp: new Date().toISOString(),
          channel_id: bugsChannel.id,
          agent_name: 'system',
        });
      }
    } catch {
      // Non bloccare se messaging non è ancora inizializzato
    }
  })();

  invalidateBugCache();

  return getBugById(id);
}

// ---------------------------------------------------------------------------
// Read / List
// ---------------------------------------------------------------------------

/**
 * Recupera un bug per ID.
 *
 * @param id - ID del bug
 * @returns BugRecord
 * @throws Error se il bug non esiste
 */
export function getBugById(id: string): BugRecord {
  const db = getDatabase();
  const row = db.prepare('SELECT * FROM bugs WHERE id = ?').get(id) as Record<string, unknown> | undefined;

  if (!row) {
    throw new Error(`Bug not found: ${id}`);
  }

  return parseBugRow(row);
}

/**
 * Elenca bug con filtri opzionali.
 *
 * Supporta filtri per status, severity, component, assigned_to.
 * I risultati sono paginati con limit/offset.
 *
 * @param params - Filtri opzionali
 * @returns Lista di bug e conteggio totale
 *
 * @example
 * ```ts
 * // Tutti i bug aperti
 * const { bugs, total } = listBugs({ status: 'open' });
 *
 * // Bug critici del componente auth
 * const criticalAuth = listBugs({ severity: 'critical', component: 'auth' });
 * ```
 */
export function listBugs(params?: ListBugsParams): ListBugsResult {
  const db = getDatabase();

  const status = params?.status;
  const severity = params?.severity;
  const component = params?.component;
  const assignedTo = params?.assigned_to;
  const limit = params?.limit ?? 50;
  const offset = params?.offset ?? 0;

  // Cache key basata sui parametri
  const cacheKey = buildBugCacheKey('list', {
    status: status ?? '',
    severity: severity ?? '',
    component: component ?? '',
    assigned_to: assignedTo ?? '',
    limit: String(limit),
    offset: String(offset),
  });

  // Cache-aside
  const cached = bugsCache.get(cacheKey);
  if (cached) {
    return cached as ListBugsResult;
  }

  // Costruisci filtri WHERE dinamici
  const whereClauses: string[] = [];
  const queryParams: unknown[] = [];

  if (status) {
    whereClauses.push('status = ?');
    queryParams.push(status.toLowerCase());
  }

  if (severity) {
    whereClauses.push('severity = ?');
    queryParams.push(severity.toLowerCase());
  }

  if (component) {
    whereClauses.push('component = ?');
    queryParams.push(component);
  }

  if (assignedTo) {
    whereClauses.push('assigned_to = ?');
    queryParams.push(assignedTo);
  }

  const whereSQL = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

  // Count totale
  const countRow = db.prepare(`SELECT COUNT(*) AS total FROM bugs ${whereSQL}`).get(...queryParams) as { total: number };
  const total = countRow.total;

  // Query paginata
  const rows = db.prepare(`
    SELECT * FROM bugs ${whereSQL}
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `).all(...queryParams, limit, offset) as Record<string, unknown>[];

  const bugs = rows.map(parseBugRow);

  const result: ListBugsResult = { bugs, total };

  // Popola cache
  bugsCache.set(cacheKey, result);

  return result;
}

// ---------------------------------------------------------------------------
// Update Status
// ---------------------------------------------------------------------------

/**
 * Valida che la transizione di stato sia consentita.
 *
 * @param currentStatus - Stato attuale
 * @param newStatus - Stato richiesto
 * @throws Error se la transizione non è consentita
 */
function validateStatusTransition(currentStatus: BugStatus, newStatus: BugStatus): void {
  if (currentStatus === newStatus) {
    return; // Stesso stato — permesso (idempotente)
  }

  const allowed = STATUS_TRANSITIONS[currentStatus];
  if (!allowed || !allowed.includes(newStatus)) {
    throw new Error(
      `Invalid status transition: '${currentStatus}' → '${newStatus}'. ` +
      `Allowed transitions from '${currentStatus}': ${allowed?.join(', ') ?? 'none'}`
    );
  }
}

/**
 * Aggiorna lo stato di un bug.
 *
 * Valida la transizione di stato secondo le regole:
 *   open → in_progress | closed
 *   in_progress → fixed | closed
 *   fixed → verified | open | closed
 *   verified → closed | open
 *   closed → open (reopen)
 *
 * @param id - ID del bug
 * @param status - Nuovo stato
 * @param by - Agente o utente che effettua l'update (opzionale, usato per assigned_to)
 * @returns BugRecord aggiornato
 *
 * @throws Error se il bug non esiste o la transizione non è consentita
 */
export function updateBugStatus(id: string, status: string, by?: string): BugRecord {
  const db = getDatabase();

  // Verifica che il bug esista
  const existing = db.prepare('SELECT id, status FROM bugs WHERE id = ?').get(id) as { id: string; status: string } | undefined;

  if (!existing) {
    throw new Error(`Bug not found: ${id}`);
  }

  const currentStatus = existing.status as BugStatus;
  const newStatus = status.toLowerCase() as BugStatus;

  // Valida lo stato richiesto
  if (!VALID_STATUSES.includes(newStatus)) {
    throw new Error(
      `Invalid status '${status}'. Supported values: ${VALID_STATUSES.join(', ')}`
    );
  }

  // Valida la transizione
  validateStatusTransition(currentStatus, newStatus);

  // Esegui UPDATE con assigned_to opzionale (se fornito, aggiorna anche l'assegnatario)
  if (by) {
    db.prepare(`
      UPDATE bugs
      SET status = ?, assigned_to = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(newStatus, by, id);
  } else {
    db.prepare(`
      UPDATE bugs
      SET status = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(newStatus, id);
  }

  // Invalida cache
  invalidateBugCache();

  return getBugById(id);
}

// ---------------------------------------------------------------------------
// Trend
// ---------------------------------------------------------------------------

/**
 * Analisi dei trend dei bug chiusi e aperti nel tempo.
 *
 * Restituisce una serie temporale giorno per giorno con il conteggio
 * di bug chiusi e aperti, utile per dashboard e reportistica.
 *
 * @param component - Filtra per componente (opzionale)
 * @param days - Finestra temporale in giorni (default: 30)
 * @returns BugTrend con serie temporale e statistiche aggregate
 *
 * @example
 * ```ts
 * // Trend degli ultimi 30 giorni per il componente auth
 * const trend = getBugTrend('auth', 30);
 * ```
 */
export function getBugTrend(component?: string, days?: number): BugTrend {
  const db = getDatabase();
  const periodDays = days ?? 30;

  // Costruisci la data di inizio
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - periodDays);
  const startDateStr = startDate.toISOString().split('T')[0];

  // Parametri per le query
  const queryParams: unknown[] = [startDateStr];
  let componentFilter = '';

  if (component) {
    componentFilter = ' AND component = ?';
    queryParams.push(component);
  }

  // Bug chiusi per giorno
  const closedRows = db.prepare(`
    SELECT DATE(closed_at) AS date, COUNT(*) AS count
    FROM bugs
    WHERE closed_at IS NOT NULL
      AND DATE(closed_at) >= ?
      ${componentFilter}
    GROUP BY DATE(closed_at)
    ORDER BY date ASC
  `).all(...queryParams) as Array<{ date: string; count: number }>;

  // Bug aperti per giorno (basato su created_at)
  const openedRows = db.prepare(`
    SELECT DATE(created_at) AS date, COUNT(*) AS count
    FROM bugs
    WHERE DATE(created_at) >= ?
      ${componentFilter}
    GROUP BY DATE(created_at)
    ORDER BY date ASC
  `).all(...queryParams) as Array<{ date: string; count: number }>;

  // Costruisci mappe per lookup O(1)
  const closedMap = new Map<string, number>();
  for (const row of closedRows) {
    closedMap.set(row.date, row.count);
  }

  const openedMap = new Map<string, number>();
  for (const row of openedRows) {
    openedMap.set(row.date, row.count);
  }

  // Genera serie temporale completa giorno per giorno
  const trendDays: TrendDay[] = [];
  let totalClosed = 0;
  let totalOpened = 0;

  for (let i = periodDays - 1; i >= 0; i--) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    const dateStr = date.toISOString().split('T')[0];

    const closed = closedMap.get(dateStr) ?? 0;
    const opened = openedMap.get(dateStr) ?? 0;

    totalClosed += closed;
    totalOpened += opened;

    trendDays.push({ date: dateStr, closed, opened });
  }

  const avgPerDay = periodDays > 0 ? Math.round((totalClosed / periodDays) * 100) / 100 : 0;

  return {
    days: trendDays,
    total_closed: totalClosed,
    total_opened: totalOpened,
    avg_per_day: avgPerDay,
    component: component ?? undefined,
    period_days: periodDays,
  };
}

// ---------------------------------------------------------------------------
// Helpers interni
// ---------------------------------------------------------------------------

/**
 * Invalida tutte le entry in cache relative ai bug.
 * Chiamata dopo ogni operazione di scrittura (report, updateStatus).
 */
function invalidateBugCache(): void {
  bugsCache.invalidatePrefix(CACHE_PREFIX);
}

/**
 * Resetta completamente la cache dei bug.
 * Utile per test che ricreano il database da capo.
 *
 * @example
 * ```ts
 * // In un beforeEach di test
 * resetBugCache();
 * ```
 */
export function resetBugCache(): void {
  bugsCache.clear();
}

/**
 * Costruisce una chiave cache deterministica per query bug.
 */
function buildBugCacheKey(prefix: string, parts: Record<string, string>): string {
  const sorted = Object.keys(parts)
    .sort()
    .map((k) => `${k}=${parts[k]}`)
    .join('&');
  return `${CACHE_PREFIX}${prefix}:${sorted}`;
}

/**
 * Parsifica una riga dal database in un BugRecord tipizzato.
 *
 * Converte:
 *   - tags da stringa JSON a oggetto (o undefined se null/'{}')
 *   - affected_files da stringa JSON a array (o undefined se null)
 *   - root_cause_category, fix_ref, assigned_to, closed_at da null a undefined
 */
function parseBugRow(row: Record<string, unknown>): BugRecord {
  return {
    id: String(row.id ?? ''),
    title: String(row.title ?? ''),
    description: String(row.description ?? ''),
    component: String(row.component ?? ''),
    severity: String(row.severity ?? 'minor') as BugSeverity,
    status: String(row.status ?? 'open') as BugStatus,
    root_cause_category: row.root_cause_category
      ? String(row.root_cause_category) as RootCauseCategory
      : undefined,
    affected_files: parseJsonArray(row.affected_files as string | null | undefined),
    fix_ref: row.fix_ref ? String(row.fix_ref) : undefined,
    reported_by: String(row.reported_by ?? ''),
    assigned_to: row.assigned_to ? String(row.assigned_to) : undefined,
    created_at: String(row.created_at ?? ''),
    updated_at: String(row.updated_at ?? ''),
    closed_at: row.closed_at ? String(row.closed_at) : undefined,
    tags: parseTags(row.tags as string | null | undefined),
  };
}

/**
 * Parsifica un JSON string di tags in oggetto.
 * Restituisce undefined in caso di null/stringa vuota/errore di parsing.
 */
function parseTags(tagsJson: string | null | undefined): Record<string, unknown> | undefined {
  if (!tagsJson || tagsJson === '{}') return undefined;
  try {
    return JSON.parse(tagsJson) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

/**
 * Parsifica un JSON string di array.
 * Restituisce undefined in caso di null/stringa vuota/errore di parsing.
 */
function parseJsonArray(jsonStr: string | null | undefined): string[] | undefined {
  if (!jsonStr || jsonStr === '[]') return undefined;
  try {
    const parsed = JSON.parse(jsonStr);
    return Array.isArray(parsed) ? parsed.map(String) : undefined;
  } catch {
    return undefined;
  }
}
