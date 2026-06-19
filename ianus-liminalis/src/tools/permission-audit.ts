/**
 * fs_permission_audit — Ianus Liminalis
 *
 * Scansiona ricorsivamente permessi file/directory e segnala configurazioni
 * insicure: world-writable, sensitive file readable by others, executable mismatch,
 * group-writable sensitive files.
 */

import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { readdir, stat as fsStat, lstat } from 'node:fs/promises';
import { join, relative, extname, basename } from 'node:path';
import { resolveSafePath } from '../core/path-utils.js';
import { logToJournal } from '../core/journal-logger.js';
import { stats as serverStats } from '../core/stats.js';
import { toolRegistry } from './registry.js';
import type { ToolDeps } from './types.js';

// ────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────

type CheckType = 'worldWritable' | 'sensitiveReadable' | 'executableMismatch' | 'groupWritable';

interface AuditFinding {
  file: string;
  currentMode: string;
  expectedMode: string;
  issue: string;
  severity: 'low' | 'medium' | 'high';
  recommendation: string;
}

interface AuditResult {
  findings: AuditFinding[];
  totalScanned: number;
  issuesFound: number;
}

// ────────────────────────────────────────────────────────────
// Config: skip dirs
// ────────────────────────────────────────────────────────────

const SKIP_DIRS = new Set(['node_modules', '.git', '.ianus-backups', '.ianus-journal']);

// ────────────────────────────────────────────────────────────
// Permission utilities
// ────────────────────────────────────────────────────────────

/**
 * Converte un mode numerico in stringa ottale (es. 0o644 → "644").
 */
function modeToOctal(mode: number): string {
  // Su Windows il mode può includere il file type (S_IFREG = 0100000, S_IFDIR = 0040000)
  const perms = mode & 0o777;
  return '0' + perms.toString(8).padStart(3, '0');
}

/**
 * Converte un mode numerico in stringa simbolica (es. "rwxr-xr-x").
 */
function modeToSymbolic(mode: number): string {
  const permChars = ['---', '--x', '-w-', '-wx', 'r--', 'r-x', 'rw-', 'rwx'];
  const s = ((mode & 0o777).toString(8) as string).padStart(3, '0');
  return s
    .split('')
    .map((c) => permChars[parseInt(c, 10)])
    .join('');
}

// ────────────────────────────────────────────────────────────
// Security policy
// ────────────────────────────────────────────────────────────

interface PolicyEntry {
  match: (fileName: string, isDir: boolean) => boolean;
  expectedMode: number;
  description: string;
}

const SECURITY_POLICY: PolicyEntry[] = [
  {
    match: (name: string, isDir: boolean) => !isDir && basename(name).startsWith('.env'),
    expectedMode: 0o600,
    description: '.env files must be readable only by owner',
  },
  {
    match: (name: string, isDir: boolean) =>
      !isDir && (name.endsWith('.pem') || name.endsWith('.key') || name.endsWith('.cert')),
    expectedMode: 0o600,
    description: 'Private key/cert files must be readable only by owner',
  },
  {
    match: (name: string, isDir: boolean) =>
      !isDir && (name.endsWith('.sh') || name.endsWith('.ps1') || name.endsWith('.bat')),
    expectedMode: 0o755,
    description: 'Script files should be executable',
  },
  {
    match: (_name: string, isDir: boolean) => isDir,
    expectedMode: 0o755,
    description: 'Directories should not be world-writable',
  },
  {
    match: (_name: string, isDir: boolean) => !isDir,
    expectedMode: 0o644,
    description: 'Files should not be world-writable',
  },
];

/**
 * Trova la mode attesa per un file/dir in base alla policy.
 */
function findExpectedMode(fileName: string, isDir: boolean): { mode: number; description: string } {
  for (const entry of SECURITY_POLICY) {
    if (entry.match(fileName, isDir)) {
      return { mode: entry.expectedMode, description: entry.description };
    }
  }
  return { mode: isDir ? 0o755 : 0o644, description: 'Default secure permissions' };
}

