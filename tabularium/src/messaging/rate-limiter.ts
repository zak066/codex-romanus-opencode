/**
 * messaging/rate-limiter.ts
 * Token bucket rate limiter per il sistema di Messaging Real-Time (R1).
 * Limita il numero di messaggi che un agente può inviare in un dato intervallo.
 *
 * Configurazione:
 *   - MAX_TOKENS = 20    (massimo gettoni accumulabili)
 *   - REFILL_RATE = 1    (1 token al secondo)
 *   - MAX_BURST = 20     (massimo burst consentito)
 *
 * @module messaging/rate-limiter
 */

// ---------------------------------------------------------------------------
// Configurazione
// ---------------------------------------------------------------------------

const MAX_TOKENS = 20;
const REFILL_RATE = 1; // 1 token al secondo
const MAX_BURST = 20;

// ---------------------------------------------------------------------------
// Tipo
// ---------------------------------------------------------------------------

export interface RateLimitResult {
  allowed: boolean;
  retryAfter?: number;
}

// ---------------------------------------------------------------------------
// Stato token bucket in-memory
// ---------------------------------------------------------------------------

interface TokenBucket {
  tokens: number;
  lastRefill: number; // timestamp in millisecondi
}

const buckets: Map<string, TokenBucket> = new Map();

// ---------------------------------------------------------------------------
// Rate limiter
// ---------------------------------------------------------------------------

/**
 * Verifica se un agente ha superato il rate limit.
 *
 * Implementa l'algoritmo token bucket:
 * - Ogni agente ha un bucket con un numero di token
 * - I token vengono rigenerati a REFILL_RATE token al secondo
 * - Ogni messaggio consuma 1 token
 * - Se non ci sono token sufficienti, la richiesta viene rifiutata
 *
 * @param agentName - Nome dell'agente da verificare
 * @returns RateLimitResult con allowed (boolean) e retryAfter (secondi, opzionale)
 */
export function checkRateLimit(agentName: string): RateLimitResult {
  const now = Date.now();

  let bucket = buckets.get(agentName);

  if (!bucket) {
    // Primo accesso: crea bucket con token pieni
    bucket = { tokens: MAX_TOKENS - 1, lastRefill: now };
    buckets.set(agentName, bucket);
    return { allowed: true };
  }

  // Refill: calcola quanti token sono stati rigenerati dall'ultimo accesso
  const elapsedSeconds = (now - bucket.lastRefill) / 1000;
  const refillTokens = Math.floor(elapsedSeconds * REFILL_RATE);

  if (refillTokens > 0) {
    bucket.tokens = Math.min(bucket.tokens + refillTokens, MAX_TOKENS);
    bucket.lastRefill = now;
  }

  // Consuma un token
  if (bucket.tokens >= 1) {
    bucket.tokens -= 1;
    return { allowed: true };
  }

  // Rate limitato: calcola quando sarà disponibile il prossimo token
  const secondsUntilNextToken = Math.ceil((1 - bucket.tokens) / REFILL_RATE);

  return {
    allowed: false,
    retryAfter: Math.max(1, secondsUntilNextToken),
  };
}

/**
 * Resetta il rate limit per un agente (utile per test).
 *
 * @param agentName - Nome dell'agente da resettare
 */
export function resetRateLimit(agentName: string): void {
  buckets.delete(agentName);
}

/**
 * Resetta TUTTI i rate limit (utile per test e cleanup).
 */
export function resetAllRateLimits(): void {
  buckets.clear();
}

/**
 * Restituisce lo stato attuale del rate limiter per un agente (debug).
 *
 * @param agentName - Nome dell'agente
 * @returns Stato del bucket o undefined se non presente
 */
export function getRateLimitState(agentName: string): { tokens: number; lastRefill: number } | undefined {
  const bucket = buckets.get(agentName);
  if (!bucket) return undefined;
  return { tokens: bucket.tokens, lastRefill: bucket.lastRefill };
}
