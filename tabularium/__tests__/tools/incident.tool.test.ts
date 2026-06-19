/**
 * __tests__/tools/incident.tool.test.ts
 * Test per tools/incident.tool.ts — Incident Management Tools (Fase 8 PANTHEON)
 *
 * Copertura:
 * - incident_create: nome tool corretto, inputSchema con campi required
 * - incident_create: parametri mancanti → isError
 * - incident_create: parametri validi → success
 * - incident_list: parametri validi → success
 * - incident_list: parametri non validi → isError
 * - incident_update: parametri validi (mitigate/resolve) → success
 * - incident_update: parametri mancanti → isError
 * - incident_update: action non valida → isError
 *
 * @module tests/tools/incident
 */

import {
  incidentCreateToolHandler,
  incidentListToolHandler,
  incidentUpdateToolHandler,
} from '../../src/tools/incident.tool.js';

// ---------------------------------------------------------------------------
// Mock del modulo core
// ---------------------------------------------------------------------------

jest.mock('../../src/core/incident-manager.js', () => ({
  createIncident: jest.fn(),
  listIncidents: jest.fn(),
  mitigateIncident: jest.fn(),
  resolveIncident: jest.fn(),
  ensureIncidentSchema: jest.fn(),
}));

import { createIncident, listIncidents, mitigateIncident, resolveIncident, ensureIncidentSchema } from '../../src/core/incident-manager.js';

const mockCreateIncident = createIncident as jest.MockedFunction<typeof createIncident>;
const mockListIncidents = listIncidents as jest.MockedFunction<typeof listIncidents>;
const mockMitigateIncident = mitigateIncident as jest.MockedFunction<typeof mitigateIncident>;
const mockResolveIncident = resolveIncident as jest.MockedFunction<typeof resolveIncident>;
const mockEnsureIncidentSchema = ensureIncidentSchema as jest.MockedFunction<typeof ensureIncidentSchema>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseResult(toolResult: { content: Array<{ type: string; text: string }>; isError?: boolean }): unknown {
  return JSON.parse(toolResult.content[0].text);
}

function fakeIncidentRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'inc_test_001',
    title: 'Test incident',
    description: 'Test description',
    severity: 'major',
    status: 'detected',
    domain: 'quality',
    source: 'quality_gate',
    detected_at: '2026-05-26T12:00:00.000Z',
    mitigated_at: undefined,
    mitigated_by: undefined,
    resolved_at: undefined,
    resolved_by: undefined,
    root_cause: undefined,
    action_taken: undefined,
    tags: undefined,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Suite: incidentCreateToolHandler
// ---------------------------------------------------------------------------