// ────────────────────────────────────────────────────────────
// Windows-specific helpers
// ────────────────────────────────────────────────────────────

const IS_WINDOWS = process.platform === 'win32';

/**
 * Su Windows, il mode Node.js per file non-readonly è 100666,
 * per readonly è 100444. Non c'è distinzione Unix owner/group/other.
 * Mappiamo:
 *   - 0o666 (writable) → segnaliamo come world_writable per sensitive files
 *   - 0o444 (readonly) → ok
 */
function windowsModeToIssues(
  mode: number,
  fileName: string,
  isDir: boolean,
): Array<{ issue: CheckType; severity: 'low' | 'medium' | 'high' }> {
  const issues: Array<{ issue: CheckType; severity: 'low' | 'medium' | 'high' }> = [];
  const perms = mode & 0o777;

  // Su Windows il default per file scrivibili è 666
  if (!isDir && perms === 0o666) {
    // Non è readonly — potrebbe essere un problema se è un file sensibile
    const isSensitive =
      basename(fileName).startsWith('.env') ||
      fileName.endsWith('.pem') ||
      fileName.endsWith('.key') ||
      fileName.endsWith('.cert');

    if (isSensitive) {
      issues.push({ issue: 'sensitiveReadable', severity: 'high' });
    }
  }

  // Per directory su Windows, la mode è tipicamente 40777
  if (isDir && perms >= 0o755) {
    // Normale per Windows — non segnaliamo warning per directory su Windows
  }

  return issues;
}

// ────────────────────────────────────────────────────────────
// Checks
// ────────────────────────────────────────────────────────────

function checkWorldWritable(
  mode: number,
  fileName: string,
  isDir: boolean,
): AuditFinding | null {
  if (IS_WINDOWS) {
    // Su Windows, il mode 666 significa "non readonly" (writable)
    // Segnaliamo solo per file (non dir) sensibili
    if (!isDir && (mode & 0o777) >= 0o666) {
      const isSensitive =
        basename(fileName).startsWith('.env') ||
        fileName.endsWith('.pem') ||
        fileName.endsWith('.key');
      if (isSensitive) {
        return {
          file: fileName,
          currentMode: modeToSymbolic(mode),
          expectedMode: 'rw-------',
          issue: 'world_writable',
          severity: 'high',
          recommendation:
            'Set file as read-only on Windows or restrict permissions via ACL',
        };
      }
    }
    return null;
  }

  // Unix: check other-writable (o+w)
  const perms = mode & 0o777;
  const otherWritable = perms & 0o002;

  if (otherWritable) {
    const expected = findExpectedMode(fileName, isDir);
    return {
      file: fileName,
      currentMode: modeToSymbolic(mode),
      expectedMode: modeToSymbolic(expected.mode),
      issue: 'world_writable',
      severity: isDir ? 'medium' : 'high',
      recommendation: `Run: chmod o-w "${fileName}"`,
    };
  }

  return null;
}

function checkSensitiveReadable(
  mode: number,
  fileName: string,
  isDir: boolean,
): AuditFinding | null {
  if (isDir) return null;

  const isSensitive =
    basename(fileName).startsWith('.env') ||
    fileName.endsWith('.pem') ||
    fileName.endsWith('.key') ||
    fileName.endsWith('.cert');

  if (!isSensitive) return null;

  if (IS_WINDOWS) {
    const perms = mode & 0o777;
    if (perms >= 0o666) {
      return {
        file: fileName,
        currentMode: modeToSymbolic(mode),
        expectedMode: 'rw-------',
        issue: 'sensitive_readable',
        severity: 'high',
        recommendation:
          'Mark the file as read-only on Windows or restrict with ACLs',
      };
    }
    return null;
  }

  // Unix: other-readable o group-readable
  const perms = mode & 0o777;
  const otherReadable = perms & 0o004;
  const groupReadable = perms & 0o040;

  if (otherReadable || groupReadable) {
    return {
      file: fileName,
      currentMode: modeToSymbolic(mode),
      expectedMode: 'rw-------',
      issue: 'sensitive_readable',
      severity: otherReadable ? 'high' : 'medium',
      recommendation: `Run: chmod 600 "${fileName}"`,
    };
  }

  return null;
}

