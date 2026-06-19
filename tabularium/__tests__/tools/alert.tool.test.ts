/**
 * Test per tools/alert.tool.ts — Alert System Tools (Fase 6: AUTOMATA)
 *
 * Copertura:
 * - alert_list → success true, data.alerts array
 * - alert_list con filtri (status, domain, severity, limit, offset)
 * - alert_list con parametri non validi → isError true
 * - alert_acknowledge con alertId mancante → isError true
 * - alert_acknowledge con by mancante → isError true
 * - alert_acknowledge con parametri validi → success true, chiama acknowledgeAlert
 * - alert_acknowledge con error da acknowledgeAlert → isError true
 * - alert_resolve con alertId mancante → isError true
 * - alert_resolve con by mancante → isError true
 * - alert_resolve con parametri validi → success true, chiama resolveAlert
 * - alert_resolve con error da resolveAlert → isError true
 *
 * @module tests/tools/alert-tool
 */

import { alertListToolHandler, alertAcknowledgeToolHandler, alertResolveToolHandler } from '../../src/tools/alert.tool.js';

// ---------------------------------------------------------------------------
// Mock dei moduli core
// ---------------------------------------------------------------------------

jest.mock('../../src/core/alert-manager.js', () => ({
  listAlerts: jest.fn(),
  acknowledgeAlert: jest.fn(),
  resolveAlert: jest.fn(),
  ensureAlertSchema: jest.fn(),
  createAlert: jest.fn(),
}));

import { listAlerts, acknowledgeAlert, resolveAlert, ensureAlertSchema, AlertRecord } from '../../src/core/alert-manager.js';

const mockListAlerts = listAlerts as jest.MockedFunction<typeof listAlerts>;
const mockAcknowledgeAlert = acknowledgeAlert as jest.MockedFunction<typeof acknowledgeAlert>;
const mockResolveAlert = resolveAlert as jest.MockedFunction<typeof resolveAlert>;
const mockEnsureAlertSchema = ensureAlertSchema as jest.MockedFunction<typeof ensureAlertSchema>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Helper per parsare il ToolResult JSON string content in oggetto.
 */
function parseResult(toolResult: { content: Array<{ type: string; text: string }>; isError?: boolean }): unknown {
  return JSON.parse(toolResult.content[0].text);
}

/**
 * Crea un alert finto per i test.
 */
