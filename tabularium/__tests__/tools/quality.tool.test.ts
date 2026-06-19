/**
 * Test per tools/quality.tool.ts — Quality Monitoring Tools (Fase 6: AUTOMATA)
 *
 * Copertura:
 * - quality_gate_run con projectPath mancante → isError true
 * - quality_gate_run con parametri validi → success true, chiama runQualityGate
 * - quality_gate_run con error da runQualityGate → isError true
 * - regression_detect con baselineWindow=1 (<3) → isError true
 * - regression_detect con baselineWindow > 100 → isError true
 * - regression_detect con baselineWindow non intero → isError true
 * - regression_detect con deviationThreshold < 0.01 → isError true
 * - regression_detect con deviationThreshold > 2.0 → isError true
 * - regression_detect con domains=['invalid'] → isError true
 * - regression_detect con domains array vuoto → isError true
 * - regression_detect con parametri validi → success true
 * - regression_detect con error da detectRegressions → isError true
 *
 * @module tests/tools/quality-tool
 */

import { qualityGateRunToolHandler, regressionDetectToolHandler } from '../../src/tools/quality.tool.js';

// ---------------------------------------------------------------------------
// Mock dei moduli core
// ---------------------------------------------------------------------------

jest.mock('../../src/core/quality-gate.js', () => ({
  runQualityGate: jest.fn(),
}));

jest.mock('../../src/core/regression-detector.js', () => ({
  detectRegressions: jest.fn(),
}));

import { runQualityGate } from '../../src/core/quality-gate.js';
import { detectRegressions } from '../../src/core/regression-detector.js';

const mockRunQualityGate = runQualityGate as jest.MockedFunction<typeof runQualityGate>;
const mockDetectRegressions = detectRegressions as jest.MockedFunction<typeof detectRegressions>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Helper per parsare il ToolResult JSON string content in oggetto.
 */
function parseResult(toolResult: { content: Array<{ type: string; text: string }>; isError?: boolean }): unknown {
  return JSON.parse(toolResult.content[0].text);
}

// ---------------------------------------------------------------------------
// Suite: qualityGateRunToolHandler
// ---------------------------------------------------------------------------

describe('qualityGateRunToolHandler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('restituisce isError true quando projectPath mancante', async () => {
    const result = await qualityGateRunToolHandler.handler({});

    expect(result.isError).toBe(true);
    const parsed = parseResult(result) as { success: boolean; error: string; message: string };
    expect(parsed.success).toBe(false);
    expect(parsed.error).toBe('VALIDATION_ERROR');
    expect(parsed.message).toContain('projectPath is required');
  });

  it('restituisce isError true quando projectPath non è stringa', async () => {
    const result = await qualityGateRunToolHandler.handler({ projectPath: 123 });

    expect(result.isError).toBe(true);
    const parsed = parseResult(result) as { success: boolean; error: string; message: string };
    expect(parsed.success).toBe(false);
    expect(parsed.error).toBe('VALIDATION_ERROR');
    expect(parsed.message).toContain('projectPath is required');
  });

  it('restituisce success true con parametri validi e chiama runQualityGate', async () => {
    const mockResult = {
      status: 'pass' as const,
      steps: [
        { name: 'lint', status: 'pass' as const, durationMs: 100, output: '' },
        { name: 'tsc', status: 'pass' as const, durationMs: 200, output: '' },
        { name: 'test', status: 'pass' as const, durationMs: 300, output: '' },
        { name: 'coverage', status: 'pass' as const, durationMs: 400, output: '', value: 85 },
        { name: 'audit', status: 'pass' as const, durationMs: 500, output: '' },
      ],
      projectPath: '/fake/project',
      startedAt: '2026-05-26T10:00:00.000Z',
      completedAt: '2026-05-26T10:00:01.000Z',
      totalDurationMs: 1500,
    };
    mockRunQualityGate.mockReturnValue(mockResult);

    const args = {
      projectPath: '/fake/project',
      thresholds: { minCoverage: 80 },
    };
    const result = await qualityGateRunToolHandler.handler(args);

    expect(result.isError).toBeUndefined();
    const parsed = parseResult(result) as { success: boolean; data: unknown };
    expect(parsed.success).toBe(true);
    expect(parsed.data).toEqual(mockResult);

    // Verifica che runQualityGate sia stata chiamata con i parametri corretti
    expect(mockRunQualityGate).toHaveBeenCalledWith('/fake/project', { minCoverage: 80 });
  });

  it('restituisce success true anche senza thresholds', async () => {
    const mockResult = {
      status: 'pass' as const,
      steps: [],
      projectPath: '/fake/project',
      startedAt: '2026-05-26T10:00:00.000Z',
      completedAt: '2026-05-26T10:00:01.000Z',
      totalDurationMs: 0,
    };
    mockRunQualityGate.mockReturnValue(mockResult);

    const result = await qualityGateRunToolHandler.handler({ projectPath: '/fake/project' });

    expect(result.isError).toBeUndefined();
    const parsed = parseResult(result) as { success: boolean };
    expect(parsed.success).toBe(true);
    expect(mockRunQualityGate).toHaveBeenCalledWith('/fake/project', undefined);
  });

  it('restituisce isError true quando runQualityGate lancia errore', async () => {
    mockRunQualityGate.mockImplementation(() => {
      throw new Error('Progetto non trovato');
    });

    const result = await qualityGateRunToolHandler.handler({ projectPath: '/fake/missing' });

    expect(result.isError).toBe(true);
    const parsed = parseResult(result) as { success: boolean; error: string; message: string };
    expect(parsed.success).toBe(false);
    expect(parsed.error).toBe('QUALITY_GATE_ERROR');
    expect(parsed.message).toContain('Progetto non trovato');
  });
});