function checkExecutableMismatch(
  mode: number,
  fileName: string,
  isDir: boolean,
): AuditFinding | null {
  if (isDir) return null;

  const isScript =
    fileName.endsWith('.sh') || fileName.endsWith('.ps1') || fileName.endsWith('.bat');

  if (!isScript) return null;

  if (IS_WINDOWS) {
    // Su Windows non c'è un bit di esecuzione nello stat
    // .ps1 e .bat sono eseguibili per natura su Windows
    return null;
  }

  const perms = mode & 0o777;
  const executable = perms & 0o111;

  if (!executable) {
    return {
      file: fileName,
      currentMode: modeToSymbolic(mode),
      expectedMode: 'rwxr-xr-x',
      issue: 'executable_mismatch',
      severity: 'medium',
      recommendation: `Run: chmod +x "${fileName}"`,
    };
  }

  return null;
}

function checkGroupWritable(
  mode: number,
  fileName: string,
  isDir: boolean,
): AuditFinding | null {
  if (IS_WINDOWS) return null; // No group concept in Node.js stat on Windows

  const isSensitive =
    !isDir &&
    (basename(fileName).startsWith('.env') ||
      fileName.endsWith('.pem') ||
      fileName.endsWith('.key') ||
      fileName.endsWith('.cert'));

  if (!isSensitive) return null;

  const perms = mode & 0o777;
  const groupWritable = perms & 0o020;

  if (groupWritable) {
    return {
      file: fileName,
      currentMode: modeToSymbolic(mode),
      expectedMode: 'rw-------',
      issue: 'group_writable',
      severity: 'medium',
      recommendation: `Run: chmod g-w "${fileName}"`,
    };
  }

  return null;
}

// ────────────────────────────────────────────────────────────
// Walk
// ────────────────────────────────────────────────────────────

async function walkForAudit(
  dir: string,
  baseDir: string,
  sensitiveOnly: boolean,
  enabledChecks: Set<CheckType>,
): Promise<{ findings: AuditFinding[]; totalScanned: number }> {
  const findings: AuditFinding[] = [];
  let totalScanned = 0;

  async function walk(currentPath: string): Promise<void> {
    let entries: string[];
    try {
      entries = await readdir(currentPath);
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = join(currentPath, entry);
      const relPath = relative(baseDir, fullPath).replace(/\\/g, '/');

      // Skip node_modules, .git, etc.
      if (SKIP_DIRS.has(entry)) continue;

      try {
        const stats = await lstat(fullPath);
        totalScanned++;

        const isDir = stats.isDirectory();
        const mode = stats.mode;

        // Se sensitiveOnly, controlla solo file sensibili
        if (sensitiveOnly && !isDir) {
          const isSensitive =
            basename(relPath).startsWith('.env') ||
            relPath.endsWith('.pem') ||
            relPath.endsWith('.key') ||
            relPath.endsWith('.cert');

          if (!isSensitive) {
            if (isDir) await walk(fullPath);
            continue;
          }
        }

        // Esegui i check abilitati
        if (enabledChecks.has('worldWritable')) {
          const finding = checkWorldWritable(mode, relPath, isDir);
          if (finding) findings.push(finding);
        }

        if (enabledChecks.has('sensitiveReadable')) {
          const finding = checkSensitiveReadable(mode, relPath, isDir);
          if (finding) findings.push(finding);
        }

        if (enabledChecks.has('executableMismatch')) {
          const finding = checkExecutableMismatch(mode, relPath, isDir);
          if (finding) findings.push(finding);
        }

        if (enabledChecks.has('groupWritable')) {
          const finding = checkGroupWritable(mode, relPath, isDir);
          if (finding) findings.push(finding);
        }

        // Windows-specific additional checks
        if (IS_WINDOWS) {
          const winIssues = windowsModeToIssues(mode, relPath, isDir);
          for (const wi of winIssues) {
            if (enabledChecks.has(wi.issue as CheckType)) {
              const expected = findExpectedMode(relPath, isDir);
              findings.push({
                file: relPath,
                currentMode: modeToSymbolic(mode),
                expectedMode: modeToSymbolic(expected.mode),
                issue: wi.issue === 'sensitiveReadable' ? 'sensitive_readable' : wi.issue,
                severity: wi.severity,
                recommendation: wi.issue === 'sensitiveReadable'
                  ? 'Restrict file permissions using Windows ACL or mark as read-only'
                  : 'Review file permissions',
              });
            }
          }
        }

        // Ricorsione nelle directory
        if (isDir) {
          await walk(fullPath);
        }
      } catch {
        // Skip inaccessible entries
      }
    }
  }

  await walk(dir);
  return { findings, totalScanned };
}

