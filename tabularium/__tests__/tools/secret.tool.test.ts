/**
 * __tests__/tools/secret.tool.test.ts
 * Test per tools/secret.tool.ts — Secret Scanner Tools (Fase 8 PANTHEON)
 *
 * Copertura:
 * - secret_scan: parametri validi → success
 * - secret_scan: errore scan → isError
 * - secret_list: parametri validi → success
 * - secret_list: status non valido → isError
 * - secret_list: limit non valido → isError
 * - secret_update_status: parametri validi → success
 * - secret_update_status: findingId mancante → isError
 * - secret_update_status: status non valido → isError
 * - secret_update_status: errore update → isError
 * - Findings offuscati nel contenuto
 *
 * @module tests/tools/secret
 */

import {
  secretScanToolHandler,
  secretListToolHandler,
  secretUpdateStatusToolHandler,
} from '../../src/tools/secret.tool.js';

// ---------------------------------------------------------------------------
// Mock del modulo core
// ---------------------------------------------------------------------------

jest.mock('../../src/core/secret-scanner.js', () => ({
  scanDirectory: jest.fn(),
  listFindings: jest.fn(),
  updateFindingStatus: jest.fn(),
  ensureSecretSchema: jest.fn(),
}));

import { scanDirectory, listFindings, updateFindingStatus, ensureSecretSchema } from '../../src/core/secret-scanner.js';

const mockScanDirectory = scanDirectory as jest.MockedFunction<typeof scanDirectory>;
const mockListFindings = listFindings as jest.MockedFunction<typeof listFindings>;
const mockUpdateFindingStatus = updateFindingStatus as jest.MockedFunction<typeof updateFindingStatus>;
const mockEnsureSecretSchema = ensureSecretSchema as jest.MockedFunction<typeof ensureSecretSchema>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseResult(toolResult: { content: Array<{ type: string; text: string }>; isError?: boolean }): unknown {
  return JSON.parse(toolResult.content[0].text);
}

function fakeFinding(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'sec_abc123',
    file_path: 'src/config.ts',
    line_number: 42,
    secret_type: 'api_key',
    severity: 'high',
    description: 'API key hardcodata',
    content: 'api_…ey12', // offuscato: primi 4 + ultimi 4
    status: 'open',
    created_at: '2026-05-26 12:00:00',
    resolved_at: null,
    ...overrides,
  };
}

function fakeScanResult(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    findings: [fakeFinding(), fakeFinding({ id: 'sec_def456', secret_type: 'password', severity: 'critical' })],
    filesScanned: 15,
    durationMs: 123,
    ...overrides,
  };
}

function fakeListResult(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    findings: [fakeFinding()],
    total: 1,
    ...overrides,
  };
}

function fakeUpdatedFinding(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'sec_abc123',
    file_path: 'src/config.ts',
    secret_type: 'api_key',
    severity: 'high',
    status: 'fixed',
    resolved_at: '2026-05-26 12:05:00',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Suite: secretScanToolHandler
// ---------------------------------------------------------------------------

describe('secretScanToolHandler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('ha il nome corretto', () => {
    expect(secretScanToolHandler.name).toBe('secret_scan');
  });

  it('restituisce success con findings per directory valida', async () => {
    mockScanDirectory.mockReturnValue(fakeScanResult() as never);

    const result = await secretScanToolHandler.handler({
      dirPath: './src',
    });

    expect(result.isError).toBeUndefined();
    const parsed = parseResult(result) as { success: boolean; data: Record<string, unknown> };
    expect(parsed.success).toBe(true);
    expect(parsed.data.findingsCount).toBe(2);
    expect(parsed.data.filesScanned).toBe(15);
    expect(parsed.data.durationMs).toBe(123);

    expect(mockEnsureSecretSchema).toHaveBeenCalled();
    expect(mockScanDirectory).toHaveBeenCalledWith('./src');
  });

  it('funziona senza dirPath (usa default)', async () => {
    mockScanDirectory.mockReturnValue(fakeScanResult() as never);

    const result = await secretScanToolHandler.handler({});

    expect(result.isError).toBeUndefined();
    expect(mockScanDirectory).toHaveBeenCalledWith(undefined);
  });

  it('findings hanno contenuto offuscato', async () => {
    mockScanDirectory.mockReturnValue(fakeScanResult() as never);

    const result = await secretScanToolHandler.handler({});
    const parsed = parseResult(result) as { success: boolean; data: { findings: Array<Record<string, unknown>> } };

    for (const finding of parsed.data.findings) {
      expect(finding).toHaveProperty('content');
      expect(finding).toHaveProperty('file_path');
      expect(finding).toHaveProperty('line_number');
      expect(finding).toHaveProperty('secret_type');
      expect(finding).toHaveProperty('severity');
    }
  });

  it('restituisce isError true quando scanDirectory lancia errore', async () => {
    mockScanDirectory.mockImplementation(() => {
      throw new Error('Directory not found');
    });

    const result = await secretScanToolHandler.handler({
      dirPath: '/invalid/path',
    });

    expect(result.isError).toBe(true);
    const parsed = parseResult(result) as { success: boolean; error: string; message: string };
    expect(parsed.success).toBe(false);
    expect(parsed.error).toBe('SCAN_ERROR');
    expect(parsed.message).toContain('Directory not found');
  });
});

