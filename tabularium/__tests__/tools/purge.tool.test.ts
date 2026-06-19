/**
 * __tests__/tools/purge.tool.test.ts
 * Test di integrazione per tools/purge.tool.ts — Memory Purge Tool (MCP² Phase 3).
 *
 * Copertura:
 * - IT1-IT10: casi di integrazione (dry-run, execute, validazione, output JSON)
 * - SG1-SG4: safe guard (default dryRun, default compactFirst, error handling, maintenance failure)
 *
 * @module tests/tools/purge-tool
 */

import { memoryPurgeToolHandler } from '../../src/tools/purge.tool.js';

// ---------------------------------------------------------------------------
// Mock dei moduli core
// ---------------------------------------------------------------------------
// NOTA: jest.mock factory NON puo' riferire variabili esterne (const/let)
// perche' Jest la hoista all'inizio del file (TDZ violation).
// Usiamo jest.requireMock() in beforeEach per accedere dinamicamente ai mock.

jest.mock('../../src/core/database.js', () => ({
  getDatabase: jest.fn(),
  getDbPath: jest.fn().mockReturnValue('/tmp/test.db'),
  initDatabase: jest.fn(),
  closeDatabase: jest.fn(),
  resetDatabase: jest.fn(),
}));

jest.mock('../../src/core/db-purge.js', () => ({
  countEventsOlderThan: jest.fn(),
  deleteEventsOlderThan: jest.fn(),
  deleteSessionsOlderThan: jest.fn(),
  deleteContextsOlderThan: jest.fn(),
  estimateRecoverableSpace: jest.fn(),
  getDatabaseSizeKb: jest.fn(),
  getNextPurgeId: jest.fn(),
  logPurgeRecord: jest.fn(),
}));

jest.mock('../../src/core/knowledge-manager.js', () => ({
  suggestKnowledge: jest.fn(),
}));

jest.mock('../../src/core/faq-manager.js', () => ({
  detectFaqCandidates: jest.fn(),
  generateFaqFromCandidate: jest.fn(),
}));

jest.mock('../../src/core/metrics-engine.js', () => ({
  storeMetric: jest.fn(),
}));

jest.mock('../../src/core/file-journal.js', () => ({
  logChange: jest.fn(),
}));

// Import mocked modules after jest.mock
import {
  countEventsOlderThan,
  deleteEventsOlderThan,
  deleteSessionsOlderThan,
  deleteContextsOlderThan,
  estimateRecoverableSpace,
  getDatabaseSizeKb,
  getNextPurgeId,
  logPurgeRecord,
} from '../../src/core/db-purge.js';
import { suggestKnowledge } from '../../src/core/knowledge-manager.js';
import { detectFaqCandidates, generateFaqFromCandidate } from '../../src/core/faq-manager.js';
import { storeMetric } from '../../src/core/metrics-engine.js';
import { logChange } from '../../src/core/file-journal.js';

// ---------------------------------------------------------------------------
// Shared mock refs (popolati in beforeEach via jest.requireMock)
// ---------------------------------------------------------------------------

let mockGetDatabase: jest.Mock;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ToolOutput {
  dry_run?: boolean;
  purge_id?: number;
  timestamp?: string;
  events_pending?: number;
  estimated_space_kb?: number;
  [key: string]: unknown;
}

