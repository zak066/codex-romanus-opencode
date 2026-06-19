/**
 * core/quality-gate.ts
 * Quality Gate pipeline — esegue lint → TSC → test → coverage → audit
 * e restituisce PASS/FAIL con dettaglio per ogni step.
 *
 * Ogni step viene eseguito con child_process.execSync; se uno step fallisce,
 * la pipeline continua comunque con i successivi (non fail-fast).
 * Il gate restituisce PASS solo se TUTTI gli step superano le soglie.
 *
 * @module core/quality-gate
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

// ---------------------------------------------------------------------------
// Tipi pubblici
// ---------------------------------------------------------------------------

/** Soglie configurabili per il quality gate */
export interface GateThreshold {
  maxLintErrors?: number;      // default: 0
  maxLintWarnings?: number;    // default: 10
  maxTsErrors?: number;        // default: 0
  minCoverage?: number;        // default: 80 (%)
  maxTestFails?: number;       // default: 0
  maxVulnerabilities?: number; // default: 0
}

/** Risultato di un singolo step della pipeline */
export interface GateStep {
  name: string;                // "lint" | "tsc" | "test" | "coverage" | "audit"
  status: 'pass' | 'fail' | 'skip';
  durationMs: number;
  output: string;
  value?: number;              // valore misurato (es. numero errori, coverage%)
}

/** Risultato completo del quality gate */
export interface GateResult {
  status: 'pass' | 'fail';
  projectPath: string;
  steps: GateStep[];
  startedAt: string;           // ISO
  completedAt: string;         // ISO
  totalDurationMs: number;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_THRESHOLDS: Required<GateThreshold> = {
  maxLintErrors: 0,
  maxLintWarnings: 10,
  maxTsErrors: 0,
  minCoverage: 80,
  maxTestFails: 0,
  maxVulnerabilities: 0,
};

/** Lunghezza massima dell'output catturato per step (in caratteri) */
const MAX_OUTPUT_LENGTH = 2_000;

// ---------------------------------------------------------------------------
// Test framework detection
// ---------------------------------------------------------------------------

/**
 * Rileva il test framework utilizzato dal progetto leggendo package.json.
 * Controlla prima `vitest`, poi `jest` in `devDependencies`/`dependencies`.
 *
 * @param projectPath - Percorso del progetto contenente package.json
 * @returns 'vitest' | 'jest' | 'unknown'
 */
export function detectTestFramework(projectPath: string): 'jest' | 'vitest' | 'unknown' {
  try {
    const pkgPath = path.join(projectPath, 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));

    const allDeps: Record<string, string> = {
      ...(pkg.dependencies ?? {}),
      ...(pkg.devDependencies ?? {}),
    };

    if (allDeps.vitest) return 'vitest';
    if (allDeps.jest) return 'jest';
    return 'unknown';
  } catch {
    return 'unknown';
  }
}

// ---------------------------------------------------------------------------
// Quality Gate — entry point
// ---------------------------------------------------------------------------

/**
 * Esegue il quality gate completo sul progetto specificato.
 *
 * Pipeline: lint → TSC → test → coverage → audit
 * Ogni step continua anche se il precedente fallisce (non fail-fast).
 * Il gate restituisce PASS solo se TUTTI gli step superano le soglie.
 *
 * @param projectPath - Percorso del progetto da analizzare
 * @param thresholds  - Soglie opzionali (sovrascrivono i default parzialmente)
 * @returns GateResult con status PASS/FAIL e dettaglio per ogni step
 */
export function runQualityGate(
  projectPath: string,
  thresholds?: GateThreshold,
): GateResult {
  const startedAt = new Date().toISOString();
  const startTime = Date.now();
  const resolvedPath = path.resolve(projectPath);

  const t: Required<GateThreshold> = { ...DEFAULT_THRESHOLDS, ...thresholds };

  const steps: GateStep[] = [
    runLintStep(resolvedPath, t),
    runTscStep(resolvedPath, t),
    runTestStep(resolvedPath, t),
    runCoverageStep(resolvedPath, t),
    runAuditStep(resolvedPath, t),
  ];

  const totalDurationMs = Date.now() - startTime;
  const allPassed = steps.every((s) => s.status === 'pass');

  return {
    status: allPassed ? 'pass' : 'fail',
    projectPath: resolvedPath,
    steps,
    startedAt,
    completedAt: new Date().toISOString(),
    totalDurationMs,
  };
}

