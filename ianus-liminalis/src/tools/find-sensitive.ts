/**
 * fs_find_sensitive — Ianus Liminalis
 *
 * Cerca file con pattern di naming sensibili (.env, *.pem, *.key, credentials*,
 * secret*, password*, ecc.) e li classifica per categoria e livello di rischio.
 * Supporta pattern custom e rilevamento di file gitignorati.
 */

import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { readdir, stat as fsStat, readFile } from 'node:fs/promises';
import { join, relative, basename, dirname, sep } from 'node:path';
import { minimatch } from 'minimatch';
import { resolveSafePath, toRelativePath } from '../core/path-utils.js';
import { logToJournal } from '../core/journal-logger.js';
import { stats as serverStats } from '../core/stats.js';
import { toolRegistry } from './registry.js';
import type { ToolDeps } from './types.js';

// ────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────

type RiskLevel = 'low' | 'medium' | 'high' | 'critical';
type FindingCategory = 'env' | 'key' | 'credential' | 'secret' | 'config' | 'auth';

interface SensitivePattern {
  pattern: string;
  category: FindingCategory;
  risk: RiskLevel;
}

interface Finding {
  file: string;
  category: FindingCategory;
  pattern: string;
  gitignored: boolean;
  risk: RiskLevel;
}

interface FindSensitiveResult {
  findings: Finding[];
  totalFiles: number;
  totalFindings: number;
}

// ────────────────────────────────────────────────────────────
// Pattern definitions
// ────────────────────────────────────────────────────────────

const SENSITIVE_PATTERNS: SensitivePattern[] = [
  // Environment files
  { pattern: '.env*', category: 'env', risk: 'high' },
  // Keys and certificates
  { pattern: '*.pem', category: 'key', risk: 'high' },
  { pattern: '*.key', category: 'key', risk: 'high' },
  { pattern: '*.p12', category: 'key', risk: 'high' },
  { pattern: '*.pfx', category: 'key', risk: 'high' },
  { pattern: '*.cert', category: 'key', risk: 'high' },
  // Credentials
  { pattern: '*credential*', category: 'credential', risk: 'high' },
  { pattern: '*.cred', category: 'credential', risk: 'high' },
  // Secrets & passwords
  { pattern: '*secret*', category: 'secret', risk: 'medium' },
  { pattern: '*password*', category: 'secret', risk: 'high' },
  // SSH keys
  { pattern: '*id_rsa*', category: 'key', risk: 'critical' },
  { pattern: '*id_dsa*', category: 'key', risk: 'critical' },
  { pattern: '*id_ecdsa*', category: 'key', risk: 'critical' },
  { pattern: '*id_ed25519*', category: 'key', risk: 'critical' },
  // Service accounts
  { pattern: '*service-account*', category: 'credential', risk: 'high' },
  { pattern: '*service_account*', category: 'credential', risk: 'high' },
  // Auth / tokens
  { pattern: '*token*', category: 'auth', risk: 'medium' },
  { pattern: '*auth*', category: 'auth', risk: 'medium' },
  // Config files (checked for secret references in content)
  { pattern: 'config.json', category: 'config', risk: 'low' },
  { pattern: '*.config.js', category: 'config', risk: 'low' },
];

// Keywords to scan in config file content to detect secret references
const SECRET_KEYWORDS = [
  'password', 'passwd', 'secret', 'api.key', 'api_key', 'api.secret',
  'api_secret', 'token', 'auth.token', 'auth_token', 'private.key',
  'private_key', 'access.key', 'access_key', 'connection.string',
  'connection_string', 'database.url', 'database_url',
];

const MAX_WALK_FILES = 100_000; // Safety limit

// ────────────────────────────────────────────────────────────
// Gitignore parser (base)
// ────────────────────────────────────────────────────────────

/**
 * Legge e parse un file .gitignore in array di pattern.
 * Supporta commenti (#), negazione (!) e pattern base glob.
 */
async function parseGitignore(workspaceRoot: string): Promise<string[]> {
  try {
    const gitignorePath = join(workspaceRoot, '.gitignore');
    const content = await readFile(gitignorePath, 'utf-8');
    return content
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'));
  } catch {
    return [];
  }
}