interface ErrorOutput {
  success: boolean;
  error: string;
  message: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseResult(toolResult: {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}): ToolOutput | ErrorOutput {
  return JSON.parse(toolResult.content[0].text) as ToolOutput | ErrorOutput;
}

function fakeCounts(overrides: Record<string, number> = {}): {
  events: number;
  sessions: number;
  contexts: number;
} {
  return {
    events: 5,
    sessions: 2,
    contexts: 3,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Suite: memoryPurgeToolHandler
// ---------------------------------------------------------------------------

describe('memoryPurgeToolHandler', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    // Acquire dynamic mock references via jest.requireMock
    const dbMock = jest.requireMock('../../src/core/database.js') as {
      getDatabase: jest.Mock;
    };
    mockGetDatabase = dbMock.getDatabase;

    // Default mock implementations
    mockGetDatabase.mockReturnValue({
      exec: jest.fn(),
      prepare: jest.fn().mockReturnValue({ get: jest.fn() }),
    });
    (getNextPurgeId as jest.Mock).mockReturnValue(42);
    (getDatabaseSizeKb as jest.Mock).mockReturnValue(1024);
    (estimateRecoverableSpace as jest.Mock).mockReturnValue(128);
    (countEventsOlderThan as jest.Mock).mockReturnValue(fakeCounts());
    (suggestKnowledge as jest.Mock).mockReturnValue(['suggestion-1', 'suggestion-2', 'suggestion-3']);
    (detectFaqCandidates as jest.Mock).mockReturnValue([]);
    (generateFaqFromCandidate as jest.Mock).mockReturnValue(undefined);
    (deleteEventsOlderThan as jest.Mock).mockReturnValue(5);
    (deleteSessionsOlderThan as jest.Mock).mockReturnValue(2);
    (deleteContextsOlderThan as jest.Mock).mockReturnValue(3);
    (storeMetric as jest.Mock).mockReturnValue(undefined);
    (logPurgeRecord as jest.Mock).mockReturnValue(undefined);
    (logChange as jest.Mock).mockReturnValue(undefined);
  });

  // -------------------------------------------------------------------------
  // IT1: Dry-run non modifica DB
  // -------------------------------------------------------------------------
  it('IT1: dry-run returns preview without deleting', async () => {
    const result = await memoryPurgeToolHandler.handler({
      olderThan: 30,
      dryRun: true,
    });

    expect(result.isError).toBeUndefined();
    const data = parseResult(result) as ToolOutput;
    expect(data.dry_run).toBe(true);
    expect(data).toHaveProperty('purge_id');
    expect(data).toHaveProperty('events_pending');
    expect(data.events_pending).toBe(5);
    expect(data.estimated_space_kb).toBe(128);

    // Verify that delete functions were NOT called
    expect(deleteEventsOlderThan).not.toHaveBeenCalled();
    expect(deleteSessionsOlderThan).not.toHaveBeenCalled();
    expect(deleteContextsOlderThan).not.toHaveBeenCalled();

    // Verify count functions WERE called
    expect(countEventsOlderThan).toHaveBeenCalledWith(30);
    expect(estimateRecoverableSpace).toHaveBeenCalledWith(30);
  });

  // -------------------------------------------------------------------------
  // IT2: Execute con default
  // -------------------------------------------------------------------------
  it('IT2: execute with default parameters calls delete and stores metrics', async () => {
    const result = await memoryPurgeToolHandler.handler({
      dryRun: false,
    });

    expect(result.isError).toBeUndefined();
    const data = parseResult(result) as ToolOutput;
    expect(data.dry_run).toBe(false);
    expect(data.purge_id).toBe(42);
    expect(data.events_deleted).toBe(5);
    expect(data.sessions_deleted).toBe(2);
    expect(data.snapshots_deleted).toBe(3);
    expect(data.total_deleted).toBe(10);
    expect(data.db_size_before_kb).toBe(1024);
    expect(data.db_size_after_kb).toBe(1024);
    expect(data.space_recovered_kb).toBe(0);

    // Verify delete functions were called with defaults
    expect(deleteEventsOlderThan).toHaveBeenCalledWith(30);
    expect(deleteSessionsOlderThan).toHaveBeenCalledWith(30, 3);
    expect(deleteContextsOlderThan).toHaveBeenCalledWith(30, 3);

    // Verify metrics were stored
    expect(storeMetric).toHaveBeenCalledWith('memory', 'memory_db_size_kb', 1024, expect.any(Object));
    expect(storeMetric).toHaveBeenCalledWith('memory', 'space_recovered_kb', 0, expect.any(Object));

    // Verify purge log
    expect(logPurgeRecord).toHaveBeenCalledWith(42, false, expect.objectContaining({
      olderThan: 30,
      eventsDeleted: 5,
      agent: 'unknown',
    }));

    // Verify journal entry
    expect(logChange).toHaveBeenCalledWith(expect.objectContaining({
      file_path: 'tabularium/memory.db',
      change_type: 'modified',
    }));
  });

  // -------------------------------------------------------------------------
  // IT3: olderThan < 1 → VALIDATION_ERROR
  // -------------------------------------------------------------------------
  it('IT3: olderThan < 1 returns VALIDATION_ERROR', async () => {
    const result = await memoryPurgeToolHandler.handler({
      olderThan: 0,
    });

    expect(result.isError).toBe(true);
    const data = parseResult(result) as ErrorOutput;
    expect(data.error).toBe('VALIDATION_ERROR');
    expect(data.message).toContain('olderThan');
    expect(data.message).toContain('1');
  });

  // -------------------------------------------------------------------------
  // IT4: olderThan > 365 → VALIDATION_ERROR
  // -------------------------------------------------------------------------
  it('IT4: olderThan > 365 returns VALIDATION_ERROR', async () => {
    const result = await memoryPurgeToolHandler.handler({
      olderThan: 366,
    });

    expect(result.isError).toBe(true);
    const data = parseResult(result) as ErrorOutput;
    expect(data.error).toBe('VALIDATION_ERROR');
    expect(data.message).toContain('olderThan');
    expect(data.message).toContain('365');
  });

  // -------------------------------------------------------------------------
  // IT5: keepLastSnapshots < 1 → VALIDATION_ERROR
  // -------------------------------------------------------------------------
  it('IT5: keepLastSnapshots < 1 returns VALIDATION_ERROR', async () => {
    const result = await memoryPurgeToolHandler.handler({
      keepLastSnapshots: 0,
    });

    expect(result.isError).toBe(true);
    const data = parseResult(result) as ErrorOutput;
    expect(data.error).toBe('VALIDATION_ERROR');
    expect(data.message).toContain('keepLastSnapshots');
    expect(data.message).toContain('1');
  });

  // -------------------------------------------------------------------------
  // IT6: compactFirst=true
  // -------------------------------------------------------------------------
  it('IT6: compactFirst=true calls suggestKnowledge and detectFaq', async () => {
    const result = await memoryPurgeToolHandler.handler({
      compactFirst: true,
      dryRun: true,
    });

    expect(result.isError).toBeUndefined();
    const data = parseResult(result) as ToolOutput;
    expect(data.compact_first).toBe(true);
    expect(data.knowledge_condensed).toBeGreaterThanOrEqual(0);

    // Verify knowledge functions were called
    expect(suggestKnowledge).toHaveBeenCalled();
    expect(detectFaqCandidates).toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // IT7: compactFirst=false skips condensation
  // -------------------------------------------------------------------------
  it('IT7: compactFirst=false does NOT call suggestKnowledge or detectFaq', async () => {
    const result = await memoryPurgeToolHandler.handler({
      compactFirst: false,
      dryRun: true,
    });

    expect(result.isError).toBeUndefined();
    const data = parseResult(result) as ToolOutput;
    expect(data.compact_first).toBe(false);
    expect(data.knowledge_condensed).toBe(0);

    // Verify knowledge functions were NOT called
    expect(suggestKnowledge).not.toHaveBeenCalled();
    expect(detectFaqCandidates).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // IT8: agent troppo lungo → VALIDATION_ERROR
  // -------------------------------------------------------------------------
  it('IT8: agent longer than 100 chars returns VALIDATION_ERROR', async () => {
    const result = await memoryPurgeToolHandler.handler({
      agent: 'x'.repeat(101),
    });

    expect(result.isError).toBe(true);
    const data = parseResult(result) as ErrorOutput;
    expect(data.error).toBe('VALIDATION_ERROR');
    expect(data.message).toContain('agent');
    expect(data.message).toContain('100');
  });

  // -------------------------------------------------------------------------
  // IT9: Parametri validi sono riflessi nell'output
  // -------------------------------------------------------------------------
  it('IT9: valid parameters are reflected in the output', async () => {
    const result = await memoryPurgeToolHandler.handler({
      olderThan: 30,
      keepLastSnapshots: 5,
      dryRun: true,
    });

    expect(result.isError).toBeUndefined();
    const data = parseResult(result) as ToolOutput;
    expect(data.older_than_days).toBe(30);
    expect(data.keep_last_snapshots).toBe(5);
    expect(data.dry_run).toBe(true);
    expect(data.purge_id).toBe(42);
    expect(data.events_pending).toBe(5);
  });

  // -------------------------------------------------------------------------
  // IT10: Output JSON contiene tutti i campi richiesti (dry-run)
  // -------------------------------------------------------------------------
  it('IT10: output JSON contains all required fields (dry-run)', async () => {
    const result = await memoryPurgeToolHandler.handler({
      olderThan: 60,
      keepLastSnapshots: 10,
      compactFirst: true,
      dryRun: true,
      agent: 'diana-tester',
    });

    expect(result.isError).toBeUndefined();
    const data = parseResult(result) as ToolOutput;

    // Campi obbligatori del dry-run
    expect(data).toHaveProperty('dry_run');
    expect(data).toHaveProperty('purge_id');
    expect(data).toHaveProperty('timestamp');
    expect(data).toHaveProperty('older_than_days');
    expect(data).toHaveProperty('keep_last_snapshots');
    expect(data).toHaveProperty('compact_first');
    expect(data).toHaveProperty('knowledge_condensed');
    expect(data).toHaveProperty('events_pending');
    expect(data).toHaveProperty('sessions_pending');
    expect(data).toHaveProperty('snapshots_pending');
    expect(data).toHaveProperty('estimated_space_kb');
    expect(data).toHaveProperty('db_size_before_kb');
    expect(data).toHaveProperty('message');
    expect(data).toHaveProperty('recommendation');

    // Verifica tipi
    expect(typeof data.dry_run).toBe('boolean');
    expect(typeof data.purge_id).toBe('number');
    expect(typeof data.timestamp).toBe('string');
    expect(typeof data.older_than_days).toBe('number');
    expect(typeof data.events_pending).toBe('number');

    // Parametri riflessi correttamente
    expect(data.older_than_days).toBe(60);
    expect(data.keep_last_snapshots).toBe(10);
  });

  // -------------------------------------------------------------------------
  // SG1: dryRun default → true (implicitamente)
  // -------------------------------------------------------------------------
  it('SG1: dryRun defaults to true when not provided', async () => {
    // Chiamata SENZA dryRun params
    const result = await memoryPurgeToolHandler.handler({
      olderThan: 30,
    });

    expect(result.isError).toBeUndefined();
    const data = parseResult(result) as ToolOutput;
    // Deve essere implicitamente true
    expect(data.dry_run).toBe(true);

    // Verify delete functions were NOT called (dry-run mode)
    expect(deleteEventsOlderThan).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // SG2: compactFirst default → true (implicitamente)
  // -------------------------------------------------------------------------
  it('SG2: compactFirst defaults to true when not provided', async () => {
    const result = await memoryPurgeToolHandler.handler({
      olderThan: 30,
      dryRun: true,
    });

    expect(result.isError).toBeUndefined();
    const data = parseResult(result) as ToolOutput;
    expect(data.compact_first).toBe(true);

    // suggestKnowledge deve essere stato chiamato
    expect(suggestKnowledge).toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // SG3: Errore in suggestKnowledge non blocca il purge
  // -------------------------------------------------------------------------
  it('SG3: error in suggestKnowledge does not block and logs warning', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    (suggestKnowledge as jest.Mock).mockImplementation(() => {
      throw new Error('Knowledge engine unavailable');
    });

    const result = await memoryPurgeToolHandler.handler({
      dryRun: true,
    });

    expect(result.isError).toBeUndefined();
    const data = parseResult(result) as ToolOutput;
    expect(data.dry_run).toBe(true);
    expect(data.knowledge_condensed).toBe(0);
    expect(data.events_pending).toBe(5); // purge continua

    // Verifica console.error e' stato chiamato
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('[purge] knowledge_suggest failed'),
    );

    consoleSpy.mockRestore();
  });

  // -------------------------------------------------------------------------
  // SG4: Errore nella manutenzione (PRAGMA) non blocca
  // -------------------------------------------------------------------------
  it('SG4: maintenance failure does not block and logs warning', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    (deleteEventsOlderThan as jest.Mock).mockReturnValue(5);
    (deleteSessionsOlderThan as jest.Mock).mockReturnValue(2);
    (deleteContextsOlderThan as jest.Mock).mockReturnValue(3);

    // Make maintenance fail by making getDatabase fail
    mockGetDatabase.mockImplementation(() => {
      throw new Error('Database maintenance lock');
    });

    const result = await memoryPurgeToolHandler.handler({
      dryRun: false,
    });

    expect(result.isError).toBeUndefined();
    const data = parseResult(result) as ToolOutput;
    expect(data.dry_run).toBe(false);
    expect(data.events_deleted).toBe(5);
    expect(data.snapshots_deleted).toBe(3);

    // Verifica console.error per il fallimento della manutenzione
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('[purge] Maintenance failed'),
    );

    consoleSpy.mockRestore();
  });
});
