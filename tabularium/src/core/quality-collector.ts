/**
 * core/quality-collector.ts
 * Raccoglie metriche di qualità del progetto eseguendo comandi shell.
 *
 * Esegue:
 * - eslint --format json (lint errors/warnings)
 * - tsc --noEmit (TypeScript errors)
 * - jest --coverage (test pass/fail + coverage)
 * - Calcolo dimensione bundle (dist/)
 *
 * Ogni metrica viene poi storeata tramite metrics-engine.
 *
 * @module core/quality-collector
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { storeMetric } from './metrics-engine.js';

// ---------------------------------------------------------------------------
// Tipi
// ---------------------------------------------------------------------------

/** Metriche di qualità raccolte dal progetto */
export interface QualityMetrics {
  lint_errors: number;
  lint_warnings: number;
  ts_errors: number;
  test_pass: number;
  test_fail: number;
  coverage_pct: number;
  bundle_size_kb: number;
}

// ---------------------------------------------------------------------------
// Raccolta
// ---------------------------------------------------------------------------

/**
 * Esegue i tool di qualità sul progetto e restituisce le metriche raccolte.
 * Ogni tool è eseguito in un try/catch separato: se uno fallisce,
 * la metrica corrispondente è impostata a -1 e la raccolta continua.
 *
 * @param projectPath - Percorso assoluto del progetto da analizzare
 * @returns QualityMetrics con tutti i valori
 */
export function collectQualityMetrics(projectPath: string): QualityMetrics {
  return {
    lint_errors: collectLintErrors(projectPath),
    lint_warnings: collectLintWarnings(projectPath),
    ts_errors: collectTsErrors(projectPath),
    test_pass: collectTestPass(projectPath),
    test_fail: collectTestFail(projectPath),
    coverage_pct: collectCoveragePct(projectPath),
    bundle_size_kb: collectBundleSize(projectPath),
  };
}

/**
 * Raccoglie e salva tutte le metriche di qualità nel database.
 * Chiama collectQualityMetrics internamente e storea ogni metrica
 * con domain="quality".
 *
 * @param projectPath - Percorso assoluto del progetto
 * @param tags - Tag opzionali da aggiungere a ogni metrica (es. { agent, branch })
 */
export function snapshotQuality(
  projectPath: string,
  tags?: Record<string, string>
): void {
  const metrics = collectQualityMetrics(projectPath);

  const entries: Array<{ name: string; value: number }> = [
    { name: 'lint_errors', value: metrics.lint_errors },
    { name: 'lint_warnings', value: metrics.lint_warnings },
    { name: 'ts_errors', value: metrics.ts_errors },
    { name: 'test_pass', value: metrics.test_pass },
    { name: 'test_fail', value: metrics.test_fail },
    { name: 'coverage_pct', value: metrics.coverage_pct },
    { name: 'bundle_size_kb', value: metrics.bundle_size_kb },
  ];

  for (const entry of entries) {
    try {
      storeMetric('quality', entry.name, entry.value, tags);
    } catch (err) {
      console.error(`[quality-collector] Failed to store metric '${entry.name}':`, err);
    }
  }
}

// ---------------------------------------------------------------------------
// Implementazioni dei singoli collector
// ---------------------------------------------------------------------------

/**
 * Esegue eslint --format json e conta gli errori.
 * Se eslint non è installato o fallisce, restituisce -1.
 */
