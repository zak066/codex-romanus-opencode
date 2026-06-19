/** @vitest-environment node */
import { vi, describe, it, expect, beforeAll } from 'vitest';

// Mock fs/promises PRIMA di ogni import
vi.mock('fs/promises', () => ({
  readFile: vi.fn(),
}));

describe('GET /api/package', () => {
  let GET: () => Promise<Response>;
  let readFile: any;

  beforeAll(async () => {
    const fs = await import('fs/promises');
    readFile = fs.readFile;

    // Setup mock: root package.json
    readFile.mockImplementation((filePath: string) => {
      if (filePath.includes('praetorium\\package.json')) {
        // praetorium package.json
        return Promise.resolve(
          JSON.stringify({
            name: 'praetorium',
            version: '0.1.0',
            private: false,
            description: 'Praetorium UI',
            dependencies: { react: '^18.0.0' },
          })
        );
      }
      // root package.json (non-praetorium path)
      return Promise.resolve(
        JSON.stringify({
          name: 'codex-romanus',
          version: '1.0.0',
          private: true,
          description: 'Root project',
        })
      );
    });

    const route = await import('../package/route');
    GET = route.GET;
  });

  it('should return package info with status 200', async () => {
    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.praetoriumPackage).toBeDefined();
    expect(data.praetoriumPackage.name).toBe('praetorium');
    expect(data.praetoriumPackage.version).toBe('0.1.0');
    expect(data.rootPackage).toBeDefined();
    expect(data.rootPackage.name).toBe('codex-romanus');
  });

  it('should include dependencies', async () => {
    const response = await GET();
    const data = await response.json();

    expect(data.dependencies).toBeDefined();
    expect(data.dependencies.react).toBe('^18.0.0');
  });
});

