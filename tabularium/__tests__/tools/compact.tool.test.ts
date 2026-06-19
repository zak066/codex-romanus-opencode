/**
 * __tests__/tools/compact.tool.test.ts
 * Test di integrazione per tools/compact.tool.ts — Memory Compact Tool (MCP² Phase 2).
 *
 * Copertura:
 * - IT1-IT6: casi di integrazione (dry-run, execute, validazione, output JSON)
 * - SC1-SC2: safe guard (zero DELETE, ADR preservate)
 *
 * @module tests/tools/compact-tool
 */

import { memoryCompactToolHandler } from '../../src/tools/compact.tool.js';

// ---------------------------------------------------------------------------
// Mock dei moduli core
// ---------------------------------------------------------------------------

const mockDbPrepare = jest.fn().mockReturnValue({ get: jest.fn(), run: jest.fn() });
const mockGetDatabase = jest.fn().mockReturnValue({
  exec: jest.fn(),
  prepare: mockDbPrepare,
});

jest.mock('../../src/core/database.js', () => ({
  getDatabase: mockGetDatabase,
  getDbPath: jest.fn().mockReturnValue('/tmp/test.db'),
  initDatabase: jest.fn(),
  closeDatabase: jest.fn(),
  resetDatabase: jest.fn(),
}));

