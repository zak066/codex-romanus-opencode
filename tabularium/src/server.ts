/**
 * server.ts
 * Entry point principale del server MCP Tabularium.
 * Registra Resources, Tools e Prompts e avvia il server su stdio transport.
 *
 * @module tabularium
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type {
  CallToolResult,
  ReadResourceResult,
  GetPromptResult,
  ListResourcesResult,
  ListToolsResult,
  ListPromptsResult,
} from '@modelcontextprotocol/sdk/types.js';

import { registerResources, resolveResource } from './resources/index.js';
import { registerTools, executeTool } from './tools/index.js';
import { registerPrompts, executePrompt } from './prompts/index.js';
import { startSseServer, stopSseServer } from './sse/server.js';
import { startHeartbeatMonitor, stopHeartbeatMonitor } from './messaging/heartbeat-monitor.js';

import { initDatabase, closeDatabase } from './core/database.js';

import { cacheMetrics, fromCache } from './core/cache-metrics.js';
import { cacheWarmup, registerDefaultWarmupTasks } from './core/cache-warmup.js';
import {
  openCodeCache,
  progressCache,
  decisionsCache,
  validationCache,
  memorySessionsCache,
  memoryEventsCache,
  memoryKnowledgeCache,
  memoryContextsCache,
} from './core/cache.js';


const SERVER_NAME = 'tabularium';
const SERVER_VERSION = '1.0.0';

// ──────────────────────────────────────────────
//  Server creation
// ──────────────────────────────────────────────

/**
 * Crea e configura il server MCP con tutti i capability handler.
 * Returns l'istanza Server pronta per la connessione.
 */
function createServer(): Server {
  const server = new Server(
    {
      name: SERVER_NAME,
      version: SERVER_VERSION,
    },
    {
      capabilities: {
        resources: {},
        tools: {},
        prompts: {},
      },
    }
  );

  registerResourceHandlers(server);
  registerToolHandlers(server);
  registerPromptHandlers(server);

  return server;
}

// ──────────────────────────────────────────────
//  Resource handlers
// ──────────────────────────────────────────────

/**
 * Registra gli handler per le MCP Resources (ListResources + ReadResource).
 * Ogni errore viene loggato su stderr e restituito come risposta safe
 * per garantire che il server non crashi mai.
 */
function registerResourceHandlers(server: Server): void {
  // ── ListResources ───────────────────────────
  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    try {
      const resources = registerResources();
      console.error(`[${SERVER_NAME}] Listed ${resources.length} resources`);
      return { resources } as ListResourcesResult;
    } catch (error) {
      console.error(`[${SERVER_NAME}] Error listing resources:`, error);
      return { resources: [] } as ListResourcesResult;
    }
  });

  // ── ReadResource ────────────────────────────
  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const uri = request.params.uri;

    if (!uri) {
      console.error(`[${SERVER_NAME}] ReadResource called with empty URI`);
      return {
        contents: [
          {
            uri: '',
            mimeType: 'text/plain' as const,
            text: 'Error: URI is required',
          },
        ],
      } as ReadResourceResult;
    }

    try {
      console.error(`[${SERVER_NAME}] Reading resource: ${uri}`);
      const contents = await resolveResource(uri);
      return { contents } as ReadResourceResult;
    } catch (error) {
      console.error(`[${SERVER_NAME}] Error reading resource '${uri}':`, error);
      return {
        contents: [
          {
            uri,
            mimeType: 'text/plain' as const,
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      } as ReadResourceResult;
    }
  });
}

// ──────────────────────────────────────────────
//  Tool handlers
// ──────────────────────────────────────────────

/**
 * Registra gli handler per gli MCP Tools (ListTools + CallTool).
 * executeTool() gestisce gia' errori internamente; il livello server
 * intercetta solo errori inattesi per non crashare mai.
 */
function registerToolHandlers(server: Server): void {
  // ── ListTools ───────────────────────────────
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    try {
      const tools = registerTools();
      console.error(`[${SERVER_NAME}] Listed ${tools.length} tools`);
      return { tools } as ListToolsResult;
    } catch (error) {
      console.error(`[${SERVER_NAME}] Error listing tools:`, error);
      return { tools: [] } as ListToolsResult;
    }
  });

  // ── CallTool ────────────────────────────────
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    if (!name) {
      return {
        content: [{ type: 'text' as const, text: 'Error: tool name is required' }],
        isError: true,
      } as CallToolResult;
    }

    try {
      console.error(`[${SERVER_NAME}] Calling tool: ${name}`);
      return (await executeTool(name, (args ?? {}) as Record<string, unknown>)) as CallToolResult;
    } catch (error) {
      console.error(`[${SERVER_NAME}] Unexpected error executing tool '${name}':`, error);
      return {
        content: [
          {
            type: 'text' as const,
            text: `Internal error executing tool '${name}': ${
              error instanceof Error ? error.message : String(error)
            }`,
          },
        ],
        isError: true,
      } as CallToolResult;
    }
  });
}

// ──────────────────────────────────────────────
//  Prompt handlers
// ──────────────────────────────────────────────

/**
 * Registra gli handler per i MCP Prompts (ListPrompts + GetPrompt).
 * I prompt restituiscono template testuali strutturati per guidare
 * il flusso di lavoro degli agenti.
 */