describe('incidentCreateToolHandler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('ha nome e inputSchema corretti', () => {
    expect(incidentCreateToolHandler.name).toBe('incident_create');
    expect(incidentCreateToolHandler.inputSchema).toBeDefined();
    expect(incidentCreateToolHandler.inputSchema.required).toContain('title');
    expect(incidentCreateToolHandler.inputSchema.required).toContain('description');
    expect(incidentCreateToolHandler.inputSchema.required).toContain('severity');
  });

  it('restituisce isError true quando title manca', async () => {
    const result = await incidentCreateToolHandler.handler({
      description: 'Test',
      severity: 'major',
    });

    expect(result.isError).toBe(true);
    const parsed = parseResult(result) as { success: boolean; error: string; message: string };
    expect(parsed.error).toBe('VALIDATION_ERROR');
    expect(parsed.message).toContain('title');
  });

  it('restituisce isError true quando description manca', async () => {
    const result = await incidentCreateToolHandler.handler({
      title: 'Test',
      severity: 'major',
    });

    expect(result.isError).toBe(true);
    const parsed = parseResult(result) as { success: boolean; error: string; message: string };
    expect(parsed.error).toBe('VALIDATION_ERROR');
    expect(parsed.message).toContain('description');
  });

  it('restituisce isError true quando severity manca', async () => {
    const result = await incidentCreateToolHandler.handler({
      title: 'Test',
      description: 'Test',
    });

    expect(result.isError).toBe(true);
    const parsed = parseResult(result) as { success: boolean; error: string; message: string };
    expect(parsed.error).toBe('VALIDATION_ERROR');
    expect(parsed.message).toContain('severity');
  });

  it('restituisce isError true per severity non valida', async () => {
    const result = await incidentCreateToolHandler.handler({
      title: 'Test',
      description: 'Test',
      severity: 'super-critical',
    });

    expect(result.isError).toBe(true);
    const parsed = parseResult(result) as { success: boolean; error: string; message: string };
    expect(parsed.error).toBe('VALIDATION_ERROR');
    expect(parsed.message).toContain('severity');
  });

  it('restituisce success true con parametri validi', async () => {
    mockCreateIncident.mockReturnValue(fakeIncidentRecord() as never);

    const result = await incidentCreateToolHandler.handler({
      title: 'Test incident',
      description: 'Test description',
      severity: 'major',
      domain: 'quality',
      source: 'quality_gate',
    });

    expect(result.isError).toBeUndefined();
    const parsed = parseResult(result) as { success: boolean; data: Record<string, unknown> };
    expect(parsed.success).toBe(true);
    expect(parsed.data.id).toBe('inc_test_001');
    expect(parsed.data.title).toBe('Test incident');
    expect(parsed.data.severity).toBe('major');
    expect(parsed.data.status).toBe('detected');

    expect(mockCreateIncident).toHaveBeenCalledWith({
      title: 'Test incident',
      description: 'Test description',
      severity: 'major',
      domain: 'quality',
      source: 'quality_gate',
    });
    expect(mockEnsureIncidentSchema).toHaveBeenCalled();
  });

  it('restituisce isError true quando createIncident lancia errore', async () => {
    mockCreateIncident.mockImplementation(() => {
      throw new Error('DB error');
    });

    const result = await incidentCreateToolHandler.handler({
      title: 'Test',
      description: 'Test',
      severity: 'major',
    });

    expect(result.isError).toBe(true);
    const parsed = parseResult(result) as { success: boolean; error: string; message: string };
    expect(parsed.error).toBe('CREATE_ERROR');
    expect(parsed.message).toContain('DB error');
  });
});

// ---------------------------------------------------------------------------
// Suite: incidentListToolHandler
// ---------------------------------------------------------------------------

