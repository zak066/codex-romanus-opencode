/**
 * core/metrics-engine.ts
 * Metrics Engine per Time-Series Universale (CENSUS — Fase 5).
 *
 * Fornisce store, query e trend analysis per metriche numeriche
 * su domini: quality, perf, security, test, seo, devops.
 *
 * Utilizza il pattern cache-aside con Cache<T> e TTL 5 minuti.
 *
 * @module core/metrics-engine
 */

import crypto from 'node:crypto';
import { getDatabase } from './database.js';
import { Cache } from './cache.js';

// ---------------------------------------------------------------------------
// Tipi pubblici
// ---------------------------------------------------------------------------

/** Entry singola di metrica */
export interface MetricEntry {
  id: string;
  domain: string;
  metric_name: string;
  value: number;
  tags: Record<string, string>;
  recorded_at: string;
}

/** Parametri per queryMetrics */
export interface MetricsQuery {
  domain: string;
  metric_name?: string;
  from?: string;
  to?: string;
  aggregation?: 'raw' | 'avg' | 'sum' | 'min' | 'max' | 'p50' | 'p95' | 'p99' | 'count';
  tags?: Record<string, string>;
  interval?: string; // "hour" | "day" | "week" | "month"
}

/** Risultato di queryMetrics */
export interface MetricsQueryResult {
  domain: string;
  metric_name?: string;
  aggregation?: string;
  interval?: string;
  from: string;
  to: string;
  data: Array<MetricEntry | { period: string; value: number; count: number }>;
}

