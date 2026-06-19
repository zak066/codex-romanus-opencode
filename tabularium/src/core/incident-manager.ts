/**
 * core/incident-manager.ts
 * Sistema di Incident Management per la Fase 8 PANTHEON.
 *
 * Gestisce il ciclo di vita degli incidenti: detected → mitigated → resolved.
 * Gli incidenti sono memorizzati nella tabella SQLite `incidents` e hanno un ciclo
 * di vita che segue le regole di transizione:
 *   - detected → mitigated ✅
 *   - detected → resolved ✅ (solo se severity = 'minor')
 *   - mitigated → resolved ✅
 *
 * Pattern:
 *   - Stesso stile di alert-manager.ts e bug-tracker.ts (better-sqlite3, prepared statements)
 *   - Cache-aside con Cache<T> e TTL 30 secondi
 *   - Prefisso ID: inc_{uuid}
 *
 * @module core/incident-manager
 */

import crypto from 'node:crypto';
import { getDatabase } from './database.js';
import { Cache } from './cache.js';

// ---------------------------------------------------------------------------
// Tipi pubblici
// ---------------------------------------------------------------------------

/** Severità di un incidente */
export type IncidentSeverity = 'minor' | 'major' | 'critical';

/** Stato del ciclo di vita */
export type IncidentStatus = 'detected' | 'mitigated' | 'resolved';

/** Record completo di un incidente (corrisponde a una riga della tabella incidents) */
export interface IncidentRecord {
  id: string;
  title: string;
  description: string;
  severity: IncidentSeverity;
  status: IncidentStatus;
  domain?: string;
  source?: string;
  detected_at: string;
  mitigated_at?: string;
  mitigated_by?: string;
  resolved_at?: string;
  resolved_by?: string;
  root_cause?: string;
  action_taken?: string;
  tags?: Record<string, unknown>;
}

/** Parametri per la creazione di un nuovo incidente */
export interface CreateIncidentParams {
  title: string;
  description: string;
  severity: string;
  domain?: string;
  source?: string;
  tags?: Record<string, unknown>;
}

/** Filtri per listIncidents */
export interface ListIncidentsParams {
  status?: string;
  severity?: string;
  domain?: string;
  limit?: number;
  offset?: number;
}

