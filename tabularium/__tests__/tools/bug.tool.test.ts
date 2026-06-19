/**
 * Test per tools/bug.tool.ts — Bug Tracking Tools (Fase 7 FABRICA)
 *
 * Copertura:
 * - bug_report: parametri mancanti → isError true
 * - bug_report: parametri validi → success true
 * - bug_report: error da reportBug → isError true
 * - bug_query: parametri validi → success true
 * - bug_query: parametri non validi → isError true
 * - bug_trend: parametri validi → success true
 * - bug_trend: parametri non validi → isError true
 *
 * @module tests/tools/bug-tool
 */

import { bugReportToolHandler, bugQueryToolHandler, bugTrendToolHandler } from '../../src/tools/bug.tool.js';

// ---------------------------------------------------------------------------
// Mock dei moduli core
// ---------------------------------------------------------------------------

jest.mock('../../src/core/bug-tracker.js', () => ({
  reportBug: jest.fn(),
  listBugs: jest.fn(),
  updateBugStatus: jest.fn(),
  getBugTrend: jest.fn(),
  ensureBugSchema: jest.fn(),
}));

import { reportBug, listBugs, getBugTrend, ensureBugSchema } from '../../src/core/bug-tracker.js';

const mockReportBug = reportBug as jest.MockedFunction<typeof reportBug>;
const mockListBugs = listBugs as jest.MockedFunction<typeof listBugs>;
const mockGetBugTrend = getBugTrend as jest.MockedFunction<typeof getBugTrend>;
const mockEnsureBugSchema = ensureBugSchema as jest.MockedFunction<typeof ensureBugSchema>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseResult(toolResult: { content: Array<{ type: string; text: string }>; isError?: boolean }): unknown {
  return JSON.parse(toolResult.content[0].text);
}

function fakeBugRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'bug_test_001',
    title: 'Test bug',
    description: 'Test description',
    component: 'auth',
    severity: 'major',
    status: 'open',
    root_cause_category: 'logic',
    reported_by: 'diana-tester',
    created_at: '2026-05-26T10:00:00.000Z',
    updated_at: '2026-05-26T10:00:00.000Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Suite: bugReportToolHandler
// ---------------------------------------------------------------------------

