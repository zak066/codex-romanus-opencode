/**
 * Test per core/quality-gate.ts — Quality Gate Pipeline (Fase 6: AUTOMATA)
 *
 * Copertura:
 * - runQualityGate con execSync mockato per ogni step della pipeline
 * - Soglie di default e custom
 * - PASS quando tutti gli step superano le soglie
 * - FAIL quando lint errors / coverage superano soglia
 * - Non fail-fast: step successivi vengono eseguiti anche se precedenti falliscono
 * - Errore execSync gestito gracefulmente
 *
 * @module tests/core/quality-gate
 */

import { execSync } from 'node:child_process';
import { runQualityGate } from '../../src/core/quality-gate.js';

// ---------------------------------------------------------------------------
// Mock execSync
// ---------------------------------------------------------------------------

jest.mock('node:child_process', () => ({
  execSync: jest.fn(),
}));

const mockExecSync = execSync as jest.MockedFunction<typeof execSync>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PROJECT_PATH = '/fake/project';

/**
 * Output coverage con tabella Istanbul — coverage all'85.71%
 */
function coverageOutput(pct = 85.71): string {
  return `
-----------|---------|----------|---------|---------|-------------------
File       | % Stmts | % Branch | % Funcs | % Lines | Uncovered Line #
-----------|---------|----------|---------|---------|-------------------
All files  |    ${pct} |    79.23 |    90.1  |    88.3 |
-----------|---------|----------|---------|---------|-------------------
`;
}

/**
 * Crea un mock di execSync che lancia un errore con stdout.
 * Simula un comando che esce con codice non-zero ma produce output.
 */
function throwingExecSync(stdout: string): () => never {
  return () => {
    const err = new Error('Command failed with exit code 1') as Error & { stdout?: string; stderr?: string };
    err.stdout = stdout;
    throw err;
  };
}

// ---------------------------------------------------------------------------
// Suite: runQualityGate
// ---------------------------------------------------------------------------

