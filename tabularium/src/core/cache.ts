/**
 * cache.ts
 * Sistema di caching in-memory per i dati parsati da disco.
 * Riduce le letture da filesystem e migliora le performance del server.
 * Supporta TTL configurabile per entry, invalidazione selettiva,
 * cleanup periodico, stale-while-revalidate, promise coalescing,
 * LRU eviction e statistiche.
 *
 * @module core/cache
 */

// ---------------------------------------------------------------------------
// Costanti
// ---------------------------------------------------------------------------

/** TTL di default: 30 secondi. */
const DEFAULT_TTL = 30_000;

/** Intervallo di cleanup automatico: 5 minuti. */
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

/** Percentuale di entry da rimuovere durante LRU eviction (10%). */
const LRU_EVICTION_PCT = 0.1;

// ---------------------------------------------------------------------------
// Tipi interni
// ---------------------------------------------------------------------------

/**
 * Entry nella cache con timestamp e TTL.
 */
interface CacheEntry<T> {
  /** Dati memorizzati */
  data: T;
  /** Timestamp di creazione (ms since epoch) */
  createdAt: number;
  /** TTL in millisecondi */
  ttl: number;
  /** Timestamp dell'ultimo accesso (per LRU eviction) */
  lastAccessed: number;
}

/**
 * Opzioni per configurare il comportamento della cache.
 *
 * @example
 * ```ts
 * // Cache con stale-while-revalidate e LRU
 * const cache = new Cache<string>(30_000, {
 *   staleTtl: 60_000,
 *   revalidateFn: async (key) => fetchFreshData(key),
 *   maxEntries: 1000,
 * });
 * ```
 */
export interface CacheOptions {
  /**
   * Soglia per stale-while-revalidate in millisecondi.
   * Se un'entry ha superato il TTL ma non ha superato TTL + staleTtl,
   * il dato viene comunque restituito e un refresh in background viene avviato.
   *
   * Default: solo se revalidateFn è fornito, viene usato TTL * 2.
   * Se non specificato e revalidateFn non è fornito, stale è disabilitato.
   */
  staleTtl?: number;

  /**
   * Funzione globale di revalidate per lo stale-while-revalidate.
   * Chiamata in background quando un dato stale viene servito via `get()`.
   * Opzionale — se non fornita, `get()` restituisce dati stale senza refresh.
   */
  revalidateFn?: (key: string) => Promise<unknown>;

  /**
   * Numero massimo di entry prima di attivare LRU eviction.
   * 0 = nessun limite (default).
   * Quando superato, il 10% più vecchio (per lastAccessed) viene rimosso.
   */
  maxEntries?: number;
}

/**
 * Statistiche estese della cache.
 * Usato come tipo di ritorno di `getStats()`.
 */
export interface CacheStats {
  /** Numero di entry in cache */
  size: number;
  /** Elenco delle chiavi */
  keys: string[];
  /** TTL medio in millisecondi */
  averageTtlMs: number;
  /** Età dell'entry più vecchia in millisecondi */
  oldestEntryMs: number;
  /** Numero di stale hit (dato servito ma oltre TTL) */
  staleHits: number;
  /** Numero di fetch coalesced (stessa chiave già in fetching) */
  coalescedFetches: number;
  /** Numero di entry rimosse per LRU eviction */
  evictionCount: number;
  /** Indica se stale-while-revalidate è configurato */
  isStaleEnabled: boolean;
  /** Limite massimo entry (0 = nessun limite) */
  maxEntries: number;
  /** Hit totali (fresh + stale) */
  hits: number;
  /** Miss totali (chiave non trovata o expired) */
  misses: number;
}

/**
 * Risultato di getWithStale: dato memorizzato con flag di freschezza.
 */
export interface StaleResult<T> {
  /** Dato memorizzato */
  data: T;
  /** true se il dato è stale (oltre TTL ma entro staleTtl) */
  isStale: boolean;
}

// ---------------------------------------------------------------------------
// Cache generica
// ---------------------------------------------------------------------------