/**
 * Verifica se un path relativo è coperto da .gitignore.
 * Implementazione base — non gestisce edge case complessi di gitignore
 * (pattern senza / match basename ovunque, doppio asterisco, ecc.)
 * ma copre i casi più comuni.
 */
async function isFileGitignored(
  relPath: string,
  workspaceRoot: string,
): Promise<boolean> {
  const patterns = await parseGitignore(workspaceRoot);
  if (patterns.length === 0) return false;

  let ignored = false;

  for (const p of patterns) {
    const isNegation = p.startsWith('!');
    const pattern = isNegation ? p.slice(1) : p;

    // Prova a matchare il path completo e il basename
    const matchesFull = minimatch(relPath, pattern, { dot: true });
    const matchesBase = minimatch(basename(relPath), pattern, { dot: true });

    if (matchesFull || matchesBase) {
      ignored = isNegation ? false : true;
    }
  }

  return ignored;
}

// ────────────────────────────────────────────────────────────
// Risk assessment
// ────────────────────────────────────────────────────────────

/**
 * Determina il rischio finale considerando gitignore.
 * Regole:
 *  - env/key non gitignorati → critical
 *  - env/key gitignorati → high (base)
 *  - altri tipi → base risk dal pattern
 *  - SSH key patterns hanno già risk 'critical' e restano invariati
 */
function assessFinalRisk(
  category: FindingCategory,
  baseRisk: RiskLevel,
  gitignored: boolean,
): RiskLevel {
  // SSH keys (id_rsa etc.) are always critical regardless of gitignore
  if (baseRisk === 'critical') return 'critical';

  // env/key not gitignored → critical (exposed secrets)
  if ((category === 'env' || category === 'key') && !gitignored) {
    return 'critical';
  }

  return baseRisk;
}

// ────────────────────────────────────────────────────────────
// Config file content scan
// ────────────────────────────────────────────────────────────

/**
 * Scansiona il contenuto di un file config per keyword di secret.
 * Legge i primi 8KB per performance.
 */
async function scanConfigForSecrets(
  filePath: string,
): Promise<boolean> {
  try {
    const content = await readFile(filePath, 'utf-8');
    const sample = content.slice(0, 8192).toLowerCase();
    return SECRET_KEYWORDS.some((kw) => sample.includes(kw));
  } catch {
    return false;
  }
}

// ────────────────────────────────────────────────────────────
// Walker
// ────────────────────────────────────────────────────────────

/**
 * Cammina ricorsivamente una directory,
 * restituisce tutti i file con i relativi path relativi.
 */
async function walkAllFiles(
  dir: string,
  baseDir: string,
  includeGitignored: boolean,
): Promise<{ relPath: string; absPath: string }[]> {
  const files: { relPath: string; absPath: string }[] = [];
  const gitignoreCache = new Map<string, boolean>();

  async function walk(currentPath: string): Promise<void> {
    if (files.length >= MAX_WALK_FILES) return;

    let entries: string[];
    try {
      entries = await readdir(currentPath);
    } catch {
      return;
    }

    for (const entry of entries) {
      if (files.length >= MAX_WALK_FILES) return;

      const fullPath = join(currentPath, entry);

      try {
        const stats = await fsStat(fullPath);
        if (stats.isDirectory()) {
          // Skip node_modules, .git, .ianus-journal by default
          if (entry === 'node_modules' || entry === '.git' || entry === '.ianus-journal') {
            continue;
          }
          await walk(fullPath);
        } else if (stats.isFile()) {
          const relPath = relative(baseDir, fullPath).replace(/\\/g, '/');

          // Check gitignore
          const gitignored = await isFileGitignored(relPath, baseDir);
          gitignoreCache.set(relPath, gitignored);

          // Se includeGitignored=false e il file è gitignorato, salta
          if (!includeGitignored && gitignored) continue;

          files.push({ relPath, absPath: fullPath });
        }
      } catch {
        // Skip inaccessible entries
      }
    }
  }

  await walk(dir);
  return files;
}

/**
 * Trova il primo pattern sensibile che matcha un filename.
 */
function matchSensitivePattern(
  fileName: string,
  customRegexps: RegExp[],
): SensitivePattern | null {
  // Check custom regex patterns first
  for (const regex of customRegexps) {
    if (regex.test(fileName)) {
      return { pattern: regex.source, category: 'secret', risk: 'medium' };
    }
  }

  // Check built-in patterns
  for (const sp of SENSITIVE_PATTERNS) {
    if (minimatch(fileName, sp.pattern, { dot: true })) {
      return sp;
    }
  }

  return null;
}

