/**
 * core/alert-manager.ts
 * Sistema di alert centralizzato per la Fase 6 AUTOMATA.
 *
 * Gestisce il ciclo di vita degli alert: creazione, list, acknowledge e resolve.
 * Gli alert sono memorizzati nella tabella SQLite `alerts` e hanno un ciclo
 * di vita: open → acknowledged → resolved.
 *
 * Pattern:
 *   - Stesso stile di metrics-engine.ts (better-sqlite3, prepared statements)
 *   - Cache-aside con Cache<T> e TTL 30 secondi
 *   - Prefisso ID: alr_{uuid}
 *
 * @module core/alert-manager
 */

import crypto from 'node:crypto';
import { getDatabase } from './database.js';
import { Cache } from './cache.js';

// ---------------------------------------------------------------------------
// Tipi pubblici
// ---------------------------------------------------------------------------

/** Severità di un alert */
export type AlertSeverity = 'low' | 'medium' | 'high' | 'critical';

/** Fonte di generazione dell'alert */
export type AlertSource = 'quality_gate' | 'regression_detector' | 'manual';

/** Stato del ciclo di vita */
export type AlertStatus = 'open' | 'acknowledged' | 'resolved';

/** Record completo di alert (corrisponde a una riga della tabella alerts) */
export interface AlertRecord {
  id: string;
  domain: string;
  metric_name: string;
  severity: AlertSeverity;
  source: AlertSource;
  message: string;
  current_value?: number;
  threshold_value?: number;
  deviation_pct?: number;
  status: AlertStatus;
  created_at: string;
  acknowledged_at?: string;
  acknowledged_by?: string;
  resolved_at?: string;
  resolved_by?: string;
  tags?: Record<string, unknown>;
}

/** Parametri per la creazione di un nuovo alert */
export interface CreateAlertParams {
  domain: string;
  metric_name: string;
  severity: AlertSeverity;
  source: AlertSource;
  message: string;
  current_value?: number;
  threshold_value?: number;
  deviation_pct?: number;
  tags?: Record<string, unknown>;
}

/** Filtri per listAlerts */
export interface ListAlertsParams {
  status?: AlertStatus;
  domain?: string;
  severity?: string;
  limit?: number;
  offset?: number;
}