describe('incidentListToolHandler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('ha nome e inputSchema corretti', () => {
    expect(incidentListToolHandler.name).toBe('incident_list');
    expect(incidentListToolHandler.inputSchema).toBeDefined();
    expect(incidentListToolHandler.inputSchema.properties).toHaveProperty('status');
    expect(incidentListToolHandler.inputSchema.properties).toHaveProperty('severity');
    expect(incidentListToolHandler.inputSchema.properties).toHaveProperty('domain');
  });

  it('restituisce success true con parametri validi', async () => {
    mockListIncidents.mockReturnValue({
      total: 2,
      incidents: [fakeIncidentRecord({ id: 'inc_001' }), fakeIncidentRecord({ id: 'inc_002' })],
    } as never);

    const result = await incidentListToolHandler.handler({ status: 'detected' });

    expect(result.isError).toBeUndefined();
    const parsed = parseResult(result) as { success: boolean; data: { total: number; returned: number; incidents: unknown[] } };
    expect(parsed.success).toBe(true);
    expect(parsed.data.total).toBe(2);
    expect(parsed.data.returned).toBe(2);

    expect(mockListIncidents).toHaveBeenCalledWith({
      status: 'detected',
      severity: undefined,
      domain: undefined,
      limit: undefined,
      offset: undefined,
    });
  });

  it('restituisce success con filtri multipli', async () => {
    mockListIncidents.mockReturnValue({
      total: 1,
      incidents: [fakeIncidentRecord()],
    } as never);

    const result = await incidentListToolHandler.handler({
      status: 'detected',
      severity: 'critical',
      domain: 'security',
      limit: 10,
      offset: 0,
    });

    expect(result.isError).toBeUndefined();
    expect(mockListIncidents).toHaveBeenCalledWith({
      status: 'detected',
      severity: 'critical',
      domain: 'security',
      limit: 10,
      offset: 0,
    });
  });

  it('restituisce isError true per status non valido', async () => {
    const result = await incidentListToolHandler.handler({ status: 'invalid' });

    expect(result.isError).toBe(true);
    const parsed = parseResult(result) as { success: boolean; error: string; message: string };
    expect(parsed.error).toBe('VALIDATION_ERROR');
    expect(parsed.message).toContain('status');
  });

  it('restituisce isError true per severity non valida', async () => {
    const result = await incidentListToolHandler.handler({ severity: 'very_high' });

    expect(result.isError).toBe(true);
    const parsed = parseResult(result) as { success: boolean; error: string; message: string };
    expect(parsed.error).toBe('VALIDATION_ERROR');
    expect(parsed.message).toContain('severity');
  });

  it('restituisce isError true per domain non valido', async () => {
    const result = await incidentListToolHandler.handler({ domain: 'unknown' });

    expect(result.isError).toBe(true);
    const parsed = parseResult(result) as { success: boolean; error: string; message: string };
    expect(parsed.error).toBe('VALIDATION_ERROR');
    expect(parsed.message).toContain('domain');
  });

  it('restituisce isError true per limit non valido', async () => {
    const result = await incidentListToolHandler.handler({ limit: -1 });

    expect(result.isError).toBe(true);
    const parsed = parseResult(result) as { success: boolean; error: string; message: string };
    expect(parsed.error).toBe('VALIDATION_ERROR');
    expect(parsed.message).toContain('limit');
  });

  it('restituisce isError true quando listIncidents lancia errore', async () => {
    mockListIncidents.mockImplementation(() => {
      throw new Error('DB error');
    });

    const result = await incidentListToolHandler.handler({});

    expect(result.isError).toBe(true);
    const parsed = parseResult(result) as { success: boolean; error: string; message: string };
    expect(parsed.error).toBe('LIST_ERROR');
    expect(parsed.message).toContain('DB error');
  });
});

// ---------------------------------------------------------------------------
// Suite: incidentUpdateToolHandler
// ---------------------------------------------------------------------------

