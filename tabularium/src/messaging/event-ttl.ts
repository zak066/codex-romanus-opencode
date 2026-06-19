/**
 * messaging/event-ttl.ts
 * TTL cleanup periodico per event_log (GAP-07).
 * Rimuove eventi più vecchi di N giorni (default: 7).
 *
 * @module messaging/event-ttl
 */

import { getDatabase } from '../core/database.js';

/**
 * Elimina eventi più vecchi di maxAgeDays giorni dalla tabella event_log.
 *
 * @param maxAgeDays - Età massima in giorni (default: 7)
 * @returns Oggetto con conteggio eliminazioni e soglia applicata
 */
export function purgeOldEvents(maxAgeDays: number = 7): { deleted: number; maxAgeDays: number } {
  try {
    const db = getDatabase();
    const result = db.prepare(
      `DELETE FROM event_log WHERE created_at < datetime('now', ?)`
    ).run(`-${maxAgeDays} days`);

    const deleted = result.changes;
    if (deleted > 0) {
      console.error(`[event-ttl] Purged ${deleted} old events (older than ${maxAgeDays} days)`);
    }
    return { deleted, maxAgeDays };
  } catch (err) {
    // DB non disponibile (test o avvio) — skip silenzioso
    return { deleted: 0, maxAgeDays };
  }
}

/**
 * Avvia timer periodico per TTL cleanup automatico.
 *
 * @param intervalMs - Intervallo in millisecondi (default: 3600000 = 1 ora)
 * @param maxAgeDays - Età massima in giorni per purgeOldEvents (default: 7)
 * @returns Funzione stop() per fermare il timer
 */
export function startTtlTimer(
  intervalMs: number = 3600000,
  maxAgeDays: number = 7
): () => void {
  const timer = setInterval(() => {
    purgeOldEvents(maxAgeDays);
  }, intervalMs);

  console.error(`[event-ttl] TTL timer started (interval: ${intervalMs}ms, maxAge: ${maxAgeDays}d)`);

  return () => {
    clearInterval(timer);
    console.error('[event-ttl] TTL timer stopped');
  };
}
