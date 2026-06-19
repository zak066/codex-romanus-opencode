import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig } from './config.js';
import { PluginRegistry } from './engine/plugin-registry.js';
import { RateLimiterManager } from './engine/rate-limiter.js';
import { Validator } from './engine/validator.js';
import { PublishEngine } from './engine/publish-engine.js';
import { registerAllTools, type ToolContext } from './tools/index.js';

/**
 * Sets up and starts the Nuntius MCP server.
 *
 * Initialization order:
 * 1. Load config from environment variables
 * 2. Create PluginRegistry and load plugins via dynamic import
 * 3. Create RateLimiterManager (per-platform token buckets)
 * 4. Create Validator (Zod-based pre-publish validation)
 * 5. Create PublishEngine (orchestrator with retry logic)
 * 6. Register all MCP tools
 * 7. Connect via stdio transport
 */
export async function setupServer(): Promise<void> {
  console.error('[nuntius] Initializing Nuntius MCP Server...');

  // 1. Load configuration
  const config = loadConfig();
  console.error('[nuntius] Config loaded:', {
    facebook: config.facebook ? 'configured' : 'not configured',
    instagram: config.instagram ? 'configured' : 'not configured',
  });

  // 2. Load plugins
  const registry = new PluginRegistry();
  await registry.loadPlugins();
  console.error(`[nuntius] Plugins registered: ${registry.getRegisteredCount()}`);

  // 3. Core engine components
  const rateLimiter = new RateLimiterManager();
  const validator = new Validator();
  const engine = new PublishEngine(registry, rateLimiter, validator);

  // 4. Create MCP server (high-level McpServer pattern, like Imago)
  const server = new McpServer({
    name: 'nuntius',
    version: '1.0.0',
  });

  // 5. Register tools
  const toolContext: ToolContext = { publishEngine: engine, registry, rateLimiter, config };
  registerAllTools(server, toolContext);

  // 6. Connect via stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[nuntius] Nuntius MCP Server running on stdio');
}

// ─── Bootstrap ──────────────────────────────────────────────────────────
setupServer().catch((err) => {
  console.error('[nuntius] Failed to start server:', err);
  process.exit(1);
});
