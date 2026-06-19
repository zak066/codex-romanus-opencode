/**
 * fs_secret_scan — Ianus Liminalis
 *
 * Scansiona ricorsivamente una directory alla ricerca di segreti hardcodati:
 * API key, password, token JWT, AWS key, GitHub token, private key, connection string.
 * Usa pattern regex + entropia Shannon per ridurre falsi positivi.
 */

import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join, relative, extname } from 'node:path';
import { minimatch } from 'minimatch';
import { resolveSafePath } from '../core/path-utils.js';
import { logToJournal } from '../core/journal-logger.js';
import { stats as serverStats } from '../core/stats.js';
import { toolRegistry } from './registry.js';
import type { ToolDeps } from './types.js';

// ────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────

interface SecretFinding {
  file: string;
  line: number;
  column: number;
  type: 'api_key' | 'password' | 'jwt' | 'aws_key' | 'github_token' | 'private_key' | 'connection_string' | 'custom';
  entropy: number;
  snippet: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
}

interface SecretScanResult {
  findings: SecretFinding[];
  totalFiles: number;
  scannedFiles: number;
  duration: number;
}

// ────────────────────────────────────────────────────────────
// Config: binary estensioni da saltare
// ────────────────────────────────────────────────────────────

const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.ico', '.webp', '.bmp', '.tiff', '.tif',
  '.zip', '.tar', '.gz', '.bz2', '.xz', '.7z', '.rar',
  '.exe', '.dll', '.so', '.dylib', '.o', '.obj', '.lib', '.a',
  '.bin', '.dat', '.db', '.sqlite', '.sqlite3', '.wasm',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.mp3', '.mp4', '.avi', '.mov', '.wmv', '.flv', '.webm',
  '.woff', '.woff2', '.ttf', '.eot', '.otf',
  '.pyc', '.pyo', '.pyd',
  '.class', '.jar',
  '.iso', '.img',
  '.lock', // yarn.lock, package-lock.json (too large, binary-ish)
]);

const MAX_FILE_SIZE = 1 * 1024 * 1024; // 1 MB

// ────────────────────────────────────────────────────────────
// Regex patterns built-in
// ────────────────────────────────────────────────────────────

interface BuiltInPattern {
  type: SecretFinding['type'];
  regex: RegExp;
  description: string;
}

