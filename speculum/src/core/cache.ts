/**
 * Cache LRU in-memory per speculum-search.
 *
 * Fornisce una cache Least Recently Used con supporto TTL,
 * hit tracking e statistiche.
 *
 * @module core/cache
 */

/** Entry singola della cache */
export interface CacheEntry<T> {
  value: T;
  expiresAt: number;  // epoch ms
  hits: number;
  createdAt: number;
}

/** Statistiche aggregate della cache */
export interface CacheStats {
  size: number;
  maxSize: number;
  hits: number;
  misses: number;
  hitRate: number;       // 0-1
  oldestEntry: number | null;
  newestEntry: number | null;
}

/**
 * Cache LRU thread-safe in-memory.
 *
 * Usa `Map` per mantenere l'ordine di inserimento: la prima chiave
 * del Map è la meno recentemente usata. Ogni `get()` con successo
 * riporta l'entry in fondo (ri-inserimento).
 *
 * @typeParam T  Tipo dei valori memorizzati (default: any)
 */
export class LRUCache<T = any> {
  private cache: Map<string, CacheEntry<T>>;
  private maxSize: number;
  private defaultTTL: number;
  private hits = 0;
  private misses = 0;

  /**
   * @param maxSize     Massimo numero di entry (default: 100)
   * @param defaultTTL  TTL predefinito in ms (default: 1_800_000 = 30 min)
   */
  constructor(maxSize = 100, defaultTTL = 1_800_000) {
    this.cache = new Map();
    this.maxSize = maxSize;
    this.defaultTTL = defaultTTL;
  }

  /**
   * Recupera un valore dalla cache.
   *
   * Se la chiave non esiste o è scaduta, restituisce `null`
   * e incrementa il contatore dei miss.
   * Se trovata e valida, incrementa gli hit e riporta l'entry
   * in fondo (LRU refresh).
   *
   * @param key  Chiave da cercare
   * @returns    Il valore memorizzato, o `null` se assente/scaduto
   */
  async get(key: string): Promise<T | null> {
    const entry = this.cache.get(key);

    if (!entry) {
      this.misses++;
      return null;
    }

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      this.misses++;
      return null;
    }

    // LRU refresh: ri-inserisci per spostare in fondo
    this.cache.delete(key);
    this.cache.set(key, entry);
    entry.hits++;
    this.hits++;

    return entry.value;
  }

  /**
   * Memorizza un valore nella cache.
   *
   * Se la chiave esiste già, viene sovrascritta.
   * Se la cache ha raggiunto `maxSize`, elimina l'entry
   * meno recentemente usata (la prima del Map).
   *
   * @param key    Chiave
   * @param value  Valore da memorizzare
   * @param ttlMs  TTL opzionale in ms (sovrascrive `defaultTTL`)
   */
  async set(key: string, value: T, ttlMs?: number): Promise<void> {
    // Se già presente, elimina per reinserire in fondo
    this.cache.delete(key);

    // Evict finché non c'è spazio
    while (this.cache.size >= this.maxSize) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) {
        this.cache.delete(oldestKey);
      }
    }

    const ttl = ttlMs ?? this.defaultTTL;
    this.cache.set(key, {
      value,
      expiresAt: Date.now() + ttl,
      hits: 0,
      createdAt: Date.now(),
    });
  }

  /**
   * Elimina una chiave dalla cache.
   *
   * @param key  Chiave da eliminare
   * @returns    `true` se la chiave esisteva ed è stata rimossa
   */
  async delete(key: string): Promise<boolean> {
    return this.cache.delete(key);
  }

  /** Svuota completamente la cache e azzera le statistiche. */
  async clear(): Promise<void> {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
  }

  /**
   * Statistiche correnti della cache.
   *
   * Include hit rate (0-1) e timestamp delle entry più vecchia e nuova.
   */
  getStats(): CacheStats {
    const entries = Array.from(this.cache.values());
    const total = this.hits + this.misses;

    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      hits: this.hits,
      misses: this.misses,
      hitRate: total === 0 ? 0 : this.hits / total,
      oldestEntry: entries.length > 0
        ? Math.min(...entries.map(e => e.createdAt))
        : null,
      newestEntry: entries.length > 0
        ? Math.max(...entries.map(e => e.createdAt))
        : null,
    };
  }

  /** Numero di entry correnti nella cache. */
  get size(): number {
    return this.cache.size;
  }
}
