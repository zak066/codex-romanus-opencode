/** @vitest-environment node */
import { vi, describe, it, expect, beforeEach } from 'vitest';

// Mock fs/promises
vi.mock('fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
}));

// Mock auth
vi.mock('@/lib/auth', () => ({
  requireAuth: vi.fn(),
}));

// Mock propagation
vi.mock('@/lib/propagation', () => ({
  propagateModelChange: vi.fn(),
}));

describe('POST /api/config', () => {
  let mockReadFile: any;
  let mockWriteFile: any;
  let mockRequireAuth: any;
  let mockPropagateModelChange: any;

  beforeEach(async () => {
    const fsMod = await import('fs/promises');
    const authMod = await import('@/lib/auth');
    const propMod = await import('@/lib/propagation');
    mockReadFile = vi.mocked(fsMod.readFile);
    mockWriteFile = vi.mocked(fsMod.writeFile);
    mockRequireAuth = vi.mocked(authMod.requireAuth);
    mockPropagateModelChange = vi.mocked(propMod.propagateModelChange);
    vi.clearAllMocks();

    // Default: auth passes
    mockRequireAuth.mockReturnValue({ authorized: true });
    // Default: propagation succeeds
    mockPropagateModelChange.mockResolvedValue({ success: true, path: 'test.md' });
  });

  it('dovrebbe restituire 400 se agentName mancante', async () => {
    const { POST } = await import('../config/route');
    const req = new Request('http://localhost/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ updates: { model: 'sonnet' } }),
    });
    const response = await POST(req);
    expect(response.status).toBe(400);
  });

  it('dovrebbe restituire 400 se updates mancanti', async () => {
    const { POST } = await import('../config/route');
    const req = new Request('http://localhost/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentName: 'vulcanus' }),
    });
    const response = await POST(req);
    expect(response.status).toBe(400);
  });

  it('dovrebbe restituire 200 su successo', async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({ agents: { vulcanus: {} } }));
    mockWriteFile.mockResolvedValue(undefined);

    const { POST } = await import('../config/route');
    const req = new Request('http://localhost/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentName: 'vulcanus', updates: { model: 'sonnet' } }),
    });
    const response = await POST(req);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(mockWriteFile).toHaveBeenCalled();
    expect(mockPropagateModelChange).toHaveBeenCalledWith('vulcanus', 'sonnet');
  });

  it('dovrebbe restituire 404 se agente non trovato', async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({ agents: {} }));

    const { POST } = await import('../config/route');
    const req = new Request('http://localhost/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentName: 'unknown', updates: { model: 'sonnet' } }),
    });
    const response = await POST(req);
    expect(response.status).toBe(404);
  });

  it('dovrebbe restituire 500 su errore lettura', async () => {
    mockReadFile.mockRejectedValue(new Error('Read error'));

    const { POST } = await import('../config/route');
    const req = new Request('http://localhost/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentName: 'vulcanus', updates: { model: 'sonnet' } }),
    });
    const response = await POST(req);
    expect(response.status).toBe(500);
  });

  it('dovrebbe restituire 401 se non autorizzato', async () => {
    mockRequireAuth.mockReturnValue({ authorized: false, error: new Response('Unauthorized', { status: 401 }) });

    const { POST } = await import('../config/route');
    const req = new Request('http://localhost/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentName: 'vulcanus', updates: { model: 'sonnet' } }),
    });
    const response = await POST(req);
    expect(response.status).toBe(401);
  });
});