// ────────────────────────────────────────────────────────────
// Tool Registration
// ────────────────────────────────────────────────────────────

export function registerFindSensitive(_server: Server, deps: ToolDeps): void {
  toolRegistry.register({
    name: 'fs_find_sensitive',
    description:
      'Find files with sensitive naming patterns (.env, *.pem, *.key, credentials, ' +
      'secrets, passwords, SSH keys, tokens, auth files, service accounts). ' +
      'Classifies findings by category and risk level, and detects if files are gitignored. ' +
      'Supports custom regex patterns.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Directory to scan (optional, defaults to workspace root)',
        },
        customPatterns: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Additional regex patterns to match filenames against (optional)',
        },
        includeGitignored: {
          type: 'boolean',
          default: true,
          description:
            'Include files that are covered by .gitignore (default: true)',
        },
        agent: {
          type: 'string',
          description:
            'Nome dell agente chiamante (opzionale, default: "ianus")',
        },
      },
    },
    handler: async (args) => {
      const searchPath = (args.path as string | undefined) ?? '.';
      const includeGitignored =
        (args.includeGitignored as boolean | undefined) ?? true;
      const rawCustomPatterns = args.customPatterns as string[] | undefined;

      const callerAgent = (args.agent as string) || 'ianus';

      // Permission check
      const permCheck = await deps.permission.checkOperation(
        callerAgent,
        'read',
        searchPath,
        deps.workspaceRoot,
      );
      if (!permCheck.allowed) {
        return {
          content: [{ type: 'text', text: `Permission denied: ${permCheck.reason}` }],
          isError: true,
        };
      }

      // Compile custom regex patterns
      const customRegexps: RegExp[] = [];
      if (rawCustomPatterns && Array.isArray(rawCustomPatterns)) {
        for (const p of rawCustomPatterns) {
          try {
            customRegexps.push(new RegExp(p, 'i'));
          } catch (err) {
            return {
              content: [
                {
                  type: 'text',
                  text: `Invalid regex in customPatterns: "${p}" — ${(err as Error).message}`,
                },
              ],
              isError: true,
            };
          }
        }
      }

      try {
        const safePath = resolveSafePath(searchPath, deps.workspaceRoot);

        // Walk files
        const allFiles = await walkAllFiles(safePath, deps.workspaceRoot, includeGitignored);

        // Scan for sensitive files
        const findings: Finding[] = [];

        for (const file of allFiles) {
          const fileName = basename(file.relPath);
          const matched = matchSensitivePattern(fileName, customRegexps);
          if (!matched) continue;

          // Check gitignore status
          const gitignored = await isFileGitignored(file.relPath, deps.workspaceRoot);

          // Determine final risk
          let finalRisk = assessFinalRisk(matched.category, matched.risk, gitignored);

          // For config files, scan content for secret keywords
          if (matched.category === 'config') {
            const hasSecrets = await scanConfigForSecrets(file.absPath);
            if (hasSecrets) {
              // If config contains secrets, bump risk to medium
              if (finalRisk === 'low') finalRisk = 'medium';
            }
            // Also warn about potential secrets in config matching pattern name
          }

          findings.push({
            file: file.relPath,
            category: matched.category,
            pattern: matched.pattern,
            gitignored,
            risk: finalRisk,
          });
        }

        // Sort findings: critical first, then by risk descending
        const riskOrder: Record<RiskLevel, number> = {
          critical: 0,
          high: 1,
          medium: 2,
          low: 3,
        };
        findings.sort(
          (a, b) => riskOrder[a.risk] - riskOrder[b.risk] || a.file.localeCompare(b.file),
        );

        const result: FindSensitiveResult = {
          findings,
          totalFiles: allFiles.length,
          totalFindings: findings.length,
        };

        // Log to journal
        await logToJournal(deps.workspaceRoot, {
          agent: 'ianus',
          operation: 'find_sensitive',
          path: searchPath,
          details: {
            totalFiles: allFiles.length,
            totalFindings: findings.length,
            includeGitignored,
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
              text: `Error scanning for sensitive files: ${(err as Error).message}`,
            },
          ],
          isError: true,
        };
      }
    },
  });
}
