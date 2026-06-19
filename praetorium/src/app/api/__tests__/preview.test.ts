/** @vitest-environment node */
import { vi, describe, it, expect, beforeAll, beforeEach } from 'vitest';

vi.mock('fs/promises', () => ({
  readFile: vi.fn(),
}));

describe('POST /api/preview', () => {
  let POST: (request: Request) => Promise<Response>;
  let readFile: any;

  const mockConfig = {
    agent: {
      vulcanus: { model: 'sonnet', description: 'Senior Dev' },
      mercurius: { model: 'gpt-4o', description: 'Junior Dev' },
    },
  };

  beforeAll(async () => {
    const fs = await import('fs/promises');
    readFile = fs.readFile;
    readFile.mockResolvedValue(JSON.stringify(mockConfig));

    const route = await import('../preview/route');
    POST = route.POST;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    readFile.mockResolvedValue(JSON.stringify(mockConfig));
  });

  function makePost(body: object) {
    return new Request('http://localhost/api/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  it('should return preview with updated model', async () => {
    const response = await POST(
      makePost({ agentName: 'vulcanus', updates: { model: 'gpt-4o' } })
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.preview.before.model).toBe('sonnet');
    expect(data.preview.after.model).toBe('gpt-4o');
    expect(data.preview.updatedKeys).toContain('model');
  });

  it('should return 400 if agentName is missing', async () => {
    const response = await POST(makePost({ updates: { model: 'gpt-4o' } }));
    expect(response.status).toBe(400);
  });

  it('should return 400 if updates is missing', async () => {
    const response = await POST(makePost({ agentName: 'vulcanus' }));
    expect(response.status).toBe(400);
  });

  it('should return 404 if agent not found', async () => {
    const response = await POST(
      makePost({ agentName: 'nonexistent', updates: { model: 'gpt-4o' } })
    );
    expect(response.status).toBe(404);
  });
});
