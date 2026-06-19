/**
 * File Lock — Ianus Liminalis
 *
 * File-based locking mechanism per prevenire race condition
 * quando più agenti del team Codex Romanus modificano gli stessi file.
 *
 * Pattern: .lock files affiancati al file target (es. file.ts → file.ts.lock)
 * I lock contengono metadata JSON (owner, timestamp, TTL).
 * Stale detection basata su acquiredAt + ttlMinutes.
 *
 * Zero dipendenze npm — solo API Node.js native.
 */

import { join, relative, sep } from 'node:path';
import { writeFile, readFile, unlink, readdir } from 'node:fs/promises';

// ─── Public Interfaces ───────────────────────────────────────────────────

export interface LockInfo {
  /** Nome dell'agente che detiene il lock */
  owner: string;
  /** ISO timestamp di acquisizione */
  acquiredAt: string;
  /** Durata del lock in minuti prima che diventi stale */
  ttlMinutes: number;
  /** Path del file sotto lock (relativo o assoluto) */
  path: string;
  /** true se il lock è scaduto */
  isStale: boolean;
}

export interface LockResult {
  /** true se l'operazione è riuscita */
  success: boolean;
  /** Informazioni sul lock (presente se l'operazione ha coinvolto un lock) */
  lock?: LockInfo;
  /** Messaggio di errore se success === false */
  error?: string;
  /** true se l'acquisizione ha sovrascritto un lock stale */
  forcedAcquire?: boolean;
}

export interface AcquireOptions {
  /** Durata del lock in minuti (default: 15) */
  ttlMinutes?: number;
}

// ─── Constants ───────────────────────────────────────────────────────────

const DEFAULT_TTL = 15;
const DEFAULT_STALE_THRESHOLD = 30;

// ─── Private Helpers ─────────────────────────────────────────────────────

/**
 * Restituisce il path del file `.lock` per un dato file target.
 * Esempio: "decisions.md" → "decisions.md.lock"
 */
function getLockPath(filePath: string): string {
  return filePath + '.lock';
}

/**
 * Legge e parsa un file `.lock` dal disco.
 * Ritorna null se il file non esiste, è illeggibile, o ha JSON invalido.
 * Imposta isStale in base alla verifica della scadenza.
 */
async function readLockFile(lockPath: string): Promise<LockInfo | null> {
  try {
    const content = await readFile(lockPath, 'utf-8');
    const data = JSON.parse(content) as Omit<LockInfo, 'isStale'>;

    if (!data.owner || !data.acquiredAt || typeof data.ttlMinutes !== 'number') {
      return null;
    }

    const stale = isStaleLockData(data.acquiredAt, data.ttlMinutes);

    return {
      owner: data.owner,
      acquiredAt: data.acquiredAt,
      ttlMinutes: data.ttlMinutes,
      path: data.path,
      isStale: stale,
    };
  } catch {
    return null;
  }
}

/**
 * Scrive atomicamente un file `.lock` con flag `wx` (exclusive create).
 * Lancia errore se il file esiste già.
 */
async function writeLockFile(lockPath: string, info: LockInfo): Promise<void> {
  const content = JSON.stringify(
    {
      owner: info.owner,
      acquiredAt: info.acquiredAt,
      ttlMinutes: info.ttlMinutes,
      path: info.path,
    },
    null,
    2,
  );
  await writeFile(lockPath, content, { flag: 'wx', encoding: 'utf-8' });
}

/**
 * Determina se un lock è stale in base a acquiredAt + ttlMinutes.
 * Se il timestamp è invalido, considera stale (safety first).
 */
function isStaleLockData(
  acquiredAt: string,
  ttlMinutes: number,
  thresholdMinutes: number = DEFAULT_STALE_THRESHOLD,
): boolean {
  const acquired = new Date(acquiredAt).getTime();
  if (isNaN(acquired)) return true;

  const effectiveTtl = ttlMinutes > 0 ? ttlMinutes : thresholdMinutes;
  const deadline = acquired + effectiveTtl * 60 * 1000;
  return Date.now() > deadline;
}

/**
 * Wrapper che accetta un LockInfo completo.
 */
function isStaleLock(
  info: LockInfo,
  thresholdMinutes: number = DEFAULT_STALE_THRESHOLD,
): boolean {
  return isStaleLockData(info.acquiredAt, info.ttlMinutes, thresholdMinutes);
}

/**
 * Rimuove un file `.lock` dal disco.
 * Ritorna true se il file esisteva ed è stato eliminato, false se non esisteva.
 */
async function removeLockFile(lockPath: string): Promise<boolean> {
  try {
    await unlink(lockPath);
    return true;
  } catch (err: unknown) {
    const nodeErr = err as NodeJS.ErrnoException;
    if (nodeErr.code === 'ENOENT') {
      return false;
    }
    throw err;
  }
}

// ─── Public Functions ────────────────────────────────────────────────────

/**
 * Acquisisce un lock per un file target.
 *
 * Strategia:
 *  1. Tentativo di scrittura atomica con flag `wx` (exclusive create).
 *  2. Se il file esiste già (EEXIST), legge il lock esistente.
 *  3. Se il lock è attivo → errore "File is locked by {owner}".
 *  4. Se il lock è stale o illeggibile → sovrascrive (forced acquire).
 *
 * @param filePath - Path del file da lockare
 * @param owner   - Nome dell'agente che richiede il lock
 * @param options - Opzioni (ttlMinutes)
 */