// ---------------------------------------------------------------------------
// Step: Lint (ESLint)
// ---------------------------------------------------------------------------

/**
 * Esegue npx eslint --format json e conta errori/warning.
 * Se eslint non è disponibile, restituisce fail con value = -1.
 */
function runLintStep(
  projectPath: string,
  t: Required<GateThreshold>,
): GateStep {
  const stepStart = Date.now();

  const capture = execWithCapture(
    () =>
      execSync('npx eslint . --format json 2>&1', {
        cwd: projectPath,
        encoding: 'utf-8',
        timeout: 60_000,
        stdio: ['pipe', 'pipe', 'pipe'],
      }),
    'lint',
  );

  if (!capture.success) {
    return {
      name: 'lint',
      status: 'fail',
      durationMs: Date.now() - stepStart,
      output: truncate(capture.errorMessage),
      value: -1,
    };
  }

  try {
    const results = JSON.parse(capture.output) as Array<{
      errorCount?: number;
      warningCount?: number;
    }>;
    const errors = results.reduce((s, f) => s + (f.errorCount ?? 0), 0);
    const warnings = results.reduce((s, f) => s + (f.warningCount ?? 0), 0);

    const errorsOk = errors <= t.maxLintErrors;
    const warningsOk = warnings <= t.maxLintWarnings;
    const pass = errorsOk && warningsOk;

    const detail = `errors=${errors} (max=${t.maxLintErrors}), warnings=${warnings} (max=${t.maxLintWarnings})`;

    return {
      name: 'lint',
      status: pass ? 'pass' : 'fail',
      durationMs: Date.now() - stepStart,
      output: truncate(detail),
      value: errors,
    };
  } catch {
    return {
      name: 'lint',
      status: 'fail',
      durationMs: Date.now() - stepStart,
      output: truncate(`Failed to parse ESLint JSON output: ${capture.output}`),
      value: -1,
    };
  }
}

// ---------------------------------------------------------------------------
// Step: TypeScript (tsc --noEmit)
// ---------------------------------------------------------------------------

/**
 * Esegue npx tsc --noEmit e conta le righe con "error TS".
 * Se tsc non è disponibile, restituisce fail con value = -1.
 */
function runTscStep(
  projectPath: string,
  t: Required<GateThreshold>,
): GateStep {
  const stepStart = Date.now();

  const capture = execWithCapture(
    () =>
      execSync('npx tsc --noEmit 2>&1', {
        cwd: projectPath,
        encoding: 'utf-8',
        timeout: 120_000,
        stdio: ['pipe', 'pipe', 'pipe'],
      }),
    'tsc',
  );

  if (!capture.success) {
    return {
      name: 'tsc',
      status: 'fail',
      durationMs: Date.now() - stepStart,
      output: truncate(capture.errorMessage),
      value: -1,
    };
  }

  const output = capture.output;
  const errorLines = output
    .split('\n')
    .filter((line) => line.includes('error TS'));
  const errors = errorLines.length;
  const pass = errors <= t.maxTsErrors;

  const detail =
    errors > 0
      ? `${errors} TypeScript error(s) found (max=${t.maxTsErrors})\n${errorLines.slice(0, 10).join('\n')}${errorLines.length > 10 ? `\n...and ${errorLines.length - 10} more` : ''}`
      : 'No TypeScript errors';

  return {
    name: 'tsc',
    status: pass ? 'pass' : 'fail',
    durationMs: Date.now() - stepStart,
    output: truncate(detail),
    value: errors,
  };
}

// ---------------------------------------------------------------------------
// Step: Test (Jest)
// ---------------------------------------------------------------------------

/**
 * Esegue il test runner (jest o vitest) a seconda del framework rilevato
 * e conta i test falliti dal summary output.
 * Se nessun test runner è disponibile, restituisce fail con value = -1.
 */
