import { randomUUID, createHash } from 'node:crypto';
import {
  open,
  mkdir,
  readFile,
  readdir,
  rename,
  rmdir,
  stat,
  unlink,
  copyFile,
  writeFile,
} from 'node:fs/promises';
import { Dirent } from 'node:fs';
import * as path from 'node:path';
import type { BackupConfig, BackupEntry } from './types.js';

/** Suffisso per i file di backup */
const BACKUP_SUFFIX = '.bak';
/** Suffisso per i metadati del backup (sidecar JSON) */
const META_SUFFIX = '.meta.json';

/**
 * Sostituisce il carattere del drive letter (es. `D:`) con `D_`
 * e converte i backslash in forward slash per un uso sicuro nei path.
 */
function sanitizePathComponent(p: string): string {
  return p.replace(/^([A-Za-z]):/, '$1_').replace(/\\/g, '/');
}

/**
 * Legge il file metadata JSON e restituisce un BackupEntry.
 * Returns `null` se il file non esiste o è corrotto.
 */
async function readMetaFile(metaPath: string): Promise<BackupEntry | null> {
  try {
    const content = await readFile(metaPath, 'utf-8');
    return JSON.parse(content) as BackupEntry;
  } catch {
    return null;
  }
}

/**
 * Calcola un identificativo breve per il path del file (primi 16 char
 * dello SHA-256) per evitare path eccessivamente lunghi su Windows.
 */
function shortPathId(absolutePath: string): string {
  return createHash('sha256').update(absolutePath).digest('hex').slice(0, 16);
}

/**
 * Manager per backup e rollback atomici dei file.
 *
 * I backup sono organizzati come:
 * ```
 * {backupDir}/{shortPathId}/{fileName}/{timestamp}_{uuid}.bak
 * {backupDir}/{shortPathId}/{fileName}/{timestamp}_{uuid}.bak.meta.json
 * ```
 *
 * La scrittura è atomica: temp file → fsync → rename.
 */
export class BackupManager {
  private config: Required<BackupConfig>;

  constructor(config: BackupConfig) {
    this.config = {
      retentionDays: config.retentionDays ?? 5,
      backupDir: config.backupDir,
    };
  }

  // ── Helpers ────────────────────────────────────────────

  /**
   * Restituisce la directory dove risiedono i backup per un dato file.
   * Usa un ID breve (hash del path) per evitare path eccessivamente lunghi
   * su Windows, e il nome del file come secondo livello.
   */
  private getBackupDirForFile(filePath: string): string {
    const absolute = path.resolve(filePath);
    const id = shortPathId(absolute);
    const baseName = path.basename(absolute);
    return path.join(path.resolve(this.config.backupDir), id, baseName);
  }

  // ── Public API ─────────────────────────────────────────

  /**
   * Crea un backup atomico del file specificato.
   *
   * 1. Legge il contenuto del file originale
   * 2. Calcola SHA-256 hash
   * 3. Scrive il contenuto in un file temporaneo nella directory di backup
   * 4. Esegue fsync sul file descriptor
   * 5. Rinomina (atomico sullo stesso filesystem) il temp → nome finale
   * 6. Scrive un file metadata JSON affianco al backup
   */
  async backup(filePath: string): Promise<BackupEntry> {
    const absolutePath = path.resolve(filePath);

    // Leggi il file originale
    const content = await readFile(absolutePath);
    const hash = createHash('sha256').update(content).digest('hex');
    const size = content.length;
    const rawTimestamp = new Date().toISOString();           // con ':' — parseabile da new Date()
    const fileTimestamp = rawTimestamp.replace(/:/g, '-');   // con '-' — safe per filename Windows
    const id = randomUUID();

    // Crea la directory di backup
    const backupDir = this.getBackupDirForFile(filePath);
    await mkdir(backupDir, { recursive: true });

    // Scrittura atomica: temp file → fsync → rename
    const finalName = `${fileTimestamp}_${id}${BACKUP_SUFFIX}`;
    const finalPath = path.join(backupDir, finalName);
    const tempPath = path.join(backupDir, `${finalName}.tmp`);

    const handle = await open(tempPath, 'w');
    try {
      await handle.writeFile(content);
      await handle.sync(); // fsync: garantisce che i dati siano su disco
    } finally {
      await handle.close();
    }
    await rename(tempPath, finalPath);

    // Salva metadati (sidecar JSON)
    const entry: BackupEntry = {
      id,
      filePath: absolutePath,
      backupPath: finalPath,
      timestamp: rawTimestamp,
      size,
      hash,
    };
    await writeFile(finalPath + META_SUFFIX, JSON.stringify(entry, null, 2), 'utf-8');

    return entry;
  }