function fakeAlert(overrides: Partial<AlertRecord> = {}): AlertRecord {
  return {
    id: 'alr_test123',
    domain: 'quality',
    metric_name: 'lint_errors',
    severity: 'high',
    source: 'regression_detector',
    message: 'Lint errors exceeded threshold',
    current_value: 12,
    threshold_value: 0,
    deviation_pct: 50.5,
    status: 'open',
    created_at: '2026-05-26T10:00:00.000Z',
    tags: { agent: 'catone-quality' },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Suite: alertListToolHandler
// ---------------------------------------------------------------------------

describe('alertListToolHandler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('restituisce success true e data.alerts array quando non ci sono filtri', async () => {
    mockListAlerts.mockReturnValue({
      total: 2,
      alerts: [fakeAlert({ id: 'alr_001' }), fakeAlert({ id: 'alr_002', domain: 'perf' })],
    });

    const result = await alertListToolHandler.handler({});

    expect(result.isError).toBeUndefined();
    const parsed = parseResult(result) as { success: boolean; data: { total: number; returned: number; alerts: unknown[] } };
    expect(parsed.success).toBe(true);
    expect(parsed.data.total).toBe(2);
    expect(parsed.data.returned).toBe(2);
    expect(parsed.data.alerts).toHaveLength(2);
    expect(listAlerts).toHaveBeenCalledWith({});
  });

  it('passa i filtri a listAlerts e restituisce il risultato filtrato', async () => {
    mockListAlerts.mockReturnValue({
      total: 1,
      alerts: [fakeAlert({ id: 'alr_001', domain: 'security', severity: 'critical', status: 'open' })],
    });

    const args = {
      status: 'open',
      domain: 'security',
      severity: 'critical',
      limit: 10,
      offset: 0,
    };
    const result = await alertListToolHandler.handler(args);

    expect(result.isError).toBeUndefined();
    const parsed = parseResult(result) as { success: boolean; data: { total: number; returned: number } };
    expect(parsed.success).toBe(true);
    expect(parsed.data.total).toBe(1);

    expect(listAlerts).toHaveBeenCalledWith({
      status: 'open',
      domain: 'security',
      severity: 'critical',
      limit: 10,
      offset: 0,
    });
  });

  it('restituisce array vuoto quando non ci sono alert', async () => {
    mockListAlerts.mockReturnValue({ total: 0, alerts: [] });

    const result = await alertListToolHandler.handler({});

    expect(result.isError).toBeUndefined();
    const parsed = parseResult(result) as { success: boolean; data: { total: number; alerts: unknown[] } };
    expect(parsed.success).toBe(true);
    expect(parsed.data.total).toBe(0);
    expect(parsed.data.alerts).toEqual([]);
  });

  it('chiama ensureAlertSchema per garantire che la tabella esista', async () => {
    mockListAlerts.mockReturnValue({ total: 0, alerts: [] });

    await alertListToolHandler.handler({});

    expect(mockEnsureAlertSchema).toHaveBeenCalled();
  });

  it('gestisce errore di ensureAlertSchema (DB non inizializzato)', async () => {
    mockEnsureAlertSchema.mockImplementation(() => {
      throw new Error('DB not ready');
    });
    mockListAlerts.mockReturnValue({ total: 0, alerts: [] });

    const result = await alertListToolHandler.handler({});

    // Deve comunque funzionare perché l'errore è catturato
    expect(result.isError).toBeUndefined();
    const parsed = parseResult(result) as { success: boolean };
    expect(parsed.success).toBe(true);
  });

  // ── Validazione parametri ────────────────────────────────────────────

  it('restituisce isError true quando status non è valido', async () => {
    const result = await alertListToolHandler.handler({ status: 'invalid_status' });

    expect(result.isError).toBe(true);
    const parsed = parseResult(result) as { success: boolean; error: string; message: string };
    expect(parsed.success).toBe(false);
    expect(parsed.error).toBe('VALIDATION_ERROR');
    expect(parsed.message).toContain('status');
  });

  it('restituisce isError true quando domain non è valido', async () => {
    const result = await alertListToolHandler.handler({ domain: 'bogus_domain' });

    expect(result.isError).toBe(true);
    const parsed = parseResult(result) as { success: boolean; error: string; message: string };
    expect(parsed.success).toBe(false);
    expect(parsed.error).toBe('VALIDATION_ERROR');
    expect(parsed.message).toContain('domain');
  });

  it('restituisce isError true quando severity non è valida', async () => {
    const result = await alertListToolHandler.handler({ severity: 'very_high' });

    expect(result.isError).toBe(true);
    const parsed = parseResult(result) as { success: boolean; error: string; message: string };
    expect(parsed.success).toBe(false);
    expect(parsed.error).toBe('VALIDATION_ERROR');
    expect(parsed.message).toContain('severity');
  });

  it('restituisce isError true quando limit non è valido', async () => {
    const result = await alertListToolHandler.handler({ limit: 2000 });

    expect(result.isError).toBe(true);
    const parsed = parseResult(result) as { success: boolean; error: string; message: string };
    expect(parsed.error).toBe('VALIDATION_ERROR');
    expect(parsed.message).toContain('limit');
  });

  it('restituisce isError true quando limit è negativo', async () => {
    const result = await alertListToolHandler.handler({ limit: -5 });

    expect(result.isError).toBe(true);
    const parsed = parseResult(result) as { success: boolean; error: string; message: string };
    expect(parsed.error).toBe('VALIDATION_ERROR');
    expect(parsed.message).toContain('limit');
  });

  it('restituisce isError true quando offset non è valido', async () => {
    const result = await alertListToolHandler.handler({ offset: -1 });

    expect(result.isError).toBe(true);
    const parsed = parseResult(result) as { success: boolean; error: string; message: string };
    expect(parsed.error).toBe('VALIDATION_ERROR');
    expect(parsed.message).toContain('offset');
  });

  it('restituisce isError true quando listAlerts lancia errore', async () => {
    mockListAlerts.mockImplementation(() => {
      throw new Error('Database error');
    });

    const result = await alertListToolHandler.handler({});

    expect(result.isError).toBe(true);
    const parsed = parseResult(result) as { success: boolean; error: string; message: string };
    expect(parsed.success).toBe(false);
    expect(parsed.error).toBe('LIST_ERROR');
    expect(parsed.message).toContain('Database error');
  });
});

