/**
 * Test per tools/journal.tool.ts — File Change Journal Tools (Fase 7 FABRICA)
 *
 * Copertura:
 * - journal_log: parametri mancanti → isError true
 * - journal_log: parametri validi → success true
 * - journal_log: error da logChange → isError true
 * - journal_query: parametri validi → success true
 * - journal_query: parametri non validi → isError true
 *
 * @module tests/tools/journal-tool
 */

import { journalLogToolHandler, journalQueryToolHandler } from '../../src/tools/journal.tool.js';

// ---------------------------------------------------------------------------
// Mock dei moduli core
// ---------------------------------------------------------------------------

jest.mock('../../src/core/file-journal.js', () => ({
  logChange: jest.fn(),
  queryChanges: jest.fn(),
  getChangesByFile: jest.fn(),
  getRecentChanges: jest.fn(),
  ensureFileJournalSchema: jest.fn(),
}));

import { logChange, queryChanges, ensureFileJournalSchema } from '../../src/core/file-journal.js';

const mockLogChange = logChange as jest.MockedFunction<typeof logChange>;
const mockQueryChanges = queryChanges as jest.MockedFunction<typeof queryChanges>;
const mockEnsureSchema = ensureFileJournalSchema as jest.MockedFunction<typeof ensureFileJournalSchema>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseResult(toolResult: { content: Array<{ type: string; text: string }>; isError?: boolean }): unknown {
  return JSON.parse(toolResult.content[0].text);
}

function fakeJournalRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'fc_test_001',
    file_path: 'src/core/test.ts',
    agent: 'diana-tester',
    change_type: 'modified',
    summary: 'Updated test file',
    created_at: '2026-05-26T10:00:00.000Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Suite: journalLogToolHandler
// ---------------------------------------------------------------------------

describe('journalLogToolHandler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('restituisce isError true quando file_path manca', async () => {
    const result = await journalLogToolHandler.handler({
      agent: 'diana',
      change_type: 'modified',
      summary: 'Test',
    });

    expect(result.isError).toBe(true);
    const parsed = parseResult(result) as { success: boolean; error: string; message: string };
    expect(parsed.error).toBe('VALIDATION_ERROR');
    expect(parsed.message).toContain('file_path');
  });

  it('restituisce isError true quando agent manca', async () => {
    const result = await journalLogToolHandler.handler({
      file_path: 'src/test.ts',
      change_type: 'modified',
      summary: 'Test',
    });

    expect(result.isError).toBe(true);
    const parsed = parseResult(result) as { success: boolean; error: string; message: string };
    expect(parsed.error).toBe('VALIDATION_ERROR');
    expect(parsed.message).toContain('agent');
  });

  it('restituisce isError true quando change_type non valido', async () => {
    const result = await journalLogToolHandler.handler({
      file_path: 'src/test.ts',
      agent: 'diana',
      change_type: 'invalid_type',
      summary: 'Test',
    });

    expect(result.isError).toBe(true);
    const parsed = parseResult(result) as { success: boolean; error: string; message: string };
    expect(parsed.error).toBe('VALIDATION_ERROR');
    expect(parsed.message).toContain('change_type');
  });

  it('restituisce isError true quando summary manca', async () => {
    const result = await journalLogToolHandler.handler({
      file_path: 'src/test.ts',
      agent: 'diana',
      change_type: 'modified',
    });

    expect(result.isError).toBe(true);
    const parsed = parseResult(result) as { success: boolean; error: string; message: string };
    expect(parsed.error).toBe('VALIDATION_ERROR');
    expect(parsed.message).toContain('summary');
  });

  it('restituisce isError true quando tutti i parametri mancano', async () => {
    const result = await journalLogToolHandler.handler({});

    expect(result.isError).toBe(true);
    const parsed = parseResult(result) as { success: boolean; error: string };
    expect(parsed.success).toBe(false);
    expect(parsed.error).toBe('VALIDATION_ERROR');
  });

  it('restituisce success true con parametri validi', async () => {
    mockLogChange.mockReturnValue(fakeJournalRecord() as never);

    const result = await journalLogToolHandler.handler({
      file_path: 'src/core/test.ts',
      agent: 'diana-tester',
      change_type: 'modified',
      summary: 'Updated test file',
    });

    expect(result.isError).toBeUndefined();
    const parsed = parseResult(result) as { success: boolean; data: Record<string, unknown> };
    expect(parsed.success).toBe(true);
    expect(parsed.data.id).toBe('fc_test_001');
    expect(parsed.data.change_type).toBe('modified');

    expect(mockLogChange).toHaveBeenCalledWith({
      file_path: 'src/core/test.ts',
      agent: 'diana-tester',
      change_type: 'modified',
      summary: 'Updated test file',
      session_id: undefined,
      task_id: undefined,
      diff: undefined,
    });
  });

  it('accetta parametri opzionali (session_id, task_id, diff)', async () => {
    mockLogChange.mockReturnValue(fakeJournalRecord() as never);

    await journalLogToolHandler.handler({
      file_path: 'src/test.ts',
      agent: 'diana',
      change_type: 'created',
      summary: 'Created file',
      session_id: 'sess_001',
      task_id: 'task_001',
      diff: '+ some code',
    });

    expect(mockLogChange).toHaveBeenCalledWith({
      file_path: 'src/test.ts',
      agent: 'diana',
      change_type: 'created',
      summary: 'Created file',
      session_id: 'sess_001',
      task_id: 'task_001',
      diff: '+ some code',
    });
  });

  it('chiama ensureFileJournalSchema', async () => {
    mockLogChange.mockReturnValue(fakeJournalRecord() as never);

    await journalLogToolHandler.handler({
      file_path: 'src/test.ts',
      agent: 'diana',
      change_type: 'modified',
      summary: 'Test',
    });

    expect(mockEnsureSchema).toHaveBeenCalled();
  });

  it('restituisce isError true quando logChange lancia errore', async () => {
    mockLogChange.mockImplementation(() => {
      throw new Error('Database error');
    });

    const result = await journalLogToolHandler.handler({
      file_path: 'src/test.ts',
      agent: 'diana',
      change_type: 'modified',
      summary: 'Test',
    });

    expect(result.isError).toBe(true);
    const parsed = parseResult(result) as { success: boolean; error: string; message: string };
    expect(parsed.success).toBe(false);
    expect(parsed.error).toBe('LOG_ERROR');
    expect(parsed.message).toContain('Database error');
  });
});