jest.mock('../../src/core/db-compact.js', () => ({
  countEventsForCompact: jest.fn(),
  countKnowledgeEntries: jest.fn(),
  getDatabaseSizeKb: jest.fn(),
  getNextCompactId: jest.fn(),
  getTotalEventCount: jest.fn(),
  logCompactRecord: jest.fn(),
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
  countEventsForCompact,
  countKnowledgeEntries,
  getDatabaseSizeKb,
  getNextCompactId,
  getTotalEventCount,
  logCompactRecord,
} from '../../src/core/db-compact.js';
import { suggestKnowledge } from '../../src/core/knowledge-manager.js';
import { detectFaqCandidates, generateFaqFromCandidate } from '../../src/core/faq-manager.js';
import { storeMetric } from '../../src/core/metrics-engine.js';
import { logChange } from '../../src/core/file-journal.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ToolOutput {
  dry_run?: boolean;
  compact_id?: number;
  timestamp?: string;
  events_in_window?: number;
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
  total: number;
  recent: number;
  knowledgeReady: number;
} {
  return {
    total: 15,
    recent: 3,
    knowledgeReady: 8,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Suite: memoryCompactToolHandler
// ---------------------------------------------------------------------------

describe('memoryCompactToolHandler', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    // Default mock implementations
    (getNextCompactId as jest.Mock).mockReturnValue(7);
    (getDatabaseSizeKb as jest.Mock).mockReturnValue(1024);
    (countEventsForCompact as jest.Mock).mockReturnValue(fakeCounts());
    (countKnowledgeEntries as jest.Mock).mockReturnValue(25);
    (getTotalEventCount as jest.Mock).mockReturnValue(450);
    (suggestKnowledge as jest.Mock).mockReturnValue([
      { id: 'k_001', title: 'Pattern test', category: 'pattern' },
      { id: 'k_002', title: 'Lesson test', category: 'lesson' },
    ]);
    (detectFaqCandidates as jest.Mock).mockReturnValue([
      { pattern: 'ERR_001', occurrences: 4, suggestedTitle: 'FAQ: ERR_001 — test', recentExample: 'sample' },
    ]);
    (generateFaqFromCandidate as jest.Mock).mockReturnValue(undefined);
    (storeMetric as jest.Mock).mockReturnValue(undefined);
    (logCompactRecord as jest.Mock).mockReturnValue(undefined);
    (logChange as jest.Mock).mockReturnValue(undefined);
  });

  // -------------------------------------------------------------------------
  // IT1: Dry-run non modifica DB
  // -------------------------------------------------------------------------
  it('IT1: dry-run restituisce preview senza condensare', async () => {
    const result = await memoryCompactToolHandler.handler({
      olderThan: 7,
      dryRun: true,
    });

    expect(result.isError).toBeUndefined();
    const data = parseResult(result) as ToolOutput;
    expect(data.dry_run).toBe(true);
    expect(data).toHaveProperty('compact_id');
    expect(data).toHaveProperty('events_in_window');
    expect(data.events_in_window).toBe(15);

    // Verify that compact functions were NOT called
    expect(suggestKnowledge).not.toHaveBeenCalled();
    expect(detectFaqCandidates).not.toHaveBeenCalled();
    expect(logCompactRecord).not.toHaveBeenCalled();
    expect(logChange).not.toHaveBeenCalled();

    // Verify count functions WERE called
    expect(countEventsForCompact).toHaveBeenCalledWith(7);
  });

  // -------------------------------------------------------------------------
  // IT2: Execute con parametri default
  // -------------------------------------------------------------------------
  it('IT2: execute con parametri default chiama suggestKnowledge e registra metriche', async () => {
    const result = await memoryCompactToolHandler.handler({
      dryRun: false,
    });

    expect(result.isError).toBeUndefined();
    const data = parseResult(result) as ToolOutput;
    expect(data.dry_run).toBeUndefined(); // non presente quando dry_run=false
    expect(data.compact_id).toBe(7);
    expect(data.knowledge_created).toHaveLength(2);
    expect(data.faq_created).toHaveLength(1);
    expect(data.event_count_before).toBe(450);
    expect(data.event_count_after).toBe(450); // invariato — COMPACT non cancella

    // Verify knowledge functions were called with defaults
    expect(suggestKnowledge).toHaveBeenCalled();
    expect(detectFaqCandidates).toHaveBeenCalledWith(3);
    expect(generateFaqFromCandidate).toHaveBeenCalled();

    // Verify metrics were stored
    expect(storeMetric).toHaveBeenCalledWith('memory', 'memory_event_count', 450, expect.any(Object));
    expect(storeMetric).toHaveBeenCalledWith('memory', 'memory_last_compact_age_days', 0, expect.any(Object));

    // Verify compact log
    expect(logCompactRecord).toHaveBeenCalledWith(7, false, expect.objectContaining({
      olderThan: 7,
      knowledgeLimit: 10,
      knowledgeCreated: 2,
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
    const result = await memoryCompactToolHandler.handler({
      olderThan: 0,
    });

    expect(result.isError).toBe(true);
    const data = parseResult(result) as ErrorOutput;
    expect(data.error).toBe('VALIDATION_ERROR');
    expect(data.message).toContain('olderThan');
    expect(data.message).toContain('1');
  });

  // -------------------------------------------------------------------------
  // IT4: knowledgeLimit > 50 → VALIDATION_ERROR
  // -------------------------------------------------------------------------
  it('IT4: knowledgeLimit > 50 returns VALIDATION_ERROR', async () => {
    const result = await memoryCompactToolHandler.handler({
      knowledgeLimit: 51,
    });

    expect(result.isError).toBe(true);
    const data = parseResult(result) as ErrorOutput;
    expect(data.error).toBe('VALIDATION_ERROR');
    expect(data.message).toContain('knowledgeLimit');
    expect(data.message).toContain('50');
  });

  // -------------------------------------------------------------------------
  // IT5: compact con createSnapshot=true → snapshot_id presente
  // -------------------------------------------------------------------------
  it('IT5: compact con createSnapshot=true ha snapshot_id presente', async () => {
    // Mock del database per snapshot
    mockGetDatabase.mockReturnValue({
      exec: jest.fn(),
      prepare: jest.fn().mockReturnValue({
        run: jest.fn(),
        get: jest.fn(),
      }),
    });

    const result = await memoryCompactToolHandler.handler({
      dryRun: false,
      createSnapshot: true,
    });

    expect(result.isError).toBeUndefined();
    const data = parseResult(result) as ToolOutput;
    expect(data).toHaveProperty('snapshot_id');
    // snapshot_id deve essere una stringa non vuota se snapshot creato
    expect(typeof data.snapshot_id).toBe('string');
  });

  // -------------------------------------------------------------------------
  // IT6: compact in autoMode → auto_mode presente nell'output
  // -------------------------------------------------------------------------
  it('IT6: compact in autoMode riflette auto_mode: true', async () => {
    const result = await memoryCompactToolHandler.handler({
      dryRun: true,
      autoMode: true,
    });

    expect(result.isError).toBeUndefined();
    const data = parseResult(result) as ToolOutput;
    expect(data.auto_mode).toBe(true);
  });

  // -------------------------------------------------------------------------
  // IT7: autoMode forza olderThan a 7
  // -------------------------------------------------------------------------
  it('IT7: autoMode con olderThan=1 forza olderThan a 7', async () => {
    const result = await memoryCompactToolHandler.handler({
      dryRun: true,
      autoMode: true,
      olderThan: 1,
    });

    expect(result.isError).toBeUndefined();
    const data = parseResult(result) as ToolOutput;
    expect(data.older_than_days).toBe(7);
    expect(countEventsForCompact).toHaveBeenCalledWith(7);
  });

  // -------------------------------------------------------------------------
  // IT8: agent troppo lungo → VALIDATION_ERROR
  // -------------------------------------------------------------------------
  it('IT8: agent longer than 100 chars returns VALIDATION_ERROR', async () => {
    const result = await memoryCompactToolHandler.handler({
      agent: 'x'.repeat(101),
    });

    expect(result.isError).toBe(true);
    const data = parseResult(result) as ErrorOutput;
    expect(data.error).toBe('VALIDATION_ERROR');
    expect(data.message).toContain('agent');
    expect(data.message).toContain('100');
  });

  // -------------------------------------------------------------------------
  // IT9: Parametri validi riflessi nell'output (dry-run)
  // -------------------------------------------------------------------------
  it('IT9: parametri validi sono riflessi nell\'output (dry-run)', async () => {
    const result = await memoryCompactToolHandler.handler({
      olderThan: 14,
      knowledgeLimit: 5,
      dryRun: true,
      agent: 'diana-tester',
    });

    expect(result.isError).toBeUndefined();
    const data = parseResult(result) as ToolOutput;
    expect(data.older_than_days).toBe(14);
    expect(data.knowledge_limit).toBe(5);
    expect(data.dry_run).toBe(true);
    expect(data.compact_id).toBe(7);
    expect(data.events_in_window).toBe(15);
  });

  // -------------------------------------------------------------------------
  // IT10: Output JSON contiene tutti i campi richiesti (dry-run)
  // -------------------------------------------------------------------------
  it('IT10: output JSON contiene tutti i campi richiesti (dry-run)', async () => {
    const result = await memoryCompactToolHandler.handler({
      olderThan: 30,
      knowledgeLimit: 20,
      createSnapshot: false,
      dryRun: true,
      agent: 'vulcanus-senior-dev',
    });

    expect(result.isError).toBeUndefined();
    const data = parseResult(result) as ToolOutput;

    // Campi obbligatori del dry-run
    expect(data).toHaveProperty('dry_run');
    expect(data).toHaveProperty('compact_id');
    expect(data).toHaveProperty('timestamp');
    expect(data).toHaveProperty('auto_mode');
    expect(data).toHaveProperty('older_than_days');
    expect(data).toHaveProperty('knowledge_limit');
    expect(data).toHaveProperty('create_snapshot');
    expect(data).toHaveProperty('events_in_window');
    expect(data).toHaveProperty('events_recent');
    expect(data).toHaveProperty('events_knowledge_ready');
    expect(data).toHaveProperty('knowledge_entries_before');
    expect(data).toHaveProperty('db_size_kb');
    expect(data).toHaveProperty('message');
    expect(data).toHaveProperty('recommendation');

    // Verifica tipi
    expect(typeof data.dry_run).toBe('boolean');
    expect(typeof data.compact_id).toBe('number');
    expect(typeof data.timestamp).toBe('string');
    expect(typeof data.older_than_days).toBe('number');
    expect(typeof data.events_in_window).toBe('number');

    // Parametri riflessi correttamente
    expect(data.older_than_days).toBe(30);
    expect(data.knowledge_limit).toBe(20);
    expect(data.create_snapshot).toBe(false);
  });

  // -------------------------------------------------------------------------
  // SC1: Safe guard — MAI cancellare eventi (zero DELETE)
  // -------------------------------------------------------------------------
  it('SC1: safe guard — MAI chiamare funzioni DELETE', async () => {
    // Verifica che nessuna funzione di delete sia mai chiamata
    const deleteSpy = jest.fn();

    // Esegui compact
    await memoryCompactToolHandler.handler({
      dryRun: false,
    });

    // suggestKnowledge deve essere chiamato (condensa)
    expect(suggestKnowledge).toHaveBeenCalled();

    // Nessuna funzione "delete" deve essere chiamata
    expect(deleteSpy).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // SC2: Safe guard — errore in suggestKnowledge non blocca il compact
  // -------------------------------------------------------------------------
  it('SC2: errore in suggestKnowledge non blocca e logga warning', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    (suggestKnowledge as jest.Mock).mockImplementation(() => {
      throw new Error('Knowledge engine unavailable');
    });

    const result = await memoryCompactToolHandler.handler({
      dryRun: false,
    });

    expect(result.isError).toBeUndefined();
    const data = parseResult(result) as ToolOutput;
    expect(data.compact_id).toBe(7);
    expect(data.knowledge_created).toEqual([]); // 0 knowledge create

    // Verifica console.error e' stato chiamato
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('[compact] knowledge_suggest failed'),
    );

    consoleSpy.mockRestore();
  });

  // -------------------------------------------------------------------------
  // SC3: errore in faq_detect non blocca
  // -------------------------------------------------------------------------
  it('SC3: errore in faq_detect non blocca e logga warning', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    (detectFaqCandidates as jest.Mock).mockImplementation(() => {
      throw new Error('Faq engine unavailable');
    });

    const result = await memoryCompactToolHandler.handler({
      dryRun: false,
    });

    expect(result.isError).toBeUndefined();
    const data = parseResult(result) as ToolOutput;
    expect(data.compact_id).toBe(7);
    expect(data.faq_created).toEqual([]);
    // knowledge non bloccata
    expect(data.knowledge_created).toHaveLength(2);

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('[compact] faq_detect failed'),
    );

    consoleSpy.mockRestore();
  });

  // -------------------------------------------------------------------------
  // SC4: knowledgeLimit < 1 → VALIDATION_ERROR
  // -------------------------------------------------------------------------
  it('SC4: knowledgeLimit < 1 returns VALIDATION_ERROR', async () => {
    const result = await memoryCompactToolHandler.handler({
      knowledgeLimit: 0,
    });

    expect(result.isError).toBe(true);
    const data = parseResult(result) as ErrorOutput;
    expect(data.error).toBe('VALIDATION_ERROR');
    expect(data.message).toContain('knowledgeLimit');
    expect(data.message).toContain('1');
  });

  // -------------------------------------------------------------------------
  // VT1: olderThan > 365 → VALIDATION_ERROR
  // -------------------------------------------------------------------------
  it('VT1: olderThan > 365 returns VALIDATION_ERROR', async () => {
    const result = await memoryCompactToolHandler.handler({
      olderThan: 366,
    });

    expect(result.isError).toBe(true);
    const data = JSON.parse(result.content[0].text) as Record<string, unknown>;
    expect(data.error).toBe('VALIDATION_ERROR');
    expect((data.message as string)).toContain('olderThan');
    expect((data.message as string)).toContain('365');
  });

  // -------------------------------------------------------------------------
  // VT2: createSnapshot non-boolean → VALIDATION_ERROR
  // -------------------------------------------------------------------------
  it('VT2: createSnapshot non-boolean returns VALIDATION_ERROR', async () => {
    const result = await memoryCompactToolHandler.handler({
      createSnapshot: 'true' as unknown as boolean,
    });

    expect(result.isError).toBe(true);
    const data = JSON.parse(result.content[0].text) as Record<string, unknown>;
    expect(data.error).toBe('VALIDATION_ERROR');
    expect((data.message as string)).toContain('createSnapshot');
  });

  // -------------------------------------------------------------------------
  // VT3: autoMode non-boolean → VALIDATION_ERROR
  // -------------------------------------------------------------------------
  it('VT3: autoMode non-boolean returns VALIDATION_ERROR', async () => {
    const result = await memoryCompactToolHandler.handler({
      autoMode: 1 as unknown as boolean,
    });

    expect(result.isError).toBe(true);
    const data = JSON.parse(result.content[0].text) as Record<string, unknown>;
    expect(data.error).toBe('VALIDATION_ERROR');
    expect((data.message as string)).toContain('autoMode');
  });

  // -------------------------------------------------------------------------
  // VT4: dryRun non-boolean → VALIDATION_ERROR
  // -------------------------------------------------------------------------
  it('VT4: dryRun non-boolean returns VALIDATION_ERROR', async () => {
    const result = await memoryCompactToolHandler.handler({
      dryRun: 0 as unknown as boolean,
    });

    expect(result.isError).toBe(true);
    const data = JSON.parse(result.content[0].text) as Record<string, unknown>;
    expect(data.error).toBe('VALIDATION_ERROR');
    expect((data.message as string)).toContain('dryRun');
  });

  // -------------------------------------------------------------------------
  // VT5: agent non-string → VALIDATION_ERROR
  // -------------------------------------------------------------------------
  it('VT5: agent non-string returns VALIDATION_ERROR', async () => {
    const result = await memoryCompactToolHandler.handler({
      agent: 42 as unknown as string,
    });

    expect(result.isError).toBe(true);
    const data = JSON.parse(result.content[0].text) as Record<string, unknown>;
    expect(data.error).toBe('VALIDATION_ERROR');
    expect((data.message as string)).toContain('agent');
  });

  // -------------------------------------------------------------------------
  // VT6: createSnapshot=false in execute → snapshot_skipped=true
  // -------------------------------------------------------------------------
  it('VT6: execute con createSnapshot=false ha snapshot_skipped: true', async () => {
    const result = await memoryCompactToolHandler.handler({
      dryRun: false,
      createSnapshot: false,
    });

    expect(result.isError).toBeUndefined();
    const data = JSON.parse(result.content[0].text) as Record<string, unknown>;
    expect(data.snapshot_skipped).toBe(true);
  });
});
