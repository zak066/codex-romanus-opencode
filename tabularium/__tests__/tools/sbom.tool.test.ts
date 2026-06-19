/**
 * __tests__/tools/sbom.tool.test.ts
 * Test per tools/sbom.tool.ts — SBOM Tracker Tools (Fase 8 PANTHEON)
 *
 * Copertura:
 * - sbom_capture: parametri validi → success con snapshot
 * - sbom_capture: errore capture → isError
 * - sbom_list: parametri validi → success
 * - sbom_list: limit non valido → isError
 * - sbom_diff: parametri validi → success con diff
 * - sbom_diff: snapshotId1 mancante → isError
 * - sbom_diff: snapshotId2 mancante → isError
 * - sbom_diff: errore diff → isError
 *
 * @module tests/tools/sbom
 */

import {
  sbomCaptureToolHandler,
  sbomListToolHandler,
  sbomDiffToolHandler,
} from '../../src/tools/sbom.tool.js';

// ---------------------------------------------------------------------------
// Mock del modulo core
// ---------------------------------------------------------------------------

jest.mock('../../src/core/sbom-tracker.js', () => ({
  captureSnapshot: jest.fn(),
  listSnapshots: jest.fn(),
  diffSnapshots: jest.fn(),
}));

import { captureSnapshot, listSnapshots, diffSnapshots } from '../../src/core/sbom-tracker.js';

const mockCaptureSnapshot = captureSnapshot as jest.MockedFunction<typeof captureSnapshot>;
const mockListSnapshots = listSnapshots as jest.MockedFunction<typeof listSnapshots>;
const mockDiffSnapshots = diffSnapshots as jest.MockedFunction<typeof diffSnapshots>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseResult(toolResult: { content: Array<{ type: string; text: string }>; isError?: boolean }): unknown {
  return JSON.parse(toolResult.content[0].text);
}

function fakeSnapshot(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'sbom_uuid_test',
    dependencies: [
      { name: 'express', version: '4.18.2', license: 'MIT' },
      { name: 'lodash', version: '4.17.21', license: 'MIT' },
      { name: 'typescript', version: '5.3.0', license: 'Apache-2.0' },
    ],
    totalCount: 3,
    generatedAt: '2026-05-26T12:00:00.000Z',
    ...overrides,
  };
}

function fakeDiffResult(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    added: [{ name: 'react', version: '18.2.0', license: 'MIT' }],
    removed: [{ name: 'lodash', version: '4.17.21', license: 'MIT' }],
    changed: [{ name: 'express', from: '4.18.1', to: '4.18.2' }],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Suite: sbomCaptureToolHandler
// ---------------------------------------------------------------------------

describe('sbomCaptureToolHandler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('ha il nome corretto', () => {
    expect(sbomCaptureToolHandler.name).toBe('sbom_capture');
  });

  it('restituisce success con snapshot per progetto valido', async () => {
    mockCaptureSnapshot.mockReturnValue(fakeSnapshot() as never);

    const result = await sbomCaptureToolHandler.handler({
      projectPath: '/path/to/project',
    });

    expect(result.isError).toBeUndefined();
    const parsed = parseResult(result) as { success: boolean; data: Record<string, unknown> };
    expect(parsed.success).toBe(true);
    expect(parsed.data.id).toBe('sbom_uuid_test');
    expect(parsed.data.totalCount).toBe(3);
    expect(parsed.data.dependencies).toHaveLength(3);
    expect(parsed.data).toHaveProperty('generatedAt');

    expect(mockCaptureSnapshot).toHaveBeenCalledWith('/path/to/project');
  });

  it('funziona senza projectPath (usa default)', async () => {
    mockCaptureSnapshot.mockReturnValue(fakeSnapshot() as never);

    const result = await sbomCaptureToolHandler.handler({});

    expect(result.isError).toBeUndefined();
    expect(mockCaptureSnapshot).toHaveBeenCalledWith(undefined);
  });

  it('restituisce isError true quando captureSnapshot lancia errore', async () => {
    mockCaptureSnapshot.mockImplementation(() => {
      throw new Error('package.json not found');
    });

    const result = await sbomCaptureToolHandler.handler({
      projectPath: '/invalid',
    });

    expect(result.isError).toBe(true);
    const parsed = parseResult(result) as { success: boolean; error: string; message: string };
    expect(parsed.success).toBe(false);
    expect(parsed.error).toBe('CAPTURE_ERROR');
    expect(parsed.message).toContain('package.json not found');
  });
});

// ---------------------------------------------------------------------------
// Suite: sbomListToolHandler
// ---------------------------------------------------------------------------

