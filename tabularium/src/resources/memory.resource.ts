/**
 * resources/memory.resource.ts
 * Resource MCP per il sistema di memoria del team.
 * URI: tabularium://memory
 *
 * Supporta:
 * - tabularium://memory/sessions — lista sessioni
 * - tabularium://memory/sessions/{id} — dettaglio sessione
 * - tabularium://memory/sessions/{id}/events — eventi di una sessione
 * - tabularium://memory/knowledge — knowledge base entries
 * - tabularium://memory/search?q=... — ricerca full-text
 * - tabularium://memory/context — contesto corrente per agenti
 *
 * @module resources/memory
 */

import type { ResourceContent, ResourceHandler } from '../types/mcp.js';
import { listSessions, getSession } from '../core/db-sessions.js';
import { getEventsBySession } from '../core/db-events.js';
import { listKnowledge, searchKnowledge } from '../core/db-knowledge.js';
import { getLatestContextPerAgent } from '../core/db-contexts.js';
import { getDatabase } from '../core/database.js';
import { semanticSearch, hybridSearch } from '../core/semantic-search.js';

// ---------------------------------------------------------------------------
// Patterns URI
// ---------------------------------------------------------------------------

const BASE_URI = 'tabularium://memory';

// Pattern match con supporto per query string
const URI_PATTERNS = [
  { pattern: /^tabularium:\/\/memory\/sessions\/([^/]+)\/events(?:\?(.+))?$/, handler: 'sessionEvents' },
  { pattern: /^tabularium:\/\/memory\/sessions\/([^/]+)(?:\?(.+))?$/, handler: 'sessionDetail' },
  { pattern: /^tabularium:\/\/memory\/sessions(?:\?(.+))?$/, handler: 'sessionList' },
  { pattern: /^tabularium:\/\/memory\/knowledge(?:\?(.+))?$/, handler: 'knowledgeList' },
  { pattern: /^tabularium:\/\/memory\/search\?(.+)$/, handler: 'search' },
  { pattern: /^tabularium:\/\/memory\/context$/, handler: 'context' },
];

// ---------------------------------------------------------------------------
// Resource Handler
// ---------------------------------------------------------------------------

export const memoryResourceHandler: ResourceHandler = {
  uri: BASE_URI,
  name: 'Memory',
  description: 'Team memory: sessions, events, contexts, knowledge base',
  mimeType: 'application/json',

  handler: async (): Promise<ResourceContent[]> => {
    // Questo handler generico restituisce una panoramica di tutte le memorie disponibili
    try {
      const db = getDatabase();

      // Statistiche veloci
      const sessionCount = (db.prepare('SELECT COUNT(*) as count FROM sessions').get() as { count: number }).count;
      const eventCount = (db.prepare('SELECT COUNT(*) as count FROM events').get() as { count: number }).count;
      const knowledgeCount = (db.prepare('SELECT COUNT(*) as count FROM knowledge_entries').get() as { count: number }).count;
      const contextCount = (db.prepare('SELECT COUNT(*) as count FROM contexts').get() as { count: number }).count;

      return [
        {
          uri: `${BASE_URI}/status`,
          mimeType: 'application/json',
          text: JSON.stringify(
            {
              status: 'available',
              endpoints: [
                { uri: `${BASE_URI}/sessions`, description: 'List sessions' },
                { uri: `${BASE_URI}/sessions/{id}`, description: 'Session detail' },
                { uri: `${BASE_URI}/sessions/{id}/events`, description: 'Session events' },
                { uri: `${BASE_URI}/knowledge`, description: 'Knowledge base' },
                { uri: `${BASE_URI}/search?q=...`, description: 'Full-text search' },
                { uri: `${BASE_URI}/context`, description: 'Current team context' },
              ],
              stats: {
                sessions: sessionCount,
                events: eventCount,
                knowledgeEntries: knowledgeCount,
                contexts: contextCount,
              },
            },
            null,
            2
          ),
        },
      ];
    } catch {
      return [
        {
          uri: `${BASE_URI}/status`,
          mimeType: 'application/json',
          text: JSON.stringify({ status: 'unavailable', message: 'Memory database not initialized' }),
        },
      ];
    }
  },
};

