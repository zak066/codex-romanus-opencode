/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';

vi.mock('fs/promises', () => ({
  readFile: vi.fn(),
}));

describe('GET /api/models', () => {
  let readFile: ReturnType<typeof vi.fn>;
  let GET: () => Promise<Response>;

  const mockConfig = {
    agent: {
      'vulcanus-senior-dev': { model: 'sonnet', status: 'idle' },
      'minerva-architect': { model: 'sonnet', status: 'busy' },
    },
  };

  beforeAll(async () => {
    const fsMock = await import('fs/promises');
    readFile = fsMock.readFile as unknown as ReturnType<typeof vi.fn>;
    readFile.mockResolvedValue(JSON.stringify(mockConfig));

    const route = await import('../models/route');
    GET = route.GET;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    readFile.mockResolvedValue(JSON.stringify(mockConfig));
  });

  it('should return 200 with agents array', async () => {
    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.agents).toHaveLength(2);
    expect(data.agents[0]).toMatchObject({ name: 'vulcanus-senior-dev' });
    expect(data.agents[1]).toMatchObject({ name: 'minerva-architect' });
  });

  it('should return empty array if no agents config', async () => {
    readFile.mockResolvedValue(JSON.stringify({ project: 'test' }));

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.agents).toEqual([]);
  });

  it('should return 500 on file read error', async () => {
    readFile.mockRejectedValue(new Error('File not found'));

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.error).toBe('Failed to load models');
  });

  it('should return 500 on invalid JSON', async () => {
    readFile.mockResolvedValue('not-valid-json');

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.error).toBe('Failed to load models');
  });
});