/** Risultato di queryTrend */
export interface MetricsTrend {
  domain: string;
  metric_name: string;
  previous_avg: number;
  current_avg: number;
  delta: number;
  delta_pct: number;
  direction: 'up' | 'down' | 'stable';
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

/** Cache per metriche — TTL 5 minuti (300000 ms) */
const metricsCache = new Cache<unknown>(300_000);

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

/**
 * Crea la tabella `metrics` e gli indici se non esistono.
 * Chiamata all'avvio del server per garantire che lo schema sia presente.
 */
export function ensureMetricsSchema(): void {
  const db = getDatabase();

  db.exec(`
    CREATE TABLE IF NOT EXISTS metrics (
      id              TEXT PRIMARY KEY,
      domain          TEXT NOT NULL,
      metric_name     TEXT NOT NULL,
      value           REAL NOT NULL,
      tags            TEXT DEFAULT '{}',
      recorded_at     TEXT NOT NULL DEFAULT (datetime('now')),
      created_at      TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_metrics_lookup
    ON metrics(domain, metric_name, recorded_at DESC)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_metrics_domain
    ON metrics(domain, recorded_at DESC)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_metrics_name
    ON metrics(metric_name, recorded_at DESC)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_metrics_recorded_at
    ON metrics(recorded_at DESC)
  `);
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

/**
 * Inserisce una nuova metrica nel database.
 *
 * @param domain - Dominio della metrica (quality, perf, security, test, seo, devops)
 * @param metric_name - Nome della metrica (es. lint_errors, p95_latency_ms)
 * @param value - Valore numerico (REAL)
 * @param tags - Metadati opzionali { agent, file, branch, ... }
 * @returns ID della metrica inserita
 */
export function storeMetric(
  domain: string,
  metric_name: string,
  value: number,
  tags?: Record<string, string>
): string {
  const db = getDatabase();
  const id = `mtr_${crypto.randomUUID()}`;
  const domainLower = domain.toLowerCase();
  const tagsJson = JSON.stringify(tags ?? {});
  const recordedAt = new Date().toISOString();

  db.prepare(`
    INSERT INTO metrics (id, domain, metric_name, value, tags, recorded_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, domainLower, metric_name, value, tagsJson, recordedAt);

  // Invalida cache per questo dominio
  invalidateDomainCache(domainLower);

  return id;
}

// ---------------------------------------------------------------------------
// Query
// ---------------------------------------------------------------------------

/**
 * Interroga le metriche con filtri e aggregazioni opzionali.
 *
 * Supporta:
 * - Filtri per domain (obbligatorio), metric_name, range temporale, tags
 * - Aggregazioni: avg, sum, min, max, p50, p95, p99, count
 * - Time bucketing con interval (hour, day, week, month)
 * - Pattern cache-aside con TTL 5 minuti
 *
 * @param query - Parametri della query
 * @returns Risultato con dominio, finestra temporale e serie di dati
 */
export function queryMetrics(query: MetricsQuery): MetricsQueryResult {
  const {
    domain,
    metric_name,
    from,
    to,
    aggregation,
    tags,
    interval,
  } = query;

  const domainLower = domain.toLowerCase();
  const defaultFrom = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const fromDate = from ?? defaultFrom;
  const toDate = to ?? new Date().toISOString();

  // Costruisci chiave cache
  const cacheKey = buildMetricsCacheKey('query', {
    domain: domainLower,
    metric_name: metric_name ?? '',
    from: fromDate,
    to: toDate,
    aggregation: aggregation ?? 'raw',
    tags: tags ? JSON.stringify(tags) : '',
    interval: interval ?? '',
  });

  // Cache-aside: prova cache
  const cached = metricsCache.get(cacheKey);
  if (cached) {
    return cached as MetricsQueryResult;
  }

  // Costruisci query SQL
  const { whereClauses, params } = buildWhereClause(domainLower, metric_name, fromDate, toDate, tags);

  const db = getDatabase();

  let data: unknown[];
  let resultAggregation: string | undefined = aggregation;

  if (!aggregation || aggregation === 'raw') {
    // Query raw: restituisci singole entry
    const sql = `
      SELECT id, domain, metric_name, value, tags, recorded_at
      FROM metrics
      ${whereClauses.length > 0 ? 'WHERE ' + whereClauses.join(' AND ') : ''}
      ORDER BY recorded_at DESC
      LIMIT 10000
    `;
    data = db.prepare(sql).all(...params) as MetricEntry[];

    // Parsifica tags da JSON string a oggetto
    data = (data as MetricEntry[]).map((row) => ({
      ...row,
      tags: parseTags(row.tags as unknown as string),
    }));
  } else if (['p50', 'p95', 'p99'].includes(aggregation)) {
    // Percentili con OFFSET/LIMIT
    data = computePercentile(db, domainLower, metric_name, fromDate, toDate, tags, aggregation, whereClauses, params);
  } else if (interval) {
    // Aggregazione con intervallo temporale
    data = computeAggregatedWithInterval(db, domainLower, metric_name, fromDate, toDate, tags, aggregation, interval, whereClauses, params);
    resultAggregation = aggregation;
  } else {
    // Aggregazione singola su tutto il range
    data = computeSimpleAggregation(db, domainLower, metric_name, fromDate, toDate, tags, aggregation, whereClauses, params);
    resultAggregation = aggregation;
  }

  const result: MetricsQueryResult = {
    domain: domainLower,
    metric_name,
    aggregation: resultAggregation,
    interval,
    from: fromDate,
    to: toDate,
    data: data as MetricsQueryResult['data'],
  };

  // Popola cache
  metricsCache.set(cacheKey, result);

  return result;
}

// ---------------------------------------------------------------------------
// Trend
// ---------------------------------------------------------------------------

/**
 * Confronta due finestre temporali per calcolare il trend di una metrica.
 *
 * Finestra recente: [now - days, now]
 * Finestra precedente: [now - 2*days, now - days]
 *
 * @param domain - Dominio della metrica
 * @param metric_name - Nome della metrica
 * @param days - Larghezza finestra in giorni (default: 7)
 * @param tags - Filtro opzionale su tag
 * @returns MetricTrend con delta e direzione
 */
export function queryTrend(
  domain: string,
  metric_name: string,
  days: number = 7,
  tags?: Record<string, string>
): MetricsTrend {
  const now = new Date();
  const toDate = now.toISOString();
  const pastDate = new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
  const pastPastDate = new Date(now.getTime() - 2 * days * 24 * 60 * 60 * 1000).toISOString();

  const domainLower = domain.toLowerCase();

  // Cache key
  const cacheKey = buildMetricsCacheKey('trend', {
    domain: domainLower,
    metric_name,
    days: String(days),
    tags: tags ? JSON.stringify(tags) : '',
  });

  // Cache-aside
  const cached = metricsCache.get(cacheKey);
  if (cached) {
    return cached as MetricsTrend;
  }

  // Build tag filters
  const { whereClauses: whereClausesRecent, params: paramsRecent } =
    buildWhereClause(domainLower, metric_name, pastDate, toDate, tags);
  const { whereClauses: whereClausesPrev, params: paramsPrev } =
    buildWhereClause(domainLower, metric_name, pastPastDate, pastDate, tags);

  const db = getDatabase();

  // Finestra recente: AVG
  const recentRow = db.prepare(`
    SELECT AVG(value) as avg_val, COUNT(*) as count
    FROM metrics
    ${whereClausesRecent.length > 0 ? 'WHERE ' + whereClausesRecent.join(' AND ') : ''}
  `).get(...paramsRecent) as { avg_val: number | null; count: number };

  // Finestra precedente: AVG
  const prevRow = db.prepare(`
    SELECT AVG(value) as avg_val, COUNT(*) as count
    FROM metrics
    ${whereClausesPrev.length > 0 ? 'WHERE ' + whereClausesPrev.join(' AND ') : ''}
  `).get(...paramsPrev) as { avg_val: number | null; count: number };

  const currentAvg = recentRow.avg_val ?? 0;
  const previousAvg = prevRow.avg_val ?? 0;
  const delta = currentAvg - previousAvg;
  const deltaPct = previousAvg !== 0
    ? Number(((delta / Math.abs(previousAvg)) * 100).toFixed(2))
    : delta > 0 ? 100 : delta < 0 ? -100 : 0;

  let direction: 'up' | 'down' | 'stable';
  if (deltaPct > 5) {
    direction = 'up';
  } else if (deltaPct < -5) {
    direction = 'down';
  } else {
    direction = 'stable';
  }

  const trend: MetricsTrend = {
    domain: domainLower,
    metric_name,
    previous_avg: Number(previousAvg.toFixed(4)),
    current_avg: Number(currentAvg.toFixed(4)),
    delta: Number(delta.toFixed(4)),
    delta_pct: deltaPct,
    direction,
  };

  // Popola cache
  metricsCache.set(cacheKey, trend);

  return trend;
}

// ---------------------------------------------------------------------------
// Helpers interni
// ---------------------------------------------------------------------------

/**
 * Invalida tutte le entry in cache per un dato dominio.
 */
function invalidateDomainCache(domain: string): void {
  metricsCache.invalidatePrefix(`metrics:query:${domain}:`);
  metricsCache.invalidatePrefix(`metrics:trend:${domain}:`);
}

/**
 * Costruisce una chiave cache deterministica.
 * Il dominio viene estratto come prefisso separato per permettere
 * invalidazione mirata per dominio via invalidatePrefix.
 */
function buildMetricsCacheKey(prefix: string, parts: Record<string, string>): string {
  const domain = parts.domain ?? 'unknown';
  const rest = Object.keys(parts)
    .filter((k) => k !== 'domain')
    .sort()
    .map((k) => `${k}=${parts[k]}`)
    .join('&');
  return `metrics:${prefix}:${domain}:${rest}`;
}

/**
 * Costruisce le clausole WHERE e i parametri per filtraggio metriche.
 */
function buildWhereClause(
  domain: string,
  metricName?: string,
  from?: string,
  to?: string,
  tags?: Record<string, string>
): { whereClauses: string[]; params: unknown[] } {
  const whereClauses: string[] = ['domain = ?'];
  const params: unknown[] = [domain];

  if (metricName) {
    whereClauses.push('metric_name = ?');
    params.push(metricName);
  }

  if (from && to) {
    whereClauses.push('recorded_at BETWEEN ? AND ?');
    params.push(from, to);
  }

  if (tags && Object.keys(tags).length > 0) {
    for (const [key, value] of Object.entries(tags)) {
      whereClauses.push(`json_extract(tags, '$.${key}') = ?`);
      params.push(value);
    }
  }

  return { whereClauses, params };
}

/**
 * Calcola un percentile (p50, p95, p99) della metrica.
 */
function computePercentile(
  db: ReturnType<typeof getDatabase>,
  domain: string,
  metricName: string | undefined,
  from: string,
  to: string,
  tags: Record<string, string> | undefined,
  aggregation: string,
  whereClauses: string[],
  params: unknown[]
): Array<{ period: string; value: number; count: number }> {
  const percentileMap: Record<string, number> = { p50: 0.5, p95: 0.95, p99: 0.99 };
  const fraction = percentileMap[aggregation] ?? 0.95;

  // Usa query nidificata per calcolare il percentile
  const countSql = `
    SELECT COUNT(*) as total FROM metrics ${whereClauses.length > 0 ? 'WHERE ' + whereClauses.join(' AND ') : ''}
  `;
  const countRow = db.prepare(countSql).get(...params) as { total: number };
  const total = countRow.total;

  if (total === 0) {
    return [{ period: `${from} - ${to}`, value: 0, count: 0 }];
  }

  const offset = Math.max(0, Math.min(total - 1, Math.floor(total * fraction) - 1));

  const sql = `
    SELECT value
    FROM metrics
    ${whereClauses.length > 0 ? 'WHERE ' + whereClauses.join(' AND ') : ''}
    ORDER BY value ASC
    LIMIT 1 OFFSET ?
  `;

  const row = db.prepare(sql).get(...params, offset) as { value: number } | undefined;

  return [{
    period: `${from} - ${to}`,
    value: row?.value ?? 0,
    count: total,
  }];
}

/**
 * Calcola aggregazione con raggruppamento per intervallo temporale.
 */
function computeAggregatedWithInterval(
  db: ReturnType<typeof getDatabase>,
  domain: string,
  metricName: string | undefined,
  from: string,
  to: string,
  tags: Record<string, string> | undefined,
  aggregation: string,
  interval: string,
  whereClauses: string[],
  params: unknown[]
): Array<{ period: string; value: number; count: number }> {
  // Mappa intervallo → formato strftime
  const intervalFormat: Record<string, string> = {
    hour: '%Y-%m-%dT%H:00:00',
    day: '%Y-%m-%d',
    week: '%Y-%W',
    month: '%Y-%m',
  };

  const fmt = intervalFormat[interval] ?? '%Y-%m-%d';

  const aggFunc: Record<string, string> = {
    avg: 'AVG',
    sum: 'SUM',
    min: 'MIN',
    max: 'MAX',
    count: 'COUNT',
  };

  const func = aggFunc[aggregation] ?? 'AVG';

  const sql = `
    SELECT
      strftime('${fmt}', recorded_at) AS period,
      ${func}(value) AS value,
      COUNT(*) AS count
    FROM metrics
    ${whereClauses.length > 0 ? 'WHERE ' + whereClauses.join(' AND ') : ''}
    GROUP BY strftime('${fmt}', recorded_at)
    ORDER BY period ASC
  `;

  return db.prepare(sql).all(...params) as Array<{ period: string; value: number; count: number }>;
}

/**
 * Calcola una semplice aggregazione sull'intero range temporale.
 */
function computeSimpleAggregation(
  db: ReturnType<typeof getDatabase>,
  domain: string,
  metricName: string | undefined,
  from: string,
  to: string,
  tags: Record<string, string> | undefined,
  aggregation: string,
  whereClauses: string[],
  params: unknown[]
): Array<{ period: string; value: number; count: number }> {
  const aggFunc: Record<string, string> = {
    avg: 'AVG',
    sum: 'SUM',
    min: 'MIN',
    max: 'MAX',
    count: 'COUNT',
  };

  const func = aggFunc[aggregation] ?? 'AVG';

  const sql = `
    SELECT ${func}(value) AS value, COUNT(*) AS count
    FROM metrics
    ${whereClauses.length > 0 ? 'WHERE ' + whereClauses.join(' AND ') : ''}
  `;

  const row = db.prepare(sql).get(...params) as { value: number | null; count: number };

  return [{
    period: `${from} - ${to}`,
    value: row.value ?? 0,
    count: row.count,
  }];
}

/**
 * Parsifica un JSON string di tags in oggetto.
 * Restituisce oggetto vuoto in caso di errore.
 */
function parseTags(tagsJson: string): Record<string, string> {
  if (!tagsJson || tagsJson === '{}') return {};
  try {
    return JSON.parse(tagsJson) as Record<string, string>;
  } catch {
    return {};
  }
}