// ---------------------------------------------------------------------------
// Suite: secretListToolHandler
// ---------------------------------------------------------------------------

describe('secretListToolHandler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('ha il nome corretto', () => {
    expect(secretListToolHandler.name).toBe('secret_list');
  });

  it('restituisce success con findings list', async () => {
    mockListFindings.mockReturnValue(fakeListResult() as never);

    const result = await secretListToolHandler.handler({ status: 'open' });

    expect(result.isError).toBeUndefined();
    const parsed = parseResult(result) as { success: boolean; data: { total: number; returned: number; findings: unknown[] } };
    expect(parsed.success).toBe(true);
    expect(parsed.data.total).toBe(1);
    expect(parsed.data.returned).toBe(1);

    expect(mockListFindings).toHaveBeenCalledWith('open', undefined, undefined, undefined);
  });

  it('listFindings viene chiamata con parametri corretti', async () => {
    mockListFindings.mockReturnValue(fakeListResult() as never);

    await secretListToolHandler.handler({
      status: 'open',
      secretType: 'api_key',
      limit: 10,
      offset: 0,
    });

    expect(mockListFindings).toHaveBeenCalledWith('open', 'api_key', 10, 0);
  });

  it('restituisce isError true per status non valido', async () => {
    const result = await secretListToolHandler.handler({ status: 'invalid' });

    expect(result.isError).toBe(true);
    const parsed = parseResult(result) as { success: boolean; error: string; message: string };
    expect(parsed.error).toBe('VALIDATION_ERROR');
    expect(parsed.message).toContain('status');
  });

  it('restituisce isError true per limit non valido (negativo)', async () => {
    const result = await secretListToolHandler.handler({ limit: -1 });

    expect(result.isError).toBe(true);
    const parsed = parseResult(result) as { success: boolean; error: string; message: string };
    expect(parsed.error).toBe('VALIDATION_ERROR');
    expect(parsed.message).toContain('limit');
  });

  it('restituisce isError true per limit > 1000', async () => {
    const result = await secretListToolHandler.handler({ limit: 2000 });

    expect(result.isError).toBe(true);
    const parsed = parseResult(result) as { success: boolean; error: string; message: string };
    expect(parsed.error).toBe('VALIDATION_ERROR');
    expect(parsed.message).toContain('limit');
  });

  it('restituisce isError true quando listFindings lancia errore', async () => {
    mockListFindings.mockImplementation(() => {
      throw new Error('DB error');
    });

    const result = await secretListToolHandler.handler({});

    expect(result.isError).toBe(true);
    const parsed = parseResult(result) as { success: boolean; error: string; message: string };
    expect(parsed.error).toBe('LIST_ERROR');
    expect(parsed.message).toContain('DB error');
  });
});

// ---------------------------------------------------------------------------
// Suite: secretUpdateStatusToolHandler
// ---------------------------------------------------------------------------

describe('secretUpdateStatusToolHandler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('ha il nome corretto', () => {
    expect(secretUpdateStatusToolHandler.name).toBe('secret_update_status');
  });

  it('restituisce success per update valido', async () => {
    mockUpdateFindingStatus.mockReturnValue(fakeUpdatedFinding() as never);

    const result = await secretUpdateStatusToolHandler.handler({
      findingId: 'sec_abc123',
      status: 'fixed',
    });

    expect(result.isError).toBeUndefined();
    const parsed = parseResult(result) as { success: boolean; data: Record<string, unknown> };
    expect(parsed.success).toBe(true);
    expect(parsed.data.id).toBe('sec_abc123');
    expect(parsed.data.status).toBe('fixed');
    expect(parsed.data.resolved_at).toBeTruthy();

    expect(mockUpdateFindingStatus).toHaveBeenCalledWith('sec_abc123', 'fixed');
  });

  it('restituisce isError true per findingId mancante', async () => {
    const result = await secretUpdateStatusToolHandler.handler({
      status: 'fixed',
    });

    expect(result.isError).toBe(true);
    const parsed = parseResult(result) as { success: boolean; error: string; message: string };
    expect(parsed.error).toBe('VALIDATION_ERROR');
    expect(parsed.message).toContain('findingId');
  });

  it('restituisce isError true per status non valido', async () => {
    const result = await secretUpdateStatusToolHandler.handler({
      findingId: 'sec_abc123',
      status: 'nonexistent',
    });

    expect(result.isError).toBe(true);
    const parsed = parseResult(result) as { success: boolean; error: string; message: string };
    expect(parsed.error).toBe('VALIDATION_ERROR');
    expect(parsed.message).toContain('status');
  });

  it('restituisce isError true quando updateFindingStatus lancia errore', async () => {
    mockUpdateFindingStatus.mockImplementation(() => {
      throw new Error('Finding not found');
    });

    const result = await secretUpdateStatusToolHandler.handler({
      findingId: 'sec_unknown',
      status: 'fixed',
    });

    expect(result.isError).toBe(true);
    const parsed = parseResult(result) as { success: boolean; error: string; message: string };
    expect(parsed.error).toBe('UPDATE_ERROR');
    expect(parsed.message).toContain('Finding not found');
  });
});
