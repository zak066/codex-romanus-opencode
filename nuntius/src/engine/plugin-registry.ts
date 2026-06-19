import { readdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import type { SocialPlugin } from '../plugins/social-plugin.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Plugin Registry — loads SocialPlugin implementations via dynamic import().
 *
 * Convention: each subdirectory under src/plugins/ must export a default class
 * that implements the SocialPlugin interface.
 *
 * If a plugin's required config (env vars) is missing, the plugin is skipped
 * with a console.error log — no crash.
 *
 * Works both in dev (tsx, relative to src/) and in production
 * (node dist/, relative to dist/).
 */
export class PluginRegistry {
  private plugins: Map<string, SocialPlugin> = new Map();

  /**
   * Scans the plugins directory, dynamically imports each subdirectory,
   * and registers valid plugins that have all required config variables set.
   */
  async loadPlugins(): Promise<void> {
    // Resolve the plugins directory relative to this file's location.
    // In dev (tsx):  src/engine/this-file → src/plugins/
    // In prod (dist): dist/engine/this-file → dist/plugins/
    const pluginsDir = join(__dirname, '..', 'plugins');

    let entries: { name: string; isDirectory: () => boolean }[];
    try {
      entries = await readdir(pluginsDir, { withFileTypes: true });
    } catch (err) {
      console.error(`[nuntius] Plugin directory not found at ${pluginsDir}:`, err);
      return;
    }

    const subdirs = entries.filter(
      (entry) => entry.isDirectory() && !entry.name.startsWith('.'),
    );

    for (const dir of subdirs) {
      try {
        // Dynamic import — uses absolute path for cross-platform reliability
        const modulePath = join(pluginsDir, dir.name, 'index.js');
        const moduleUrl = pathToFileURL(modulePath).href;
        const mod = await import(moduleUrl);

        if (!mod.default || typeof mod.default !== 'function') {
          console.error(
            `[nuntius] Plugin "${dir.name}/index.ts" has no default export — skipping`,
          );
          continue;
        }

        const instance: SocialPlugin = new mod.default();

        if (!this.isValidPlugin(instance)) {
          console.error(
            `[nuntius] Plugin "${dir.name}" does not implement SocialPlugin interface — skipping`,
          );
          continue;
        }

        const platformName = instance.getPlatformName();

        // Check required config — skip if any variable is missing
        const requiredConfig = instance.getRequiredConfig();
        const missing: string[] = [];
        for (const key of requiredConfig) {
          if (!process.env[key]) {
            missing.push(key);
          }
        }

        if (missing.length > 0) {
          console.error(
            `[nuntius] Plugin "${platformName}" missing config: ${missing.join(', ')} — not registered`,
          );
          continue;
        }

        this.plugins.set(platformName, instance);
        console.error(`[nuntius] Plugin registered: ${platformName}`);
      } catch (err) {
        console.error(`[nuntius] Failed to load plugin from "${dir.name}":`, err);
      }
    }
  }

  /**
   * Manually register a plugin (useful for testing or programmatic registration).
   */
  register(plugin: SocialPlugin): void {
    this.plugins.set(plugin.getPlatformName(), plugin);
    console.error(`[nuntius] Plugin manually registered: ${plugin.getPlatformName()}`);
  }

  /**
   * Returns the plugin for a given platform name, or undefined.
   */
  getPlugin(platform: string): SocialPlugin | undefined {
    return this.plugins.get(platform);
  }

  /**
   * Returns the list of all registered platform names.
   */
  listPlatforms(): string[] {
    return Array.from(this.plugins.keys());
  }

  /**
   * Returns the number of registered plugins.
   */
  getRegisteredCount(): number {
    return this.plugins.size;
  }

  /**
   * Type guard: verifies that an object implements all required SocialPlugin methods.
   */
  private isValidPlugin(obj: unknown): obj is SocialPlugin {
    if (!obj || typeof obj !== 'object') return false;
    const p = obj as Record<string, unknown>;
    return (
      typeof p.getPlatformName === 'function' &&
      typeof p.getRequiredConfig === 'function' &&
      typeof p.validateConfig === 'function' &&
      typeof p.publishPost === 'function' &&
      typeof p.getPostStatus === 'function' &&
      typeof p.getMediaConstraints === 'function'
    );
  }
}