function runTestStep(
  projectPath: string,
  t: Required<GateThreshold>,
): GateStep {
  const stepStart = Date.now();
  const framework = detectTestFramework(projectPath);
  const testCmd = framework === 'vitest' ? 'npx vitest run' : 'npx jest --silent';

  const capture = execWithCapture(
    () =>
      execSync(`${testCmd} 2>&1`, {
        cwd: projectPath,
        encoding: 'utf-8',
        timeout: 120_000,
        stdio: ['pipe', 'pipe', 'pipe'],
      }),
    'test',
  );

  const output = capture.output;

  // Cerca "Tests: X failed, Y passed, Z total" oppure "Tests: Y passed, Z total"
  const failedMatch = output.match(/(\d+)\s+failed/);
  const testFails = failedMatch ? parseInt(failedMatch[1], 10) : 0;

  // Se jest non ha prodotto output significativo, segnala fallimento
  const hasTestOutput = /Tests:/.test(output);
  if (!hasTestOutput) {
    return {
      name: 'test',
      status: 'fail',
      durationMs: Date.now() - stepStart,
      output: truncate(output || 'No test output produced'),
      value: -1,
    };
  }

  const passedMatch = output.match(/(\d+)\s+passed/);
  const testPassed = passedMatch ? parseInt(passedMatch[1], 10) : 0;
  const totalMatch = output.match(/(\d+)\s+total/);
  const testTotal = totalMatch ? parseInt(totalMatch[1], 10) : 0;

  const pass = testFails <= t.maxTestFails;
  const detail =
    testFails > 0
      ? `Tests: ${testFails} failed, ${testPassed} passed (${testTotal} total)`
      : `Tests: ${testPassed} passed (${testTotal} total)`;

  return {
    name: 'test',
    status: pass ? 'pass' : 'fail',
    durationMs: Date.now() - stepStart,
    output: truncate(detail),
    value: testFails,
  };
}

// ---------------------------------------------------------------------------
// Step: Coverage (Jest --coverage)
// ---------------------------------------------------------------------------

/**
 * Esegue il coverage (jest --silent --coverage o vitest run --coverage)
 * a seconda del framework rilevato e estrae la percentuale di coverage.
 * Cerca la riga "All files" nella tabella di Istanbul oppure il coverage summary.
 */
function runCoverageStep(
  projectPath: string,
  t: Required<GateThreshold>,
): GateStep {
  const stepStart = Date.now();
  const framework = detectTestFramework(projectPath);
  const coverageCmd = framework === 'vitest' ? 'npx vitest run --coverage' : 'npx jest --silent --coverage';

  const capture = execWithCapture(
    () =>
      execSync(`${coverageCmd} 2>&1`, {
        cwd: projectPath,
        encoding: 'utf-8',
        timeout: 120_000,
        stdio: ['pipe', 'pipe', 'pipe'],
      }),
    'coverage',
  );

  const output = capture.output;
  const coveragePct = extractCoveragePct(output);

  if (coveragePct < 0) {
    return {
      name: 'coverage',
      status: 'fail',
      durationMs: Date.now() - stepStart,
      output: truncate(
        output || 'Could not extract coverage percentage',
      ),
      value: -1,
    };
  }

  const pass = coveragePct >= t.minCoverage;
  const detail = `Coverage: ${coveragePct.toFixed(2)}% (min=${t.minCoverage}%)`;

  return {
    name: 'coverage',
    status: pass ? 'pass' : 'fail',
    durationMs: Date.now() - stepStart,
    output: truncate(detail),
    value: coveragePct,
  };
}

// ---------------------------------------------------------------------------
// Step: Audit (npm audit)
// ---------------------------------------------------------------------------

/**
 * Esegue npm audit --audit-level=high e conta le vulnerabilità.
 * Se npm audit non è disponibile, restituisce fail con value = -1.
 */