export async function acquireLock(
  filePath: string,
  owner: string,
  options?: AcquireOptions,
): Promise<LockResult> {
  const lockPath = getLockPath(filePath);
  const ttlMinutes = options?.ttlMinutes ?? DEFAULT_TTL;
  const now = new Date().toISOString();

  const lockInfo: LockInfo = {
    owner,
    acquiredAt: now,
    ttlMinutes,
    path: filePath,
    isStale: false,
  };

  // Step 1: Tentativo di creazione atomica (exclusive create)
  try {
    await writeLockFile(lockPath, lockInfo);
    return { success: true, lock: lockInfo };
  } catch (err: unknown) {
    const nodeErr = err as NodeJS.ErrnoException;
    if (nodeErr.code !== 'EEXIST') {
      // Errore inaspettato (permessi, disco pieno, path invalido, ecc.)
      return {
        success: false,
        error: `Failed to acquire lock: ${nodeErr.message}`,
      };
    }
  }

  // Step 2: Il lock esiste già — verifica se è stale
  try {
    const existing = await readLockFile(lockPath);

    if (existing && !existing.isStale) {
      // Lock attivo — non possiamo acquisire
      return {
        success: false,
        error: `File is locked by ${existing.owner} (acquired at ${existing.acquiredAt})`,
        lock: existing,
      };
    }

    // Step 3: Lock stale o illeggibile — sovrascrivi (forzato)
    // Nota: usiamo writeFile semplice (non wx) perché stiamo overwritando
    const content = JSON.stringify(
      {
        owner: lockInfo.owner,
        acquiredAt: lockInfo.acquiredAt,
        ttlMinutes: lockInfo.ttlMinutes,
        path: lockInfo.path,
      },
      null,
      2,
    );
    await writeFile(lockPath, content, { encoding: 'utf-8' });

    return {
      success: true,
      lock: lockInfo,
      forcedAcquire: true,
    };
  } catch (innerErr: unknown) {
    return {
      success: false,
      error: `Failed to acquire lock (stale handling): ${(innerErr as Error).message}`,
    };
  }
}

/**
 * Rilascia un lock per un file target.
 *
 * Regole:
 *  - Solo l'owner originale del lock può rilasciarlo.
 *  - Se il lock non esiste → successo (no-op).
 *  - Se l'owner non corrisponde → errore.
 *
 * @param filePath - Path del file da sbloccare
 * @param owner   - Nome dell'agente che richiede il rilascio
 */
export async function releaseLock(
  filePath: string,
  owner: string,
): Promise<LockResult> {
  const lockPath = getLockPath(filePath);

  try {
    const existing = await readLockFile(lockPath);

    if (!existing) {
      // Lock non esiste — no-op
      return { success: true };
    }

    if (existing.owner !== owner) {
      return {
        success: false,
        error: `Cannot release lock: owned by ${existing.owner}`,
        lock: existing,
      };
    }

    await removeLockFile(lockPath);
    return { success: true, lock: existing };
  } catch (err: unknown) {
    return {
      success: false,
      error: `Failed to release lock: ${(err as Error).message}`,
    };
  }
}

/**
 * Legge le informazioni sul lock di un file target.
 * Ritorna null se non esiste alcun lock o se il file `.lock` è illeggibile.
 *
 * @param filePath - Path del file da ispezionare
 */
export async function getLock(filePath: string): Promise<LockInfo | null> {
  const lockPath = getLockPath(filePath);
  return readLockFile(lockPath);
}

/**
 * Elenca tutti i file `.lock` presenti in una directory (ricorsivo).
 *
 * @param directory - Path della directory da scandagliare (default: process.cwd())
 * @param options   - includeStale: se true, include anche lock scaduti (default: false)
 */
export async function listLocks(
  directory?: string,
  options?: { includeStale?: boolean },
): Promise<LockInfo[]> {
  const searchDir = directory || process.cwd();
  const includeStale = options?.includeStale ?? false;
  const results: LockInfo[] = [];

  try {
    const entries = await readdir(searchDir, {
      recursive: true,
      withFileTypes: true,
    });

    // Filtra solo i file che terminano con '.lock'
    const lockEntries = entries.filter(
      (entry) => entry.isFile() && entry.name.endsWith('.lock'),
    );

    for (const entry of lockEntries) {
      const lockPath = join(entry.parentPath, entry.name);
      const info = await readLockFile(lockPath);

      if (info) {
        // Ricava il path del file originale (senza .lock)
        const sourceFileName = entry.name.slice(0, -5); // rimuove '.lock'
        const sourcePath = join(entry.parentPath, sourceFileName);
        info.path = relative(searchDir, sourcePath);

        if (includeStale || !info.isStale) {
          results.push(info);
        }
      }
    }

    return results;
  } catch (err: unknown) {
    const message = (err as Error).message;
    console.error(`[file-lock] Error listing locks in "${searchDir}": ${message}`);
    return [];
  }
}

/**
 * Verifica se un file ha un lock attivo (non stale).
 *
 * @param filePath - Path del file da controllare
 * @returns true se il file è lockato da un lock non scaduto
 */
export async function isLocked(filePath: string): Promise<boolean> {
  const lock = await getLock(filePath);
  if (!lock) return false;
  return !lock.isStale;
}
