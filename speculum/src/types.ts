// ─── Search ────────────────────────────────────────────────────

export interface SearchParams {
  query: string;
  maxResults?: number;       // default 10, max 20
  region?: string;           // es. "it-it", "us-en" (kl param)
  timeRange?: 'd' | 'w' | 'm' | 'y';  // day/week/month/year (df param)
}

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  date?: string;
  source: 'duckduckgo';
  fetchedAt: string;
}

// ─── Knowledge (Instant Answer) ─────────────────────────────────

export interface KnowledgeParams {
  query: string;
}

export interface KnowledgeResult {
  abstract: string;
  entity: string;
  heading: string;
  infobox?: Record<string, unknown>;
  image?: string;
  url?: string;
  relatedTopics?: { name: string; url: string }[];
}

// ─── Suggest (Autocomplete) ─────────────────────────────────────

export interface SuggestParams {
  query: string;
}

export interface SuggestResult {
  query: string;
  suggestions: string[];
}

// ─── Fetch ──────────────────────────────────────────────────────

export interface FetchParams {
  url: string;
  extract?: boolean;  // default true: estrai contenuto con Readability
}

export interface FetchResult {
  title: string;
  url: string;
  content: string;    // testo pulito (se extract) o HTML raw
  excerpt?: string;
}

// ─── Cache ──────────────────────────────────────────────────────

export interface SearchCache {
  get(key: string): Promise<unknown | null>;
  set(key: string, value: unknown, ttlMs?: number): Promise<void>;
  getStats(): { size: number; hits: number; misses: number; hitRate: number };
}