// ---------------------------------------------------------------------------
// URI Resolution (chiamato da resolveResource)
// ---------------------------------------------------------------------------

/**
 * Risolve un URI specifico di memoria e restituisce i contenuti.
 * Questo viene chiamato dal router centrale quando un URI inizia con tabularium://memory.
 *
 * @param uri - URI completo da risolvere
 * @returns Array di ResourceContent
 */
export async function resolveMemoryUri(uri: string): Promise<ResourceContent[]> {
  // Cerca pattern corrispondente
  for (const { pattern, handler } of URI_PATTERNS) {
    const match = uri.match(pattern);
    if (!match) continue;

    switch (handler) {
      case 'sessionList':
        return handleSessionList(match[1]);
      case 'sessionDetail':
        return handleSessionDetail(match[1]);
      case 'sessionEvents':
        return handleSessionEvents(match[1], match[2]);
      case 'knowledgeList':
        return handleKnowledgeList(match[1]);
      case 'search':
        return await handleSearch(match[1]);
      case 'context':
        return handleContext();
    }
  }

  // Se nessun pattern corrisponde, restituisci la panoramica
  return memoryResourceHandler.handler();
}

// ---------------------------------------------------------------------------
// Handler interni
// ---------------------------------------------------------------------------

/**
 * Gestisce: tabularium://memory/sessions
 */
function handleSessionList(queryString?: string): ResourceContent[] {
  const params = parseQueryString(queryString ?? '');
  const sessions = listSessions({
    agent: params.agent as string | undefined,
    status: params.status as 'active' | 'completed' | 'aborted' | 'interrupted' | undefined,
    limit: params.limit ? parseInt(params.limit as string, 10) : undefined,
  });

  return [
    {
      uri: 'tabularium://memory/sessions',
      mimeType: 'application/json',
      text: JSON.stringify(
        {
          sessions,
          total: sessions.length,
          filters: params,
        },
        null,
        2
      ),
    },
  ];
}

/**
 * Gestisce: tabularium://memory/sessions/{id}
 */
function handleSessionDetail(id: string): ResourceContent[] {
  const session = getSession(id);

  if (!session) {
    return [
      {
        uri: `tabularium://memory/sessions/${id}`,
        mimeType: 'application/json',
        text: JSON.stringify({ error: `Session not found: ${id}` }),
      },
    ];
  }

  return [
    {
      uri: `tabularium://memory/sessions/${id}`,
      mimeType: 'application/json',
      text: JSON.stringify({ session }, null, 2),
    },
  ];
}

/**
 * Gestisce: tabularium://memory/sessions/{id}/events
 */
function handleSessionEvents(id: string, queryString?: string): ResourceContent[] {
  const params = parseQueryString(queryString ?? '');

  const result = getEventsBySession(id, {
    type: params.type as 'task_started' | 'task_completed' | 'decision_made' | undefined,
    limit: params.limit ? parseInt(params.limit as string, 10) : undefined,
    offset: params.offset ? parseInt(params.offset as string, 10) : undefined,
  });

  return [
    {
      uri: `tabularium://memory/sessions/${id}/events`,
      mimeType: 'application/json',
      text: JSON.stringify(
        {
          session_id: id,
          events: result.events,
          total: result.total,
          limit: params.limit ? parseInt(params.limit as string, 10) : 50,
          offset: params.offset ? parseInt(params.offset as string, 10) : 0,
        },
        null,
        2
      ),
    },
  ];
}

/**
 * Gestisce: tabularium://memory/knowledge
 */
function handleKnowledgeList(queryString?: string): ResourceContent[] {
  const params = parseQueryString(queryString ?? '');

  const entries = listKnowledge({
    category: params.category as 'lesson' | 'faq' | 'pattern' | 'tip' | 'pitfall' | 'tutorial' | undefined,
    status: params.status as 'active' | 'archived' | 'draft' | undefined,
    limit: params.limit ? parseInt(params.limit as string, 10) : undefined,
  });

  return [
    {
      uri: 'tabularium://memory/knowledge',
      mimeType: 'application/json',
      text: JSON.stringify(
        {
          entries,
          total: entries.length,
        },
        null,
        2
      ),
    },
  ];
}