function registerPromptHandlers(server: Server): void {
  // ── ListPrompts ─────────────────────────────
  server.setRequestHandler(ListPromptsRequestSchema, async () => {
    try {
      const prompts = registerPrompts();
      console.error(`[${SERVER_NAME}] Listed ${prompts.length} prompts`);
      return { prompts } as ListPromptsResult;
    } catch (error) {
      console.error(`[${SERVER_NAME}] Error listing prompts:`, error);
      return { prompts: [] } as ListPromptsResult;
    }
  });

  // ── GetPrompt ───────────────────────────────
  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    if (!name) {
      return {
        description: 'Error: prompt name is required',
        messages: [
          {
            role: 'user' as const,
            content: { type: 'text' as const, text: 'Error: prompt name is required' },
          },
        ],
      } as GetPromptResult;
    }

    try {
      console.error(`[${SERVER_NAME}] Getting prompt: ${name}`);
      return (await executePrompt(name, args as Record<string, string> | undefined)) as GetPromptResult;
    } catch (error) {
      console.error(`[${SERVER_NAME}] Error getting prompt '${name}':`, error);
      return {
        description: `Error: prompt '${name}' failed`,
        messages: [
          {
            role: 'user' as const,
            content: {
              type: 'text' as const,
              text: `Error retrieving prompt '${name}': ${
                error instanceof Error ? error.message : String(error)
              }`,
            },
          },
        ],
      } as GetPromptResult;
    }
  });
}

// ──────────────────────────────────────────────
//  Main entry point
// ──────────────────────────────────────────────

/**
 * Avvia il server MCP Tabularium con stdio transport.
 *
 * Configura:
 * - StdioServerTransport per comunicazione MCP
 * - Graceful shutdown su SIGINT/SIGTERM
 * - Global error handler per non crashare mai (uncaughtException, unhandledRejection)
 * - Logging strutturato su stderr
 */
async function main(): Promise<void> {
  console.error(`[${SERVER_NAME}] Starting MCP server v${SERVER_VERSION}...`);
  console.error(`[${SERVER_NAME}] Working directory: ${process.cwd()}`);
  console.error(`[${SERVER_NAME}] Platform: ${process.platform} | Node: ${process.version}`);

  // ── Inizializza database SQLite ─────────────
  try {
    await initDatabase();
    console.error(`[${SERVER_NAME}] Memory database initialized`);

  } catch (err) {
    console.error(`[${SERVER_NAME}] Failed to initialize database:`, err);
    console.error(`[${SERVER_NAME}] Continuing without memory persistence (read-only mode)`);
  }
    // ── Avvia Cache Metrics ──────────────────────
    try {
      cacheMetrics.register(fromCache('openCodeCache', openCodeCache));
      cacheMetrics.register(fromCache('progressCache', progressCache));
      cacheMetrics.register(fromCache('decisionsCache', decisionsCache));
      cacheMetrics.register(fromCache('validationCache', validationCache));
      cacheMetrics.register(fromCache('memorySessionsCache', memorySessionsCache));
      cacheMetrics.register(fromCache('memoryEventsCache', memoryEventsCache));
      cacheMetrics.register(fromCache('memoryKnowledgeCache', memoryKnowledgeCache));
      cacheMetrics.register(fromCache('memoryContextsCache', memoryContextsCache));
      cacheMetrics.startAutoReport(60_000);
      console.error(`[${SERVER_NAME}] Cache metrics started (8 caches, interval 60s)`);
    } catch (err) {
      console.error(`[${SERVER_NAME}] Failed to start cache metrics:`, err);
    }

    // ── Avvia Cache Warmup ──────────────────────
    try {
      registerDefaultWarmupTasks();
      const warmupReport = await cacheWarmup.warmupByTag('startup');
      console.error(
        `[${SERVER_NAME}] Cache warmup: ${warmupReport.completed}/${warmupReport.total} tasks completed in ${warmupReport.totalDuration}ms`
      );
      cacheWarmup.startScheduler(300_000);
      console.error(`[${SERVER_NAME}] Cache warmup scheduler started (interval 5min)`);
    } catch (err) {
      console.error(`[${SERVER_NAME}] Failed to start cache warmup:`, err);
    }

    startSseServer().catch((err: unknown) => {
      console.error(`[${SERVER_NAME}] SSE server failed to start:`, err);
    });
    startHeartbeatMonitor();


  const server = createServer();
  const transport = new StdioServerTransport();

  // ── Graceful shutdown ──────────────────────
  const shutdown = async (signal: string): Promise<void> => {
    console.error(`[${SERVER_NAME}] Received ${signal}, shutting down gracefully...`);
    try {
      await server.close();
      console.error(`[${SERVER_NAME}] Server closed`);
    } catch (err) {
      console.error(`[${SERVER_NAME}] Error during shutdown:`, err);
    }
    await stopSseServer();
    stopHeartbeatMonitor();
    cacheMetrics.stopAutoReport();
    cacheWarmup.stopScheduler();
    closeDatabase();
    process.exit(0);
  };

  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });

  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });

  // ── Global error handlers (mai crashare) ────
  process.on('uncaughtException', (error) => {
    console.error(`[${SERVER_NAME}] [UNCAUGHT_EXCEPTION]`, error);
  });

  process.on('unhandledRejection', (reason) => {
    console.error(`[${SERVER_NAME}] [UNHANDLED_REJECTION]`, reason);
  });

  // ── Connect ─────────────────────────────────
  try {
    await server.connect(transport);
    console.error(`[${SERVER_NAME}] Server connected via stdio transport`);
    console.error(`[${SERVER_NAME}] Ready to accept MCP requests`);
  } catch (error) {
    console.error(`[${SERVER_NAME}] Failed to start server:`, error);
    process.exit(1);
  }
}

// Avvio
main().catch((err) => {
  console.error(`[${SERVER_NAME}] Fatal startup error:`, err);
  process.exit(1);
});
