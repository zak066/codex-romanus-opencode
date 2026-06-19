/**
 * core/database.ts
 * Gestione della connessione SQLite singleton per Tabularium.
 * Inizializza il database, abilita WAL mode e foreign keys,
 * esegue le migrazioni dalla cartella migrations/.
 *
 * @module core/database
 */

import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';


// ---------------------------------------------------------------------------
// Costanti
// ---------------------------------------------------------------------------

/** Nome del file di default per il database SQLite */
const DEFAULT_DB_FILENAME = 'memory.db';

// ---------------------------------------------------------------------------
// Stato
// ---------------------------------------------------------------------------

/** Istanza singleton del database */
let db: Database.Database | null = null;

/** Percorso del database attuale */
let currentDbPath: string = '';

// ---------------------------------------------------------------------------
// Pubblica
// ---------------------------------------------------------------------------

/**
 * Restituisce l'istanza singleton del database.
 * Lancia errore se il database non è stato inizializzato.
 *
 * @returns Istanza Database di better-sqlite3
 * @throws Error se initDatabase() non è stata chiamata
 */
export function getDatabase(): Database.Database {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return db;
}

/**
 * Inizializza la connessione SQLite (singleton).
 *
 * - Crea il file DB se non esiste
 * - Abilita WAL mode per performance di scrittura
 * - Abilita foreign keys
 * - Esegue le migrazioni pendenti
 *
 * Se chiamata più volte, restituisce la stessa istanza già inizializzata.
 *
 * @param dbPath - Percorso personalizzato del file DB (default: memory.db nella directory del progetto)
 * @returns Istanza Database inizializzata
 */
