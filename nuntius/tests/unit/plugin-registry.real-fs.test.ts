/**
 * Real-filesystem tests for PluginRegistry.loadPlugins.
 *
 * These are in a separate file to avoid the vi.mock('node:fs/promises')
 * hoisting in plugin-registry.test.ts which would shadow the real readdir.
 *
 * Tests verify that loadPlugins can discover and register real plugins
 * from the filesystem when the correct env vars are set.
 */

import { PluginRegistry } from '../../src/engine/plugin-registry.js';

// ─── loadPlugins (env-driven, real filesystem) ────────────────────────────

describe('PluginRegistry.loadPlugins (real fs, env-driven)', () => {
  let registry: PluginRegistry;

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    registry = new PluginRegistry();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should load facebook and instagram plugins when env vars are set', async () => {
    // Set env vars for both platforms
    process.env.FACEBOOK_PAGE_ID = 'test-page-id';
    process.env.FACEBOOK_ACCESS_TOKEN = 'test-access-token';
    process.env.INSTAGRAM_USER_ID = 'test-user-id';
    process.env.INSTAGRAM_ACCESS_TOKEN = 'test-access-token';

    await registry.loadPlugins();

    expect(registry.getPlugin('facebook')).toBeDefined();
    expect(registry.getPlugin('instagram')).toBeDefined();
    expect(registry.getRegisteredCount()).toBeGreaterThanOrEqual(2);

    delete process.env.FACEBOOK_PAGE_ID;
    delete process.env.FACEBOOK_ACCESS_TOKEN;
    delete process.env.INSTAGRAM_USER_ID;
    delete process.env.INSTAGRAM_ACCESS_TOKEN;
  });

  it('should skip facebook plugin when env vars are missing', async () => {
    // Only set instagram vars
    process.env.INSTAGRAM_USER_ID = 'test-user-id';
    process.env.INSTAGRAM_ACCESS_TOKEN = 'test-access-token';
    // Facebook vars are NOT set

    await registry.loadPlugins();

    expect(registry.getPlugin('facebook')).toBeUndefined();
    expect(registry.getPlugin('instagram')).toBeDefined();

    delete process.env.INSTAGRAM_USER_ID;
    delete process.env.INSTAGRAM_ACCESS_TOKEN;
  });

  it('should skip instagram plugin when env vars are missing', async () => {
    // Only set facebook vars
    process.env.FACEBOOK_PAGE_ID = 'test-page-id';
    process.env.FACEBOOK_ACCESS_TOKEN = 'test-access-token';
    // Instagram vars are NOT set

    await registry.loadPlugins();

    expect(registry.getPlugin('facebook')).toBeDefined();
    expect(registry.getPlugin('instagram')).toBeUndefined();

    delete process.env.FACEBOOK_PAGE_ID;
    delete process.env.FACEBOOK_ACCESS_TOKEN;
  });
});