/**
 * Cache generica in-memory con supporto TTL per entry.
 *
 * Ogni entry ha un TTL individuale. Alla lettura, se il TTL è scaduto,
 * l'entry viene rimossa automaticamente (lazy eviction).
 * Un cleanup periodico rimuove le entry scadute per evitare memory leak.
 *
 * Supporta le seguenti features opzionali (tramite CacheOptions):
 *   - **Stale-while-revalidate**: serve dati leggermente scaduti mentre
 *     un refresh in background li aggiorna
 *   - **Promise coalescing**: evita fetch concorrenti per la stessa key
 *   - **LRU eviction**: rimuove automaticamente le entry meno usate
 *     quando si supera maxEntries
 *
 * @typeParam T - Tipo dei dati memorizzati
 *
 * @example
 * ```ts
 * // Cache base (backward compat)
 * const cache = new Cache<MyData>(60_000);
 * cache.set('key', data);
 * const cached = cache.get('key');
 *
 * // Cache con stale-while-revalidate e LRU
 * const advanced = new Cache<MyData>(30_000, {
 *   staleTtl: 60_000,
 *   revalidateFn: async (key) => await fetchData(key),
 *   maxEntries: 500,
 * });
 * const result = advanced.getWithStale('key');
 * if (result?.isStale) console.log('dato stale, refresh in corso...');
 * ```
 */
export class Cache<T> {
  /** Storage interno: Map chiave → entry */
  private store = new Map<string, CacheEntry<T>>();

  /** Timer per cleanup periodico, se attivo */
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  /** Promise attive per promise coalescing (solo getOrSet) */
  private pendingFetches = new Map<string, Promise<T>>();

  /** Set di chiavi in corso di background refresh (stale-while-revalidate) */
  private pendingRefreshes = new Set<string>();

  // -----------------------------------------------------------------------
  // Statistiche
  // -----------------------------------------------------------------------

  /** Hit totali (fresh + stale) */
  private hits = 0;
  /** Miss totali (chiave non trovata o expired) */
  private misses = 0;
  /** Stale hit: dati serviti ma oltre TTL */
  private staleHits = 0;
  /** Fetch coalesced: stesse chiave già in fetching */
  private coalescedFetches = 0;
  /** Entry rimosse per LRU eviction */
  private evictionCount = 0;

  /**
   * @param defaultTTL - TTL di default in millisecondi (default: 30s)
   * @param options - Opzioni avanzate (stale-while-revalidate, LRU, ecc.)
   *
   * @example
   * ```ts
   * // Solo TTL (backward compat)
   * const c1 = new Cache<string>();
   * const c2 = new Cache<string>(60_000);
   *
   * // Con opzioni
   * const c3 = new Cache<string>(30_000, { maxEntries: 500 });
   * ```
   */
  constructor(
    private defaultTTL: number = DEFAULT_TTL,
    private options?: CacheOptions,
  ) {
    this.startCleanup();
  }

  // -----------------------------------------------------------------------
  // Metodi principali
  // -----------------------------------------------------------------------

  /**
   * Recupera un valore dalla cache.
   * Se l'entry è scaduta (oltre TTL + staleTtl), la rimuove e restituisce
   * undefined (lazy eviction).
   *
   * Se l'entry è stale (oltre TTL ma entro staleTtl), restituisce il dato
   * e, se `revalidateFn` è configurato, avvia un refresh in background
   * (fire-and-forget).
   *
   * **Nota**: questo metodo è backward-compatibile — il tipo di ritorno
   * rimane `T | undefined`. Per informazioni sullo stato di freschezza,
   * usa `getWithStale()`.
   *
   * @param key - Chiave dell'entry
   * @returns Valore memorizzato o undefined se assente/scaduto
   */
  get(key: string): T | undefined {
    const result = this.getWithStale(key);
    if (!result) return undefined;

    if (result.isStale) {
      this.triggerBackgroundRefresh(key);
    }

    return result.data;
  }