export async function initDatabase(dbPath?: string): Promise<Database.Database> {
  if (db) {
    return db;
  }

  // Risolvi percorso del database
  const resolvedPath = dbPath ?? resolveDefaultDbPath();

  // Crea la directory se non esiste
  const dir = path.dirname(resolvedPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  console.error(`[database] Initializing SQLite database at: ${resolvedPath}`);

  db = new Database(resolvedPath);

  // Abilita WAL mode per migliori performance di scrittura concorrente
  db.pragma('journal_mode = WAL');

  // WAL autocheckpoint ogni 1000 pagine (~4 MB) per evitare WAL eccessivi
  db.pragma('wal_autocheckpoint = 1000');

  // Abilita foreign keys enforcement
  db.pragma('foreign_keys = ON');

  // Carica estensione sqlite-vec per ricerca vettoriale
  try {
    const vec = require('sqlite-vec');
    vec.load(db);
  } catch {
    console.error('[database] sqlite-vec not available — vector search disabled');
  }

  currentDbPath = resolvedPath;

  // Esegui migrazioni
  await runMigrations(db);

  console.error(`[database] Database initialized successfully: ${resolvedPath}`);

  return db;
}

/**
 * Chiude la connessione al database e resetta il singleton.
 * Usato per graceful shutdown.
 */
export function closeDatabase(): void {
  if (db) {
    try {
      db.close();
      console.error('[database] Database connection closed');
    } catch (err) {
      console.error('[database] Error closing database:', err);
    }
    db = null;
    currentDbPath = '';
  }
}

/**
 * Restituisce il percorso attuale del database.
 *
 * @returns Percorso del file DB o stringa vuota se non inizializzato
 */
export function getDbPath(): string {
  return currentDbPath;
}

/**
 * Resetta il database (utile per test).
 * Chiude la connessione e cancella il file.
 */
export function resetDatabase(): void {
  const dbPath = currentDbPath;
  closeDatabase();
  if (dbPath && fs.existsSync(dbPath)) {
    try {
      // Rimuovi anche file WAL e SHM
      const walPath = dbPath + '-wal';
      const shmPath = dbPath + '-shm';
      if (fs.existsSync(walPath)) fs.unlinkSync(walPath);
      if (fs.existsSync(shmPath)) fs.unlinkSync(shmPath);
      fs.unlinkSync(dbPath);
      console.error(`[database] Database file deleted: ${dbPath}`);
    } catch (err) {
      console.error('[database] Error deleting database file:', err);
    }
  }
}

// ---------------------------------------------------------------------------
// Health Check
// ---------------------------------------------------------------------------

export interface HealthCheckResult {
  integrity: 'ok' | 'corrupt' | 'error';
  integrityDetail?: string;
  walSize: number;
  dbSize: number;
  walRatio: number;
  knowledgeEntriesCount: number;
  knowledgeFtsCount: number;
  orphans: { ftsWithoutContent: number; contentWithoutFts: number };
  recommendations: string[];
}

export function runDatabaseHealthCheck(): HealthCheckResult {
  const database = getDatabase();
  const result: HealthCheckResult = {
    integrity: 'ok',
    walSize: 0,
    dbSize: 0,
    walRatio: 0,
    knowledgeEntriesCount: 0,
    knowledgeFtsCount: 0,
    orphans: { ftsWithoutContent: 0, contentWithoutFts: 0 },
    recommendations: [],
  };

  // Integrity check
  try {
    const check = database.prepare('PRAGMA integrity_check').get() as { integrity_check: string };
    if (check && check.integrity_check !== 'ok') {
      result.integrity = 'corrupt';
      result.integrityDetail = check.integrity_check;
      result.recommendations.push('RUN VACUUM IMMEDIATELY — database corruption detected');
    }
  } catch (err) {
    result.integrity = 'error';
    result.integrityDetail = err instanceof Error ? err.message : String(err);
  }

  // WAL size check
  const dbPath = currentDbPath;
  const walPath = dbPath + '-wal';
  if (fs.existsSync(walPath)) {
    result.walSize = fs.statSync(walPath).size;
  }
  if (fs.existsSync(dbPath)) {
    result.dbSize = fs.statSync(dbPath).size;
  }
  result.walRatio = result.dbSize > 0 ? result.walSize / result.dbSize : 0;

  if (result.walRatio > 0.5) {
    result.recommendations.push(`WAL file is ${Math.round(result.walRatio * 100)}% of DB size — run checkpoint`);
  }

  // FTS vs content table row count
  try {
    const entriesCount = database.prepare('SELECT COUNT(*) as cnt FROM knowledge_entries').get() as { cnt: number };
    result.knowledgeEntriesCount = entriesCount?.cnt ?? 0;

    const ftsCount = database.prepare('SELECT COUNT(*) as cnt FROM knowledge_fts').get() as { cnt: number };
    result.knowledgeFtsCount = ftsCount?.cnt ?? 0;

    // Check orphans
    const ftsOrphans = database.prepare(`
      SELECT COUNT(*) as cnt FROM knowledge_fts fts
      LEFT JOIN knowledge_entries ke ON fts.rowid = ke.rowid
      WHERE ke.rowid IS NULL
    `).get() as { cnt: number };
    result.orphans.ftsWithoutContent = ftsOrphans?.cnt ?? 0;

    const contentOrphans = database.prepare(`
      SELECT COUNT(*) as cnt FROM knowledge_entries ke
      LEFT JOIN knowledge_fts fts ON ke.rowid = fts.rowid
      WHERE fts.rowid IS NULL
    `).get() as { cnt: number };
    result.orphans.contentWithoutFts = contentOrphans?.cnt ?? 0;

    if (result.knowledgeEntriesCount !== result.knowledgeFtsCount) {
      result.recommendations.push(`FTS mismatch: ${result.knowledgeEntriesCount} entries vs ${result.knowledgeFtsCount} FTS — run fts_rebuild`);
    }
  } catch {
    // FTS table might not exist yet
  }

  return result;
}

// ---------------------------------------------------------------------------
// Privato
// ---------------------------------------------------------------------------

/**
 * Risolve il percorso di default per il database.
 * Il database viene creato nella directory principale di Tabularium
 * (stessa directory che contiene il package.json di Tabularium),
 * usando __dirname per determinare la posizione del modulo.
 * In questo modo il percorso è indipendente da process.cwd().
 */
function resolveDefaultDbPath(): string {
  // database.ts è in src/core/, quindi risali di 2 livelli per la root di tabularium/
  const tabulariumRoot = path.resolve(__dirname, '..', '..');
  return path.join(tabulariumRoot, DEFAULT_DB_FILENAME);
}

/**
 * Esegue le migrazioni SQL dalla cartella migrations/ in ordine alfabetico.
 * Tiene traccia delle migrazioni già eseguite tramite una tabella `_migrations`.
 *
 * @param database - Istanza del database su cui eseguire le migrazioni
 */
async function runMigrations(database: Database.Database): Promise<void> {
  // Crea tabella di tracking migrazioni se non esiste
  database.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name TEXT PRIMARY KEY,
      executed_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // Determina il percorso della cartella migrations
  const migrationsDir = findMigrationsDir();

  if (!migrationsDir || !fs.existsSync(migrationsDir)) {
    console.error('[database] No migrations directory found, skipping migrations');
    return;
  }

  // Legge tutti i file .sql in ordine alfabetico
  const files = fs.readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  if (files.length === 0) {
    console.error('[database] No SQL migration files found');
    return;
  }

  // Recupera migrazioni già eseguite
  const executed = new Set(
    database.prepare('SELECT name FROM _migrations').all()
      .map((row: unknown) => (row as { name: string }).name)
  );

  for (const file of files) {
    if (executed.has(file)) {
      console.error(`[database] Migration already executed: ${file}`);
      continue;
    }

    const filePath = path.join(migrationsDir, file);
    const sql = fs.readFileSync(filePath, 'utf-8');

    console.error(`[database] Running migration: ${file}`);

    // Esegue la migrazione in una transazione
    const runMigration = database.transaction(() => {
      database.exec(sql);
      database.prepare('INSERT INTO _migrations (name) VALUES (?)').run(file);
    });

    try {
      runMigration();
      console.error(`[database] Migration completed: ${file}`);
    } catch (err) {
      console.error(`[database] Migration failed: ${file}`, err);
      throw new Error(
        `Migration '${file}' failed: ${err instanceof Error ? err.message : String(err)}`,
        { cause: err }
      );
    }
  }
}

/**
 * Trova la directory delle migrazioni.
 * Usa __dirname per determinare il percorso relativo al modulo,
 * indipendentemente dalla working directory del processo.
 */
function findMigrationsDir(): string | null {
  const tabulariumRoot = path.resolve(__dirname, '..', '..');
  const migrationsPath = path.join(tabulariumRoot, 'migrations');

  if (fs.existsSync(migrationsPath)) {
    return migrationsPath;
  }

  return null;
}
