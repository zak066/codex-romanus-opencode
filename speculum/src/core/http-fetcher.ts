/**
 * speculum-search — HTTP Fetcher (S3)
 *
 * Modulo di fetch HTTP con:
 * - Timeout configurabile (default 10s)
 * - Retry con exponential backoff (1s, 2s)
 * - Sanitizzazione: max content size 100KB
 * - User-Agent: speculum/1.0 (Codex Romanus)
 *
 * Usa fetch() globale di Node.js 18+ — nessuna dipendenza esterna.
 */

// ─── Types ─────────────────────────────────────────────────────

export interface FetchOptions {
  timeout?: number;      // default 10000 (ms)
  retries?: number;      // default 1 (2 tentativi totali)
  userAgent?: string;
  maxSize?: number;      // default 102400 (100KB)
  method?: string;       // default 'GET'
  body?: string;         // request body per POST
  contentType?: string;  // Content-Type header
  headers?: Record<string, string>;  // headers aggiuntivi da unire
}

export interface FetchResult {
  ok: boolean;
  status: number;
  body: string;
  url: string;
  headers: Record<string, string>;
  duration: number;      // ms
  cached: boolean;
}

export class HttpError extends Error {
  public status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

/**
 * Interfaccia per l'iniezione delle dipendenze (es. SearchEngine).
 */
export interface HttpFetcher {
  fetchUrl(url: string, options?: FetchOptions): Promise<FetchResult>;
}

// ─── Implementation ────────────────────────────────────────────

/**
 * Esegue una richiesta HTTP con timeout, retry e sanitizzazione.
 * Supporta GET (default) e POST.
 *
 * @param url      URL da fetchare
 * @param options  Opzioni di configurazione
 * @returns        FetchResult con body, status, headers, duration
 * @throws         HttpError in caso di timeout o errori HTTP 4xx/5xx
 */
export async function fetchUrl(
  url: string,
  options?: FetchOptions,
): Promise<FetchResult> {
  const {
    timeout = 10_000,
    retries = 1,
    userAgent = 'speculum/1.0 (Codex Romanus)',
    maxSize = 102_400, // 100 KB
    method = 'GET',
    body,
    contentType,
    headers: customHeaders,
  } = options ?? {};

  const startTime = Date.now();
  let lastError: Error | null = null;

  // Costruisci headers (uniendo eventuali headers custom)
  const headers: Record<string, string> = {
    'User-Agent': userAgent,
    Accept: 'text/html,application/json,*/*',
    ...customHeaders,
  };
  if (contentType) {
    headers['Content-Type'] = contentType;
  }

  // Costruisci init per fetch
  const init: RequestInit = {
    signal: undefined as unknown as AbortSignal,
    method,
    headers,
  };
  if (body && method !== 'GET' && method !== 'HEAD') {
    init.body = body;
  }

  // Tentativi: da 0 a retries (incluso) = retries + 1 tentativi totali
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);
      init.signal = controller.signal;

      const response = await fetch(url, init);

      clearTimeout(timeoutId);
      const duration = Date.now() - startTime;

      // Leggi il body con limite di dimensione
      const responseBody = await readBodyWithLimit(response, maxSize);

      // Converti headers in Record<string, string>
      const headers: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        headers[key] = value;
      });

      return {
        ok: response.ok,
        status: response.status,
        body: responseBody,
        url: response.url,
        headers,
        duration,
        cached: false,
      };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      // Se è l'ultimo tentativo, rilancia
      if (attempt === retries) {
        if (lastError.name === 'AbortError') {
          throw new HttpError(408, `Request timeout after ${timeout}ms: ${url}`);
        }
        throw lastError;
      }

      // Exponential backoff: 1s, 2s, 4s...
      const delay = Math.pow(2, attempt) * 1000;
      console.error(
        `[http-fetcher] Tentativo ${attempt + 1} fallito per ${url}, ` +
        `riprovo tra ${delay}ms: ${lastError.message}`,
      );
      await sleep(delay);
    }
  }

  // Dovrebbe essere irraggiungibile, ma TypeScript vuole un return
  throw lastError ?? new Error('Unexpected error in fetchUrl');
}

/**
 * Crea un oggetto HttpFetcher (per dependency injection).
 */
export function createHttpFetcher(): HttpFetcher {
  return { fetchUrl };
}

// ─── Helpers ───────────────────────────────────────────────────

/**
 * Legge il body della response con un limite massimo di byte.
 * Se il body supera maxSize, tronca e scarta il resto.
 */
async function readBodyWithLimit(
  response: Response,
  maxSize: number,
): Promise<string> {
  if (!response.body) {
    // Fallback: usa text() ma attenzione alla dimensione
    const text = await response.text();
    return text.length > maxSize ? text.slice(0, maxSize) : text;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const remaining = maxSize - totalBytes;
      if (remaining <= 0) break;

      const chunk = value.slice(0, remaining);
      chunks.push(decoder.decode(chunk, { stream: true }));
      totalBytes += chunk.length;
    }
  } finally {
    reader.cancel().catch(() => { /* ignore */ });
  }

  // Flush finale del decoder
  chunks.push(decoder.decode());

  return chunks.join('');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
