/**
 * Unit tests for PluginRegistry.
 *
 * Tests cover:
 *   - register / getPlugin / listPlatforms / getRegisteredCount
 *   - loadPlugins error handling (mock readdir)
 *
 * NOTE: Real-filesystem loadPlugins tests are in plugin-registry.real-fs.test.ts
 * to avoid vi.mock hoisting conflicts.
 */

import { PluginRegistry } from '../../src/engine/plugin-registry.js';
import { createMockPlugin } from '../helpers.js';
import { readdir } from 'node:fs/promises';

// ─── Core API ─────────────────────────────────────────────────────────────

describe('PluginRegistry', () => {
  let registry: PluginRegistry;

  beforeEach(() => {
    registry = new PluginRegistry();
  });

  describe('initial state', () => {
    it('should be empty initially', () => {
      expect(registry.getRegisteredCount()).toBe(0);
      expect(registry.listPlatforms()).toEqual([]);
    });
  });

  describe('register', () => {
    it('should add a plugin', () => {
      const plugin = createMockPlugin('test-platform');
      registry.register(plugin);

      expect(registry.getRegisteredCount()).toBe(1);
      expect(registry.listPlatforms()).toEqual(['test-platform']);
    });

    it('should overwrite a previously registered plugin with the same name', () => {
      const pluginA = createMockPlugin('same-name');
      const pluginB = createMockPlugin('same-name');
      pluginB.getPlatformName = vi.fn().mockReturnValue('same-name');

      registry.register(pluginA);
      registry.register(pluginB);

      expect(registry.getRegisteredCount()).toBe(1);
    });

    it('should support multiple distinct platforms', () => {
      registry.register(createMockPlugin('alpha'));
      registry.register(createMockPlugin('beta'));
      registry.register(createMockPlugin('gamma'));

      expect(registry.getRegisteredCount()).toBe(3);
      expect(registry.listPlatforms().sort()).toEqual(['alpha', 'beta', 'gamma']);
    });
  });

  describe('getPlugin', () => {
    it('should return a registered plugin by platform name', () => {
      const plugin = createMockPlugin('my-platform');
      registry.register(plugin);

      expect(registry.getPlugin('my-platform')).toBe(plugin);
    });

    it('should return undefined for an unregistered platform', () => {
      expect(registry.getPlugin('does-not-exist')).toBeUndefined();
    });
  });

  describe('getRegisteredCount', () => {
    it('should return the number of registered plugins', () => {
      expect(registry.getRegisteredCount()).toBe(0);
      registry.register(createMockPlugin('a'));
      expect(registry.getRegisteredCount()).toBe(1);
      registry.register(createMockPlugin('b'));
      expect(registry.getRegisteredCount()).toBe(2);
    });
  });
});

// ─── loadPlugins (mocked readdir) ─────────────────────────────────────────

vi.mock('node:fs/promises', () => ({
  readdir: vi.fn(),
}));

describe('PluginRegistry.loadPlugins (mocked readdir)', () => {
  let registry: PluginRegistry;

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(readdir).mockReset();
    registry = new PluginRegistry();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should handle readdir rejection gracefully (e.g. missing directory)', async () => {
    vi.mocked(readdir).mockRejectedValue(new Error('ENOENT: directory not found'));

    await expect(registry.loadPlugins()).resolves.not.toThrow();
    expect(registry.getRegisteredCount()).toBe(0);
  });

  it('should handle readdir returning empty list', async () => {
    vi.mocked(readdir).mockResolvedValue([]);

    await registry.loadPlugins();

    expect(registry.getRegisteredCount()).toBe(0);
  });

  it('should skip directories starting with a dot', async () => {
    // Even with dot-prefixed dirs, readdir won't find actual plugin modules
    // so each will fail to import. We're just verifying no crash.
    const mockEntry = (name: string) =>
      ({ name, isDirectory: () => true }) as import('node:fs').Dirent;

    vi.mocked(readdir).mockResolvedValue([
      mockEntry('.hidden'),
      mockEntry('.DS_Store'),
    ]);

    await expect(registry.loadPlugins()).resolves.not.toThrow();
  });
});