  /**
   * Versione avanzata di `get()` che restituisce anche il flag `isStale`.
   * Non attiva refresh in background (è una lettura pura).
   *
   * @param key - Chiave dell'entry
   * @returns Oggetto con data e flag isStale, o undefined se assente/scaduto
   *
   * @example
   * ```ts
   * const result = cache.getWithStale('key');
   * if (result) {
   *   console.log(result.data, result.isStale ? '(stale)' : '(fresh)');
   * }
   * ```
   */
  getWithStale(key: string): StaleResult<T> | undefined {
    const entry = this.store.get(key);
    if (!entry) {
      this.misses++;
      return undefined;
    }

    const age = Date.now() - entry.createdAt;

    // Aggiorna lastAccessed per LRU (anche per letture stale)
    entry.lastAccessed = Date.now();

    if (age <= entry.ttl) {
      // Fresco — hit normale
      this.hits++;
      return { data: entry.data, isStale: false };
    }

    // Determina la soglia di stale per questa entry
    const staleTtl = this.getEffectiveStaleTtl(entry.ttl);

    if (staleTtl > 0 && age <= entry.ttl + staleTtl) {
      // Stale ma ancora servibile
      this.staleHits++;
      this.hits++;
      return { data: entry.data, isStale: true };
    }

    // Troppo vecchio — rimuovi (lazy eviction)
    this.store.delete(key);
    this.misses++;
    return undefined;
  }

  /**
   * Inserisce o sovrascrive un valore nella cache.
   * Attiva LRU eviction se `maxEntries` è configurato e superato.
   *
   * @param key - Chiave dell'entry
   * @param data - Dati da memorizzare
   * @param ttl - TTL opzionale per questa specifica entry (ms)
   */
  set(key: string, data: T, ttl?: number): void {
    this.store.set(key, {
      data,
      createdAt: Date.now(),
      ttl: ttl ?? this.defaultTTL,
      lastAccessed: Date.now(),
    });

    this.evictIfNeeded();
  }

  /**
   * Rimuove una entry specifica dalla cache.
   *
   * @param key - Chiave da invalidare
   */
  invalidate(key: string): void {
    this.store.delete(key);
  }

