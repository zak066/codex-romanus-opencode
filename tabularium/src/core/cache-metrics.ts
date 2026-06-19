/**
 * core/cache-metrics.ts
 * Ponte tra le cache esistenti (Cache<T>, fs_cache, llm_cache) e il
 * metrics engine di Tabularium (C4 — Cache Metrics Collector).
 *
 * Raccoglie periodicamente hit/miss ratio, latenza, TTL e altre statistiche
 * delle cache e le registra come metriche time-series su metrics_store
 * (domain="cache") per analisi storiche, trend e alert.
 *
 * ## Metriche registrate (ogni 60 secondi)
 * - `cache.{name}.size`        — Numero entry correnti
 * - `cache.{name}.hit_rate`    — Hit rate percentuale (0-100)
 * - `cache.{name}.stale_hits`  — Conteggio stale hit (se supportato)
 * - `cache.{name}.evictions`   — Conteggio LRU eviction
 * - `cache.{name}.coalesced`   — Conteggio promise coalesced fetch
 *
 * ## Cache integrate
 * - **Cache<T> in Tabularium**: adapter `fromCache()` già disponibile
 * - **fs_cache in Ianus**: usa `CacheConfig` custom (polling esterno)
 * - **llm_cache in Ianus**: stesso pattern
 *
 * @module core/cache-metrics
 */

import { storeMetric } from './metrics-engine.js';
import { Cache } from './cache.js';

// ---------------------------------------------------------------------------
// Tipi pubblici
// ---------------------------------------------------------------------------

/**
 * Snapshot istantaneo dello stato di una cache.
 * Raccolto atomicamente da `getSnapshot()` per evitare inconsistenze
 * tra letture multiple durante una singola report cycle.
 */
export interface CacheSnapshot {
  /** Numero di entry attualmente in cache */
  size: number;
  /** Hit totali accumulati (fresh + stale) */
  hits: number;
  /** Miss totali accumulati */
  misses: number;
  /** Stale hit totali (dato servito ma oltre TTL primario) */
  staleHits: number;
  /** Entry rimosse per LRU eviction */
  evictionCount: number;
  /** Fetch coalesced (stessa chiave già in fetching) */
  coalescedFetches: number;
}

/**
 * Configurazione di una cache da monitorare.
 *
 * Ogni cache registrata deve implementare questo contratto minimo.
 * Il metodo `getSnapshot()` viene chiamato atomicamente ad ogni ciclo
 * di report per catturare lo stato corrente.
 *
 * @example
 * ```ts
 * // Adapter per Cache<T>
 * const myCache = new Cache<string>(30_000);
 * cacheMetrics.register({
 *   name: 'myCache',
 *   getSnapshot: () => {
 *     const stats = myCache.getStats();
 *     return {
 *       size: stats.size,
 *       hits: stats.hits,
 *       misses: stats.misses,
 *       staleHits: stats.staleHits,
 *       evictionCount: stats.evictionCount,
 *       coalescedFetches: stats.coalescedFetches,
 *     };
 *   },
 * });
 * ```
 */
export interface CacheConfig {
  /** Nome logico della cache (es. 'openCodeCache', 'llm_cache') */
  name: string;

  /**
   * Cattura uno snapshot atomico dello stato corrente della cache.
   * Chiamato una volta per ciclo di report — i dati devono essere
   * consistenti tra loro (non letture distribuite).
   */
  getSnapshot(): CacheSnapshot;
}

// ---------------------------------------------------------------------------
// Adapter factory per Cache<T>
// ---------------------------------------------------------------------------

/**
 * Crea un `CacheConfig` a partire da un'istanza `Cache<T>` di Tabularium.
 *
 * L'adapter chiama `getStats()` una volta sola per snapshot, minimizzando
 * l'overhead di iterazione della mappa interna.
 *
 * @param name - Nome logico da assegnare alla cache nel report
 * @param cache - Istanza Cache<T> da monitorare
 * @returns Config pronta per `cacheMetrics.register()`
 *
 * @example
 * ```ts
 * import { openCodeCache } from './cache.js';
 * import { fromCache, cacheMetrics } from './cache-metrics.js';
 *
 * cacheMetrics.register(fromCache('openCodeCache', openCodeCache));
 * ```
 */