describe('bugReportToolHandler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('restituisce isError true quando title manca', async () => {
    const result = await bugReportToolHandler.handler({
      description: 'Test',
      component: 'auth',
      severity: 'major',
      reported_by: 'diana',
    });

    expect(result.isError).toBe(true);
    const parsed = parseResult(result) as { success: boolean; error: string; message: string };
    expect(parsed.error).toBe('VALIDATION_ERROR');
    expect(parsed.message).toContain('title');
  });

  it('restituisce isError true quando description manca', async () => {
    const result = await bugReportToolHandler.handler({
      title: 'Test',
      component: 'auth',
      severity: 'major',
      reported_by: 'diana',
    });

    expect(result.isError).toBe(true);
    const parsed = parseResult(result) as { success: boolean; error: string; message: string };
    expect(parsed.error).toBe('VALIDATION_ERROR');
    expect(parsed.message).toContain('description');
  });

  it('restituisce isError true quando component manca', async () => {
    const result = await bugReportToolHandler.handler({
      title: 'Test',
      description: 'Test',
      severity: 'major',
      reported_by: 'diana',
    });

    expect(result.isError).toBe(true);
    const parsed = parseResult(result) as { success: boolean; error: string; message: string };
    expect(parsed.error).toBe('VALIDATION_ERROR');
    expect(parsed.message).toContain('component');
  });

  it('restituisce isError true quando severity non valida', async () => {
    const result = await bugReportToolHandler.handler({
      title: 'Test',
      description: 'Test',
      component: 'auth',
      severity: 'super-critical',
      reported_by: 'diana',
    });

    expect(result.isError).toBe(true);
    const parsed = parseResult(result) as { success: boolean; error: string; message: string };
    expect(parsed.error).toBe('VALIDATION_ERROR');
    expect(parsed.message).toContain('severity');
  });

  it('restituisce isError true quando reported_by manca', async () => {
    const result = await bugReportToolHandler.handler({
      title: 'Test',
      description: 'Test',
      component: 'auth',
      severity: 'major',
    });

    expect(result.isError).toBe(true);
    const parsed = parseResult(result) as { success: boolean; error: string; message: string };
    expect(parsed.error).toBe('VALIDATION_ERROR');
    expect(parsed.message).toContain('reported_by');
  });

  it('restituisce isError true quando tutti i parametri mancano', async () => {
    const result = await bugReportToolHandler.handler({});

    expect(result.isError).toBe(true);
    const parsed = parseResult(result) as { success: boolean; error: string };
    expect(parsed.success).toBe(false);
    expect(parsed.error).toBe('VALIDATION_ERROR');
  });

  it('restituisce success true con parametri validi', async () => {
    mockReportBug.mockReturnValue(fakeBugRecord() as never);

    const result = await bugReportToolHandler.handler({
      title: 'Test bug',
      description: 'Test description',
      component: 'auth',
      severity: 'major',
      reported_by: 'diana-tester',
    });

    expect(result.isError).toBeUndefined();
    const parsed = parseResult(result) as { success: boolean; data: Record<string, unknown> };
    expect(parsed.success).toBe(true);
    expect(parsed.data.id).toBe('bug_test_001');
    expect(parsed.data.severity).toBe('major');
    expect(parsed.data.status).toBe('open');

    expect(mockReportBug).toHaveBeenCalledWith({
      title: 'Test bug',
      description: 'Test description',
      component: 'auth',
      severity: 'major',
      root_cause_category: undefined,
      affected_files: undefined,
      reported_by: 'diana-tester',
      assigned_to: undefined,
      tags: undefined,
    });
  });

  it('chiama ensureBugSchema', async () => {
    mockReportBug.mockReturnValue(fakeBugRecord() as never);

    await bugReportToolHandler.handler({
      title: 'Test',
      description: 'Test',
      component: 'auth',
      severity: 'minor',
      reported_by: 'diana',
    });

    expect(mockEnsureBugSchema).toHaveBeenCalled();
  });

  it('restituisce isError true quando reportBug lancia errore', async () => {
    mockReportBug.mockImplementation(() => {
      throw new Error('Database connection error');
    });

    const result = await bugReportToolHandler.handler({
      title: 'Test',
      description: 'Test',
      component: 'auth',
      severity: 'major',
      reported_by: 'diana',
    });

    expect(result.isError).toBe(true);
    const parsed = parseResult(result) as { success: boolean; error: string; message: string };
    expect(parsed.success).toBe(false);
    expect(parsed.error).toBe('REPORT_ERROR');
    expect(parsed.message).toContain('Database connection error');
  });
});

// ---------------------------------------------------------------------------
// Suite: bugQueryToolHandler
// ---------------------------------------------------------------------------

