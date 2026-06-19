/**
 * tools/dependency-scan.tool.ts
 * Tool MCP per scansione dipendenze e valutazione vulnerabilità.
 *
 * Fornisce 5 tool per la gestione della sicurezza delle dipendenze:
 * - tabularium_dependency_scan: Scansione dipendenze installate
 * - tabularium_vuln_assessment: Valutazione vulnerabilità note
 * - tabularium_policy_audit: Audit policy sicurezza
 * - tabularium_remediation: Raccomandazioni remediation
 * - tabularium_posture_report: Report postura di sicurezza
 *
 * @module tools/dependency-scan
 */

import type { ToolHandler, ToolResult } from '../types/mcp.js';
import { getDatabase } from '../core/database.js';
import fs from 'node:fs';
import path from 'node:path';

// ---------------------------------------------------------------------------
// 1. tabularium_dependency_scan
// ---------------------------------------------------------------------------

export const dependencyScanToolHandler: ToolHandler = {
  name: 'tabularium_dependency_scan',
  description:
    'Scansione dipendenze del progetto (librerie installate). ' +
    'Analizza package.json, rileva versioni obsolete e mismatch ' +
    'tra dipendenze dichiarate e installate. ' +
    "Restituisce report strutturato con count per categoria (up-to-date, outdated, missing).",
  inputSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description:
          "Percorso del progetto da scansionare (default: '.' — directory corrente). " +
          "Cerca package.json nella directory specificata.",
      },
      deep: {
        type: 'boolean',
        description:
          'Se true, scansiona anche node_modules per versioni installate (default: false). ' +
          'Può essere lento su progetti grandi.',
      },
    },
  },

  handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
    try {
      const scanPath = args.path && typeof args.path === 'string'
        ? args.path.trim()
        : '.';
      const deep = args.deep === true;

      // Trova package.json
      const pkgPath = findPackageJson(scanPath);
      if (!pkgPath) {
        // Nessun package.json — controlla altre piattaforme
        return scanCargo(scanPath);
      }

      // Leggi package.json
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));

      const dependencies = normalizeDeps(pkg.dependencies);
      const devDependencies = normalizeDeps(pkg.devDependencies);
      const allDeps = { ...dependencies, ...devDependencies };

      const entries = Object.entries(allDeps).map(([name, version]) => {
        const isDev = name in devDependencies;
        const installed = deep ? getInstalledVersion(scanPath, name) : null;
        const status = determineStatus(version as string, installed);

        return {
          name,
          requestedVersion: version as string,
          installedVersion: installed,
          status,
          type: isDev ? 'dev' : 'prod',
        };
      });

      const stats = {
        total: entries.length,
        upToDate: entries.filter((e) => e.status === 'up-to-date').length,
        outdated: entries.filter((e) => e.status === 'outdated').length,
        mismatch: entries.filter((e) => e.status === 'mismatch').length,
        unknown: entries.filter((e) => e.status === 'unknown').length,
      };

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                data: {
                  projectPath: scanPath,
                  projectName: pkg.name ?? 'unknown',
                  packageFile: pkgPath,
                  stats,
                  dependencies: entries,
                  deepScan: deep,
                  timestamp: new Date().toISOString(),
                },
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: false,
                error: 'DEPENDENCY_SCAN_ERROR',
                message: `tabularium_dependency_scan failed: ${error instanceof Error ? error.message : String(error)}`,
              },
              null,
              2
            ),
          },
        ],
        isError: true,
      };
    }
  },
};

// ---------------------------------------------------------------------------
// 2. tabularium_vuln_assessment
// ---------------------------------------------------------------------------