/** Risultato di listIncidents */
export interface ListIncidentsResult {
  incidents: IncidentRecord[];
  total: number;
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

/**
 * Cache per incidenti — TTL 30 secondi.
 * Gli incidenti cambiano con operazioni di mitigate/resolve, quindi
 * un TTL breve garantisce dati freschi senza impattare le performance.
 */
const incidentsCache = new Cache<unknown>(30_000);

/** Prefisso per chiavi cache */
const CACHE_PREFIX = 'incidents:';

// ---------------------------------------------------------------------------
// Domini validi
// ---------------------------------------------------------------------------

const VALID_DOMAINS = ['quality', 'perf', 'security', 'test', 'devops'];

const VALID_SEVERITIES: IncidentSeverity[] = ['minor', 'major', 'critical'];

const VALID_STATUSES: IncidentStatus[] = ['detected', 'mitigated', 'resolved'];

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

/**
 * Crea la tabella `incidents` e gli indici se non esistono.
 * Chiamata all'avvio del server o al primo utilizzo per garantire
 * che lo schema sia presente (fallback se la migration non è ancora passata).
 *
 * Usa `CREATE TABLE IF NOT EXISTS` e `CREATE INDEX IF NOT EXISTS`
 * per essere idempotente.
 */
export function ensureIncidentSchema(): void {
  const db = getDatabase();

  db.exec(`
    CREATE TABLE IF NOT EXISTS incidents (
      id                TEXT PRIMARY KEY,
      title             TEXT NOT NULL,
      description       TEXT NOT NULL,
      severity          TEXT NOT NULL
                        CHECK(severity IN ('minor','major','critical')),
      status            TEXT NOT NULL DEFAULT 'detected'
                        CHECK(status IN ('detected','mitigated','resolved')),
      domain            TEXT,
      source            TEXT,
      detected_at       TEXT NOT NULL DEFAULT (datetime('now')),
      mitigated_at      TEXT,
      mitigated_by      TEXT,
      resolved_at       TEXT,
      resolved_by       TEXT,
      root_cause        TEXT,
      action_taken      TEXT,
      tags              TEXT
    )
  `);

  db.exec('CREATE INDEX IF NOT EXISTS idx_incidents_status ON incidents(status)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_incidents_severity ON incidents(severity)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_incidents_detected_at ON incidents(detected_at)');
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

/**
 * Crea un nuovo incidente nel database.
 *
 * @param params - Parametri per la creazione dell'incidente
 * @returns L'incidente appena creato
 *
 * @example
 * ```ts
 * const incident = createIncident({
 *   title: 'Quality gate failed',
 *   description: 'Lint errors exceeded threshold',
 *   severity: 'major',
 *   domain: 'quality',
 *   source: 'quality_gate',
 *   tags: { agent: 'catone-quality' },
 * });
 * ```
 */
export function createIncident(params: CreateIncidentParams): IncidentRecord {
  const db = getDatabase();

  // Validazione severity
  const severity = params.severity.toLowerCase() as IncidentSeverity;
  if (!VALID_SEVERITIES.includes(severity)) {
    throw new Error(
      `Invalid severity '${params.severity}'. Supported values: ${VALID_SEVERITIES.join(', ')}`
    );
  }

  const id = `inc_${crypto.randomUUID()}`;
  const domainLower = params.domain ? params.domain.toLowerCase() : null;
  const tagsJson = params.tags ? JSON.stringify(params.tags) : null;

  db.prepare(`
    INSERT INTO incidents (id, title, description, severity, domain, source, tags)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    params.title,
    params.description,
    severity,
    domainLower,
    params.source ?? null,
    tagsJson,
  );

  // Invalida cache
  invalidateIncidentCache();

  return getIncidentById(id);
}

// ---------------------------------------------------------------------------
// Read / List
// ---------------------------------------------------------------------------

/**
 * Recupera un incidente per ID.
 *
 * @param id - ID dell'incidente
 * @returns IncidentRecord
 * @throws Error se l'incidente non esiste
 */
export function getIncidentById(id: string): IncidentRecord {
  const db = getDatabase();
  const row = db.prepare('SELECT * FROM incidents WHERE id = ?').get(id) as Record<string, unknown> | undefined;

  if (!row) {
    throw new Error(`Incident not found: ${id}`);
  }

  return parseIncidentRow(row);
}

/**
 * Elenca incidenti con filtri opzionali.
 *
 * Supporta filtri per status, severity, domain.
 * I risultati sono paginati con limit/offset.
 *
 * @param params - Filtri opzionali
 * @returns Lista di incidenti e conteggio totale
 *
 * @example
 * ```ts
 * // Tutti gli incidenti aperti
 * const { incidents, total } = listIncidents({ status: 'detected' });
 *
 * // Incidenti critici di quality
 * const criticalQuality = listIncidents({ severity: 'critical', domain: 'quality' });
 * ```
 */
export function listIncidents(params?: ListIncidentsParams): ListIncidentsResult {
  const db = getDatabase();

  const status = params?.status;
  const severity = params?.severity;
  const domain = params?.domain;
  const limit = params?.limit ?? 50;
  const offset = params?.offset ?? 0;

  // Cache key basata sui parametri
  const cacheKey = buildIncidentCacheKey('list', {
    status: status ?? '',
    severity: severity ?? '',
    domain: domain ?? '',
    limit: String(limit),
    offset: String(offset),
  });

  // Cache-aside
  const cached = incidentsCache.get(cacheKey);
  if (cached) {
    return cached as ListIncidentsResult;
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

  if (domain) {
    whereClauses.push('domain = ?');
    queryParams.push(domain.toLowerCase());
  }

  const whereSQL = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

  // Count totale
  const countRow = db.prepare(`SELECT COUNT(*) AS total FROM incidents ${whereSQL}`).get(...queryParams) as { total: number };
  const total = countRow.total;

  // Query paginata
  const rows = db.prepare(`
    SELECT * FROM incidents ${whereSQL}
    ORDER BY detected_at DESC
    LIMIT ? OFFSET ?
  `).all(...queryParams, limit, offset) as Record<string, unknown>[];

  const incidents = rows.map(parseIncidentRow);

  const result: ListIncidentsResult = { incidents, total };

  // Popola cache
  incidentsCache.set(cacheKey, result);

  return result;
}

// ---------------------------------------------------------------------------
// Mitigate
// ---------------------------------------------------------------------------

/**
 * Marca un incidente come mitigato.
 *
 * Aggiorna status = 'mitigated', mitigated_by e action_taken.
 * L'incidente deve essere in stato 'detected' per poter essere mitigato.
 *
 * @param id - ID dell'incidente
 * @param by - Nome dell'agente o utente che mitiga
 * @param action - Azione intrapresa per la mitigazione (opzionale)
 * @returns IncidentRecord aggiornato
 *
 * @throws Error se l'incidente non esiste o non è in stato 'detected'
 */
export function mitigateIncident(id: string, by: string, action?: string): IncidentRecord {
  const db = getDatabase();

  // Verifica che l'incidente esista e sia in stato 'detected'
  const existing = db.prepare('SELECT id, status FROM incidents WHERE id = ?').get(id) as { id: string; status: string } | undefined;

  if (!existing) {
    throw new Error(`Incident not found: ${id}`);
  }

  if (existing.status !== 'detected') {
    throw new Error(
      `Cannot mitigate incident '${id}': current status is '${existing.status}', expected 'detected'`
    );
  }

  db.prepare(`
    UPDATE incidents
    SET status = 'mitigated', mitigated_by = ?, action_taken = ?
    WHERE id = ?
  `).run(by, action ?? null, id);

  // Invalida cache
  invalidateIncidentCache();

  return getIncidentById(id);
}

// ---------------------------------------------------------------------------
// Resolve
// ---------------------------------------------------------------------------

/**
 * Risolve un incidente (lo chiude definitivamente).
 *
 * Aggiorna status = 'resolved', resolved_by, root_cause e action_taken.
 * resolved_at viene impostato automaticamente dal trigger SQL.
 *
 * Regole di transizione:
 *   - detected → resolved: permesso solo se severity = 'minor'
 *   - mitigated → resolved: sempre permesso
 *
 * @param id - ID dell'incidente
 * @param by - Nome dell'agente o utente che risolve
 * @param rootCause - Causa radice identificata (opzionale)
 * @param action - Azione intrapresa per la risoluzione (opzionale)
 * @returns IncidentRecord aggiornato
 *
 * @throws Error se l'incidente non esiste, è già risolto o la transizione non è valida
 */
export function resolveIncident(id: string, by: string, rootCause?: string, action?: string): IncidentRecord {
  const db = getDatabase();

  // Verifica che l'incidente esista
  const existing = db.prepare('SELECT id, status, severity FROM incidents WHERE id = ?').get(id) as {
    id: string; status: string; severity: string
  } | undefined;

  if (!existing) {
    throw new Error(`Incident not found: ${id}`);
  }

  if (existing.status === 'resolved') {
    throw new Error(`Incident '${id}' is already resolved`);
  }

  // detected → resolved solo se severity = 'minor'
  if (existing.status === 'detected' && existing.severity !== 'minor') {
    throw new Error(
      `Cannot resolve incident '${id}' from status 'detected': ` +
      `severity is '${existing.severity}', only 'minor' incidents can be resolved directly from 'detected'. ` +
      `Mitigate the incident first.`
    );
  }

  db.prepare(`
    UPDATE incidents
    SET status = 'resolved', resolved_by = ?, root_cause = ?, action_taken = ?
    WHERE id = ?
  `).run(by, rootCause ?? null, action ?? null, id);

  // Invalida cache
  invalidateIncidentCache();

  return getIncidentById(id);
}

// ---------------------------------------------------------------------------
// Helpers interni
// ---------------------------------------------------------------------------

/**
 * Invalida tutte le entry in cache relative agli incidenti.
 * Chiamata dopo ogni operazione di scrittura (create, mitigate, resolve).
 */
function invalidateIncidentCache(): void {
  incidentsCache.invalidatePrefix(CACHE_PREFIX);
}

/**
 * Resetta completamente la cache degli incidenti.
 * Utile per test che ricreano il database da capo.
 *
 * @example
 * ```ts
 * // In un beforeEach di test
 * resetIncidentCache();
 * ```
 */
export function resetIncidentCache(): void {
  incidentsCache.clear();
}

/**
 * Costruisce una chiave cache deterministica per query incidenti.
 */
function buildIncidentCacheKey(prefix: string, parts: Record<string, string>): string {
  const sorted = Object.keys(parts)
    .sort()
    .map((k) => `${k}=${parts[k]}`)
    .join('&');
  return `${CACHE_PREFIX}${prefix}:${sorted}`;
}

/**
 * Parsifica una riga dal database in un IncidentRecord tipizzato.
 *
 * Converte:
 *   - tags da stringa JSON a oggetto (o undefined se null/'{}')
 *   - domain, source, mitigated_by, resolved_by, root_cause, action_taken da null a undefined
 *   - mitigated_at, resolved_at da null a undefined
 */
function parseIncidentRow(row: Record<string, unknown>): IncidentRecord {
  return {
    id: String(row.id ?? ''),
    title: String(row.title ?? ''),
    description: String(row.description ?? ''),
    severity: String(row.severity ?? 'minor') as IncidentSeverity,
    status: String(row.status ?? 'detected') as IncidentStatus,
    domain: row.domain ? String(row.domain) : undefined,
    source: row.source ? String(row.source) : undefined,
    detected_at: String(row.detected_at ?? ''),
    mitigated_at: row.mitigated_at ? String(row.mitigated_at) : undefined,
    mitigated_by: row.mitigated_by ? String(row.mitigated_by) : undefined,
    resolved_at: row.resolved_at ? String(row.resolved_at) : undefined,
    resolved_by: row.resolved_by ? String(row.resolved_by) : undefined,
    root_cause: row.root_cause ? String(row.root_cause) : undefined,
    action_taken: row.action_taken ? String(row.action_taken) : undefined,
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