// ---------------------------------------------------------------------------
// Suite: alertAcknowledgeToolHandler
// ---------------------------------------------------------------------------

describe('alertAcknowledgeToolHandler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('restituisce isError true quando alertId non fornito', async () => {
    const result = await alertAcknowledgeToolHandler.handler({ by: 'diana' });

    expect(result.isError).toBe(true);
    const parsed = parseResult(result) as { success: boolean; error: string; message: string };
    expect(parsed.success).toBe(false);
    expect(parsed.error).toBe('VALIDATION_ERROR');
    expect(parsed.message).toContain('alertId');
  });

  it('restituisce isError true quando alertId è stringa vuota', async () => {
    const result = await alertAcknowledgeToolHandler.handler({ alertId: '', by: 'diana' });

    expect(result.isError).toBe(true);
    const parsed = parseResult(result) as { success: boolean; error: string; message: string };
    expect(parsed.error).toBe('VALIDATION_ERROR');
    expect(parsed.message).toContain('alertId');
  });

  it('restituisce isError true quando by non fornito', async () => {
    const result = await alertAcknowledgeToolHandler.handler({ alertId: 'alr_001' });

    expect(result.isError).toBe(true);
    const parsed = parseResult(result) as { success: boolean; error: string; message: string };
    expect(parsed.success).toBe(false);
    expect(parsed.error).toBe('VALIDATION_ERROR');
    expect(parsed.message).toContain('by');
  });

  it('restituisce isError true quando entrambi i parametri mancano', async () => {
    const result = await alertAcknowledgeToolHandler.handler({});

    expect(result.isError).toBe(true);
    const parsed = parseResult(result) as { success: boolean; error: string; message: string };
    expect(parsed.success).toBe(false);
  });

  it('restituisce success true con parametri validi e chiama acknowledgeAlert', async () => {
    mockAcknowledgeAlert.mockReturnValue({
      id: 'alr_001',
      status: 'acknowledged',
      acknowledged_at: '2026-05-26T12:00:00.000Z',
      acknowledged_by: 'diana-tester',
      domain: 'quality',
      metric_name: 'lint_errors',
      severity: 'high',
      source: 'regression_detector',
      message: 'Lint errors exceeded',
      current_value: 12,
      threshold_value: 0,
      deviation_pct: 50,
      created_at: '2026-05-26T10:00:00.000Z',
      resolved_at: undefined,
      resolved_by: undefined,
    });

    const result = await alertAcknowledgeToolHandler.handler({
      alertId: 'alr_001',
      by: 'diana-tester',
    });

    expect(result.isError).toBeUndefined();
    const parsed = parseResult(result) as { success: boolean; data: { id: string; status: string; acknowledged_by: string; acknowledged_at: string } };
    expect(parsed.success).toBe(true);
    expect(parsed.data.id).toBe('alr_001');
    expect(parsed.data.status).toBe('acknowledged');
    expect(parsed.data.acknowledged_by).toBe('diana-tester');
    expect(parsed.data.acknowledged_at).toBeTruthy();

    expect(mockAcknowledgeAlert).toHaveBeenCalledWith('alr_001', 'diana-tester');
  });

  it('chiama ensureAlertSchema', async () => {
    mockAcknowledgeAlert.mockReturnValue({
      id: 'alr_001',
      status: 'acknowledged',
      acknowledged_at: '2026-05-26T12:00:00.000Z',
      acknowledged_by: 'diana',
      domain: 'quality',
      metric_name: 'lint_errors',
      severity: 'high',
      source: 'regression_detector',
      message: 'Test',
      created_at: '2026-05-26T10:00:00.000Z',
      resolved_at: undefined,
      resolved_by: undefined,
    });

    await alertAcknowledgeToolHandler.handler({ alertId: 'alr_001', by: 'diana' });

    expect(mockEnsureAlertSchema).toHaveBeenCalled();
  });

  it('restituisce isError true quando acknowledgeAlert lancia errore', async () => {
    mockAcknowledgeAlert.mockImplementation(() => {
      throw new Error('Alert not found');
    });

    const result = await alertAcknowledgeToolHandler.handler({
      alertId: 'alr_nonexistent',
      by: 'diana',
    });

    expect(result.isError).toBe(true);
    const parsed = parseResult(result) as { success: boolean; error: string; message: string };
    expect(parsed.success).toBe(false);
    expect(parsed.error).toBe('ACKNOWLEDGE_ERROR');
    expect(parsed.message).toContain('Alert not found');
  });
});