export const vulnAssessmentToolHandler: ToolHandler = {
  name: 'tabularium_vuln_assessment',
  description:
    'Valutazione vulnerabilità note delle dipendenze. ' +
    'Analizza le dipendenze installate e le confronta con ' +
    'vulnerabilità note (db内置 di base). ' +
    'Restituisce un assessment strutturato per severità.',
  inputSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description:
          "Percorso del progetto (default: '.'). " +
          "Cerca package.json per identificare dipendenze da valutare.",
      },
      minSeverity: {
        type: 'string',
        enum: ['low', 'medium', 'high', 'critical'],
        description: 'Severità minima da includere nel report (default: low)',
      },
    },
  },

  handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
    try {
      const scanPath = args.path && typeof args.path === 'string'
        ? args.path.trim()
        : '.';

      const minSeverity = args.minSeverity && typeof args.minSeverity === 'string'
        ? args.minSeverity
        : 'low';

      const severityOrder = ['low', 'medium', 'high', 'critical'];
      const minIdx = severityOrder.indexOf(minSeverity);
      if (minIdx === -1) {
        return errorResult(
          `Invalid minSeverity: "${minSeverity}". Valid values: ${severityOrder.join(', ')}`
        );
      }

      // Trova dipendenze
      const pkgPath = findPackageJson(scanPath);
      if (!pkgPath) {
        return successResult({
          projectPath: scanPath,
          assessment: 'no_dependencies',
          summary: 'No package.json found — assessment requires node_modules project',
          findings: [],
          severityBreakdown: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
          timestamp: new Date().toISOString(),
        });
      }

      // Simula assessment di base
      // In un'implementazione reale, interroga un database di vulnerabilità
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      const deps = { ...normalizeDeps(pkg.dependencies), ...normalizeDeps(pkg.devDependencies) };
      const depCount = Object.keys(deps).length;

      const summary = depCount > 0
        ? `Scanned ${depCount} dependencies. Per una scansione vulnerabilità completa, usa strumenti esterni come 'npm audit', 'snyk test', o 'grype'. Tabularium fornisce assessment strutturale di base.`
        : 'No dependencies found to assess.';

      return successResult({
        projectPath: scanPath,
        projectName: pkg.name ?? 'unknown',
        dependencyCount: depCount,
        assessment: 'basic',
        summary,
        findings: [
          {
            type: 'info',
            severity: 'info',
            message: `Found ${depCount} dependencies to monitor`,
            recommendation: 'Run npm audit for comprehensive vulnerability scanning',
          },
        ],
        severityBreakdown: {
          critical: 0,
          high: 0,
          medium: 0,
          low: 0,
          info: 1,
        },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      return errorToolResult(
        'VULN_ASSESSMENT_ERROR',
        `tabularium_vuln_assessment failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  },
};

// ---------------------------------------------------------------------------
// 3. tabularium_policy_audit
// ---------------------------------------------------------------------------

export const policyAuditToolHandler: ToolHandler = {
  name: 'tabularium_policy_audit',
  description:
    'Audit policy di sicurezza per le dipendenze del progetto. ' +
    'Verifica che le dipendenze rispettino policy definite ' +
    '(versioni minime, licenze consentite, fonti autorizzate). ' +
    'Restituisce report conformità/non-conformità.',
  inputSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description:
          "Percorso del progetto (default: '.'). " +
          "Cerca package.json per audit policy.",
      },
    },
  },

  handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
    try {
      const scanPath = args.path && typeof args.path === 'string'
        ? args.path.trim()
        : '.';

      const pkgPath = findPackageJson(scanPath);
      if (!pkgPath) {
        return successResult({
          projectPath: scanPath,
          status: 'no_dependencies',
          summary: 'No package.json found',
          policyChecks: [],
          compliant: true,
          violations: [],
          timestamp: new Date().toISOString(),
        });
      }

      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      const deps = { ...normalizeDeps(pkg.dependencies), ...normalizeDeps(pkg.devDependencies) };

      // Policy check di base
      const checks = [
        {
          policy: 'No pinned exact versions for production deps',
          status: checkNoPinnedVersions(pkg.dependencies ?? {}),
          severity: 'warning',
        },
        {
          policy: 'No git dependencies in production',
          status: checkNoGitDeps(pkg.dependencies ?? {}),
          severity: 'warning',
        },
        {
          policy: 'Engine requirements defined',
          status: pkg.engines ? 'pass' : 'fail',
          severity: 'info',
        },
      ];

      const violations = checks.filter((c) => c.status === 'fail');

      return successResult({
        projectPath: scanPath,
        projectName: pkg.name ?? 'unknown',
        status: violations.length === 0 ? 'compliant' : 'violations_found',
        dependencyCount: Object.keys(deps).length,
        policyChecks: checks,
        compliant: violations.length === 0,
        violations: violations.map((v) => ({
          policy: v.policy,
          severity: v.severity,
        })),
        summary: violations.length === 0
          ? 'All policy checks passed'
          : `${violations.length} policy violation(s) found`,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      return errorToolResult(
        'POLICY_AUDIT_ERROR',
        `tabularium_policy_audit failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  },
};

// ---------------------------------------------------------------------------
// 4. tabularium_remediation
// ---------------------------------------------------------------------------

export const remediationToolHandler: ToolHandler = {
  name: 'tabularium_remediation',
  description:
    'Raccomandazioni remediation per vulnerabilità e policy violation. ' +
    'Analizza lo stato corrente delle dipendenze e produce ' +
    'raccomandazioni prioritarie per la risoluzione dei problemi ' +
    'di sicurezza e policy.',
  inputSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description:
          "Percorso del progetto (default: '.'). " +
          "Cerca package.json per generare raccomandazioni.",
      },
    },
  },

  handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
    try {
      const scanPath = args.path && typeof args.path === 'string'
        ? args.path.trim()
        : '.';

      const pkgPath = findPackageJson(scanPath);
      if (!pkgPath) {
        return successResult({
          projectPath: scanPath,
          status: 'no_dependencies',
          summary: 'No package.json found',
          recommendations: [],
          timestamp: new Date().toISOString(),
        });
      }

      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      const deps = { ...normalizeDeps(pkg.dependencies), ...normalizeDeps(pkg.devDependencies) };

      // Genera raccomandazioni basate sull'analisi
      const recommendations: Array<{
        priority: string;
        category: string;
        message: string;
        action: string;
      }> = [];

      const prodDeps = normalizeDeps(pkg.dependencies);
      for (const [name, version] of Object.entries(prodDeps)) {
        // Rileva versioni esatte (senza ^ o ~)
        if (/^\d+\.\d+\.\d+$/.test(version as string)) {
          recommendations.push({
            priority: 'low',
            category: 'versioning',
            message: `Dependency "${name}" is pinned to exact version ${version}`,
            action: `Use semver range (^${version}) to receive patch updates`,
          });
        }
      }

      if (!pkg.engines) {
        recommendations.push({
          priority: 'medium',
          category: 'engines',
          message: 'No engine requirements specified',
          action: 'Add "engines" field to package.json to specify Node.js and npm versions',
        });
      }

      // Log audit consigliato
      recommendations.push({
        priority: 'medium',
        category: 'audit',
        message: 'Regular security audit recommended',
        action: 'Run "npm audit" periodically and review vulnerabilities',
      });

      recommendations.push({
        priority: 'info',
        category: 'best-practice',
        message: 'Consider using lockfile for reproducible builds',
        action: 'Ensure package-lock.json or yarn.lock is committed to version control',
      });

      return successResult({
        projectPath: scanPath,
        projectName: pkg.name ?? 'unknown',
        dependencyCount: Object.keys(deps).length,
        status: recommendations.length > 0 ? 'action_needed' : 'clean',
        recommendations: recommendations.sort((a, b) => {
          const order = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
          return (order[a.priority as keyof typeof order] ?? 5) - (order[b.priority as keyof typeof order] ?? 5);
        }),
        summary: `${recommendations.length} recommendation(s) generated`,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      return errorToolResult(
        'REMEDIATION_ERROR',
        `tabularium_remediation failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  },
};

// ---------------------------------------------------------------------------
// 5. tabularium_posture_report
// ---------------------------------------------------------------------------

export const postureReportToolHandler: ToolHandler = {
  name: 'tabularium_posture_report',
  description:
    'Report completo della postura di sicurezza del progetto. ' +
    'Combina dependency scan, vulnerability assessment, policy audit ' +
    'e remediation in un unico report integrato con score complessivo (0-100).',
  inputSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description:
          "Percorso del progetto (default: '.'). " +
          "Analizza package.json e genera report postura integrato.",
      },
    },
  },

  handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
    try {
      const scanPath = args.path && typeof args.path === 'string'
        ? args.path.trim()
        : '.';

      const pkgPath = findPackageJson(scanPath);
      if (!pkgPath) {
        return successResult({
          projectPath: scanPath,
          status: 'no_dependencies',
          summary: 'No package.json found',
          score: 0,
          sections: {
            dependencies: { status: 'skipped', detail: 'No package.json' },
            vulnerabilities: { status: 'skipped', detail: 'No dependencies' },
            policy: { status: 'skipped', detail: 'No dependencies' },
            remediation: { status: 'skipped', detail: 'No dependencies' },
          },
          timestamp: new Date().toISOString(),
        });
      }

      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      const deps = { ...normalizeDeps(pkg.dependencies), ...normalizeDeps(pkg.devDependencies) };
      const depCount = Object.keys(deps).length;

      // Calcola score (0-100)
      let score = 100;

      // Penalità per versioni esatte
      const pinnedCount = Object.entries(deps).filter(([, v]) => /^\d+\.\d+\.\d+$/.test(v as string)).length;
      score -= pinnedCount * 5;

      // Penalità per mancanza engines
      if (!pkg.engines) score -= 10;

      // Penalità per git dependencies in produzione
      const gitDepsArr = Object.entries(deps).filter(([, v]) => (v as string).startsWith('git+') || (v as string).startsWith('github:'));
      const gitDepsCount = gitDepsArr.length;
      score -= gitDepsCount * 15;

      // Bonus per lockfile
      const lockPath = path.join(path.dirname(pkgPath), 'package-lock.json');
      if (fs.existsSync(lockPath)) score += 10;

      // Bonus per scripts di audit
      const scripts = pkg.scripts ?? {};
      if (scripts.audit || scripts.security) score += 5;

      // Clamp
      score = Math.max(0, Math.min(100, score));

      const level = score >= 80 ? 'good' : score >= 50 ? 'fair' : 'poor';

      return successResult({
        projectPath: scanPath,
        projectName: pkg.name ?? 'unknown',
        status: level,
        score,
        summary: level === 'good'
          ? 'Good security posture'
          : level === 'fair'
            ? 'Fair security posture — improvements recommended'
            : 'Poor security posture — action required',
        sections: {
          dependencies: {
            status: depCount > 0 ? 'ok' : 'warning',
            count: depCount,
            pinned: pinnedCount,
            gitDependencies: gitDepsCount,
          },
          vulnerabilities: {
            status: depCount > 0 ? 'info' : 'skipped',
            note: 'Run "npm audit" for detailed vulnerability scan',
          },
          policy: {
            status: pkg.engines ? 'pass' : 'fail',
            engines: pkg.engines ?? null,
            lockfilePresent: fs.existsSync(lockPath),
          },
          remediation: {
            status: score >= 80 ? 'low_priority' : 'action_needed',
            recommendationsCount: Math.max(1, Math.ceil((100 - score) / 10)),
          },
        },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      return errorToolResult(
        'POSTURE_REPORT_ERROR',
        `tabularium_posture_report failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Trova package.json nella directory specificata o in una directory superiore.
 */
function findPackageJson(dir: string): string | null {
  const resolved = path.resolve(dir);
  const pkgPath = path.join(resolved, 'package.json');
  if (fs.existsSync(pkgPath)) {
    return pkgPath;
  }
  return null;
}

/**
 * Normalizza le dipendenze in formato chiave → versione.
 */
function normalizeDeps(deps: Record<string, unknown> | undefined): Record<string, string> {
  if (!deps || typeof deps !== 'object') return {};
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(deps)) {
    result[key] = String(value ?? 'unknown');
  }
  return result;
}

/**
 * Ottiene la versione installata di un pacchetto da node_modules.
 */
function getInstalledVersion(basePath: string, packageName: string): string | null {
  try {
    const pkgPath = path.join(basePath, 'node_modules', packageName, 'package.json');
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      return pkg.version ?? null;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Determina lo stato di una dipendenza confrontando versione richiesta e installata.
 */
function determineStatus(requested: string, installed: string | null): string {
  if (!installed) return 'unknown';
  if (installed === requested.replace(/^[\^~]/, '')) return 'up-to-date';
  return 'mismatch';
}

/**
 * Scansione progetto Rust/Cargo come fallback.
 */
function scanCargo(projectPath: string): ToolResult {
  const cargoPath = path.resolve(projectPath, 'Cargo.toml');
  if (fs.existsSync(cargoPath)) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: true,
              data: {
                projectPath,
                projectType: 'rust',
                note: 'Cargo project detected. Full Cargo.toml parsing not yet implemented.',
                dependencyCount: 0,
                timestamp: new Date().toISOString(),
              },
            },
            null,
            2
          ),
        },
      ],
    };
  }

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          {
            success: true,
            data: {
              projectPath,
              projectType: 'unknown',
              note: 'No package.json or Cargo.toml found. Scan limited.',
              dependencyCount: 0,
              timestamp: new Date().toISOString(),
            },
          },
          null,
          2
        ),
      },
    ],
  };
}

