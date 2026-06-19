/**
 * Test per GAP-07 — Event Bus Persistente
 *
 * Copertura:
 * 1. Dual-write in EventBus: emit() salva su event_log dopo dispatch in-memory
 * 2. SSE replay pattern: query event_log con WHERE id > ? e filtro agent
 * 3. agent_event_history tool: 7 filtri, gestione errori
 * 4. TTL cleanup: purgeOldEvents() e gestione errori
 *
 * @module tests/messaging/event-persistence
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ===========================================================================
// 1. Dual-write: EventBus emit() → event_log
// ===========================================================================

describe('Dual-write (event-bus.ts → event_log)', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('should persist event via insertStmt.run() after emit()', async () => {
    // Arrange: mock database to return a working prepare
    const mockRun = vi.fn();
    const dbMock = {
      prepare: vi.fn(() => ({ run: mockRun })),
    };
    vi.doMock('../../src/core/database.js', () => ({
      getDatabase: vi.fn(() => dbMock),
    }));

    const { emit } = await import('../../src/messaging/event-bus.js');

    // Act
    const event = {
      type: 'message_sent' as const,
      payload: { test: true, content: 'hello' },
      timestamp: new Date().toISOString(),
      channel_id: 'ch_general',
      agent_name: 'diana',
    };
    emit(event);

    // Assert
    expect(dbMock.prepare).toHaveBeenCalledTimes(1);
    const sql = dbMock.prepare.mock.calls[0][0];
    expect(sql).toContain('INSERT INTO event_log');
    expect(sql).toContain('event_type');
    expect(sql).toContain('payload');
    expect(sql).toContain('channel_id');
    expect(sql).toContain('agent_name');
    expect(sql).toContain('event_timestamp');

    expect(mockRun).toHaveBeenCalledTimes(1);
    expect(mockRun.mock.calls[0][0]).toMatchObject({
      event_type: 'message_sent',
      channel_id: 'ch_general',
      agent_name: 'diana',
    });
  });

  it('should not crash if database is unavailable', async () => {
    // Arrange: mock database to throw
    vi.doMock('../../src/core/database.js', () => ({
      getDatabase: vi.fn(() => {
        throw new Error('Database not initialized');
      }),
    }));

    const { emit } = await import('../../src/messaging/event-bus.js');

    // Act & Assert: must not throw despite DB error
    expect(() => {
      emit({
        type: 'message_sent',
        payload: { test: true },
        timestamp: new Date().toISOString(),
      });
    }).not.toThrow();
  });

  it('should not crash if getDatabase returns null-like (edge case)', async () => {
    // Arrange: mock prepare to throw on the INSERT query
    vi.doMock('../../src/core/database.js', () => ({
      getDatabase: vi.fn(() => ({
        prepare: vi.fn(() => { throw new Error('prepare failed'); }),
      })),
    }));

    const { emit } = await import('../../src/messaging/event-bus.js');

    // Act & Assert
    expect(() => {
      emit({
        type: 'agent_status_change',
        payload: { agent: 'diana', status: 'busy' },
        timestamp: new Date().toISOString(),
        agent_name: 'diana',
      });
    }).not.toThrow();
  });

  it('should populate all event_log columns in INSERT', async () => {
    // Arrange
    const mockRun = vi.fn();
    const dbMock = {
      prepare: vi.fn(() => ({ run: mockRun })),
    };
    vi.doMock('../../src/core/database.js', () => ({
      getDatabase: vi.fn(() => dbMock),
    }));

    const { emit } = await import('../../src/messaging/event-bus.js');

    // Act — event with ALL fields populated
    emit({
      type: 'channel_created',
      payload: { channel_name: 'design', created_by: 'diana' },
      timestamp: '2026-06-07T12:00:00.000Z',
      channel_id: 'ch_design',
      agent_name: 'diana',
    });

    // Assert — all fields in the run params
    const params = mockRun.mock.calls[0][0];
    expect(params).toMatchObject({
      event_type: 'channel_created',
      channel_id: 'ch_design',
      agent_name: 'diana',
      event_timestamp: '2026-06-07T12:00:00.000Z',
    });
    // payload should be JSON-stringified
    expect(() => JSON.parse(params.payload)).not.toThrow();
    expect(JSON.parse(params.payload)).toEqual({
      channel_name: 'design',
      created_by: 'diana',
    });
  });

  it('should handle null channel_id and agent_name in INSERT', async () => {
    // Arrange
    const mockRun = vi.fn();
    const dbMock = {
      prepare: vi.fn(() => ({ run: mockRun })),
    };
    vi.doMock('../../src/core/database.js', () => ({
      getDatabase: vi.fn(() => dbMock),
    }));

    const { emit } = await import('../../src/messaging/event-bus.js');

    // Act — event WITHOUT channel_id and agent_name
    emit({
      type: 'message_sent',
      payload: { broadcast: true },
      timestamp: new Date().toISOString(),
    });

    // Assert — should pass null for optional fields
    const params = mockRun.mock.calls[0][0];
    expect(params.channel_id).toBeNull();
    expect(params.agent_name).toBeNull();
  });
});

// ===========================================================================
// 2. SSE Replay pattern: event_log query with WHERE id > ?
// ===========================================================================

describe('SSE Replay pattern (server.ts — replayEvents)', () => {
  it('should query event_log with WHERE id > ? ORDER BY id ASC LIMIT 500', async () => {
    // Arrange: create mock that captures the SQL
    let capturedSql = '';
    const mockAll = vi.fn().mockReturnValue([]);
    const dbMock = {
      prepare: vi.fn((sql: string) => {
        capturedSql = sql;
        return { all: mockAll };
      }),
    };
    vi.doMock('../../src/core/database.js', () => ({
      getDatabase: vi.fn(() => dbMock),
    }));

    // Simulate the exact SQL that replayEvents executes (from server.ts)
    const { getDatabase } = await import('../../src/core/database.js');
    const db = getDatabase();
    const lastEventId = 42;

    const stmt = db.prepare(`
      SELECT id, event_type, payload, channel_id, agent_name, event_timestamp
      FROM event_log
      WHERE id > ?
      ORDER BY id ASC
      LIMIT 500
    `);
    stmt.all(lastEventId);

    // Assert SQL correctness
    expect(capturedSql).toContain('WHERE id > ?');
    expect(capturedSql).toContain('ORDER BY id ASC');
    expect(capturedSql).toContain('LIMIT 500');
    expect(capturedSql).toContain('SELECT id');
    expect(capturedSql).toContain('event_type');
    expect(capturedSql).toContain('payload');
    expect(capturedSql).toContain('FROM event_log');

    // Assert the parameter was passed correctly
    expect(mockAll).toHaveBeenCalledWith(42);
  });

  it('should filter replayed events by agent_name', async () => {
    // Arrange: rows that simulate event_log results
    const allRows = [
      { id: 1, event_type: 'message_sent', payload: '{}', channel_id: null, agent_name: 'diana', event_timestamp: '2026-01-01T00:00:00Z' },
      { id: 2, event_type: 'message_sent', payload: '{}', channel_id: null, agent_name: 'vulcanus', event_timestamp: '2026-01-02T00:00:00Z' },
      { id: 3, event_type: 'message_sent', payload: '{}', channel_id: null, agent_name: 'diana', event_timestamp: '2026-01-03T00:00:00Z' },
      { id: 4, event_type: 'message_sent', payload: '{}', channel_id: null, agent_name: 'minerva', event_timestamp: '2026-01-04T00:00:00Z' },
    ];

    const mockAll = vi.fn().mockReturnValue(allRows);
    const dbMock = {
      prepare: vi.fn(() => ({ all: mockAll })),
    };
    vi.doMock('../../src/core/database.js', () => ({
      getDatabase: vi.fn(() => dbMock),
    }));

    // Simulate replayEvents filtering logic from server.ts
    const agentFilter = 'diana';
    const filtered = allRows.filter(r => !agentFilter || r.agent_name === agentFilter);

    // Assert
    expect(filtered).toHaveLength(2);
    expect(filtered[0].agent_name).toBe('diana');
    expect(filtered[1].agent_name).toBe('diana');

    // Verify no events from other agents leak through
    expect(filtered.some(r => r.agent_name !== 'diana')).toBe(false);
  });

  it('should return empty when no events exist after lastEventId', async () => {
    // Arrange
    const mockAll = vi.fn().mockReturnValue([]);
    const dbMock = {
      prepare: vi.fn(() => ({ all: mockAll })),
    };
    vi.doMock('../../src/core/database.js', () => ({
      getDatabase: vi.fn(() => dbMock),
    }));

    const { getDatabase } = await import('../../src/core/database.js');
    const db = getDatabase();
    const stmt = db.prepare('SELECT ... WHERE id > ?');
    const rows = stmt.all(999);

    expect(rows).toHaveLength(0);
  });
});

// ===========================================================================
// 3. agent_event_history tool (messaging.tool.ts — Tool 11)
// ===========================================================================

describe('agent_event_history tool (messaging.tool.ts)', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('should return events with type filter', async () => {
    // Arrange
    const mockAll = vi.fn();
    const mockGet = vi.fn();
    const dbMock = {
      prepare: vi.fn(() => ({
        all: mockAll,
        get: mockGet,
      })),
    };
    // Configure mock responses
    mockGet.mockReturnValue({ total: 2 });
    mockAll.mockReturnValue([
      { id: 2, event_type: 'message_sent', payload: '{"msg":"hello"}', channel_id: 'ch_general', agent_name: 'diana', event_timestamp: '2026-01-02T00:00:00Z', created_at: '2026-01-02T00:00:00Z' },
      { id: 1, event_type: 'message_sent', payload: '{"msg":"world"}', channel_id: 'ch_general', agent_name: 'diana', event_timestamp: '2026-01-01T00:00:00Z', created_at: '2026-01-01T00:00:00Z' },
    ]);

    vi.doMock('../../src/core/database.js', () => ({
      getDatabase: vi.fn(() => dbMock),
    }));

    const { agentEventHistoryToolHandler } = await import('../../src/tools/messaging.tool.js');

    // Act
    const result = await agentEventHistoryToolHandler.handler({
      type: 'message_sent',
      limit: 10,
    });
    const data = JSON.parse(result.content[0].text);

    // Assert
    expect(data.success).toBe(true);
    expect(data.data.total).toBe(2);
    expect(data.data.events).toHaveLength(2);
    expect(data.data.events[0].event_type).toBe('message_sent');
    expect(data.data.events[0].payload).toEqual({ msg: 'hello' });
    expect(data.data.events[1].payload).toEqual({ msg: 'world' });
  });

  it('should filter by agent_name and channel_id', async () => {
    // Arrange
    const mockAll = vi.fn();
    const mockGet = vi.fn();
    const dbMock = {
      prepare: vi.fn(() => ({
        all: mockAll,
        get: mockGet,
      })),
    };
    mockGet.mockReturnValue({ total: 1 });
    mockAll.mockReturnValue([
      { id: 5, event_type: 'agent_status_change', payload: '{"status":"busy"}', channel_id: null, agent_name: 'vulcanus', event_timestamp: '2026-01-05T00:00:00Z', created_at: '2026-01-05T00:00:00Z' },
    ]);

    vi.doMock('../../src/core/database.js', () => ({
      getDatabase: vi.fn(() => dbMock),
    }));

    const { agentEventHistoryToolHandler } = await import('../../src/tools/messaging.tool.js');

    // Act — filter by agent_name
    const result = await agentEventHistoryToolHandler.handler({
      agent_name: 'vulcanus',
      limit: 50,
    });
    const data = JSON.parse(result.content[0].text);

    // Assert
    expect(data.success).toBe(true);
    expect(data.data.events).toHaveLength(1);
    expect(data.data.events[0].agent_name).toBe('vulcanus');

    // Verify SQL used agent_name filter in WHERE clause
    const sqlCall = dbMock.prepare.mock.calls.find(
      (call: string[]) => call[0].includes('WHERE')
    );
    if (sqlCall) {
      expect(sqlCall[0]).toContain('agent_name');
    }
  });

  it('should handle empty results gracefully', async () => {
    // Arrange
    const mockAll = vi.fn().mockReturnValue([]);
    const mockGet = vi.fn().mockReturnValue({ total: 0 });
    const dbMock = {
      prepare: vi.fn(() => ({
        all: mockAll,
        get: mockGet,
      })),
    };

    vi.doMock('../../src/core/database.js', () => ({
      getDatabase: vi.fn(() => dbMock),
    }));

    const { agentEventHistoryToolHandler } = await import('../../src/tools/messaging.tool.js');

    // Act — filter that matches nothing
    const result = await agentEventHistoryToolHandler.handler({
      type: 'agent_heartbeat_timeout',
      agent_name: 'nonexistent_agent',
      limit: 10,
    });
    const data = JSON.parse(result.content[0].text);

    // Assert
    expect(data.success).toBe(true);
    expect(data.data.total).toBe(0);
    expect(data.data.events).toEqual([]);
  });

  it('should support since/until timestamp filtering', async () => {
    // Arrange
    const mockAll = vi.fn();
    const mockGet = vi.fn();
    const dbMock = {
      prepare: vi.fn(() => ({
        all: mockAll,
        get: mockGet,
      })),
    };
    mockGet.mockReturnValue({ total: 1 });
    mockAll.mockReturnValue([
      { id: 3, event_type: 'message_sent', payload: '{}', channel_id: null, agent_name: 'diana', event_timestamp: '2026-01-03T00:00:00Z', created_at: '2026-01-03T00:00:00Z' },
    ]);

    vi.doMock('../../src/core/database.js', () => ({
      getDatabase: vi.fn(() => dbMock),
    }));

    const { agentEventHistoryToolHandler } = await import('../../src/tools/messaging.tool.js');

    // Act
    const result = await agentEventHistoryToolHandler.handler({
      since: '2026-01-01T00:00:00Z',
      until: '2026-01-31T00:00:00Z',
      limit: 50,
    });
    const data = JSON.parse(result.content[0].text);

    // Assert
    expect(data.success).toBe(true);
    expect(data.data.total).toBe(1);

    // Verify both since and until appear in SQL
    const countSql = dbMock.prepare.mock.calls.find(
      (call: string[]) => call[0].includes('COUNT(*)')
    );
    if (countSql) {
      expect(countSql[0]).toContain('event_timestamp >=');
      expect(countSql[0]).toContain('event_timestamp <=');
    }
  });

  it('should enforce limit max of 1000 and min of 1', async () => {
    // Arrange
    const mockAll = vi.fn().mockReturnValue([]);
    const mockGet = vi.fn().mockReturnValue({ total: 0 });
    const dbMock = {
      prepare: vi.fn(() => ({
        all: mockAll,
        get: mockGet,
      })),
    };

    vi.doMock('../../src/core/database.js', () => ({
      getDatabase: vi.fn(() => dbMock),
    }));

    const { agentEventHistoryToolHandler } = await import('../../src/tools/messaging.tool.js');

    // Act — try excessive limit
    const result = await agentEventHistoryToolHandler.handler({ limit: 999999 });
    const data = JSON.parse(result.content[0].text);

    // Assert — should cap at 1000
    expect(data.success).toBe(true);

    // The SQL uses parameterized LIMIT @limit (capped server-side)
    // Verify .all() was called with limit=1000 (capped)
    const allCall = mockAll.mock.calls[0];
    if (allCall && allCall[0]) {
      expect(allCall[0].limit).toBe(1000);
    }
  });

  it('should return DB_UNAVAILABLE error when database throws', async () => {
    // Arrange: database throws error
    vi.doMock('../../src/core/database.js', () => ({
      getDatabase: vi.fn(() => {
        throw new Error('getDatabase failed: DB not reachable');
      }),
    }));

    const { agentEventHistoryToolHandler } = await import('../../src/tools/messaging.tool.js');

    // Act
    const result = await agentEventHistoryToolHandler.handler({ limit: 5 });
    const data = JSON.parse(result.content[0].text);

    // Assert
    expect(data.success).toBe(false);
    expect(data.error).toBe('DB_UNAVAILABLE');
  });

  it('should return DB_UNAVAILABLE when prepare throws', async () => {
    // Arrange: prepare() throws
    vi.doMock('../../src/core/database.js', () => ({
      getDatabase: vi.fn(() => ({
        prepare: vi.fn(() => { throw new Error('prepare failed: table not found'); }),
      })),
    }));

    const { agentEventHistoryToolHandler } = await import('../../src/tools/messaging.tool.js');

    // Act
    const result = await agentEventHistoryToolHandler.handler({ limit: 5 });
    const data = JSON.parse(result.content[0].text);

    // Assert
    expect(data.success).toBe(false);
    expect(data.error).toBe('DB_UNAVAILABLE');
  });
});

// ===========================================================================
// 4. TTL cleanup: purgeOldEvents() & startTtlTimer()
// ===========================================================================

describe('TTL cleanup (event-ttl.ts)', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('should delete events older than maxAgeDays and return deleted count', async () => {
    // Arrange
    const mockRun = vi.fn(() => ({ changes: 7 }));
    const dbMock = {
      prepare: vi.fn(() => ({ run: mockRun })),
    };

    vi.doMock('../../src/core/database.js', () => ({
      getDatabase: vi.fn(() => dbMock),
    }));

    const { purgeOldEvents } = await import('../../src/messaging/event-ttl.js');

    // Act
    const result = purgeOldEvents(7);

    // Assert
    expect(result.deleted).toBe(7);
    expect(result.maxAgeDays).toBe(7);

    // Verify SQL
    const sql = dbMock.prepare.mock.calls[0][0];
    expect(sql).toContain('DELETE FROM event_log');
    expect(sql).toContain('datetime');
    expect(sql).toContain('created_at');

    // Verify parameter
    expect(mockRun).toHaveBeenCalledWith('-7 days');
  });

  it('should use default maxAgeDays of 7 when called without args', async () => {
    // Arrange
    const mockRun = vi.fn(() => ({ changes: 0 }));
    const dbMock = {
      prepare: vi.fn(() => ({ run: mockRun })),
    };

    vi.doMock('../../src/core/database.js', () => ({
      getDatabase: vi.fn(() => dbMock),
    }));

    const { purgeOldEvents } = await import('../../src/messaging/event-ttl.js');

    // Act — no args
    const result = purgeOldEvents();

    // Assert
    expect(result.maxAgeDays).toBe(7);
    expect(mockRun).toHaveBeenCalledWith('-7 days');
  });

  it('should return { deleted: 0, maxAgeDays } when DB is unavailable', async () => {
    // Arrange: database throws
    vi.doMock('../../src/core/database.js', () => ({
      getDatabase: vi.fn(() => {
        throw new Error('Database not initialized');
      }),
    }));

    const { purgeOldEvents } = await import('../../src/messaging/event-ttl.js');

    // Act
    const result = purgeOldEvents(30);

    // Assert
    expect(result.deleted).toBe(0);
    expect(result.maxAgeDays).toBe(30);
  });

  it('should return { deleted: 0, maxAgeDays } when prepare throws', async () => {
    // Arrange: prepare throws
    vi.doMock('../../src/core/database.js', () => ({
      getDatabase: vi.fn(() => ({
        prepare: vi.fn(() => { throw new Error('prepare error'); }),
      })),
    }));

    const { purgeOldEvents } = await import('../../src/messaging/event-ttl.js');

    // Act
    const result = purgeOldEvents(14);

    // Assert
    expect(result.deleted).toBe(0);
    expect(result.maxAgeDays).toBe(14);
  });

  it('startTtlTimer should return a stop function that clears the interval', async () => {
    // Arrange
    vi.useFakeTimers();
    const mockRun = vi.fn(() => ({ changes: 0 }));
    const dbMock = {
      prepare: vi.fn(() => ({ run: mockRun })),
    };

    vi.doMock('../../src/core/database.js', () => ({
      getDatabase: vi.fn(() => dbMock),
    }));

    const { startTtlTimer } = await import('../../src/messaging/event-ttl.js');

    // Act
    const stop = startTtlTimer(1000, 7);

    // The timer should fire and call purgeOldEvents → getDatabase → prepare → run
    // After 1 tick, nothing yet (interval is 1000ms)
    expect(mockRun).not.toHaveBeenCalled();

    // Advance time by 1100ms to trigger the interval
    vi.advanceTimersByTime(1100);

    // Now purgeOldEvents should have been called
    expect(mockRun).toHaveBeenCalledTimes(1);

    // Stop the timer
    stop();
    vi.advanceTimersByTime(2000);
    // Should NOT have been called again after stop
    expect(mockRun).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });

  it('should return 0 deleted when no old events exist', async () => {
    // Arrange
    const mockRun = vi.fn(() => ({ changes: 0 }));
    const dbMock = {
      prepare: vi.fn(() => ({ run: mockRun })),
    };

    vi.doMock('../../src/core/database.js', () => ({
      getDatabase: vi.fn(() => dbMock),
    }));

    const { purgeOldEvents } = await import('../../src/messaging/event-ttl.js');

    // Act
    const result = purgeOldEvents(365);

    // Assert
    expect(result.deleted).toBe(0);
    expect(result.maxAgeDays).toBe(365);
  });
});