/**
 * Gestisce: tabularium://memory/search?q=...
 * Support mode=semantic per ricerca semantica, mode=hybrid per ibrida (FTS + semantica).
 * Default: FTS tradizionale.
 */
async function handleSearch(queryString: string): Promise<ResourceContent[]> {
  const params = parseQueryString(queryString);
  const query = (params.q as string) ?? '';
  const mode = (params.mode as string) ?? 'fts';
  const limit = params.limit ? parseInt(params.limit as string, 10) : 10;
  const searchType = (params.type as string) ?? 'all';

  if (!query.trim()) {
    return [
      {
        uri: 'tabularium://memory/search',
        mimeType: 'application/json',
        text: JSON.stringify({ error: 'Query parameter "q" is required' }),
      },
    ];
  }

  if (mode === 'semantic') {
    try {
      const results = await semanticSearch(query, searchType, limit);
      return [
        {
          uri: 'tabularium://memory/search',
          mimeType: 'application/json',
          text: JSON.stringify(
            {
              query,
              mode: 'semantic',
              search_type: searchType,
              results,
              total: results.length,
            },
            null,
            2
          ),
        },
      ];
    } catch (error) {
      return [
        {
          uri: 'tabularium://memory/search',
          mimeType: 'application/json',
          text: JSON.stringify(
            {
              query,
              mode: 'semantic',
              error: `Semantic search failed: ${error instanceof Error ? error.message : String(error)}`,
              results: [],
              total: 0,
            },
            null,
            2
          ),
        },
      ];
    }
  }

  if (mode === 'hybrid') {
    try {
      const results = await hybridSearch(query, limit);
      return [
        {
          uri: 'tabularium://memory/search',
          mimeType: 'application/json',
          text: JSON.stringify(
            {
              query,
              mode: 'hybrid',
              results,
              total: results.length,
            },
            null,
            2
          ),
        },
      ];
    } catch (error) {
      return [
        {
          uri: 'tabularium://memory/search',
          mimeType: 'application/json',
          text: JSON.stringify(
            {
              query,
              mode: 'hybrid',
              error: `Hybrid search failed: ${error instanceof Error ? error.message : String(error)}`,
              results: [],
              total: 0,
            },
            null,
            2
          ),
        },
      ];
    }
  }

  // Default: FTS tradizionale
  const results = searchKnowledge(
    query,
    params.category as 'lesson' | 'faq' | 'pattern' | 'tip' | 'pitfall' | 'tutorial' | undefined,
    limit
  );

  return [
    {
      uri: 'tabularium://memory/search',
      mimeType: 'application/json',
      text: JSON.stringify(
        {
          query,
          mode: 'fts',
          results: { knowledge: results },
          total: results.length,
        },
        null,
        2
      ),
    },
  ];
}

/**
 * Gestisce: tabularium://memory/context
 */
function handleContext(): ResourceContent[] {
  // Recupera contesti recenti per agente
  const contexts = getLatestContextPerAgent();

  // Cerca la sessione attiva più recente
  const sessions = listSessions({ status: 'active' as const, limit: 5 });

  return [
    {
      uri: 'tabularium://memory/context',
      mimeType: 'application/json',
      text: JSON.stringify(
        {
          contexts,
          active_sessions: sessions,
          last_updated: new Date().toISOString(),
        },
        null,
        2
      ),
    },
  ];
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

/**
 * Parser semplice di query string.
 * Converte "?agent=iuppiter&limit=10" in { agent: 'iuppiter', limit: '10' }
 */
function parseQueryString(queryString: string): Record<string, string> {
  const params: Record<string, string> = {};

  if (!queryString) return params;

  // Rimuovi eventuale ? iniziale
  const qs = queryString.startsWith('?') ? queryString.substring(1) : queryString;

  for (const part of qs.split('&')) {
    const [key, value] = part.split('=');
    if (key && value) {
      try {
        params[decodeURIComponent(key)] = decodeURIComponent(value);
      } catch {
        params[key] = value;
      }
    }
  }

  return params;
}
