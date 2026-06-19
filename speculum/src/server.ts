/**
 * speculum — MCP Search Server (Codex Romanus)
 *
 * Server MCP che espone 5 tool:
 * - speculum_web_search  → DuckDuckGo Lite HTML search + cheerio
 * - speculum_suggest     → DuckDuckGo autocomplete
 * - speculum_knowledge   → DuckDuckGo Instant Answer API
 * - speculum_web_fetch   → HTTP fetch + Readability content extraction
 *
 * @module server
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { handleSearch, handleSuggest, handleKnowledge, handleFetch } from './tools/index.js';

const server = new McpServer({
  name: 'speculum',
  version: '1.0.0',
  description: 'Web search, knowledge & content — no API key required',
});

// ─── Tool: speculum_web_search ─────────────────────────────────
// DuckDuckGo Lite HTML search — restituisce risultati web con titolo, URL e snippet

server.registerTool(
  'speculum_web_search',
  {
    description:
      'Search the web using DuckDuckGo Lite HTML — returns up to 20 results ' +
      'with titles, URLs and snippets. No API key required.',
    inputSchema: z.object({
      query: z.string().describe('The search query'),
      maxResults: z.number().optional().default(10)
        .describe('Maximum results to return (default: 10, max: 20)'),
      region: z.string().optional()
        .describe('Region/language code (kl parameter, e.g. "it-it", "us-en", "de-de")'),
      timeRange: z.enum(['d', 'w', 'm', 'y']).optional()
        .describe('Time range filter: d=day, w=week, m=month, y=year'),
    }),
  },
  async (args) => handleSearch(args),
);

// ─── Tool: speculum_suggest ─────────────────────────────────────
// DuckDuckGo autocomplete — restituisce suggerimenti di ricerca

server.registerTool(
  'speculum_suggest',
  {
    description: 'Get search autocomplete suggestions from DuckDuckGo',
    inputSchema: z.object({ query: z.string() }),
  },
  async (args) => handleSuggest(args),
);

// ─── Tool: speculum_knowledge ──────────────────────────────────
// DuckDuckGo Instant Answer — restituisce knowledge panel, abstract e related topics

server.registerTool(
  'speculum_knowledge',
  {
    description: 'Get instant answers, knowledge panels and related topics from DuckDuckGo',
    inputSchema: z.object({ query: z.string() }),
  },
  async (args) => handleKnowledge(args),
);

// ─── Tool: speculum_web_fetch ────────────────────────────────
// HTTP GET + Readability content extraction

server.registerTool(
  'speculum_web_fetch',
  {
    description: 'Fetch a web page and extract readable content using Mozilla Readability',
    inputSchema: z.object({
      url: z.string().describe('The URL to fetch'),
      extract: z.boolean().optional().default(true)
        .describe('Extract clean content with Readability (default: true). If false, raw HTML is returned'),
    }),
  },
  async (args) => handleFetch(args),
);

export { server };

// ─── Startup ───────────────────────────────────────────────────
const transport = new StdioServerTransport();
await server.connect(transport);