function collectLintErrors(projectPath: string): number {
  try {
    const output = execSync('npx eslint --format json .', {
      cwd: projectPath,
      encoding: 'utf-8',
      timeout: 60_000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const results = JSON.parse(output) as Array<{ errorCount?: number }>;
    return results.reduce((sum, file) => sum + (file.errorCount ?? 0), 0);
  } catch (err: unknown) {
    // eslint potrebbe non essere installato o non avere file da analizzare
    console.error(`[quality-collector] eslint failed: ${err instanceof Error ? err.message : String(err)}`);
    return -1;
  }
}

/**
 * Esegue eslint --format json e conta i warning.
 */
function collectLintWarnings(projectPath: string): number {
  try {
    const output = execSync('npx eslint --format json .', {
      cwd: projectPath,
      encoding: 'utf-8',
      timeout: 60_000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const results = JSON.parse(output) as Array<{ warningCount?: number }>;
    return results.reduce((sum, file) => sum + (file.warningCount ?? 0), 0);
  } catch {
    return -1;
  }
}

/**
 * Esegue tsc --noEmit e conta gli errori dal parsing dell'output.
 * Cerca pattern "error TS" nell'output (stderr).
 */
function collectTsErrors(projectPath: string): number {
  try {
    const stdout = execSync('npx tsc --noEmit 2>&1', {
      cwd: projectPath,
      encoding: 'utf-8',
      timeout: 120_000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Conta le righe con "error TS"
    const errorLines = stdout.split('\n').filter((line) => line.includes('error TS'));
    return errorLines.length;
  } catch (err: unknown) {
    // tsc restituisce exit code 1 quando ci sono errori, ma l'output contiene i dettagli
    const stderr = (err as { stderr?: string; stdout?: string })?.stderr
      ?? (err as { message?: string })?.message
      ?? '';
    const errorLines = stderr.split('\n').filter((line) => line.includes('error TS'));
    if (errorLines.length > 0) return errorLines.length;

    // Se non troviamo errori nell'output, tsc potrebbe non essere disponibile
    console.error(`[quality-collector] tsc failed: ${err instanceof Error ? err.message : String(err)}`);
    return -1;
  }
}

/**
 * Esegue jest --coverage e conta i test passati.
 * Cerca nel summary output "Tests: X passed" con regex.
 */
function collectTestPass(projectPath: string): number {
  try {
    const output = execSync('npx jest --coverage 2>&1', {
      cwd: projectPath,
      encoding: 'utf-8',
      timeout: 120_000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const match = output.match(/(\d+)\s+passed/);
    return match ? parseInt(match[1], 10) : -1;
  } catch (err: unknown) {
    // Jest ha exit code 1 quando ci sono test falliti, ma l'output è ancora valido
    const output = (err as { stdout?: string })?.stdout
      ?? (err as { stderr?: string })?.stderr
      ?? '';
    const match = output.match(/(\d+)\s+passed/);
    if (match) return parseInt(match[1], 10);

    console.error(`[quality-collector] jest failed: ${err instanceof Error ? err.message : String(err)}`);
    return -1;
  }
}

/**
 * Esegue jest --coverage e conta i test falliti.
 * Cerca "X failed" nel summary.
 */
function collectTestFail(projectPath: string): number {
  try {
    const output = execSync('npx jest --coverage 2>&1', {
      cwd: projectPath,
      encoding: 'utf-8',
      timeout: 120_000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Cerca "X failed", ma attenzione a "X passed" che contiene "ed" ma non è "failed"
    const matchFailed = output.match(/(\d+)\s+failed/);
    return matchFailed ? parseInt(matchFailed[1], 10) : 0;
  } catch (err: unknown) {
    const output = (err as { stdout?: string })?.stdout
      ?? (err as { stderr?: string })?.stderr
      ?? '';
    const matchFailed = output.match(/(\d+)\s+failed/);
    if (matchFailed) return parseInt(matchFailed[1], 10);

    return -1;
  }
}

/**
 * Esegue jest --coverage e estrae la percentuale di coverage dal summary.
 * Cerca "Lines:" o "Statements:" seguiti da percentuale.
 */
function collectCoveragePct(projectPath: string): number {
  try {
    const output = execSync('npx jest --coverage 2>&1', {
      cwd: projectPath,
      encoding: 'utf-8',
      timeout: 120_000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Cerca la riga "All files" e la percentuale di Statements o Lines
    const lines = output.split('\n');
    for (const line of lines) {
      if (line.includes('All files')) {
        // Formato tipico: "| All files | 85.5 | 90.2 | 78.3 | 88.1 |"
        const parts = line.split('|').map((p) => p.trim());
        // Statements è di solito il terzo campo dopo "All files"
        // Cerchiamo un valore percentuale
        for (const part of parts) {
          const pctMatch = part.match(/(\d+\.?\d*)/);
          if (pctMatch) {
            return parseFloat(pctMatch[1]);
          }
        }
      }
    }

    // Fallback: cerca "Coverage summary:" o "File" con percentuali
    const pctMatch = output.match(/(\d+\.\d+)%\s*\|/);
    return pctMatch ? parseFloat(pctMatch[1]) : -1;
  } catch {
    return -1;
  }
}

/**
 * Calcola la dimensione della cartella dist/ in kilobyte.
 * Usa fs ricorsivo per compatibilità cross-platform.
 */
function collectBundleSize(projectPath: string): number {
  const distPath = path.join(projectPath, 'dist');
  try {
    if (!fs.existsSync(distPath)) {
      // Prova altre cartelle tipiche
      const altPaths = ['build', 'out', '.next'];
      for (const alt of altPaths) {
        const altPath = path.join(projectPath, alt);
        if (fs.existsSync(altPath)) {
          return Math.round(getDirectorySize(altPath) / 1024);
        }
      }
      return -1;
    }

    return Math.round(getDirectorySize(distPath) / 1024);
  } catch {
    console.error('[quality-collector] Failed to calculate bundle size');
    return -1;
  }
}

/**
 * Calcola ricorsivamente la dimensione totale di una directory in byte.
 */
function getDirectorySize(dirPath: string): number {
  let totalSize = 0;

  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        totalSize += getDirectorySize(fullPath);
      } else if (entry.isFile()) {
        try {
          const stat = fs.statSync(fullPath);
          totalSize += stat.size;
        } catch {
          // Salta file non accessibili
        }
      }
    }
  } catch {
    // Directory non accessibile
  }

  return totalSize;
}