  /**
   * Rollback del file all'ultimo backup disponibile, o a uno specifico
   * tramite `backupId`.
   *
   * Steps: verifica esistenza backup → copia backup → overwrite originale.
   */
  async rollback(filePath: string, backupId?: string): Promise<void> {
    const backups = await this.listBackups(filePath);

    if (backups.length === 0) {
      throw new Error(`No backups found for file: ${filePath}`);
    }

    let target: BackupEntry;
    if (backupId) {
      const found = backups.find((b) => b.id === backupId);
      if (!found) {
        throw new Error(
          `Backup with ID "${backupId}" not found for file: ${filePath}`,
        );
      }
      target = found;
    } else {
      // Il primo elemento è il più recente (ordinamento decrescente)
      target = backups[0];
    }

    // Verifica che il file di backup esista ancora
    await stat(target.backupPath);

    // Copia il contenuto del backup sopra il file originale
    await copyFile(target.backupPath, path.resolve(filePath));
  }

  /**
   * Elenca i backup disponibili per un file, ordinati per data (decrescente).
   * Legge i file metadata `.bak.meta.json` nella directory di backup.
   */
  async listBackups(filePath: string): Promise<BackupEntry[]> {
    const backupDir = this.getBackupDirForFile(filePath);

    let fileNames: string[];
    try {
      fileNames = await readdir(backupDir);
    } catch {
      return [];
    }

    const entries: BackupEntry[] = [];

    for (const name of fileNames) {
      if (!name.endsWith(META_SUFFIX)) continue;

      const metaPath = path.join(backupDir, name);
      const entry = await readMetaFile(metaPath);
      if (entry) {
        entries.push(entry);
      }
    }

    // Ordina per timestamp decrescente (più recente primo)
    entries.sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    );

    return entries;
  }

  /**
   * Elimina i backup più vecchi di `retentionDays`.
   * Se `force` è true, elimina tutti i backup indipendentemente dall'età.
   *
   * Cammina ricorsivamente la directory `backupDir`, elimina i file
   * `.bak` e `.bak.meta.json` che superano la retention, e pulisce
   * le directory vuote residue.
   *
   * @returns Il numero di backup eliminati.
   */
  async prune(force?: boolean): Promise<number> {
    const backupRoot = path.resolve(this.config.backupDir);
    let deletedCount = 0;
    const now = Date.now();
    const retentionMs = this.config.retentionDays * 24 * 60 * 60 * 1000;

    const walkDir = async (dir: string): Promise<void> => {
      let dirents: Dirent[];
      try {
        dirents = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of dirents) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          await walkDir(fullPath);
          // Pulisce directory vuote
          try {
            const remaining = await readdir(fullPath);
            if (remaining.length === 0) {
              await rmdir(fullPath);
            }
          } catch {
            // Ignora errori di rimozione
          }
        } else if (entry.isFile()) {
          const isBak = entry.name.endsWith(BACKUP_SUFFIX);
          const isMeta = entry.name.endsWith(META_SUFFIX);

          if (isBak || isMeta) {
            // Per i meta file, usa il timestamp del .bak corrispondente
            let fileToCheck = fullPath;
            if (isMeta) {
              const bakPath = fullPath.slice(0, -META_SUFFIX.length);
              try {
                await stat(bakPath);
                fileToCheck = bakPath;
              } catch {
                // Meta orfano — eliminalo
                await unlink(fullPath).catch(() => {});
                continue;
              }
            }

            const stats = await stat(fileToCheck);
            const age = now - stats.mtimeMs;

            if (force || age > retentionMs) {
              await unlink(fileToCheck).catch(() => {});
              // Elimina anche il meta corrispondente
              const metaPath = fileToCheck + META_SUFFIX;
              await unlink(metaPath).catch(() => {});
              deletedCount++;
            }
          }
        }
      }
    };

    try {
      await stat(backupRoot);
    } catch {
      // Se la directory di backup non esiste, niente da prune
      return 0;
    }

    await walkDir(backupRoot);
    return deletedCount;
  }

  /**
   * Ottiene il percorso assoluto di un backup specifico cercando
   * ricorsivamente in tutta la directory `backupDir`.
   *
   * @returns Il percorso completo del file `.bak`, o `null` se non trovato.
   */
  async getBackupPath(backupId: string): Promise<string | null> {
    const backupRoot = path.resolve(this.config.backupDir);

    try {
      await stat(backupRoot);
    } catch {
      return null;
    }

    const searchDir = async (dir: string): Promise<string | null> => {
      let dirents: Dirent[];
      try {
        dirents = await readdir(dir, { withFileTypes: true });
      } catch {
        return null;
      }

      for (const entry of dirents) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          const result = await searchDir(fullPath);
          if (result) return result;
        } else if (
          entry.isFile() &&
          entry.name.endsWith(BACKUP_SUFFIX) &&
          entry.name.includes(backupId)
        ) {
          return fullPath;
        }
      }

      return null;
    };

    return searchDir(backupRoot);
  }
}