// ---------------------------------------------------------------------------
// Suite: journalQueryToolHandler
// ---------------------------------------------------------------------------

describe('journalQueryToolHandler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('restituisce success true con parametri validi (nessun filtro)', async () => {
    mockQueryChanges.mockReturnValue({
      total: 3,
      changes: [
        fakeJournalRecord({ id: 'fc_001' }),
        fakeJournalRecord({ id: 'fc_002' }),
        fakeJournalRecord({ id: 'fc_003' }),
      ],
    } as never);

    const result = await journalQueryToolHandler.handler({});

    expect(result.isError).toBeUndefined();
    const parsed = parseResult(result) as { success: boolean; data: { total: number; returned: number; changes: unknown[] } };
    expect(parsed.success).toBe(true);
    expect(parsed.data.total).toBe(3);
    expect(parsed.data.returned).toBe(3);

    expect(mockQueryChanges).toHaveBeenCalledWith({
      file_path: undefined,
      agent: undefined,
      task_id: undefined,
      change_type: undefined,
      limit: undefined,
      offset: undefined,
    });
  });

  it('restituisce success true con filtri', async () => {
    mockQueryChanges.mockReturnValue({
      total: 1,
      changes: [fakeJournalRecord({ id: 'fc_001', file_path: 'src/auth.ts' })],
    } as never);

    const result = await journalQueryToolHandler.handler({
      file_path: 'src/auth.ts',
      agent: 'vulcanus',
      limit: 10,
    });

    expect(result.isError).toBeUndefined();
    const parsed = parseResult(result) as { success: boolean; data: { total: number } };
    expect(parsed.success).toBe(true);

    expect(mockQueryChanges).toHaveBeenCalledWith({
      file_path: 'src/auth.ts',
      agent: 'vulcanus',
      task_id: undefined,
      change_type: undefined,
      limit: 10,
      offset: undefined,
    });
  });

  it('restituisce isError true quando change_type non valido', async () => {
    const result = await journalQueryToolHandler.handler({ change_type: 'bad_type' });

    expect(result.isError).toBe(true);
    const parsed = parseResult(result) as { success: boolean; error: string; message: string };
    expect(parsed.error).toBe('VALIDATION_ERROR');
    expect(parsed.message).toContain('change_type');
  });

  it('restituisce isError true quando limit non valido', async () => {
    const result = await journalQueryToolHandler.handler({ limit: -5 });

    expect(result.isError).toBe(true);
    const parsed = parseResult(result) as { success: boolean; error: string; message: string };
    expect(parsed.error).toBe('VALIDATION_ERROR');
    expect(parsed.message).toContain('limit');
  });

  it('restituisce isError true quando limit > 1000', async () => {
    const result = await journalQueryToolHandler.handler({ limit: 5000 });

    expect(result.isError).toBe(true);
    const parsed = parseResult(result) as { success: boolean; error: string; message: string };
    expect(parsed.error).toBe('VALIDATION_ERROR');
    expect(parsed.message).toContain('limit');
  });

  it('restituisce isError true quando queryChanges lancia errore', async () => {
    mockQueryChanges.mockImplementation(() => {
      throw new Error('Query failed');
    });

    const result = await journalQueryToolHandler.handler({});

    expect(result.isError).toBe(true);
    const parsed = parseResult(result) as { success: boolean; error: string; message: string };
    expect(parsed.error).toBe('QUERY_ERROR');
    expect(parsed.message).toContain('Query failed');
  });
});
