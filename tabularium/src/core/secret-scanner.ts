/**
 * core/secret-scanner.ts
 * Secret Scanner (Custos Secret Monitor) — Fase 8 PANTHEON.
 *
 * Scansiona ricorsivamente directory alla ricerca di segreti hardcodati
 * (API key, password, token, private key, connection string, AWS key, GitHub token).
 *
 * Pattern:
 *   - Stesso stile di bug-tracker.ts (better-sqlite3, prepared statements)
 *   - Cache-aside con Cache<T> e TTL 30 secondi
 *   - Prefisso ID: sec_{uuid}
 *   - Contenuto offuscato (primi 4 + ultimi 4 caratteri)
 *
 * @module core/secret-scanner
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { getDatabase } from './database.js';
import { Cache } from './cache.js';

// ---------------------------------------------------------------------------
// Tipi pubblici
// ---------------------------------------------------------------------------

/** Finding di un segreto hardcodato */
export interface SecretFinding {
  id: string;
  file_path: string;
  line_number?: number;
  secret_type: string;
  severity: string;
  description: string;
  content?: string;
  status: string;
  created_at: string;
  resolved_at?: string;
}

/** Risultato di una scansione */
export interface ScanResult {
  findings: SecretFinding[];
  filesScanned: number;
  durationMs: number;
}

/** Pattern di rilevamento per tipo di segreto */
interface SecretPattern {
  type: string;
  pattern: RegExp;
  severity: string;
  description: string;
}

// ---------------------------------------------------------------------------
// Pattern di rilevamento
// ---------------------------------------------------------------------------

const SECRET_PATTERNS: SecretPattern[] = [
  {
    type: 'api_key',
    pattern: /(?:api[_-]?key|apikey)\s*[:=]\s*['"][A-Za-z0-9_-]{16,}['"]/i,
    severity: 'high',
    description: 'API key hardcodata',
  },
  {
    type: 'token',
    pattern: /(?:token|bearer)\s*[:=]\s*['"][A-Za-z0-9_\-.]{20,}['"]/i,
    severity: 'high',
    description: 'Token di autenticazione hardcodato',
  },
  {
    type: 'password',
    pattern: /(?:password|passwd|pwd)\s*[:=]\s*['"][^'"]{8,}['"]/i,
    severity: 'critical',
    description: 'Password hardcodata',
  },
  {
    type: 'private_key',
    pattern: /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/,
    severity: 'critical',
    description: 'Chiave privata hardcodata',
  },
  {
    type: 'connection_string',
    pattern: /(?:mongodb|postgresql|mysql|redis):\/\/[^\s]{10,}/i,
    severity: 'high',
    description: 'Stringa di connessione hardcodata',
  },
  {
    type: 'aws_key',
    pattern: /AKIA[0-9A-Z]{16}/,
    severity: 'critical',
    description: 'AWS Access Key ID hardcodata',
  },
  {
    type: 'github_token',
    pattern: /gh[pousr]_[A-Za-z0-9_]{36,}/,
    severity: 'critical',
    description: 'GitHub token hardcodato',
  },
];

// ---------------------------------------------------------------------------
// Estensioni di file da scansionare
// ---------------------------------------------------------------------------

const SCANNABLE_EXTENSIONS = new Set([
  '.env',
  '.ts',
  '.js',
  '.json',
  '.yaml',
  '.yml',
  '.md',
  '.toml',
  '.ini',
  '.cfg',
  '.conf',
  '.xml',
  '.config',
]);

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

const findingsCache = new Cache<unknown>(30_000);
const CACHE_PREFIX = 'secret:';

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

/**
 * Crea la tabella `secret_findings` e gli indici se non esistono.
 * Idempotente — può essere chiamato più volte.
 */
export function ensureSecretSchema(): void {
  const db = getDatabase();

  db.exec(`
    CREATE TABLE IF NOT EXISTS secret_findings (
      id            TEXT PRIMARY KEY,
      file_path     TEXT NOT NULL,
      line_number   INTEGER,
      secret_type   TEXT NOT NULL,
      severity      TEXT NOT NULL CHECK(severity IN ('low','medium','high','critical')),
      description   TEXT NOT NULL,
      content       TEXT,
      status        TEXT NOT NULL DEFAULT 'open'
                    CHECK(status IN ('open','acknowledged','false_positive','fixed')),
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      resolved_at   TEXT
    )
  `);

  db.exec('CREATE INDEX IF NOT EXISTS idx_secret_file ON secret_findings(file_path)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_secret_type ON secret_findings(secret_type)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_secret_status ON secret_findings(status)');
}

// ---------------------------------------------------------------------------
// Scansione
// ---------------------------------------------------------------------------

/**
 * Estensioni da escludere durante la scansione.
 */
const EXCLUDED_EXTENSIONS = new Set([
  '.db',
  '.db-wal',
  '.db-shm',
  '.sqlite',
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.svg',
  '.ico',
  '.woff',
  '.woff2',
  '.ttf',
  '.eot',
  '.map',
]);

/**
 * Directory da escludere durante la scansione.
 */
const EXCLUDED_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  '.next',
  '.nuxt',
  'build',
  'coverage',
  '.cache',
]);