describe('bugQueryToolHandler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('restituisce success true con parametri validi', async () => {
    mockListBugs.mockReturnValue({
      total: 2,
      bugs: [fakeBugRecord({ id: 'bug_001' }), fakeBugRecord({ id: 'bug_002' })],
    } as never);

    const result = await bugQueryToolHandler.handler({ status: 'open' });

    expect(result.isError).toBeUndefined();
    const parsed = parseResult(result) as { success: boolean; data: { total: number; returned: number; bugs: unknown[] } };
    expect(parsed.success).toBe(true);
    expect(parsed.data.total).toBe(2);
    expect(parsed.data.returned).toBe(2);

    expect(mockListBugs).toHaveBeenCalledWith({
      status: 'open',
      severity: undefined,
      component: undefined,
      assigned_to: undefined,
      limit: undefined,
      offset: undefined,
    });
  });

  it('restituisce isError true quando status non valido', async () => {
    const result = await bugQueryToolHandler.handler({ status: 'invalid' });

    expect(result.isError).toBe(true);
    const parsed = parseResult(result) as { success: boolean; error: string; message: string };
    expect(parsed.error).toBe('VALIDATION_ERROR');
    expect(parsed.message).toContain('status');
  });

  it('restituisce isError true quando severity non valida', async () => {
    const result = await bugQueryToolHandler.handler({ severity: 'very_high' });

    expect(result.isError).toBe(true);
    const parsed = parseResult(result) as { success: boolean; error: string; message: string };
    expect(parsed.error).toBe('VALIDATION_ERROR');
    expect(parsed.message).toContain('severity');
  });

  it('restituisce isError true quando limit non valido', async () => {
    const result = await bugQueryToolHandler.handler({ limit: -1 });

    expect(result.isError).toBe(true);
    const parsed = parseResult(result) as { success: boolean; error: string; message: string };
    expect(parsed.error).toBe('VALIDATION_ERROR');
    expect(parsed.message).toContain('limit');
  });

  it('restituisce isError true quando limit > 1000', async () => {
    const result = await bugQueryToolHandler.handler({ limit: 2000 });

    expect(result.isError).toBe(true);
    const parsed = parseResult(result) as { success: boolean; error: string; message: string };
    expect(parsed.error).toBe('VALIDATION_ERROR');
    expect(parsed.message).toContain('limit');
  });

  it('restituisce isError true quando listBugs lancia errore', async () => {
    mockListBugs.mockImplementation(() => {
      throw new Error('DB error');
    });

    const result = await bugQueryToolHandler.handler({});

    expect(result.isError).toBe(true);
    const parsed = parseResult(result) as { success: boolean; error: string; message: string };
    expect(parsed.error).toBe('QUERY_ERROR');
    expect(parsed.message).toContain('DB error');
  });
});

// ---------------------------------------------------------------------------
// Suite: bugTrendToolHandler
// ---------------------------------------------------------------------------

describe('bugTrendToolHandler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('restituisce success true con parametri validi (default)', async () => {
    mockGetBugTrend.mockReturnValue({
      days: [],
      total_closed: 0,
      total_opened: 0,
      avg_per_day: 0,
      period_days: 30,
    } as never);

    const result = await bugTrendToolHandler.handler({});

    expect(result.isError).toBeUndefined();
    const parsed = parseResult(result) as { success: boolean; data: { period_days: number } };
    expect(parsed.success).toBe(true);
    expect(parsed.data.period_days).toBe(30);

    expect(mockGetBugTrend).toHaveBeenCalledWith(undefined, undefined);
  });

  it('restituisce success true con component e days', async () => {
    mockGetBugTrend.mockReturnValue({
      days: [],
      total_closed: 1,
      total_opened: 3,
      avg_per_day: 0.03,
      component: 'auth',
      period_days: 7,
    } as never);

    const result = await bugTrendToolHandler.handler({
      component: 'auth',
      days: 7,
    });

    expect(result.isError).toBeUndefined();
    const parsed = parseResult(result) as { success: boolean; data: Record<string, unknown> };
    expect(parsed.success).toBe(true);
    expect(parsed.data.component).toBe('auth');
    expect(parsed.data.period_days).toBe(7);

    expect(mockGetBugTrend).toHaveBeenCalledWith('auth', 7);
  });

  it('restituisce isError true quando days non valido', async () => {
    const result = await bugTrendToolHandler.handler({ days: 500 });

    expect(result.isError).toBe(true);
    const parsed = parseResult(result) as { success: boolean; error: string; message: string };
    expect(parsed.error).toBe('VALIDATION_ERROR');
    expect(parsed.message).toContain('days');
  });

  it('restituisce isError true quando getBugTrend lancia errore', async () => {
    mockGetBugTrend.mockImplementation(() => {
      throw new Error('Trend computation error');
    });

    const result = await bugTrendToolHandler.handler({});

    expect(result.isError).toBe(true);
    const parsed = parseResult(result) as { success: boolean; error: string; message: string };
    expect(parsed.error).toBe('TREND_ERROR');
    expect(parsed.message).toContain('Trend computation error');
  });
});