// ────────────────────────────────────────────────────────────
// Tool Registration
// ────────────────────────────────────────────────────────────

export function registerPermissionAudit(_server: Server, deps: ToolDeps): void {
  toolRegistry.register({
    name: 'fs_permission_audit',
    description:
      'Scan file/directory permissions recursively and report insecure configurations. ' +
      'Checks: world-writable files, sensitive files readable by others, executable mismatch, ' +
      'group-writable sensitive files. Skips node_modules, .git by default.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          default: '.',
          description: 'Directory da scansionare (default: workspace root)',
        },
        sensitiveOnly: {
          type: 'boolean',
          default: false,
          description: 'Only scan sensitive files (.env, *.pem, *.key, *.cert)',
        },
        checks: {
          type: 'array',
          items: {
            type: 'string',
            enum: ['worldWritable', 'sensitiveReadable', 'executableMismatch', 'groupWritable'],
          },
          description:
            'Checks da eseguire (default: tutti). ' +
            'Opzioni: worldWritable, sensitiveReadable, executableMismatch, groupWritable',
        },
        agent: {
          type: 'string',
          description: 'Nome dell agente chiamante (opzionale, default: "ianus")',
        },
      },
      required: [],
    },
    handler: async (args) => {
      const auditPath = (args.path as string) ?? '.';
      const sensitiveOnly = (args.sensitiveOnly as boolean) ?? false;
      const checksRaw = args.checks as string[] | undefined;

      // Determina quali check eseguire
      const allChecks: CheckType[] = [
        'worldWritable',
        'sensitiveReadable',
        'executableMismatch',
        'groupWritable',
      ];
      const enabledChecks = new Set<CheckType>(
        checksRaw && Array.isArray(checksRaw) && checksRaw.length > 0
          ? (checksRaw.filter((c): c is CheckType =>
              allChecks.includes(c as CheckType),
            ) as CheckType[])
          : allChecks,
      );

      // Permission check
      const callerAgent = (args.agent as string) || 'ianus';
      const permCheck = await deps.permission.checkOperation(
        callerAgent,
        'read',
        auditPath,
        deps.workspaceRoot,
      );
      if (!permCheck.allowed) {
        return {
          content: [{ type: 'text', text: `Permission denied: ${permCheck.reason}` }],
          isError: true,
        };
      }

      try {
        const safePath = resolveSafePath(auditPath, deps.workspaceRoot);

        const { findings, totalScanned } = await walkForAudit(
          safePath,
          deps.workspaceRoot,
          sensitiveOnly,
          enabledChecks,
        );

        const result: AuditResult = {
          findings,
          totalScanned,
          issuesFound: findings.length,
        };

        // Log to journal
        await logToJournal(deps.workspaceRoot, {
          agent: 'ianus',
          operation: 'permission_audit',
          path: auditPath,
          details: {
            totalScanned,
            issuesFound: findings.length,
            sensitiveOnly,
            checks: Array.from(enabledChecks),
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
              text: `Error auditing permissions: ${(err as Error).message}`,
            },
          ],
          isError: true,
        };
      }
    },
  });
}