describe('sbomListToolHandler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('ha il nome corretto', () => {
    expect(sbomListToolHandler.name).toBe('sbom_list');
  });

  it('restituisce success con lista snapshot', async () => {
    mockListSnapshots.mockReturnValue([
      fakeSnapshot(),
      fakeSnapshot({ id: 'sbom_uuid_2' }),
    ] as never);

    const result = await sbomListToolHandler.handler({ limit: 10 });

    expect(result.isError).toBeUndefined();
    const parsed = parseResult(result) as { success: boolean; data: { total: number; snapshots: unknown[] } };
    expect(parsed.success).toBe(true);
    expect(parsed.data.total).toBe(2);
    expect(parsed.data.snapshots).toHaveLength(2);

    expect(mockListSnapshots).toHaveBeenCalledWith(10);
  });

  it('funziona senza limit (usa default)', async () => {
    mockListSnapshots.mockReturnValue([] as never);

    const result = await sbomListToolHandler.handler({});

    expect(result.isError).toBeUndefined();
    expect(mockListSnapshots).toHaveBeenCalledWith(undefined);
  });

  it('restituisce isError true per limit non valido (negativo)', async () => {
    const result = await sbomListToolHandler.handler({ limit: 0 });

    expect(result.isError).toBe(true);
    const parsed = parseResult(result) as { success: boolean; error: string; message: string };
    expect(parsed.error).toBe('VALIDATION_ERROR');
    expect(parsed.message).toContain('limit');
  });

  it('restituisce isError true per limit > 100', async () => {
    const result = await sbomListToolHandler.handler({ limit: 200 });

    expect(result.isError).toBe(true);
    const parsed = parseResult(result) as { success: boolean; error: string; message: string };
    expect(parsed.error).toBe('VALIDATION_ERROR');
    expect(parsed.message).toContain('limit');
  });

  it('restituisce isError true quando listSnapshots lancia errore', async () => {
    mockListSnapshots.mockImplementation(() => {
      throw new Error('Memory error');
    });

    const result = await sbomListToolHandler.handler({});

    expect(result.isError).toBe(true);
    const parsed = parseResult(result) as { success: boolean; error: string; message: string };
    expect(parsed.error).toBe('LIST_ERROR');
    expect(parsed.message).toContain('Memory error');
  });
});

// ---------------------------------------------------------------------------
// Suite: sbomDiffToolHandler
// ---------------------------------------------------------------------------

describe('sbomDiffToolHandler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('ha il nome corretto', () => {
    expect(sbomDiffToolHandler.name).toBe('sbom_diff');
  });

  it('restituisce success con diff tra due snapshot', async () => {
    mockDiffSnapshots.mockReturnValue(fakeDiffResult() as never);

    const result = await sbomDiffToolHandler.handler({
      snapshotId1: 'sbom_uuid_old',
      snapshotId2: 'sbom_uuid_new',
    });

    expect(result.isError).toBeUndefined();
    const parsed = parseResult(result) as { success: boolean; data: { summary: { added: number; removed: number; changed: number } } };
    expect(parsed.success).toBe(true);
    expect(parsed.data.summary.added).toBe(1);
    expect(parsed.data.summary.removed).toBe(1);
    expect(parsed.data.summary.changed).toBe(1);
    expect(parsed.data).toHaveProperty('added');
    expect(parsed.data).toHaveProperty('removed');
    expect(parsed.data).toHaveProperty('changed');

    expect(mockDiffSnapshots).toHaveBeenCalledWith('sbom_uuid_old', 'sbom_uuid_new');
  });

  it('restituisce isError true per snapshotId1 mancante', async () => {
    const result = await sbomDiffToolHandler.handler({
      snapshotId2: 'sbom_uuid_new',
    });

    expect(result.isError).toBe(true);
    const parsed = parseResult(result) as { success: boolean; error: string; message: string };
    expect(parsed.error).toBe('VALIDATION_ERROR');
    expect(parsed.message).toContain('snapshotId1');
  });

  it('restituisce isError true per snapshotId2 mancante', async () => {
    const result = await sbomDiffToolHandler.handler({
      snapshotId1: 'sbom_uuid_old',
    });

    expect(result.isError).toBe(true);
    const parsed = parseResult(result) as { success: boolean; error: string; message: string };
    expect(parsed.error).toBe('VALIDATION_ERROR');
    expect(parsed.message).toContain('snapshotId2');
  });

  it('restituisce isError true quando diffSnapshots lancia errore', async () => {
    mockDiffSnapshots.mockImplementation(() => {
      throw new Error('Snapshot not found');
    });

    const result = await sbomDiffToolHandler.handler({
      snapshotId1: 'sbom_unknown',
      snapshotId2: 'sbom_unknown2',
    });

    expect(result.isError).toBe(true);
    const parsed = parseResult(result) as { success: boolean; error: string; message: string };
    expect(parsed.error).toBe('DIFF_ERROR');
    expect(parsed.message).toContain('Snapshot not found');
  });
});