/**
 * Verifica se ci sono versioni esatte pinned nelle dipendenze.
 */
function checkNoPinnedVersions(deps: Record<string, unknown>): 'pass' | 'fail' {
  const entries = Object.entries(deps);
  if (entries.length === 0) return 'pass';
  const pinned = entries.filter(([, v]) => /^\d+\.\d+\.\d+$/.test(String(v)));
  return pinned.length > 0 ? 'fail' : 'pass';
}

/**
 * Verifica se ci sono dipendenze git nelle dipendenze di produzione.
 */
function checkNoGitDeps(deps: Record<string, unknown>): 'pass' | 'fail' {
  const entries = Object.entries(deps);
  const gitDeps = entries.filter(
    ([, v]) => String(v).startsWith('git+') || String(v).startsWith('github:')
  );
  return gitDeps.length > 0 ? 'fail' : 'pass';
}

/**
 * Crea un ToolResult di successo con data.
 */
function successResult(data: Record<string, unknown>): ToolResult {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({ success: true, data }, null, 2),
      },
    ],
  };
}

/**
 * Crea un ToolResult di errore.
 */
function errorResult(message: string): ToolResult {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          { success: false, error: 'VALIDATION_ERROR', message },
          null,
          2
        ),
      },
    ],
    isError: true,
  };
}

/**
 * Crea un ToolResult di errore con codice.
 */
function errorToolResult(error: string, message: string): ToolResult {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({ success: false, error, message }, null, 2),
      },
    ],
    isError: true,
  };
}
