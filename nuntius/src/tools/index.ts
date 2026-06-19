import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { PublishEngine } from '../engine/publish-engine.js';
import type { PluginRegistry } from '../engine/plugin-registry.js';
import type { RateLimiterManager } from '../engine/rate-limiter.js';
import type { NuntiusConfig } from '../types.js';
import { registerPublishTool } from './publish.js';
import { registerValidateTool } from './validate.js';
import { registerListPlatformsTool } from './platforms.js';
import { registerStatusTool } from './status.js';
import { registerAccountsTool } from './accounts.js';

/**
 * Shared context passed to all tool handlers.
 */
export interface ToolContext {
  publishEngine: PublishEngine;
  registry: PluginRegistry;
  rateLimiter: RateLimiterManager;
  config: NuntiusConfig;
}

/**
 * Registers all MCP tools on the server.
 *
 * Registered tools:
 *   - social_publish          — Publish a post to one or more platforms
 *   - social_validate         — Validate post content without publishing
 *   - social_list_platforms   — List available platforms and their status
 *   - social_status           — Get the status of a published post
 *   - social_accounts         — Show connected social media accounts
 */
export function registerAllTools(server: McpServer, ctx: ToolContext): void {
  registerPublishTool(server, ctx);
  registerValidateTool(server, ctx);
  registerListPlatformsTool(server, ctx);
  registerStatusTool(server, ctx);
  registerAccountsTool(server, ctx);

  console.error(
    '[nuntius] Tools registered: social_publish, social_validate, social_list_platforms, social_status, social_accounts',
  );
}