describe('runQualityGate', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── PASS: tutti gli step OK ──────────────────────────────────────────

  it('restituisce PASS quando tutti gli step superano le soglie di default', () => {
    mockExecSync
      .mockReturnValueOnce(JSON.stringify([{ errorCount: 0, warningCount: 0 }]))
      .mockReturnValueOnce('No errors found')
      .mockReturnValueOnce('Tests: 42 passed (42 total)')
      .mockReturnValueOnce(coverageOutput(85.71))
      .mockReturnValueOnce('found 0 vulnerabilities');

    const result = runQualityGate(PROJECT_PATH);

    expect(result.status).toBe('pass');
    expect(result.steps).toHaveLength(5);
    expect(result.steps.every((s) => s.status === 'pass')).toBe(true);

    // Verifica struttura del risultato
    expect(result.projectPath).toEqual(expect.any(String));
    expect(result.projectPath).toContain('project');
    expect(result.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(result.completedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(result.totalDurationMs).toBeGreaterThanOrEqual(0);
  });

  // ── FAIL: lint errors > soglia ───────────────────────────────────────

  it('fallisce quando lint errors superano maxLintErrors', () => {
    mockExecSync
      .mockImplementationOnce(throwingExecSync(JSON.stringify([{ errorCount: 5, warningCount: 3 }])))
      .mockReturnValueOnce('No errors found')
      .mockReturnValueOnce('Tests: 42 passed (42 total)')
      .mockReturnValueOnce(coverageOutput(85.71))
      .mockReturnValueOnce('found 0 vulnerabilities');

    const result = runQualityGate(PROJECT_PATH, { maxLintErrors: 0 });

    expect(result.status).toBe('fail');
    expect(result.steps[0].status).toBe('fail');
    expect(result.steps[0].name).toBe('lint');
    expect(result.steps[0].value).toBe(5);
    // Step successivi devono essere comunque eseguiti
    expect(result.steps[1].status).toBe('pass');
    expect(result.steps[2].status).toBe('pass');
    expect(result.steps[3].status).toBe('pass');
    expect(result.steps[4].status).toBe('pass');
  });

  it('fallisce quando lint warnings superano maxLintWarnings', () => {
    mockExecSync
      .mockImplementationOnce(throwingExecSync(JSON.stringify([{ errorCount: 0, warningCount: 20 }])))
      .mockReturnValueOnce('No errors found')
      .mockReturnValueOnce('Tests: 42 passed (42 total)')
      .mockReturnValueOnce(coverageOutput(85.71))
      .mockReturnValueOnce('found 0 vulnerabilities');

    const result = runQualityGate(PROJECT_PATH, { maxLintWarnings: 10 });

    expect(result.status).toBe('fail');
    expect(result.steps[0].status).toBe('fail');
    expect(result.steps[0].value).toBe(0); // value = errors, not warnings
  });

  // ── FAIL: coverage < soglia ──────────────────────────────────────────

  it('fallisce quando coverage è inferiore a minCoverage', () => {
    mockExecSync
      .mockReturnValueOnce(JSON.stringify([{ errorCount: 0, warningCount: 0 }]))
      .mockReturnValueOnce('No errors found')
      .mockReturnValueOnce('Tests: 42 passed (42 total)')
      .mockReturnValueOnce(coverageOutput(65.0))
      .mockReturnValueOnce('found 0 vulnerabilities');

    const result = runQualityGate(PROJECT_PATH, { minCoverage: 80 });

    expect(result.status).toBe('fail');
    expect(result.steps[3].status).toBe('fail');
    expect(result.steps[3].name).toBe('coverage');
    expect(result.steps[3].value).toBeLessThan(80);
  });

  // ── FAIL: test fails > soglia ────────────────────────────────────────

  it('fallisce quando test fails superano maxTestFails', () => {
    mockExecSync
      .mockReturnValueOnce(JSON.stringify([{ errorCount: 0, warningCount: 0 }]))
      .mockReturnValueOnce('No errors found')
      .mockImplementationOnce(throwingExecSync('Tests: 5 failed, 37 passed (42 total)'))
      .mockReturnValueOnce(coverageOutput(85.71))
      .mockReturnValueOnce('found 0 vulnerabilities');

    const result = runQualityGate(PROJECT_PATH, { maxTestFails: 0 });

    expect(result.status).toBe('fail');
    expect(result.steps[2].status).toBe('fail');
    expect(result.steps[2].name).toBe('test');
    expect(result.steps[2].value).toBe(5);
  });

  // ── FAIL: audit vulnerabilties > soglia ──────────────────────────────

  it('fallisce quando vulnerabilità superano maxVulnerabilities', () => {
    mockExecSync
      .mockReturnValueOnce(JSON.stringify([{ errorCount: 0, warningCount: 0 }]))
      .mockReturnValueOnce('No errors found')
      .mockReturnValueOnce('Tests: 42 passed (42 total)')
      .mockReturnValueOnce(coverageOutput(85.71))
      .mockImplementationOnce(throwingExecSync(
        'found 3 vulnerabilities (1 low, 2 moderate)'
      ));

    const result = runQualityGate(PROJECT_PATH, { maxVulnerabilities: 0 });

    expect(result.status).toBe('fail');
    expect(result.steps[4].status).toBe('fail');
    expect(result.steps[4].name).toBe('audit');
    expect(result.steps[4].value).toBe(3);
  });

  // ── Non fail-fast ────────────────────────────────────────────────────

  it('NON blocca gli step successivi quando uno step fallisce (non fail-fast)', () => {
    // Primo step (lint) fallisce, ma tutti gli altri vengono eseguiti
    mockExecSync
      .mockImplementationOnce(throwingExecSync(JSON.stringify([{ errorCount: 10, warningCount: 5 }])))
      .mockImplementationOnce(throwingExecSync('src/file.ts:1:1 - error TS2322: Type mismatch'))
      .mockImplementationOnce(throwingExecSync('Tests: 3 failed, 10 passed (13 total)'))
      .mockReturnValueOnce(coverageOutput(85.71))
      .mockReturnValueOnce('found 0 vulnerabilities');

    const result = runQualityGate(PROJECT_PATH);

    // Tutti e 5 gli step devono essere presenti nel risultato
    expect(result.steps).toHaveLength(5);
    expect(result.steps[0].status).toBe('fail'); // lint
    expect(result.steps[1].status).toBe('fail'); // tsc
    expect(result.steps[2].status).toBe('fail'); // test
    expect(result.steps[3].status).toBe('pass'); // coverage
    expect(result.steps[4].status).toBe('pass'); // audit
    expect(result.status).toBe('fail');
  });

  // ── Soglie custom ────────────────────────────────────────────────────

  it('accetta soglie custom che sovrascrivono i default', () => {
    mockExecSync
      .mockReturnValueOnce(JSON.stringify([{ errorCount: 3, warningCount: 5 }]))
      .mockReturnValueOnce('No errors found')
      .mockReturnValueOnce('Tests: 42 passed (42 total)')
      .mockReturnValueOnce(coverageOutput(75.0))
      .mockReturnValueOnce('found 0 vulnerabilities');

    // Soglie più permissive: 5 errori, 10 warnings, 70% coverage
    const result = runQualityGate(PROJECT_PATH, {
      maxLintErrors: 5,
      maxLintWarnings: 10,
      minCoverage: 70,
    });

    expect(result.status).toBe('pass');
    expect(result.steps[0].status).toBe('pass');
    expect(result.steps[3].status).toBe('pass');
  });

  it('usa soglie di default per i parametri non specificati', () => {
    mockExecSync
      .mockReturnValueOnce(JSON.stringify([{ errorCount: 0, warningCount: 0 }]))
      .mockReturnValueOnce('No errors found')
      .mockReturnValueOnce('Tests: 42 passed (42 total)')
      .mockReturnValueOnce(coverageOutput(85.71))
      .mockReturnValueOnce('found 0 vulnerabilities');

    // Passa solo minCoverage — gli altri devono usare i default
    const result = runQualityGate(PROJECT_PATH, { minCoverage: 90 });

    // Coverage 85.71 < 90, quindi fail
    expect(result.status).toBe('fail');
    expect(result.steps[3].status).toBe('fail');
  });

  // ── Errore execSync gestito ──────────────────────────────────────────

  it('gestisce errore execSync per tool non disponibile (nessun stdout)', () => {
    mockExecSync.mockImplementation(() => {
      throw new Error('ENOENT: tool not found');
    });

    const result = runQualityGate(PROJECT_PATH);

    expect(result.steps).toHaveLength(5);
    // Ogni step deve avere value = -1 quando il tool non è disponibile
    for (const step of result.steps) {
      expect(step.value).toBe(-1);
    }
    expect(result.status).toBe('fail');
  });

  it('gestisce errore execSync con stderr (es. tsc su stderr)', () => {
    mockExecSync
      .mockReturnValueOnce(JSON.stringify([{ errorCount: 0, warningCount: 0 }]))
      .mockImplementationOnce(() => {
        const err = new Error('tsc failed') as Error & { stderr?: string };
        err.stderr = 'src/file.ts:5:3 - error TS2554: Wrong args\nFound 1 error.';
        throw err;
      })
      .mockReturnValueOnce('Tests: 42 passed (42 total)')
      .mockReturnValueOnce(coverageOutput(85.71))
      .mockReturnValueOnce('found 0 vulnerabilities');

    const result = runQualityGate(PROJECT_PATH);

    expect(result.steps[1].status).toBe('fail');
    expect(result.steps[1].value).toBeGreaterThanOrEqual(0);
  });

  // ── Soglia custom: maxTsErrors ───────────────────────────────────────

  it('applica soglia custom maxTsErrors', () => {
    mockExecSync
      .mockReturnValueOnce(JSON.stringify([{ errorCount: 0, warningCount: 0 }]))
      .mockImplementationOnce(throwingExecSync(
        'src/file.ts:1:1 - error TS2322: Type mismatch\nsrc/file2.ts:3:5 - error TS2554: Wrong args'
      ))
      .mockReturnValueOnce('Tests: 42 passed (42 total)')
      .mockReturnValueOnce(coverageOutput(85.71))
      .mockReturnValueOnce('found 0 vulnerabilities');

    // Con maxTsErrors = 3, 2 errori passano
    const result = runQualityGate(PROJECT_PATH, { maxTsErrors: 3 });

    expect(result.status).toBe('pass');
    expect(result.steps[1].status).toBe('pass');
    expect(result.steps[1].value).toBe(2);
  });

  // ── Step names ───────────────────────────────────────────────────────

  it('contiene i nomi corretti per ogni step', () => {
    mockExecSync
      .mockReturnValueOnce(JSON.stringify([{ errorCount: 0, warningCount: 0 }]))
      .mockReturnValueOnce('No errors found')
      .mockReturnValueOnce('Tests: 42 passed (42 total)')
      .mockReturnValueOnce(coverageOutput(85.71))
      .mockReturnValueOnce('found 0 vulnerabilities');

    const result = runQualityGate(PROJECT_PATH);

    const stepNames = result.steps.map((s) => s.name);
    expect(stepNames).toEqual(['lint', 'tsc', 'test', 'coverage', 'audit']);
  });

  // ── Coverage da summary ──────────────────────────────────────────────

  it('estrae coverage dal formato summary quando manca tabella All files', () => {
    mockExecSync
      .mockReturnValueOnce(JSON.stringify([{ errorCount: 0, warningCount: 0 }]))
      .mockReturnValueOnce('No errors found')
      .mockReturnValueOnce('Tests: 42 passed (42 total)')
      .mockReturnValueOnce('Coverage summary:\nStatements   : 92.5% ( 24/26 )\nLines        : 90.0% ( 18/20 )')
      .mockReturnValueOnce('found 0 vulnerabilities');

    const result = runQualityGate(PROJECT_PATH);

    expect(result.steps[3].status).toBe('pass');
    expect(result.steps[3].value).toBe(92.5);
  });

  it('fallisce quando coverage non può essere estratto', () => {
    mockExecSync
      .mockReturnValueOnce(JSON.stringify([{ errorCount: 0, warningCount: 0 }]))
      .mockReturnValueOnce('No errors found')
      .mockReturnValueOnce('Tests: 42 passed (42 total)')
      .mockReturnValueOnce('No coverage data available')
      .mockReturnValueOnce('found 0 vulnerabilities');

    const result = runQualityGate(PROJECT_PATH);

    expect(result.steps[3].status).toBe('fail');
    expect(result.steps[3].value).toBe(-1);
  });
});