describe('incidentUpdateToolHandler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('ha nome e inputSchema corretti', () => {
    expect(incidentUpdateToolHandler.name).toBe('incident_update');
    expect(incidentUpdateToolHandler.inputSchema).toBeDefined();
    expect(incidentUpdateToolHandler.inputSchema.required).toContain('incidentId');
    expect(incidentUpdateToolHandler.inputSchema.required).toContain('action');
    expect(incidentUpdateToolHandler.inputSchema.required).toContain('by');
  });

  it('restituisce success true per mitigate', async () => {
    mockMitigateIncident.mockReturnValue(fakeIncidentRecord({
      status: 'mitigated',
      mitigated_by: 'diana-tester',
      action_taken: 'Applied hotfix',
    }) as never);

    const result = await incidentUpdateToolHandler.handler({
      incidentId: 'inc_test_001',
      action: 'mitigate',
      by: 'diana-tester',
      actionTaken: 'Applied hotfix',
    });

    expect(result.isError).toBeUndefined();
    const parsed = parseResult(result) as { success: boolean; data: Record<string, unknown> };
    expect(parsed.success).toBe(true);
    expect(parsed.data.status).toBe('mitigated');
    expect(parsed.data.mitigated_by).toBe('diana-tester');

    expect(mockMitigateIncident).toHaveBeenCalledWith(
      'inc_test_001',
      'diana-tester',
      'Applied hotfix',
    );
  });

  it('restituisce success true per resolve', async () => {
    mockResolveIncident.mockReturnValue(fakeIncidentRecord({
      status: 'resolved',
      resolved_by: 'diana-tester',
      root_cause: 'Found the bug',
    }) as never);

    const result = await incidentUpdateToolHandler.handler({
      incidentId: 'inc_test_001',
      action: 'resolve',
      by: 'diana-tester',
      rootCause: 'Found the bug',
    });

    expect(result.isError).toBeUndefined();
    const parsed = parseResult(result) as { success: boolean; data: Record<string, unknown> };
    expect(parsed.success).toBe(true);
    expect(parsed.data.status).toBe('resolved');
    expect(parsed.data.resolved_by).toBe('diana-tester');
    expect(parsed.data.root_cause).toBe('Found the bug');

    expect(mockResolveIncident).toHaveBeenCalledWith(
      'inc_test_001',
      'diana-tester',
      'Found the bug',
      undefined,
    );
  });

  it('restituisce isError true per incidentId mancante', async () => {
    const result = await incidentUpdateToolHandler.handler({
      action: 'mitigate',
      by: 'diana',
    });

    expect(result.isError).toBe(true);
    const parsed = parseResult(result) as { success: boolean; error: string; message: string };
    expect(parsed.error).toBe('VALIDATION_ERROR');
    expect(parsed.message).toContain('incidentId');
  });

  it('restituisce isError true per action mancante', async () => {
    const result = await incidentUpdateToolHandler.handler({
      incidentId: 'inc_001',
      by: 'diana',
    });

    expect(result.isError).toBe(true);
    const parsed = parseResult(result) as { success: boolean; error: string; message: string };
    expect(parsed.error).toBe('VALIDATION_ERROR');
    expect(parsed.message).toContain('action');
  });

  it('restituisce isError true per by mancante', async () => {
    const result = await incidentUpdateToolHandler.handler({
      incidentId: 'inc_001',
      action: 'mitigate',
    });

    expect(result.isError).toBe(true);
    const parsed = parseResult(result) as { success: boolean; error: string; message: string };
    expect(parsed.error).toBe('VALIDATION_ERROR');
    expect(parsed.message).toContain('by');
  });

  it('restituisce isError true per action non valida', async () => {
    const result = await incidentUpdateToolHandler.handler({
      incidentId: 'inc_001',
      action: 'delete',
      by: 'diana',
    });

    expect(result.isError).toBe(true);
    const parsed = parseResult(result) as { success: boolean; error: string; message: string };
    expect(parsed.error).toBe('VALIDATION_ERROR');
    expect(parsed.message).toContain('action');
  });

  it('restituisce isError true quando mitigateIncident lancia errore', async () => {
    mockMitigateIncident.mockImplementation(() => {
      throw new Error('Incident not found');
    });

    const result = await incidentUpdateToolHandler.handler({
      incidentId: 'inc_unknown',
      action: 'mitigate',
      by: 'diana',
    });

    expect(result.isError).toBe(true);
    const parsed = parseResult(result) as { success: boolean; error: string; message: string };
    expect(parsed.error).toBe('UPDATE_ERROR');
    expect(parsed.message).toContain('Incident not found');
  });

  it('restituisce isError true quando resolveIncident lancia errore', async () => {
    mockResolveIncident.mockImplementation(() => {
      throw new Error('Invalid transition');
    });

    const result = await incidentUpdateToolHandler.handler({
      incidentId: 'inc_001',
      action: 'resolve',
      by: 'diana',
    });

    expect(result.isError).toBe(true);
    const parsed = parseResult(result) as { success: boolean; error: string; message: string };
    expect(parsed.error).toBe('UPDATE_ERROR');
    expect(parsed.message).toContain('Invalid transition');
  });
});