  /**
   * Invalida tutte le entry la cui chiave inizia con un prefisso.
   * Utile per invalidare gruppi logici (es. tutte le entry di un agente).
   *
   * @param prefix - Prefisso della chiave
   */
  invalidatePrefix(prefix: string): void {
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) {
        this.store.delete(key);
      }
    }
  }

  /**
   * Svuota completamente la cache.
   */
  clear(): void {
    this.store.clear();
  }

  /**
   * Ottiene un valore dalla cache o, se assente (o expired), chiama la
   * factory per generarlo, lo memorizza e lo restituisce.
   *
   * Supporta **stale-while-revalidate**: se il dato è stale, viene
   * restituito immediatamente mentre la factory viene chiamata in
   * background per aggiornarlo.
   *
   * Supporta **promise coalescing**: se `getOrSet` viene chiamato
   * concorrentemente con la stessa chiave mentre un fetch è in corso,
   * la promise esistente viene riutilizzata invece di crearne una nuova.
   *
   * @param key - Chiave dell'entry
   * @param factory - Funzione async che produce il dato se non in cache
   * @param ttl - TTL opzionale per questa entry
   * @returns Dato (dalla cache o dalla factory)
   *
   * @example
   * ```ts
   * const data = await cache.getOrSet('my-key', async () => {
   *   return await expensiveOperation();
   * }, 60_000);
   * ```
   */
  async getOrSet(key: string, factory: () => Promise<T>, ttl?: number): Promise<T> {
    // Prova con stale-while-revalidate: anche dati stale vanno bene
    const result = this.getWithStale(key);
    if (result) {
      if (result.isStale) {
        // Dato stale: restituiscilo subito, avvia refresh in background
        // (usa la factory come revalidateFn per questa chiamata)
        // Controlla sia pendingFetches che pendingRefreshes per evitare duplicati
        if (!this.pendingFetches.has(key) && !this.pendingRefreshes.has(key)) {
          this.pendingRefreshes.add(key);
          const promise = factory()
            .then((freshData) => {
              this.set(key, freshData, ttl);
              this.pendingFetches.delete(key);
              this.pendingRefreshes.delete(key);
              return freshData;
            })
            .catch((err) => {
              this.pendingFetches.delete(key);
              this.pendingRefreshes.delete(key);
              throw err;
            });
          this.pendingFetches.set(key, promise);
        }
      }
      return result.data;
    }

    // Nessun dato in cache — promise coalescing
    const pending = this.pendingFetches.get(key);
    if (pending) {
      this.coalescedFetches++;
      return pending;
    }

    // Nuovo fetch
    const promise = factory()
      .then((data) => {
        this.set(key, data, ttl);
        this.pendingFetches.delete(key);
        return data;
      })
      .catch((err) => {
        this.pendingFetches.delete(key);
        throw err;
      });

    this.pendingFetches.set(key, promise);
    return promise;
  }

  // -----------------------------------------------------------------------
  // Utility
  // -----------------------------------------------------------------------

  /**
   * Numero di entry attualmente in cache (incluse eventuali scadute non
   * ancora rimosse dal cleanup).
   */
  get size(): number {
    return this.store.size;
  }

  /**
   * Ottiene statistiche estese sulla cache.
   *
   * @returns Statistiche: dimensione, chiavi, TTL medio, stale hits, ecc.
   *
   * @example
   * ```ts
   * const stats = cache.getStats();
   * console.log(`Hit rate: ${stats.hits / (stats.hits + stats.misses) * 100}%`);
   * ```
   */
  getStats(): CacheStats {
    const now = Date.now();
    let totalTtl = 0;
    let oldest = now;

    for (const entry of this.store.values()) {
      totalTtl += entry.ttl;
      if (entry.createdAt < oldest) {
        oldest = entry.createdAt;
      }
    }

    return {
      size: this.store.size,
      keys: Array.from(this.store.keys()),
      averageTtlMs: this.store.size > 0 ? Math.round(totalTtl / this.store.size) : 0,
      oldestEntryMs: this.store.size > 0 ? now - oldest : 0,
      staleHits: this.staleHits,
      coalescedFetches: this.coalescedFetches,
      evictionCount: this.evictionCount,
      isStaleEnabled: this.isStaleConfigured,
      maxEntries: this.options?.maxEntries ?? 0,
      hits: this.hits,
      misses: this.misses,
    };
  }

  // -----------------------------------------------------------------------
  // Cleanup periodico
  // -----------------------------------------------------------------------

  /**
   * Avvia il timer di cleanup periodico.
   * Rimuove le entry scadute ogni CLEANUP_INTERVAL_MS.
   */
  private startCleanup(): void {
    if (this.cleanupTimer) return;
    this.cleanupTimer = setInterval(() => {
      this.removeExpired();
    }, CLEANUP_INTERVAL_MS);

    // Non impedisce la chiusura del processo Node.js
    if (this.cleanupTimer && typeof this.cleanupTimer === 'object' && 'unref' in this.cleanupTimer) {
      (this.cleanupTimer as NodeJS.Timeout).unref();
    }
  }

  /**
   * Ferma il timer di cleanup periodico.
   */
  stopCleanup(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  /**
   * Rimuove tutte le entry scadute.
   * Rispetta la soglia staleTtl: le entry stale (entro staleTtl) NON vengono
   * rimosse perché sono ancora servibili.
   *
   * Viene chiamata periodicamente e su richiesta.
   *
   * @returns Numero di entry rimosse
   */
  removeExpired(): number {
    const now = Date.now();
    let removed = 0;

    for (const [key, entry] of this.store.entries()) {
      const staleTtl = this.getEffectiveStaleTtl(entry.ttl);
      const expiryThreshold = entry.ttl + staleTtl;

      if (now - entry.createdAt > expiryThreshold) {
        this.store.delete(key);
        removed++;
      }
    }

    return removed;
  }

  // -----------------------------------------------------------------------
  // Stale-while-revalidate
  // -----------------------------------------------------------------------

  /**
   * Restituisce la soglia staleTtl effettiva per una entry.
   *
   * Logica:
   * - Se `options.staleTtl` è esplicitamente impostato → usa quello
   * - Se `options.revalidateFn` è fornito ma staleTtl no → default: TTL * 2
   * - Altrimenti → 0 (stale disabilitato)
   */
  private getEffectiveStaleTtl(entryTtl: number): number {
    if (this.options?.staleTtl !== undefined) {
      return this.options.staleTtl;
    }
    if (this.options?.revalidateFn) {
      return entryTtl * 2;
    }
    return 0;
  }

  /**
   * Indica se stale-while-revalidate è stato configurato (tramite
   * staleTtl o revalidateFn).
   */
  private get isStaleConfigured(): boolean {
    return this.options?.staleTtl !== undefined || this.options?.revalidateFn !== undefined;
  }

  /**
   * Avvia un refresh in background per una chiave stale.
   * Fire-and-forget: la promise non viene attesa.
   * Se un refresh è già in corso per la stessa chiave, non fa nulla
   * (coalescing).
   *
   * @param key - Chiave da refreshare
   */
  private triggerBackgroundRefresh(key: string): void {
    if (!this.options?.revalidateFn) return;

    // Evita refresh concorrenti sulla stessa chiave
    if (this.pendingRefreshes.has(key)) return;

    this.pendingRefreshes.add(key);

    this.options
      .revalidateFn(key)
      .then((freshData) => {
        this.set(key, freshData as T);
        this.pendingRefreshes.delete(key);
      })
      .catch(() => {
        // Silenzioso: il dato stale rimane in cache
        this.pendingRefreshes.delete(key);
      });
  }

  // -----------------------------------------------------------------------
  // LRU eviction
  // -----------------------------------------------------------------------

  /**
   * Se `maxEntries` è configurato e superato, rimuove il 10% più vecchio
   * (per lastAccessed) delle entry.
   */
  private evictIfNeeded(): void {
    const max = this.options?.maxEntries ?? 0;
    if (max <= 0 || this.store.size <= max) return;

    // Calcola quante entry rimuovere (10%, minimo 1)
    const toRemove = Math.max(1, Math.ceil(this.store.size * LRU_EVICTION_PCT));

    // Ordina per lastAccessed crescente (più vecchi primi)
    const sorted = Array.from(this.store.entries()).sort(
      ([, a], [, b]) => a.lastAccessed - b.lastAccessed,
    );

    for (let i = 0; i < toRemove && i < sorted.length; i++) {
      this.store.delete(sorted[i][0]);
      this.evictionCount++;
    }
  }
}