/** Risultato di listAlerts */
export interface ListAlertsResult {
  alerts: AlertRecord[];
  total: number;
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

/**
 * Cache per alert attivi — TTL 30 secondi.
 * Gli alert cambiano frequentemente (acknowledge/resolve aggiornano lo stato),
 * quindi un TTL breve garantisce dati freschi senza impattare le performance.
 */
const alertsCache = new Cache<unknown>(30_000);

/** Prefisso per chiavi cache */
const CACHE_PREFIX = 'alerts:';

// ---------------------------------------------------------------------------
// Domini validi
// ---------------------------------------------------------------------------

const VALID_DOMAINS = ['quality', 'perf', 'security', 'test', 'seo', 'devops'];

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

/**
 * Crea la tabella `alerts` e gli indici se non esistono.
 * Chiamata all'avvio del server o al primo utilizzo per garantire
 * che lo schema sia presente (fallback se la migration non è ancora passata).
 *
 * Usa `CREATE TABLE IF NOT EXISTS` e `CREATE INDEX IF NOT EXISTS`
 * per essere idempotente.
 */
export function ensureAlertSchema(): void {
  const db = getDatabase();

  db.exec(`
    CREATE TABLE IF NOT EXISTS alerts (
      id                TEXT PRIMARY KEY,
      domain            TEXT NOT NULL,
      metric_name       TEXT NOT NULL,
      severity          TEXT NOT NULL
                        CHECK (severity IN ('low', 'medium', 'high', 'critical')),
      source            TEXT NOT NULL
                        CHECK (source IN ('quality_gate', 'regression_detector', 'manual')),
      message           TEXT NOT NULL,
      current_value     REAL,
      threshold_value   REAL,
      deviation_pct     REAL,
      status            TEXT NOT NULL DEFAULT 'open'
                        CHECK (status IN ('open', 'acknowledged', 'resolved')),
      created_at        TEXT NOT NULL DEFAULT (datetime('now')),
      acknowledged_at   TEXT,
      acknowledged_by   TEXT,
      resolved_at       TEXT,
      resolved_by       TEXT,
      tags              TEXT
    )
  `);

  db.exec('CREATE INDEX IF NOT EXISTS idx_alerts_status ON alerts(status)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_alerts_severity ON alerts(severity)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_alerts_domain ON alerts(domain)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_alerts_created_at ON alerts(created_at)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_alerts_source ON alerts(source)');
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

/**
 * Crea un nuovo alert nel database.
 *
 * @param params - Parametri per la creazione dell'alert
 * @returns L'alert appena creato
 *
 * @example
 * ```ts
 * const alert = createAlert({
 *   domain: 'quality',
 *   metric_name: 'lint_errors',
 *   severity: 'high',
 *   source: 'quality_gate',
 *   message: 'Lint errors exceeded threshold: 12 > 0',
 *   current_value: 12,
 *   threshold_value: 0,
 *   tags: { agent: 'catone-quality' },
 * });
 * ```
 */
export function createAlert(params: CreateAlertParams): AlertRecord {
  const db = getDatabase();
  const id = `alr_${crypto.randomUUID()}`;
  const domainLower = params.domain.toLowerCase();
  const tagsJson = params.tags ? JSON.stringify(params.tags) : null;

  db.prepare(`
    INSERT INTO alerts (id, domain, metric_name, severity, source, message,
                        current_value, threshold_value, deviation_pct, tags)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    domainLower,
    params.metric_name,
    params.severity,
    params.source,
    params.message,
    params.current_value ?? null,
    params.threshold_value ?? null,
    params.deviation_pct ?? null,
    tagsJson,
  );

  // Invalida cache

  // Invia notifica messaging per alert critici (fire-and-forget)
  (async () => {
    try {
      const { emit } = await import('../messaging/event-bus.js');
      const { getChannelByName } = await import('../messaging/db-channels.js');
      const { sendMessage } = await import('../messaging/db-messages.js');

      const alertsChannel = getChannelByName('alerts');
      if (alertsChannel) {
        const msg = sendMessage(alertsChannel.id, 'system',
          `🔴 Alert [${params.severity}]: ${params.message}`,
          { alert_id: id, alert_type: params.source }
        );
        emit({
          type: 'message_sent',
          payload: { message: msg, channel: '#alerts' },
          timestamp: new Date().toISOString(),
          channel_id: alertsChannel.id,
          agent_name: 'system',
        });
      }
    } catch {
      // Non bloccare se messaging non è ancora inizializzato
    }
  })();

  invalidateAlertCache();

  return getAlertById(id);
}

// ---------------------------------------------------------------------------
// Read / List
// ---------------------------------------------------------------------------

/**
 * Recupera un alert per ID.
 *
 * @param id - ID dell'alert
 * @returns AlertRecord o undefined se non trovato
 */
export function getAlertById(id: string): AlertRecord {
  const db = getDatabase();
  const row = db.prepare('SELECT * FROM alerts WHERE id = ?').get(id) as Record<string, unknown> | undefined;

  if (!row) {
    throw new Error(`Alert not found: ${id}`);
  }

  return parseAlertRow(row);
}

/**
 * Elenca alert con filtri opzionali.
 *
 * Supporta filtri per status, domain, severity.
 * I risultati sono paginati con limit/offset.
 *
 * @param params - Filtri opzionali
 * @returns Lista di alert e conteggio totale
 *
 * @example
 * ```ts
 * // Tutti gli alert aperti
 * const { alerts, total } = listAlerts({ status: 'open' });
 *
 * // Alert critici di quality
 * const criticalQuality = listAlerts({ severity: 'critical', domain: 'quality' });
 * ```
 */
export function listAlerts(params?: ListAlertsParams): ListAlertsResult {
  const db = getDatabase();

  const status = params?.status;
  const domain = params?.domain;
  const severity = params?.severity;
  const limit = params?.limit ?? 50;
  const offset = params?.offset ?? 0;

  // Cache key basata sui parametri
  const cacheKey = buildAlertCacheKey('list', {
    status: status ?? '',
    domain: domain ?? '',
    severity: severity ?? '',
    limit: String(limit),
    offset: String(offset),
  });

  // Cache-aside
  const cached = alertsCache.get(cacheKey);
  if (cached) {
    return cached as ListAlertsResult;
  }

  // Costruisci filtri WHERE dinamici
  const whereClauses: string[] = [];
  const queryParams: unknown[] = [];

  if (status) {
    whereClauses.push('status = ?');
    queryParams.push(status);
  }

  if (domain) {
    whereClauses.push('domain = ?');
    queryParams.push(domain.toLowerCase());
  }

  if (severity) {
    whereClauses.push('severity = ?');
    queryParams.push(severity);
  }

  const whereSQL = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

  // Count totale
  const countRow = db.prepare(`SELECT COUNT(*) AS total FROM alerts ${whereSQL}`).get(...queryParams) as { total: number };
  const total = countRow.total;

  // Query paginata
  const rows = db.prepare(`
    SELECT * FROM alerts ${whereSQL}
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `).all(...queryParams, limit, offset) as Record<string, unknown>[];

  const alerts = rows.map(parseAlertRow);

  const result: ListAlertsResult = { alerts, total };

  // Popola cache
  alertsCache.set(cacheKey, result);

  return result;
}

// ---------------------------------------------------------------------------
// Acknowledge
// ---------------------------------------------------------------------------

/**
 * Marca un alert come acknowledged.
 *
 * Aggiorna status = 'acknowledged', acknowledged_at e acknowledged_by.
 * L'alert deve essere in stato 'open' per poter essere acknowledge.
 *
 * @param id - ID dell'alert
 * @param by - Nome dell'agente o utente che acknowledge
 * @returns AlertRecord aggiornato
 *
 * @throws Error se l'alert non esiste o non è in stato 'open'
 */
export function acknowledgeAlert(id: string, by: string): AlertRecord {
  const db = getDatabase();

  // Verifica che l'alert esista e sia in stato 'open'
  const existing = db.prepare('SELECT id, status FROM alerts WHERE id = ?').get(id) as { id: string; status: string } | undefined;

  if (!existing) {
    throw new Error(`Alert not found: ${id}`);
  }

  if (existing.status !== 'open') {
    throw new Error(`Cannot acknowledge alert '${id}': current status is '${existing.status}', expected 'open'`);
  }

  const acknowledgedAt = new Date().toISOString();

  db.prepare(`
    UPDATE alerts
    SET status = 'acknowledged', acknowledged_at = ?, acknowledged_by = ?
    WHERE id = ?
  `).run(acknowledgedAt, by, id);

  // Invalida cache
  invalidateAlertCache();

  return getAlertById(id);
}

// ---------------------------------------------------------------------------
// Resolve
// ---------------------------------------------------------------------------

/**
 * Risolve un alert (lo chiude definitivamente).
 *
 * Aggiorna status = 'resolved' e resolved_by.
 * resolved_at viene impostato automaticamente dal trigger SQL
 * `trg_alerts_resolved`.
 *
 * L'alert deve esistere per essere risolto (qualsiasi stato, anche 'open'
 * o 'acknowledged').
 *
 * @param id - ID dell'alert
 * @param by - Nome dell'agente o utente che risolve
 * @returns AlertRecord aggiornato
 *
 * @throws Error se l'alert non esiste o è già risolto
 */
export function resolveAlert(id: string, by: string): AlertRecord {
  const db = getDatabase();

  // Verifica che l'alert esista e non sia già risolto
  const existing = db.prepare('SELECT id, status FROM alerts WHERE id = ?').get(id) as { id: string; status: string } | undefined;

  if (!existing) {
    throw new Error(`Alert not found: ${id}`);
  }

  if (existing.status === 'resolved') {
    throw new Error(`Alert '${id}' is already resolved`);
  }

  db.prepare(`
    UPDATE alerts
    SET status = 'resolved', resolved_by = ?
    WHERE id = ?
  `).run(by, id);

  // Invalida cache
  invalidateAlertCache();

  return getAlertById(id);
}

// ---------------------------------------------------------------------------
// Helpers interni
// ---------------------------------------------------------------------------

/**
 * Invalida tutte le entry in cache relative agli alert.
 * Chiamata dopo ogni operazione di scrittura (create, acknowledge, resolve).
 */
function invalidateAlertCache(): void {
  alertsCache.invalidatePrefix(CACHE_PREFIX);
}

/**
 * Resetta completamente la cache degli alert.
 * Utile per test che ricreano il database da capo.
 *
 * @example
 * ```ts
 * // In un beforeEach di test
 * resetAlertCache();
 * ```
 */
export function resetAlertCache(): void {
  alertsCache.clear();
}

/**
 * Costruisce una chiave cache deterministica per query alert.
 */
function buildAlertCacheKey(prefix: string, parts: Record<string, string>): string {
  const sorted = Object.keys(parts)
    .sort()
    .map((k) => `${k}=${parts[k]}`)
    .join('&');
  return `${CACHE_PREFIX}${prefix}:${sorted}`;
}

/**
 * Parsifica una riga dal database in un AlertRecord tipizzato.
 *
 * Converte:
 *   - tags da stringa JSON a oggetto (o undefined se null/'{}')
 *   - current_value, threshold_value, deviation_pct da null a undefined
 *   - acknowledged_at, resolved_at da stringa vuota/null a undefined
 *
 * La row arriva da better-sqlite3 come Record<string, unknown>,
 * quindi usiamo una conversione intermedia per TypeScript.
 */
function parseAlertRow(row: Record<string, unknown>): AlertRecord {
  return {
    id: String(row.id ?? ''),
    domain: String(row.domain ?? ''),
    metric_name: String(row.metric_name ?? ''),
    severity: String(row.severity ?? 'low') as AlertSeverity,
    source: String(row.source ?? 'manual') as AlertSource,
    message: String(row.message ?? ''),
    current_value: row.current_value != null ? Number(row.current_value) : undefined,
    threshold_value: row.threshold_value != null ? Number(row.threshold_value) : undefined,
    deviation_pct: row.deviation_pct != null ? Number(row.deviation_pct) : undefined,
    status: String(row.status ?? 'open') as AlertStatus,
    created_at: String(row.created_at ?? ''),
    acknowledged_at: row.acknowledged_at ? String(row.acknowledged_at) : undefined,
    acknowledged_by: row.acknowledged_by ? String(row.acknowledged_by) : undefined,
    resolved_at: row.resolved_at ? String(row.resolved_at) : undefined,
    resolved_by: row.resolved_by ? String(row.resolved_by) : undefined,
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
