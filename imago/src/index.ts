/**
 * Imago — MCP Server for ComfyUI
 *
 * Bridges AI agents (Claude Code, Cursor, n8n, etc.) to ComfyUI
 * for image generation via workflow-based pipelines.
 *
 * Transport: stdio (default MCP transport)
 * Pattern: Adapter + Bridge (see comfyui-mcp-architecture.md)
 */

import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { loadConfig } from './config.js';
import { info } from './utils/logger.js';
import { ComfyClient } from './comfyui/client.js';
import { WorkflowManager } from './services/workflow-manager.js';
import { AssetRegistry } from './services/asset-registry.js';
import { ImageHandler } from './services/image-handler.js';
import { registerAllTools, type ToolDeps } from './tools/index.js';

// ─── Configuration ────────────────────────────────────────────

const config = loadConfig();
const startTime = Date.now();

info('Imago server starting', {
  version: '0.1.0',
  comfyuiUrl: config.comfyui.url,
  clientId: config.comfyui.clientId,
});

// ─── Server Instance ───────────────────────────────────────────

const server = new McpServer({
  name: 'imago',
  version: '0.1.0',
});

// ─── Dependencies ──────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const comfyClient = new ComfyClient(config.comfyui.url, config.comfyui.clientId);
const workflowManager = new WorkflowManager(join(__dirname, '..', 'workflows'));
const assetRegistry = new AssetRegistry({ ttlMs: 24 * 60 * 60 * 1000 });
const imageHandler = new ImageHandler();

const deps: ToolDeps = {
  comfyClient,
  workflowManager,
  assetRegistry,
  imageHandler,
};

// ─── Register Tools ────────────────────────────────────────────

registerAllTools(server, deps);

// ─── Startup ───────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
info('Imago server avviato (stdio transport)', {
  uptime: Math.floor((Date.now() - startTime) / 1000),
});