// ---------------------------------------------------------------------------
// Istanze globali
// ---------------------------------------------------------------------------

/** Cache per opencode.json — TTL 60 secondi. */
export const openCodeCache = new Cache<unknown>(60_000);

/** Cache per progress.md — TTL 30 secondi. */
export const progressCache = new Cache<unknown>(30_000);

/** Cache per decisions.md — TTL 60 secondi. */
export const decisionsCache = new Cache<unknown>(60_000);

/** Cache per validazione — TTL 120 secondi (2 minuti). */
export const validationCache = new Cache<unknown>(120_000);

// Fase 2 — integrate cache-aside nei moduli CRUD

/** Cache per query sessioni DB — TTL 30 secondi. */
export const memorySessionsCache = new Cache<unknown>(30_000);

/** Cache per query eventi DB — TTL 15 secondi. */
export const memoryEventsCache = new Cache<unknown>(15_000);

/** Cache per query knowledge DB — TTL 60 secondi. */
export const memoryKnowledgeCache = new Cache<unknown>(60_000);

/** Cache per query contesti DB — TTL 30 secondi. */
export const memoryContextsCache = new Cache<unknown>(30_000);

// ---------------------------------------------------------------------------
// Funzioni globali di invalidazione
// ---------------------------------------------------------------------------

/**
 * Invalida tutte le cache contemporaneamente.
 * Utile dopo modifiche a file (opencode.json, progress.md, decisions.md).
 *
 * @example
 * ```ts
 * // Dopo aver scritto opencode.json
 * invalidateAllCaches();
 * ```
 */
export function invalidateAllCaches(): void {
  openCodeCache.clear();
  progressCache.clear();
  decisionsCache.clear();
  validationCache.clear();
}

/**
 * Invalida le cache relative a un agente specifico.
 * Utile dopo modifiche alla configurazione di un singolo agente.
 *
 * @param agentName - Nome dell'agente
 *
 * @example
 * ```ts
 * invalidateAgentCache('minerva');
 * ```
 */
export function invalidateAgentCache(agentName: string): void {
  // Invalida tutte le entry che iniziano col nome agente
  openCodeCache.invalidatePrefix(agentName);
  progressCache.invalidatePrefix(agentName);
  decisionsCache.invalidatePrefix(agentName);
  validationCache.invalidatePrefix(agentName);
}

/**
 * Restituisce le statistiche aggregate di tutte le cache.
 *
 * @returns Statistiche per ogni cache
 *
 * @example
 * ```ts
 * const stats = getCacheStats();
 * console.log(stats.openCodeCache);
 * ```
 */
export function getCacheStats(): Record<string, CacheStats> {
  return {
    openCodeCache: openCodeCache.getStats(),
    progressCache: progressCache.getStats(),
    decisionsCache: decisionsCache.getStats(),
    validationCache: validationCache.getStats(),
  };
}
