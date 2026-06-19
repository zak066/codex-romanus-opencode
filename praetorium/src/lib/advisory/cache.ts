// ============================================================
// Praetorium — Advisory: Cache su file system per i dati della leaderboard
// ============================================================
//
// Legge e scrive la cache advisory in formato JSON.
// Scrittura atomica (tmp → rename) per evitare corruzione.
// TTL configurabile via variabile d'ambiente ADVISORY_CACHE_TTL (default 24h).
// ============================================================

import fs from 'fs/promises';
import path from 'path';
import type { AdvisoryCacheEntry } from './types';

/** TTL della cache in millisecondi (default: 24 ore) */
export const CACHE_TTL = parseInt(process.env.ADVISORY_CACHE_TTL || '86400000', 10);

/** Percorso del file di cache (nella root del progetto Praetorium) */
export const CACHE_FILE = path.join(process.cwd(), '.praetorium-cache-advisory.json');

/**
 * Legge la cache advisory dal file system.
 *
 * @returns AdvisoryCacheEntry se la cache esiste ed è valida, altrimenti null
 */
export async function readCache(): Promise<AdvisoryCacheEntry | null> {
  try {
    const raw = await fs.readFile(CACHE_FILE, 'utf-8');
    const entry = JSON.parse(raw) as AdvisoryCacheEntry;

    // Validazione base della struttura
    if (
      !entry.cachedAt ||
      !entry.expiresAt ||
      !entry.data ||
      !entry.data.high ||
      !entry.data.budget
    ) {
      console.warn('[Praetorium] Cache advisory: struttura non valida, ignoro');
      return null;
    }

    // Controllo scadenza
    const expiresAt = new Date(entry.expiresAt).getTime();
    const now = Date.now();

    if (now >= expiresAt) {
      console.log('[Praetorium] Cache advisory: scaduta');
      return null;
    }

    const ageSeconds = Math.floor((now - new Date(entry.cachedAt).getTime()) / 1000);
    console.log(`[Praetorium] Cache advisory: valida (età: ${ageSeconds}s)`);
    return entry;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      console.log('[Praetorium] Cache advisory: file non esistente');
      return null;
    }
    console.warn('[Praetorium] Cache advisory: errore lettura:', (err as Error).message);
    return null;
  }
}

/**
 * Scrive la cache advisory sul file system in modo atomico.
 *
 * Scrive prima su un file temporaneo (.tmp), poi rinomina.
 * Questo previene la corruzione del file in caso di crash durante la scrittura.
 *
 * @param entry - I dati da salvare nella cache
 */
export async function writeCache(entry: AdvisoryCacheEntry): Promise<void> {
  try {
    const tmpFile = CACHE_FILE + '.tmp';
    const json = JSON.stringify(entry, null, 2);

    await fs.writeFile(tmpFile, json, 'utf-8');
    await fs.rename(tmpFile, CACHE_FILE);

    console.log(`[Praetorium] Cache advisory: salvata (${entry.modelsCount} modelli)`);
  } catch (err) {
    console.error('[Praetorium] Cache advisory: errore scrittura:', (err as Error).message);
    throw new Error(`Scrittura cache fallita: ${(err as Error).message}`);
  }
}

/**
 * Calcola l'età della cache in secondi.
 *
 * @param cachedAt - Timestamp ISO 8601 di creazione della cache
 * @returns Età in secondi, oppure 0 se il timestamp non è valido
 */
export function getCacheAgeSeconds(cachedAt: string): number {
  const cached = new Date(cachedAt).getTime();
  if (isNaN(cached)) return 0;
  return Math.floor((Date.now() - cached) / 1000);
}