/**
 * Scansiona ricorsivamente una directory alla ricerca di segreti hardcodati.
 *
 * @param dirPath - Directory da scansionare (default: processo corrente)
 * @returns Risultato della scansione con findings, conteggio file e durata
 *
 * @example
 * ```ts
 * const result = scanDirectory('./src');
 * console.log(`Trovati ${result.findings.length} segreti in ${result.filesScanned} file`);
 * ```
 */
export function scanDirectory(dirPath?: string): ScanResult {
  const startTime = Date.now();
  const targetDir = dirPath ?? process.cwd();

  // Verifica che la directory esista
  if (!fs.existsSync(targetDir)) {
    throw new Error(`Directory not found: ${targetDir}`);
  }

  const stats = fs.statSync(targetDir);
  if (!stats.isDirectory()) {
    throw new Error(`Not a directory: ${targetDir}`);
  }

  const findings: SecretFinding[] = [];
  let filesScanned = 0;

  // Scansione ricorsiva
  const files = collectFiles(targetDir);
  const db = getDatabase();

  // Prepara statement INSERT
  const insertStmt = db.prepare(`
    INSERT INTO secret_findings (id, file_path, line_number, secret_type, severity, description, content)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  for (const filePath of files) {
    const ext = path.extname(filePath).toLowerCase();

    // Salta estensioni non supportate
    if (!SCANNABLE_EXTENSIONS.has(ext)) {
      continue;
    }

    filesScanned++;

    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');

      for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
        const line = lines[lineIndex];

        for (const pattern of SECRET_PATTERNS) {
          const match = line.match(pattern.pattern);
          if (match) {
            const id = `sec_${crypto.randomUUID()}`;
            const matchedText = match[0];
            const obfuscated = obfuscateSecret(matchedText);

            const finding: SecretFinding = {
              id,
              file_path: path.relative(targetDir, filePath),
              line_number: lineIndex + 1,
              secret_type: pattern.type,
              severity: pattern.severity,
              description: pattern.description,
              content: obfuscated,
              status: 'open',
              created_at: new Date().toISOString().replace('T', ' ').slice(0, 19),
            };

            findings.push(finding);

            // Salva nel database
            insertStmt.run(
              id,
              finding.file_path,
              finding.line_number,
              finding.secret_type,
              finding.severity,
              finding.description,
              obfuscated,
            );
          }
        }
      }
    } catch {
      // Salta file che non possono essere letti (binari, permessi, ecc.)
      continue;
    }
  }

  const durationMs = Date.now() - startTime;

  // Invalida cache
  invalidateFindingsCache();

  return {
    findings,
    filesScanned,
    durationMs,
  };
}

// ---------------------------------------------------------------------------
// Query
// ---------------------------------------------------------------------------

/**
 * Elenca i secret findings con filtri opzionali.
 *
 * @param status - Filtra per stato (open, acknowledged, false_positive, fixed)
 * @param secretType - Filtra per tipo di segreto
 * @param limit - Numero massimo di risultati (default: 50)
 * @param offset - Offset per paginazione (default: 0)
 * @returns Array di SecretFinding
 *
 * @example
 * ```ts
 * const openFindings = listFindings('open', 'api_key');
 * ```
 */
export function listFindings(
  status?: string,
  secretType?: string,
  limit?: number,
  offset?: number,
): { findings: SecretFinding[]; total: number } {
  const db = getDatabase();
  const queryLimit = limit ?? 50;
  const queryOffset = offset ?? 0;

  // Cache key
  const cacheKey = buildCacheKey('list', {
    status: status ?? '',
    type: secretType ?? '',
    limit: String(queryLimit),
    offset: String(queryOffset),
  });

  const cached = findingsCache.get(cacheKey);
  if (cached) {
    return cached as { findings: SecretFinding[]; total: number };
  }

  // Costruisci WHERE dinamico
  const whereClauses: string[] = [];
  const queryParams: unknown[] = [];

  if (status) {
    whereClauses.push('status = ?');
    queryParams.push(status.toLowerCase());
  }

  if (secretType) {
    whereClauses.push('secret_type = ?');
    queryParams.push(secretType.toLowerCase());
  }

  const whereSQL = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

  // Count totale
  const countRow = db.prepare(`SELECT COUNT(*) AS total FROM secret_findings ${whereSQL}`).get(...queryParams) as { total: number };
  const total = countRow.total;

  // Query paginata
  const rows = db.prepare(`
    SELECT * FROM secret_findings ${whereSQL}
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `).all(...queryParams, queryLimit, queryOffset) as Record<string, unknown>[];

  const findings = rows.map(parseFindingRow);

  const result = { findings, total };
  findingsCache.set(cacheKey, result);

  return result;
}

/**
 * Recupera un finding per ID.
 *
 * @param id - ID del finding
 * @returns SecretFinding
 * @throws Error se il finding non esiste
 */
export function getFindingById(id: string): SecretFinding {
  const db = getDatabase();
  const row = db.prepare('SELECT * FROM secret_findings WHERE id = ?').get(id) as Record<string, unknown> | undefined;

  if (!row) {
    throw new Error(`Secret finding not found: ${id}`);
  }

  return parseFindingRow(row);
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

/**
 * Aggiorna lo status di un finding.
 *
 * @param id - ID del finding
 * @param status - Nuovo stato (open, acknowledged, false_positive, fixed)
 * @returns SecretFinding aggiornato
 * @throws Error se il finding non esiste o lo stato non è valido
 */
export function updateFindingStatus(id: string, status: string): SecretFinding {
  const db = getDatabase();

  // Verifica che il finding esista
  const existing = db.prepare('SELECT id, status FROM secret_findings WHERE id = ?').get(id) as { id: string; status: string } | undefined;

  if (!existing) {
    throw new Error(`Secret finding not found: ${id}`);
  }

  const newStatus = status.toLowerCase();
  const VALID_STATUSES = ['open', 'acknowledged', 'false_positive', 'fixed'];

  if (!VALID_STATUSES.includes(newStatus)) {
    throw new Error(
      `Invalid status '${status}'. Supported values: ${VALID_STATUSES.join(', ')}`
    );
  }

  db.prepare(`
    UPDATE secret_findings
    SET status = ?, resolved_at = CASE WHEN ? IN ('fixed', 'false_positive') THEN datetime('now') ELSE resolved_at END
    WHERE id = ?
  `).run(newStatus, newStatus, id);

  // Invalida cache
  invalidateFindingsCache();

  return getFindingById(id);
}

// ---------------------------------------------------------------------------
// Helpers interni
// ---------------------------------------------------------------------------

/**
 * Colleziona ricorsivamente tutti i file scansionabili in una directory.
 * Esclude node_modules, .git, dist e file binari.
 */
function collectFiles(dirPath: string): string[] {
  const results: string[] = [];

  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);

      if (entry.isDirectory()) {
        // Salta directory escluse
        if (EXCLUDED_DIRS.has(entry.name)) {
          continue;
        }
        // Ricorsione
        results.push(...collectFiles(fullPath));
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        // Salta estensioni escluse
        if (EXCLUDED_EXTENSIONS.has(ext)) {
          continue;
        }
        results.push(fullPath);
      }
    }
  } catch {
    // Salta directory senza permessi di lettura
  }

  return results;
}

/**
 * Offusca un segreto mostrando solo i primi 4 e ultimi 4 caratteri.
 * Esempio: "sk-proj-ABCDE12345" → "sk-p…2345"
 *
 * @param secret - Testo da offuscare
 * @returns Testo offuscato
 */
function obfuscateSecret(secret: string): string {
  if (secret.length <= 12) {
    // Per stringhe corte, mostra solo type=value senza il valore
    const eqIndex = secret.indexOf('=');
    const colonIndex = secret.indexOf(':');
    const sepIndex = eqIndex > -1 ? eqIndex : colonIndex > -1 ? colonIndex : -1;

    if (sepIndex > -1) {
      return secret.slice(0, sepIndex + 1) + '***';
    }
    return secret.slice(0, 4) + '***';
  }

  const prefix = secret.slice(0, 4);
  const suffix = secret.slice(-4);
  return `${prefix}…${suffix}`;
}

/**
 * Invalida tutte le entry in cache relative ai secret findings.
 */
function invalidateFindingsCache(): void {
  findingsCache.invalidatePrefix(CACHE_PREFIX);
}

/**
 * Resetta completamente la cache dei findings.
 * Utile per test che ricreano il database da capo.
 */
export function resetFindingsCache(): void {
  findingsCache.clear();
}

/**
 * Costruisce una chiave cache deterministica.
 */
function buildCacheKey(prefix: string, parts: Record<string, string>): string {
  const sorted = Object.keys(parts)
    .sort()
    .map((k) => `${k}=${parts[k]}`)
    .join('&');
  return `${CACHE_PREFIX}${prefix}:${sorted}`;
}

/**
 * Parsifica una riga dal database in un SecretFinding tipizzato.
 */
function parseFindingRow(row: Record<string, unknown>): SecretFinding {
  return {
    id: String(row.id ?? ''),
    file_path: String(row.file_path ?? ''),
    line_number: row.line_number != null ? Number(row.line_number) : undefined,
    secret_type: String(row.secret_type ?? ''),
    severity: String(row.severity ?? 'medium'),
    description: String(row.description ?? ''),
    content: row.content ? String(row.content) : undefined,
    status: String(row.status ?? 'open'),
    created_at: String(row.created_at ?? ''),
    resolved_at: row.resolved_at ? String(row.resolved_at) : undefined,
  };
}