function runAuditStep(
  projectPath: string,
  t: Required<GateThreshold>,
): GateStep {
  const stepStart = Date.now();

  const capture = execWithCapture(
    () =>
      execSync('npm audit --audit-level=high 2>&1', {
        cwd: projectPath,
        encoding: 'utf-8',
        timeout: 60_000,
        stdio: ['pipe', 'pipe', 'pipe'],
      }),
    'audit',
  );

  const output = capture.output;

  // Cerca "found X vulnerabilities" nel summary
  const vulnMatch = output.match(/found\s+(\d+)\s+vulnerabilit(y|ies)/);
  const vulns = vulnMatch ? parseInt(vulnMatch[1], 10) : 0;

  // Se npm audit non ha dato output (non è un progetto npm), fallisce
  if (!output || output.trim().length === 0) {
    return {
      name: 'audit',
      status: 'fail',
      durationMs: Date.now() - stepStart,
      output: 'npm audit produced no output (not an npm project?)',
      value: -1,
    };
  }

  const pass = vulns <= t.maxVulnerabilities;

  // Estrai anche il dettaglio delle severity
  const severityDetail: string[] = [];
  const sevMatch = output.match(/\((\d+)\s+(\w+).*?\)/g);
  if (sevMatch) {
    severityDetail.push(...sevMatch.map((s) => s.trim()));
  }

  const detail =
    vulns > 0
      ? `${vulns} vulnerabilities found (max=${t.maxVulnerabilities})${severityDetail.length > 0 ? ' — ' + severityDetail.join(', ') : ''}`
      : 'No vulnerabilities found';

  return {
    name: 'audit',
    status: pass ? 'pass' : 'fail',
    durationMs: Date.now() - stepStart,
    output: truncate(detail),
    value: vulns,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Esegue un comando shell e cattura output sia in caso di successo che di errore.
 * execSync lancia un'eccezione quando il processo termina con exit code !== 0
 * (es. eslint con errori, jest con test falliti, tsc con errori TS).
 * Questo helper normalizza la cattura in entrambi i casi.
 */
function execWithCapture(
  fn: () => string,
  stepName: string,
): { success: boolean; output: string; errorMessage: string } {
  try {
    const output = fn();
    return { success: true, output, errorMessage: '' };
  } catch (err: unknown) {
    const errorObj = err as Error & { stdout?: string; stderr?: string };
    const stdout = errorObj.stdout ?? '';
    const stderr = errorObj.stderr ?? '';
    const message = errorObj.message ?? String(err);

    // Molti tool scrivono output significativo su stdout anche quando
    // escono con codice di errore (es. eslint --format json con errori).
    // Se stdout è presente, consideriamolo come output valido.
    if (stdout) {
      return { success: true, output: stdout, errorMessage: '' };
    }

    // Alcuni tool (es. tsc) scrivono su stderr
    if (stderr) {
      return { success: true, output: stderr, errorMessage: '' };
    }

    return {
      success: false,
      output: '',
      errorMessage: `[${stepName}] ${message}`,
    };
  }
}

/**
 * Estrae la percentuale di coverage dall'output di jest --coverage.
 * Supporta due formati:
 *   1. Tabella Istanbul: "| All files | 85.71 | 66.66 | 66.66 | 83.33 |"
 *   2. Coverage summary: "Statements   : 92.3% ( 24/26 )"
 *
 * @returns percentuale (0-100) o -1 se non trovata
 */
function extractCoveragePct(output: string): number {
  // Prova 1: cerca la riga "All files" nella tabella Istanbul
  for (const line of output.split('\n')) {
    if (line.includes('All files')) {
      // Formato: "| All files | 85.71 | 66.66 | 66.66 | 83.33 |"
      const parts = line.split('|').map((p) => p.trim());
      for (const part of parts) {
        const pctMatch = part.match(/^(\d+\.?\d*)$/);
        if (pctMatch) {
          return parseFloat(pctMatch[1]);
        }
      }
    }
  }

  // Prova 2: cerca il coverage summary
  // "Statements   : 92.3% ( 24/26 )"
  const stmtsMatch = output.match(/Statements\s*:\s*(\d+\.?\d*)%/);
  if (stmtsMatch) {
    return parseFloat(stmtsMatch[1]);
  }

  // Prova 3: cerca "Lines" nel summary
  const linesMatch = output.match(/Lines\s*:\s*(\d+\.?\d*)%/);
  if (linesMatch) {
    return parseFloat(linesMatch[1]);
  }

  // Prova 4: cerca qualsiasi percentuale dopo "All files"
  const allFilesPct = output.match(/All\s+files[^|]*\|\s*(\d+\.?\d*)/);
  if (allFilesPct) {
    return parseFloat(allFilesPct[1]);
  }

  return -1;
}

/**
 * Tronca una stringa se eccede MAX_OUTPUT_LENGTH, aggiungendo marker.
 */
function truncate(text: string): string {
  if (text.length <= MAX_OUTPUT_LENGTH) return text;
  return text.substring(0, MAX_OUTPUT_LENGTH - 3) + '...';
}