export function fromCache<T>(name: string, cache: Cache<T>): CacheConfig {
  return {
    name,
    getSnapshot: () => {
      const stats = cache.getStats();
      return {
        size: stats.size,
        hits: stats.hits,
        misses: stats.misses,
        staleHits: stats.staleHits,
        evictionCount: stats.evictionCount,
        coalescedFetches: stats.coalescedFetches,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

/**
 * Entry singola di un report cache.
 * Include lo snapshot raw più l'hit rate calcolato.
 */
export interface CacheMetricsEntry {
  /** Nome logico della cache */
  name: string;
  /** Snapshot dello stato */
  snapshot: CacheSnapshot;
  /** Hit rate percentuale (0-100), calcolato come hits / (hits + misses) */
  hitRate: number;
}

/**
 * Report completo di tutte le cache registrate.
 * Generato da `CacheMetrics.report()`.
 */
export interface CacheMetricsReport {
  /** Timestamp ISO della generazione del report */
  timestamp: string;
  /** Elenco delle cache con i relativi snapshot */
  caches: CacheMetricsEntry[];
}

// ---------------------------------------------------------------------------
// Cache Metrics Collector
// ---------------------------------------------------------------------------

/**
 * Collettore di metriche per le cache registrate.
 *
 * Mantiene un registro di cache (ognuna con il proprio `CacheConfig`),
 * le interroga a intervalli regolari e scrive i risultati come metriche
 * time-series su metrics_store (domain="cache").
 *
 * Fornisce un metodo `report()` per raccolta on-demand e
 * `startAutoReport()` / `stopAutoReport()` per raccolta periodica.
 *
 * @example
 * ```ts
 * import { cacheMetrics, fromCache } from './cache-metrics.js';
 * import { openCodeCache } from './cache.js';
 *
 * // Registra cache
 * cacheMetrics.register(fromCache('openCodeCache', openCodeCache));
 *
 * // Report manuale
 * const report = await cacheMetrics.report();
 * console.log(report);
 *
 * // Auto-report ogni 60 secondi
 * cacheMetrics.startAutoReport();
 *
 * // ... più tardi
 * cacheMetrics.stopAutoReport();
 * ```
 */
export class CacheMetrics {
  /** Registro delle cache monitorate */
  private caches = new Map<string, CacheConfig>();

  /** Timer per l'auto-report periodico */
  private timer: ReturnType<typeof setInterval> | null = null;

  /** Intervallo di default per l'auto-report: 60 secondi */
  private readonly defaultIntervalMs = 60_000;

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  /**
   * Registra una nuova cache da monitorare.
   * Se già esiste una cache con lo stesso nome, viene sovrascritta.
   *
   * @param config - Configurazione della cache
   *
   * @example
   * ```ts
   * cacheMetrics.register({
   *   name: 'myCache',
   *   getSnapshot: () => ({ size: 0, hits: 0, misses: 0, staleHits: 0, evictionCount: 0, coalescedFetches: 0 }),
   * });
   * ```
   */
  register(config: CacheConfig): void {
    this.caches.set(config.name, config);
  }

  /**
   * Rimuove una cache dal monitoraggio.
   *
   * @param name - Nome logico della cache da rimuovere
   */
  unregister(name: string): void {
    this.caches.delete(name);
  }

  // -----------------------------------------------------------------------
  // Report
  // -----------------------------------------------------------------------

  /**
   * Raccoglie gli snapshot di tutte le cache registrate e li registra
   * come metriche time-series su metrics_store (domain="cache").
   *
   * Per ogni cache, registra le seguenti metriche con tag `{ cache_name }`:
   * - `cache.<name>.size`
   * - `cache.<name>.hit_rate`
   * - `cache.<name>.stale_hits`
   * - `cache.<name>.evictions`
   * - `cache.<name>.coalesced`
   *
   * Se una cache fallisce, le altre vengono comunque processate
   * (isolamento per eccezioni).
   *
   * @returns Report con tutti gli snapshot raccolti
   */
  async report(): Promise<CacheMetricsReport> {
    const entries: CacheMetricsEntry[] = [];

    for (const config of this.caches.values()) {
      try {
        const snapshot = config.getSnapshot();
        const total = snapshot.hits + snapshot.misses;
        const hitRate = total > 0
          ? Number(((snapshot.hits / total) * 100).toFixed(2))
          : 0;

        // Tag comune per filtraggio
        const tags: Record<string, string> = { cache_name: config.name };

        // Store metriche — usa storeMetric() direttamente (bypassa tool validation)
        storeMetric('cache', `${config.name}.size`, snapshot.size, tags);
        storeMetric('cache', `${config.name}.hit_rate`, hitRate, tags);
        storeMetric('cache', `${config.name}.stale_hits`, snapshot.staleHits, tags);
        storeMetric('cache', `${config.name}.evictions`, snapshot.evictionCount, tags);
        storeMetric('cache', `${config.name}.coalesced`, snapshot.coalescedFetches, tags);

        entries.push({
          name: config.name,
          snapshot,
          hitRate,
        });
      } catch (err) {
        console.error(
          `[CacheMetrics] Error collecting metrics for '${config.name}':`,
          err instanceof Error ? err.message : String(err),
        );
      }
    }

    // ── Aggregate metrics for Praetorium frontend ───────────────────────
    // Il frontend (praetorium/src/app/(monitoring)/metrics/page.tsx) cerca
    // metriche aggregate con nomi esatti: cache_hit_rate, cache_size,
    // cache_eviction_count, cache_hits_total, cache_misses_total.
    // Calcoliamo totali su tutte le istanze di cache registrate.

    let totalHits = 0;
    let totalMisses = 0;
    let totalSize = 0;
    let totalEvictions = 0;

    for (const entry of entries) {
      totalHits += entry.snapshot.hits;
      totalMisses += entry.snapshot.misses;
      totalSize += entry.snapshot.size;
      totalEvictions += entry.snapshot.evictionCount;
    }

    const overallHitRate = (totalHits + totalMisses) > 0
      ? Number(((totalHits / (totalHits + totalMisses)) * 100).toFixed(2))
      : 0;

    storeMetric('cache', 'cache_hit_rate', overallHitRate);
    storeMetric('cache', 'cache_size', totalSize);
    storeMetric('cache', 'cache_eviction_count', totalEvictions);
    storeMetric('cache', 'cache_hits_total', totalHits);
    storeMetric('cache', 'cache_misses_total', totalMisses);

    return {
      timestamp: new Date().toISOString(),
      caches: entries,
    };
  }

  // -----------------------------------------------------------------------
  // Auto-report periodico
  // -----------------------------------------------------------------------

  /**
   * Avvia il reporter automatico che raccoglie e salva le metriche
   * a intervalli regolari.
   *
   * Se già avviato, non fa nulla (no-op).
   * Il timer è configurato con `unref()` per non bloccare la chiusura
   * del processo Node.js.
   *
   * @param intervalMs - Intervallo in millisecondi (default: 60000 = 1 minuto)
   *
   * @example
   * ```ts
   * // Ogni 30 secondi
   * cacheMetrics.startAutoReport(30_000);
   * ```
   */
  startAutoReport(intervalMs?: number): void {
    if (this.timer) return;

    const interval = intervalMs ?? this.defaultIntervalMs;

    this.timer = setInterval(() => {
      this.report().catch((err) => {
        console.error(
          '[CacheMetrics] Auto-report error:',
          err instanceof Error ? err.message : String(err),
        );
      });
    }, interval);

    // Non impedisce la chiusura del processo Node.js
    if (typeof this.timer === 'object' && this.timer !== null && 'unref' in this.timer) {
      (this.timer as NodeJS.Timeout).unref();
    }
  }

  /**
   * Ferma il reporter automatico.
   * Se non avviato, non fa nulla (no-op).
   */
  stopAutoReport(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Indica se l'auto-report periodico è attivo.
   *
   * @returns `true` se il timer di auto-report è in esecuzione
   */
  isAutoReportRunning(): boolean {
    return this.timer !== null;
  }
}

// ---------------------------------------------------------------------------
// Singleton globale
// ---------------------------------------------------------------------------

/**
 * Istanza singleton di `CacheMetrics` per uso in tutto Tabularium.
 *
 * @example
 * ```ts
 * // Nel modulo di avvio server
 * import { cacheMetrics, fromCache } from './core/cache-metrics.js';
 * import { openCodeCache, progressCache } from './core/cache.js';
 *
 * cacheMetrics.register(fromCache('openCodeCache', openCodeCache));
 * cacheMetrics.register(fromCache('progressCache', progressCache));
 * cacheMetrics.startAutoReport();
 * ```
 */
export const cacheMetrics = new CacheMetrics();