// ---------------------------------------------------------------------------
// Suite: alertResolveToolHandler
// ---------------------------------------------------------------------------

describe('alertResolveToolHandler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('restituisce isError true quando alertId non fornito', async () => {
    const result = await alertResolveToolHandler.handler({ by: 'janus' });

    expect(result.isError).toBe(true);
    const parsed = parseResult(result) as { success: boolean; error: string; message: string };
    expect(parsed.success).toBe(false);
    expect(parsed.error).toBe('VALIDATION_ERROR');
    expect(parsed.message).toContain('alertId');
  });

  it('restituisce isError true quando by non fornito', async () => {
    const result = await alertResolveToolHandler.handler({ alertId: 'alr_001' });

    expect(result.isError).toBe(true);
    const parsed = parseResult(result) as { success: boolean; error: string; message: string };
    expect(parsed.success).toBe(false);
    expect(parsed.error).toBe('VALIDATION_ERROR');
    expect(parsed.message).toContain('by');
  });

  it('restituisce isError true quando by è stringa vuota', async () => {
    const result = await alertResolveToolHandler.handler({ alertId: 'alr_001', by: '' });

    expect(result.isError).toBe(true);
    const parsed = parseResult(result) as { success: boolean; error: string; message: string };
    expect(parsed.error).toBe('VALIDATION_ERROR');
    expect(parsed.message).toContain('by');
  });

  it('restituisce success true con parametri validi e chiama resolveAlert', async () => {
    mockResolveAlert.mockReturnValue({
      id: 'alr_001',
      status: 'resolved',
      resolved_at: '2026-05-26T12:30:00.000Z',
      resolved_by: 'janus-security',
      domain: 'quality',
      metric_name: 'lint_errors',
      severity: 'high',
      source: 'regression_detector',
      message: 'Lint errors exceeded',
      current_value: 12,
      threshold_value: 0,
      deviation_pct: 50,
      created_at: '2026-05-26T10:00:00.000Z',
      acknowledged_at: undefined,
      acknowledged_by: undefined,
    });

    const result = await alertResolveToolHandler.handler({
      alertId: 'alr_001',
      by: 'janus-security',
    });

    expect(result.isError).toBeUndefined();
    const parsed = parseResult(result) as { success: boolean; data: { id: string; status: string; resolved_by: string; resolved_at: string } };
    expect(parsed.success).toBe(true);
    expect(parsed.data.id).toBe('alr_001');
    expect(parsed.data.status).toBe('resolved');
    expect(parsed.data.resolved_by).toBe('janus-security');
    expect(parsed.data.resolved_at).toBeTruthy();

    expect(mockResolveAlert).toHaveBeenCalledWith('alr_001', 'janus-security');
  });

  it('chiama ensureAlertSchema', async () => {
    mockResolveAlert.mockReturnValue({
      id: 'alr_001',
      status: 'resolved',
      resolved_at: '2026-05-26T12:30:00.000Z',
      resolved_by: 'janus',
      domain: 'quality',
      metric_name: 'lint_errors',
      severity: 'high',
      source: 'regression_detector',
      message: 'Test',
      created_at: '2026-05-26T10:00:00.000Z',
      acknowledged_at: undefined,
      acknowledged_by: undefined,
    });

    await alertResolveToolHandler.handler({ alertId: 'alr_001', by: 'janus' });

    expect(mockEnsureAlertSchema).toHaveBeenCalled();
  });

  it('restituisce isError true quando resolveAlert lancia errore', async () => {
    mockResolveAlert.mockImplementation(() => {
      throw new Error('Alert already resolved');
    });

    const result = await alertResolveToolHandler.handler({
      alertId: 'alr_001',
      by: 'janus',
    });

    expect(result.isError).toBe(true);
    const parsed = parseResult(result) as { success: boolean; error: string; message: string };
    expect(parsed.success).toBe(false);
    expect(parsed.error).toBe('RESOLVE_ERROR');
    expect(parsed.message).toContain('Alert already resolved');
  });
});