// ---------------------------------------------------------------------------
// Suite: regressionDetectToolHandler
// ---------------------------------------------------------------------------

describe('regressionDetectToolHandler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── Validazione parametri ─────────────────────────────────────────────

  it('restituisce isError true quando baselineWindow < 3', async () => {
    const result = await regressionDetectToolHandler.handler({ baselineWindow: 1 });

    expect(result.isError).toBe(true);
    const parsed = parseResult(result) as { success: boolean; error: string; message: string };
    expect(parsed.success).toBe(false);
    expect(parsed.error).toBe('VALIDATION_ERROR');
    expect(parsed.message).toContain('baselineWindow');
  });

  it('restituisce isError true quando baselineWindow > 100', async () => {
    const result = await regressionDetectToolHandler.handler({ baselineWindow: 101 });

    expect(result.isError).toBe(true);
    const parsed = parseResult(result) as { success: boolean; error: string; message: string };
    expect(parsed.error).toBe('VALIDATION_ERROR');
    expect(parsed.message).toContain('baselineWindow');
  });

  it('restituisce isError true quando baselineWindow non è intero', async () => {
    const result = await regressionDetectToolHandler.handler({ baselineWindow: 3.5 });

    expect(result.isError).toBe(true);
    const parsed = parseResult(result) as { success: boolean; error: string; message: string };
    expect(parsed.error).toBe('VALIDATION_ERROR');
    expect(parsed.message).toContain('baselineWindow');
  });

  it('restituisce isError true quando baselineWindow non è numero', async () => {
    const result = await regressionDetectToolHandler.handler({ baselineWindow: 'abc' });

    expect(result.isError).toBe(true);
    const parsed = parseResult(result) as { success: boolean; error: string; message: string };
    expect(parsed.error).toBe('VALIDATION_ERROR');
    expect(parsed.message).toContain('baselineWindow');
  });

  it('restituisce isError true quando deviationThreshold < 0.01', async () => {
    const result = await regressionDetectToolHandler.handler({ deviationThreshold: 0.001 });

    expect(result.isError).toBe(true);
    const parsed = parseResult(result) as { success: boolean; error: string; message: string };
    expect(parsed.error).toBe('VALIDATION_ERROR');
    expect(parsed.message).toContain('deviationThreshold');
  });

  it('restituisce isError true quando deviationThreshold > 2.0', async () => {
    const result = await regressionDetectToolHandler.handler({ deviationThreshold: 3.0 });

    expect(result.isError).toBe(true);
    const parsed = parseResult(result) as { success: boolean; error: string; message: string };
    expect(parsed.error).toBe('VALIDATION_ERROR');
    expect(parsed.message).toContain('deviationThreshold');
  });

  it('restituisce isError true quando deviationThreshold non è numero', async () => {
    const result = await regressionDetectToolHandler.handler({ deviationThreshold: 'xyz' });

    expect(result.isError).toBe(true);
    const parsed = parseResult(result) as { success: boolean; error: string; message: string };
    expect(parsed.error).toBe('VALIDATION_ERROR');
    expect(parsed.message).toContain('deviationThreshold');
  });

  it('restituisce isError true quando domains contiene domini non validi', async () => {
    const result = await regressionDetectToolHandler.handler({ domains: ['invalid'] });

    expect(result.isError).toBe(true);
    const parsed = parseResult(result) as { success: boolean; error: string; message: string };
    expect(parsed.success).toBe(false);
    expect(parsed.error).toBe('VALIDATION_ERROR');
    expect(parsed.message).toContain('Invalid domain');
  });

  it('restituisce isError true quando domains è array vuoto', async () => {
    const result = await regressionDetectToolHandler.handler({ domains: [] });

    expect(result.isError).toBe(true);
    const parsed = parseResult(result) as { success: boolean; error: string; message: string };
    expect(parsed.error).toBe('VALIDATION_ERROR');
    expect(parsed.message).toContain('domains');
  });

  it('restituisce isError true quando domains non è un array', async () => {
    const result = await regressionDetectToolHandler.handler({ domains: 'quality' });

    expect(result.isError).toBe(true);
    const parsed = parseResult(result) as { success: boolean; error: string; message: string };
    expect(parsed.error).toBe('VALIDATION_ERROR');
    expect(parsed.message).toContain('domains');
  });

  // ── Parametri validi ─────────────────────────────────────────────────

  it('restituisce success true con parametri validi e chiama detectRegressions', async () => {
    const mockResult = {
      totalMetrics: 5,
      alerts: [
        {
          id: 'alr_test',
          domain: 'quality',
          metricName: 'lint_errors',
          currentValue: 15,
          baselineAvg: 5,
          deviationPct: 200,
          direction: 'up' as const,
          severity: 'critical' as const,
          message: 'Lint errors increased 200%',
          detectedAt: '2026-05-26T10:00:00.000Z',
        },
      ],
      checkedDomains: ['quality'],
      durationMs: 42,
    };
    mockDetectRegressions.mockReturnValue(mockResult);

    const args = {
      baselineWindow: 10,
      deviationThreshold: 0.20,
      domains: ['quality', 'perf'],
    };
    const result = await regressionDetectToolHandler.handler(args);

    expect(result.isError).toBeUndefined();
    const parsed = parseResult(result) as { success: boolean; data: unknown };
    expect(parsed.success).toBe(true);
    expect(parsed.data).toEqual(mockResult);

    // Verifica parametri passati
    expect(mockDetectRegressions).toHaveBeenCalledWith({
      baselineWindow: 10,
      deviationThreshold: 0.20,
      domains: ['quality', 'perf'],
    });
  });

  it('restituisce success true con parametri minimi (solo baselineWindow)', async () => {
    mockDetectRegressions.mockReturnValue({
      totalMetrics: 0,
      alerts: [],
      checkedDomains: [],
      durationMs: 0,
    });

    const result = await regressionDetectToolHandler.handler({ baselineWindow: 5 });

    expect(result.isError).toBeUndefined();
    const parsed = parseResult(result) as { success: boolean };
    expect(parsed.success).toBe(true);
    expect(mockDetectRegressions).toHaveBeenCalledWith({
      baselineWindow: 5,
    });
  });

  it('converte domains in lowercase', async () => {
    mockDetectRegressions.mockReturnValue({
      totalMetrics: 0,
      alerts: [],
      checkedDomains: [],
      durationMs: 0,
    });

    const result = await regressionDetectToolHandler.handler({ domains: ['QUALITY', 'PERF'] });

    expect(result.isError).toBeUndefined();
    expect(mockDetectRegressions).toHaveBeenCalledWith({
      domains: ['quality', 'perf'],
    });
  });

  // ── Errore da detectRegressions ──────────────────────────────────────

  it('restituisce isError true quando detectRegressions lancia errore', async () => {
    mockDetectRegressions.mockImplementation(() => {
      throw new Error('Database connection failed');
    });

    const result = await regressionDetectToolHandler.handler({ baselineWindow: 10 });

    expect(result.isError).toBe(true);
    const parsed = parseResult(result) as { success: boolean; error: string; message: string };
    expect(parsed.success).toBe(false);
    expect(parsed.error).toBe('REGRESSION_DETECT_ERROR');
    expect(parsed.message).toContain('Database connection failed');
  });

  // ── Domini case-insensitive ──────────────────────────────────────────

  it('accetta domini in qualsiasi caso (case-insensitive)', async () => {
    mockDetectRegressions.mockReturnValue({
      totalMetrics: 0,
      alerts: [],
      checkedDomains: [],
      durationMs: 0,
    });

    const result = await regressionDetectToolHandler.handler({ domains: ['SECURITY', 'Test'] });

    expect(result.isError).toBeUndefined();
  });
});
