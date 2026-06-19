import { vi } from 'vitest';
import '@testing-library/jest-dom';

// Global fetch mock for tests in jsdom environment
globalThis.fetch = vi.fn((url: string | URL | Request) => {
  const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
  if (urlStr.includes('/api/channels')) {
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        channels: [
          { id: '1', name: 'general', description: 'Canale generale', is_default: true, message_count: 3 },
          { id: '2', name: 'design', description: 'Design channel', is_default: false, message_count: 0 },
        ],
        total: 2,
      }),
    } as Response);
  }
  if (urlStr.includes('/api/metrics')) {
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        tabs: ['Performance', 'Quality', 'System'],
      }),
    } as Response);
  }
  return Promise.resolve({ ok: true, json: () => Promise.resolve({}) } as Response);
});