const BUILT_IN_PATTERNS: BuiltInPattern[] = [
  {
    type: 'api_key',
    regex: /[aA][pP][iI]_?[kK][eE][yY].{0,30}['"][A-Za-z0-9_\-]{16,}['"]/g,
    description: 'Generic API key',
  },
  {
    type: 'password',
    regex: /[pP][aA][sS][sS][wW][oO][rR][dD].{0,30}['"][^'"\s]{8,}['"]/g,
    description: 'Password assignment',
  },
  {
    type: 'jwt',
    regex: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
    description: 'JWT token',
  },
  {
    type: 'aws_key',
    regex: /AKIA[0-9A-Z]{16}/g,
    description: 'AWS Access Key ID',
  },
  {
    type: 'github_token',
    regex: /gh[pousr]_[A-Za-z0-9_]{36,}/g,
    description: 'GitHub token (personal/oauth/...)',
  },
  {
    type: 'private_key',
    regex: /-----BEGIN\s*(RSA|EC|OPENSSH)?\s*PRIVATE\s*KEY-----/g,
    description: 'Private key header',
  },
  {
    type: 'connection_string',
    regex: /(?:mongodb|postgresql|mysql|redis):\/\/[^\s]+/gi,
    description: 'Database connection string',
  },
];

// ────────────────────────────────────────────────────────────
// Shannon Entropy
// ────────────────────────────────────────────────────────────

/**
 * Calcola l'entropia di Shannon per una stringa.
 * Valori > 4.5 indicano alta casualità (tipica di secret/token generati).
 */
function shannonEntropy(str: string): number {
  const len = str.length;
  if (len === 0) return 0;

  const freq = new Map<string, number>();
  for (let i = 0; i < len; i++) {
    const char = str[i];
    freq.set(char, (freq.get(char) || 0) + 1);
  }

  let entropy = 0;
  for (const count of freq.values()) {
    const p = count / len;
    entropy -= p * Math.log2(p);
  }
  return Math.round(entropy * 100) / 100;
}

// ────────────────────────────────────────────────────────────
// Severity classification
// ────────────────────────────────────────────────────────────

function classifySeverity(
  type: SecretFinding['type'],
  entropy: number,
): SecretFinding['severity'] {
  if (type === 'private_key' || type === 'aws_key') {
    return entropy > 5.5 ? 'critical' : 'high';
  }
  if (type === 'jwt' || type === 'github_token' || type === 'connection_string') {
    return 'high';
  }
  if (type === 'api_key' || type === 'password') {
    return entropy >= 4.0 ? 'medium' : 'low';
  }
  return entropy >= 4.5 ? 'medium' : 'low';
}

// ────────────────────────────────────────────────────────────
// File walk
// ────────────────────────────────────────────────────────────

/**
 * Cammina ricorsivamente la directory collezionando file
 * che matchano include e non matchano exclude.
 */
async function walkFiles(
  dir: string,
  baseDir: string,
  includePattern: string,
  excludePatterns: string[],
): Promise<string[]> {
  const files: string[] = [];

  async function walk(currentPath: string): Promise<void> {
    let entries: string[];
    try {
      entries = await readdir(currentPath);
    } catch {
      return; // Skip inaccessible directories
    }

    for (const entry of entries) {
      const fullPath = join(currentPath, entry);
      const relPath = relative(baseDir, fullPath).replace(/\\/g, '/');

      // Check exclude patterns before stat (avoid unnecessary stat calls)
      let excluded = false;
      for (const excl of excludePatterns) {
        if (minimatch(relPath, excl, { dot: true })) {
          excluded = true;
          break;
        }
      }
      if (excluded) continue;

      try {
        const stats = await stat(fullPath);
        if (stats.isDirectory()) {
          await walk(fullPath);
        } else if (stats.isFile()) {
          // Check include pattern
          if (minimatch(relPath, includePattern, { dot: true })) {
            // Skip binary by extension
            const ext = extname(entry).toLowerCase();
            if (BINARY_EXTENSIONS.has(ext)) continue;

            // Skip oversized files
            if (stats.size > MAX_FILE_SIZE) continue;

            files.push(fullPath);
          }
        }
      } catch {
        // Skip inaccessible entries
      }
    }
  }

  await walk(dir);
  return files;
}

// ────────────────────────────────────────────────────────────
// Extract snippet around match
// ────────────────────────────────────────────────────────────

function extractSnippet(line: string, matchIndex: number, matchLength: number): string {
  const before = line.substring(Math.max(0, matchIndex - 50), matchIndex);
  const match = line.substring(matchIndex, matchIndex + matchLength);
  // Tronca il valore se troppo lungo (evita di esporre secret interi)
  const truncatedMatch = matchLength > 20 ? match.substring(0, 10) + '[...]' + match.substring(matchLength - 10) : match;
  const after = line.substring(matchIndex + matchLength, matchIndex + matchLength + 50);
  return before + truncatedMatch + after;
}

// ────────────────────────────────────────────────────────────
// Tool Registration
// ────────────────────────────────────────────────────────────

export function registerSecretScan(_server: Server, deps: ToolDeps): void {
  toolRegistry.register({
    name: 'fs_secret_scan',
    description:
      'Scan files in a directory for hardcoded secrets (API keys, passwords, tokens, ' +
      'JWT, AWS keys, GitHub tokens, private keys, connection strings). ' +
      'Uses regex patterns + Shannon entropy to reduce false positives. ' +
      'Skips binary files and files larger than 1MB.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          default: '.',
          description: 'Directory da scansionare (default: workspace root)',
        },
        include: {
          type: 'string',
          default: '**/*',
          description: 'Glob pattern per file da includere (default: **/*)',
        },
        exclude: {
          type: 'string',
          default: '**/node_modules/**,**/.git/**',
          description: 'Glob pattern per escludere (default: **/node_modules/**,**/.git/**)',
        },
        minEntropy: {
          type: 'number',
          default: 4.5,
          description: 'Soglia entropia Shannon minima (default: 4.5, range: 2.0-8.0)',
        },
        patterns: {
          type: 'array',
          items: { type: 'string' },
          description: 'Pattern regex custom aggiuntivi (array di stringhe regex)',
        },
        agent: {
          type: 'string',
          description: 'Nome dell agente chiamante (opzionale, default: "ianus")',
        },
      },
      required: [],
    },
    handler: async (args) => {
      const startTime = Date.now();
      const scanPath = (args.path as string) ?? '.';
      const includePattern = (args.include as string) ?? '**/*';
      const excludeRaw = (args.exclude as string) ?? '**/node_modules/**,**/.git/**';
      const minEntropy = (args.minEntropy as number) ?? 4.5;
      const customPatternsRaw = args.patterns as string[] | undefined;

      // Validate minEntropy range
      const entropyThreshold = Math.min(8.0, Math.max(2.0, minEntropy));

      // Parse exclude patterns
      const excludePatterns = excludeRaw
        .split(',')
        .map((p) => p.trim())
        .filter((p) => p.length > 0);

      // Permission check
      const callerAgent = (args.agent as string) || 'ianus';
      const permCheck = await deps.permission.checkOperation(
        callerAgent,
        'read',
        scanPath,
        deps.workspaceRoot,
      );
      if (!permCheck.allowed) {
        return {
          content: [{ type: 'text', text: `Permission denied: ${permCheck.reason}` }],
          isError: true,
        };
      }

      try {
        const safePath = resolveSafePath(scanPath, deps.workspaceRoot);

        // Compila custom patterns
        const customPatterns: BuiltInPattern[] = [];
        if (customPatternsRaw && Array.isArray(customPatternsRaw)) {
          for (let i = 0; i < customPatternsRaw.length; i++) {
            const raw = customPatternsRaw[i];
            if (typeof raw !== 'string' || raw.length === 0) continue;
            try {
              customPatterns.push({
                type: 'custom',
                regex: new RegExp(raw, 'g'),
                description: `Custom pattern #${i + 1}`,
              });
            } catch {
              // Skip invalid regex patterns
            }
          }
        }

        const allPatterns = [...BUILT_IN_PATTERNS, ...customPatterns];

        // Walk files
        const filePaths = await walkFiles(safePath, deps.workspaceRoot, includePattern, excludePatterns);
        const totalFiles = filePaths.length;
        let scannedFiles = 0;
        const findings: SecretFinding[] = [];

        for (const filePath of filePaths) {
          let content: string;
          try {
            content = await readFile(filePath, 'utf-8');
            scannedFiles++;
          } catch {
            // Skip files that can't be read as UTF-8
            continue;
          }

          const lines = content.split('\n');
          const relPath = relative(deps.workspaceRoot, filePath).replace(/\\/g, '/');

          for (const pattern of allPatterns) {
            // Reset regex
            pattern.regex.lastIndex = 0;

            for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
              const line = lines[lineIdx];

              // Reset regex for each line
              pattern.regex.lastIndex = 0;
              let match: RegExpExecArray | null;

              while ((match = pattern.regex.exec(line)) !== null) {
                const matchedValue = match[0];
                const entropy = shannonEntropy(matchedValue);

                // Filtra per entropia minima
                if (entropy < entropyThreshold) continue;

                const lineNum = lineIdx + 1;
                const column = match.index + 1;
                const snippet = extractSnippet(line, match.index, matchedValue.length);
                const severity = classifySeverity(pattern.type, entropy);

                findings.push({
                  file: relPath,
                  line: lineNum,
                  column,
                  type: pattern.type,
                  entropy,
                  snippet,
                  severity,
                });
              }
            }
          }
        }

        const duration = Date.now() - startTime;

        const result: SecretScanResult = {
          findings,
          totalFiles,
          scannedFiles,
          duration,
        };

        // Log to journal
        await logToJournal(deps.workspaceRoot, {
          agent: 'ianus',
          operation: 'secret_scan',
          path: scanPath,
          details: {
            totalFiles,
            scannedFiles,
            findingsCount: findings.length,
            duration,
          },
        });

        serverStats.increment();

        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        return {
          content: [
            {
              type: 'text',
              text: `Error scanning for secrets: ${(err as Error).message}`,
            },
          ],
          isError: true,
        };
      }
    },
  });
}
