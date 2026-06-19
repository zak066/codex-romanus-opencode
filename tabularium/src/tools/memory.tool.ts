

/**
 * tools/memory.tool.ts
 * Tool MCP per le operazioni di memoria del team.
 * Supporta store, query e snapshot della memoria persistente.
 *
 * @module tools/memory
 */

import type { ToolHandler, ToolResult } from '../types/mcp.js';
import { getDatabase } from '../core/database.js';

import { insertEvent } from '../core/db-events.js';
import { saveContext } from '../core/db-contexts.js';
import { createKnowledgeEntry, searchKnowledge, listKnowledge } from '../core/db-knowledge.js';
import { createSession, listSessions, getSession } from '../core/db-sessions.js';
import { suggestKnowledge, suggestKnowledgeForAgent } from '../core/knowledge-manager.js';
import { detectFaqCandidates, generateFaqFromCandidate } from '../core/faq-manager.js';
import { semanticSearch, hybridSearch, embedAndStore } from '../core/semantic-search.js';
import { linkRelatedDecisions, findSimilarContexts } from '../core/similarity-linker.js';
import { generateTrendReport } from '../core/trend-analyzer.js';
import { predictForTask } from '../core/oracle-engine.js';
import type { EventType, ContextType, KnowledgeCategory, KnowledgeEntry, SessionStatus } from '../types/memory.js';
import { validateAgentName } from '../messaging/agent-validator.js';

// ---------------------------------------------------------------------------
// Valid event types per azione
// ---------------------------------------------------------------------------

const VALID_EVENT_TYPES: EventType[] = [
  'task_started', 'task_completed', 'task_failed',
  'decision_made', 'file_created', 'file_modified',
  'handoff_sent', 'handoff_received',
  'error_encountered', 'milestone_reached',
  'context_saved', 'knowledge_added',
  'query_executed', 'advisory_requested',
  'config_changed', 'session_started', 'session_ended',
  'custom',
];

const VALID_CONTEXT_TYPES: ContextType[] = [
  'session_start', 'session_end', 'task_context',
  'handoff_context', 'snapshot', 'manual_save',
];

const VALID_CATEGORIES: KnowledgeCategory[] = [
  'lesson', 'faq', 'pattern', 'tip', 'pitfall', 'tutorial',
];

// ---------------------------------------------------------------------------
// Tool Handler
// ---------------------------------------------------------------------------

export const memoryToolHandler: ToolHandler = {
  name: 'tabularium_memory',
  description: 'Team memory operations: store, query, snapshot',
  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['store', 'query', 'snapshot', 'knowledge_suggest', 'faq_detect', 'semantic_search', 'link_decisions', 'trend_report', 'oracle_predict'],
        description: 'Azione: store, query, snapshot, knowledge_suggest, faq_detect, semantic_search (ricerca semantica), link_decisions (collega decisioni correlate), trend_report (report trend), oracle_predict (predizione oracolo)',
      },
      // Parametri store
      type: {
        type: 'string',
        enum: ['event', 'context', 'knowledge'],
        description: 'Tipo di dato da memorizzare (per action=store)',
      },
      session_id: {
        type: 'string',
        description: 'ID della sessione (opzionale, per store/snapshot)',
      },
      agent_name: {
        type: 'string',
        description: "Nome dell'agente",
      },
      event_type: {
        type: 'string',
        description: 'Tipo di evento (per store type=event)',
      },
      summary: {
        type: 'string',
        description: 'Riepilogo breve (max 280 char)',
      },
      details: {
        type: 'object',
        description: 'Dati strutturati aggiuntivi',
      },
      tags: {
        type: 'array',
        items: { type: 'string' },
        description: 'Array di tag',
      },
      content: {
        type: 'string',
        description: 'Contenuto del contesto (per store type=context)',
      },
      context_type: {
        type: 'string',
        description: 'Tipo di contesto (per store type=context)',
      },
      source: {
        type: 'string',
        description: 'Origine del contesto: auto, manual, file, tool',
      },
      // Parametri knowledge
      title: {
        type: 'string',
        description: 'Titolo della knowledge entry',
      },
      body: {
        type: 'string',
        description: 'Corpo della knowledge entry',
      },
      category: {
        type: 'string',
        description: 'Categoria knowledge: lesson, faq, pattern, tip, pitfall, tutorial',
      },
      source_task_id: {
        type: 'string',
        description: 'ID del task associato',
      },
      // Parametri query
      scope: {
        type: 'string',
        enum: ['events', 'sessions', 'knowledge'],
        description: 'Ambito della query (per action=query)',
      },
      agent: {
        type: 'string',
        description: "Nome dell'agente per filtrare",
      },
      // Parametro per oracle_predict
      task: {
        type: 'string',
        description: 'Descrizione del task per oracolo (per action=oracle_predict)',
      },

      limit: {
        type: 'number',
        description: 'Numero massimo di risultati',
      },
      status: {
        type: 'string',
        description: 'Status per filtrare sessioni o knowledge',
      },
      // Parametri knowledge_suggest
      context: {
        type: 'string',
        description: 'Testo di contesto per knowledge_suggest',
      },
      // Parametri faq_detect
      min_occurrences: {
        type: 'number',
        description: 'Numero minimo di occorrenze per faq_detect (default: 3)',
      },
      // Parametri semantic_search
      query: {
        type: 'string',
        description: 'Testo della query per ricerca semantica (per action=semantic_search)',
      },
      search_type: {
        type: 'string',
        enum: ['all', 'knowledge', 'event', 'decision'],
        description: 'Tipo di entità per cui cercare (per action=semantic_search)',
      },
      mode: {
        type: 'string',
        enum: ['semantic', 'hybrid'],
        description: 'Modalità di ricerca: semantic (vettoriale) o hybrid (FTS + semantica)',
      },
      threshold: {
        type: 'number',
        description: 'Soglia di similarità per link_decisions (default: 0.3)',
      },
    },
    required: ['action'],
    allOf: [
      {
        // Se action=store, allora servono agent_name e type
        if: {
          properties: { action: { const: 'store' } },
          required: ['action'],
        },
        then: {
          required: ['agent_name', 'type'],
        },
      },
      {
        // Se action=store && type=knowledge, servono anche title e body
        if: {
          properties: {
            action: { const: 'store' },
            type: { const: 'knowledge' },
          },
          required: ['action', 'type'],
        },
        then: {
          required: ['title', 'body'],
        },
      },
      {
        // Se action=store && type=event, servono anche event_type e summary
        if: {
          properties: {
            action: { const: 'store' },
            type: { const: 'event' },
          },
          required: ['action', 'type'],
        },
        then: {
          required: ['event_type', 'summary'],
        },
      },
      {
        // Se action=store && type=context, serve anche content
        if: {
          properties: {
            action: { const: 'store' },
            type: { const: 'context' },
          },
          required: ['action', 'type'],
        },
        then: {
          required: ['content'],
        },
      },
    ],
  },

  handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
    const action = String(args.action ?? '');

    try {
      switch (action) {
        case 'store':
          return handleStore(args);
        case 'query':
          return handleQuery(args);
        case 'snapshot':
          return handleSnapshot(args);
        case 'knowledge_suggest':
          return handleKnowledgeSuggest(args);
        case 'faq_detect':
          return handleFaqDetect(args);
        case 'semantic_search':
          return handleSemanticSearch(args);
        case 'link_decisions':
          return handleLinkDecisions(args);
        case 'trend_report':
          return handleTrendReport(args);
        case 'oracle_predict':
          return handleOraclePredict(args);
        default:
          return {
            content: [{ type: 'text', text: `Unknown action: ${action}` }],
            isError: true,
          };
      }
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Memory tool failed: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
};

// ---------------------------------------------------------------------------
// Action Handlers
// ---------------------------------------------------------------------------

/**
 * Gestisce l'azione store: salva un evento, contesto o knowledge entry.
 */
async function handleStore(args: Record<string, unknown>): Promise<ToolResult> {
  const storeType = String(args.type ?? '');
  const agentName = String(args.agent_name ?? '');
  const sessionId = args.session_id ? String(args.session_id) : undefined;

  if (!agentName) {
    return {
      content: [{ type: 'text', text: 'Error: agent_name is required' }],
      isError: true,
    };
  }

  const storeAgentErr = validateAgentName(agentName);
  if (storeAgentErr) {
    return {
      content: [{ type: 'text', text: `Error: ${storeAgentErr}` }],
      isError: true,
    };
  }

  if (agentName.length > 100) {
    return {
      content: [{ type: 'text', text: `Error: agent_name exceeds maximum length of 100 characters (received ${agentName.length})` }],
      isError: true,
    };
  }

  // Validate session_id format if provided
  if (sessionId && !/^(ses_|import-)[\w-]+$/.test(sessionId)) {
    return {
      content: [{ type: 'text', text: `Error: invalid session_id format '${sessionId}'. Must match pattern ses_... or import-...` }],
      isError: true,
    };
  }

  switch (storeType) {
    case 'event': {
      // Valida campi obbligatori
      const eventType = String(args.event_type ?? '');
      const summary = String(args.summary ?? '');

      if (!eventType) {
        return {
          content: [{ type: 'text', text: 'Error: event_type is required for type=event' }],
          isError: true,
        };
      }

      if (!summary) {
        return {
          content: [{ type: 'text', text: 'Error: summary is required for type=event' }],
          isError: true,
        };
      }

      // Valida event_type
      if (!VALID_EVENT_TYPES.includes(eventType as EventType)) {
        return {
          content: [
            {
              type: 'text',
              text: `Error: invalid event_type '${eventType}'. Valid values: ${VALID_EVENT_TYPES.join(', ')}`,
            },
          ],
          isError: true,
        };
      }

      // Crea o usa sessione esistente
      let targetSessionId = sessionId;
      if (!targetSessionId) {
        const session = createSession(agentName);
        targetSessionId = session.id;
      }

      const event = insertEvent(
        targetSessionId,
        agentName,
        eventType as EventType,
        summary.substring(0, 280),
        args.details as Record<string, unknown> | undefined,
        args.tags as string[] | undefined
      );

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                data: {
                  id: event.id,
                  session_id: targetSessionId,
                  stored: true,
                  timestamp: event.timestamp,
                },
              },
              null,
              2
            ),
          },
        ],
      };
    }

    case 'context': {
      const contextType = String(args.context_type ?? 'snapshot');
      const content = String(args.content ?? '');

      if (!content) {
        return {
          content: [{ type: 'text', text: 'Error: content is required for type=context' }],
          isError: true,
        };
      }

      if (!VALID_CONTEXT_TYPES.includes(contextType as ContextType)) {
        return {
          content: [
            {
              type: 'text',
              text: `Error: invalid context_type '${contextType}'. Valid values: ${VALID_CONTEXT_TYPES.join(', ')}`,
            },
          ],
          isError: true,
        };
      }

      let targetSessionId = sessionId;
      if (!targetSessionId) {
        const session = createSession(agentName);
        targetSessionId = session.id;
      }

      const context = saveContext(
        targetSessionId,
        agentName,
        contextType as ContextType,
        content,
        String(args.source ?? 'tool'),
        args.details as Record<string, unknown> | undefined
      );

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                data: {
                  id: context.id,
                  session_id: targetSessionId,
                  stored: true,
                  created_at: context.created_at,
                },
              },
              null,
              2
            ),
          },
        ],
      };
    }

    case 'knowledge': {
      const title = String(args.title ?? '');
      const body = String(args.body ?? '');
      const category = String(args.category ?? 'lesson');

      if (!title || !body) {
        return {
          content: [{ type: 'text', text: 'Error: title and body are required for type=knowledge' }],
          isError: true,
        };
      }

      if (!VALID_CATEGORIES.includes(category as KnowledgeCategory)) {
        return {
          content: [
            {
              type: 'text',
              text: `Error: invalid category '${category}'. Valid values: ${VALID_CATEGORIES.join(', ')}`,
            },
          ],
          isError: true,
        };
      }

      let entry: KnowledgeEntry;
      try {
        entry = createKnowledgeEntry(
          title,
          body,
          category as KnowledgeCategory,
          agentName,
          args.tags as string[] | undefined,
          String(args.source_task_id ?? '')
        );
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        if (errMsg.includes('SQLITE_CORRUPT_VTAB')) {
          console.error('[memory.tool] FTS corruption detected, attempting auto-repair...');
          const db = getDatabase();
          db.exec("INSERT INTO knowledge_fts(knowledge_fts) VALUES('rebuild')");
          // Riprova una volta
          entry = createKnowledgeEntry(
            title,
            body,
            category as KnowledgeCategory,
            agentName,
            args.tags as string[] | undefined,
            String(args.source_task_id ?? '')
          );
        } else {
          throw error;
        }
      }

      // Se c'è una sessione, registra l'evento knowledge_added
      if (sessionId) {
        try {
          insertEvent(
            sessionId,
            agentName,
            'knowledge_added',
            `Added knowledge: ${title}`,
            { knowledge_id: entry.id, category },
            args.tags as string[] | undefined
          );
        } catch {
          // Non bloccare se non si riesce a registrare l'evento
        }
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                data: {
                  id: entry.id,
                  stored: true,
                  created_at: entry.created_at,
                },
              },
              null,
              2
            ),
          },
        ],
      };

    }

    default:
      return {
        content: [
          {
            type: 'text',
            text: `Error: invalid type '${storeType}'. Use 'event', 'context', or 'knowledge'.`,
          },
        ],
        isError: true,
      };
  }
}

/**
 * Gestisce l'azione query: interroga la memoria per sessioni, eventi o knowledge.
 */
async function handleQuery(args: Record<string, unknown>): Promise<ToolResult> {
  const scope = String(args.scope ?? 'sessions');
  const agent = args.agent ? String(args.agent) : undefined;
  const limit = args.limit ? parseInt(String(args.limit), 10) : undefined;

  if (agent) {
    const queryAgentErr = validateAgentName(agent);
    if (queryAgentErr) {
      return {
        content: [{ type: 'text', text: `Error: ${queryAgentErr}` }],
        isError: true,
      };
    }
  }

  switch (scope) {
    case 'sessions': {
      const sessions = listSessions({
        agent,
        status: args.status as SessionStatus | undefined,
        limit,
      });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                scope: 'sessions',
                count: sessions.length,
                sessions,
              },
              null,
              2
            ),
          },
        ],
      };
    }

    case 'events': {
      // Se è fornito anche un query testuale, cerca per tipo
      const { getEventsByAgent } = await import('../core/db-events.js');
      const events = agent
        ? getEventsByAgent(agent, limit)
        : [];

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                scope: 'events',
                count: events.length,
                events,
              },
              null,
              2
            ),
          },
        ],
      };
    }

    case 'knowledge': {
      // Se c'è un query testuale, usa FTS search
      if (args.query) {
        const results = searchKnowledge(
          String(args.query),
          args.category as KnowledgeCategory | undefined,
          limit
        );
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  scope: 'knowledge',
                  mode: 'fts',
                  query: args.query,
                  count: results.length,
                  entries: results,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      const entries = listKnowledge({
        category: args.category as KnowledgeCategory | undefined,
        status: args.status as 'active' | 'archived' | 'draft' | undefined,
        limit,
      });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                scope: 'knowledge',
                count: entries.length,
                entries,
              },
              null,
              2
            ),
          },
        ],
      };
    }

    default:
      return {
        content: [{ type: 'text', text: `Error: invalid scope '${scope}'` }],
        isError: true,
      };
  }
}

/**
 * Gestisce l'azione snapshot: cattura lo stato corrente del team.
 * Crea una nuova sessione e salva un contesto di tipo snapshot.
 */
async function handleSnapshot(args: Record<string, unknown>): Promise<ToolResult> {
  const agentName = String(args.agent_name ?? 'system');

  const snapshotAgentErr = validateAgentName(agentName);
  if (snapshotAgentErr) {
    return {
      content: [{ type: 'text', text: `Error: ${snapshotAgentErr}` }],
      isError: true,
    };
  }

  if (agentName.length > 100) {
    return {
      content: [{ type: 'text', text: `Error: agent_name exceeds maximum length of 100 characters (received ${agentName.length})` }],
      isError: true,
    };
  }


  // Crea una sessione per lo snapshot
  let sessionId = args.session_id ? String(args.session_id) : undefined;

  // Validate session_id format if provided
  if (sessionId && !/^(ses_|import-)[\w-]+$/.test(sessionId)) {
    return {
      content: [{ type: 'text', text: `Error: invalid session_id format '${sessionId}'. Must match pattern ses_... or import-...` }],
      isError: true,
    };
  }

  if (!sessionId) {
    const session = createSession(agentName, 'snapshot');
    sessionId = session.id;
  }

  // Salva lo snapshot come contesto
  const snapshotContent = JSON.stringify(
    {
      snapshot_label: String(args.label ?? `snapshot-${new Date().toISOString()}`),
      timestamp: new Date().toISOString(),
      include_task_state: args.include_task_state ?? false,
    },
    null,
    2
  );

  const context = saveContext(
    sessionId,
    agentName,
    'snapshot',
    snapshotContent,
    'tool',
    { label: args.label, include_task_state: args.include_task_state ?? false }
  );

  // Registra evento snapshot
  insertEvent(
    sessionId,
    agentName,
    'context_saved',
    `Snapshot captured: ${args.label ?? 'unnamed'}`,
    { snapshot_id: context.id },
    ['snapshot']
  );

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          {
            success: true,
            data: {
              session_id: sessionId,
              snapshot_id: context.id,
              agents_snapshotted: 1,
              timestamp: context.created_at,
            },
          },
          null,
          2
        ),
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Nuove action Fase 2: Scriptorium
// ---------------------------------------------------------------------------

/**
 * Gestisce l'azione knowledge_suggest: suggerisce knowledge entries
 * rilevanti dato un contesto o per un agente specifico.
 *
 * Parametri:
 * - context (opzionale): testo di contesto per FTS5 search
 * - agent_name (opzionale): agente per cui suggerire knowledge
 * - limit (opzionale): numero massimo di suggerimenti (default: 5)
 *
 * Richiede almeno context o agent_name.
 */
async function handleKnowledgeSuggest(args: Record<string, unknown>): Promise<ToolResult> {
  const context = String(args.context ?? '');
  const agentName = String(args.agent_name ?? '');
  const limit = Number(args.limit ?? 5);

  if (agentName) {
    const ksAgentErr = validateAgentName(agentName);
    if (ksAgentErr) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ success: false, error: `knowledge_suggest validation error: ${ksAgentErr}` }, null, 2) }],
        isError: true,
      };
    }
  }

  if (!context && !agentName) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: false,
              error: 'knowledge_suggest requires context or agent_name',
            },
            null,
            2
          ),
        },
      ],
      isError: true,
    };
  }

  try {
    const suggestions = agentName
      ? suggestKnowledgeForAgent(agentName, limit)
      : suggestKnowledge(context, limit);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: true,
              data: {
                suggestions,
                total: suggestions.length,
                mode: agentName ? 'by_agent' : 'by_context',
              },
            },
            null,
            2
          ),
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: false,
              error: `knowledge_suggest failed: ${error instanceof Error ? error.message : String(error)}`,
            },
            null,
            2
          ),
        },
      ],
      isError: true,
    };
  }
}

/**
 * Gestisce l'azione faq_detect: rileva pattern ricorrenti negli eventi
 * e restituisce candidati FAQ.
 *
 * Parametri:
 * - min_occurrences (opzionale): numero minimo di occorrenze (default: 3)
 * - agent_name (opzionale): se fornito, genera anche le FAQ dal candidato
 */
async function handleFaqDetect(args: Record<string, unknown>): Promise<ToolResult> {
  const minOccurrences = Number(args.min_occurrences ?? 3);
  const agentName = String(args.agent_name ?? '');

  if (agentName) {
    const faqAgentErr = validateAgentName(agentName);
    if (faqAgentErr) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ success: false, error: `faq_detect validation error: ${faqAgentErr}` }, null, 2) }],
        isError: true,
      };
    }
  }

  try {
    const candidates = detectFaqCandidates(minOccurrences);

    // Se agent_name è fornito, genera automaticamente le FAQ
    if (agentName && candidates.length > 0) {
      for (const candidate of candidates) {
        try {
          generateFaqFromCandidate(candidate, agentName);
        } catch {
          // Non bloccare se una singola generazione fallisce
          console.error('[memory.tool] Failed to generate FAQ for candidate:', candidate.pattern);
        }
      }
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: true,
              data: {
                candidates,
                total: candidates.length,
                auto_generated: agentName ? candidates.length : 0,
              },
            },
            null,
            2
          ),
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: false,
              error: `faq_detect failed: ${error instanceof Error ? error.message : String(error)}`,
            },
            null,
            2
          ),
        },
      ],
      isError: true,
    };
  }
}

/**
 * Gestisce l'azione semantic_search: ricerca semantica su memoria del team.
 *
 * Parametri:
 * - query (obbligatorio): testo della query
 * - search_type (opzionale): tipo di entità ('all', 'knowledge', 'event', 'decision', default: 'all')
 * - limit (opzionale): numero massimo di risultati (default: 10)
 * - mode (opzionale): modalità di ricerca ('semantic' o 'hybrid', default: 'semantic')
 */
async function handleSemanticSearch(args: Record<string, unknown>): Promise<ToolResult> {
  const query = String(args.query ?? '');
  const searchType = String(args.search_type ?? 'all');
  const limit = Number(args.limit ?? 10);
  const mode = String(args.mode ?? 'semantic');

  if (!query.trim()) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            { success: false, error: 'semantic_search requires a non-empty query' },
            null,
            2
          ),
        },
      ],
      isError: true,
    };
  }

  try {
    const results = mode === 'hybrid'
      ? await hybridSearch(query, limit)
      : await semanticSearch(query, searchType, limit);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: true,
              data: {
                query,
                mode,
                search_type: searchType,
                results,
                total: results.length,
              },
            },
            null,
            2
          ),
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: false,
              error: `semantic_search failed: ${error instanceof Error ? error.message : String(error)}`,
            },
            null,
            2
          ),
        },
      ],
      isError: true,
    };
  }
}

/**
 * Gestisce l'azione link_decisions: collega decisioni correlate tramite similarity.
 *
 * Parametri:
 * - threshold (opzionale): soglia di similarità minima (default: 0.3)
 */
async function handleLinkDecisions(args: Record<string, unknown>): Promise<ToolResult> {
  const threshold = Number(args.threshold ?? 0.3);

  try {
    const links = await linkRelatedDecisions(threshold);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: true,
              data: {
                links,
                total: links.length,
                threshold,
              },
            },
            null,
            2
          ),
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: false,
              error: `link_decisions failed: ${error instanceof Error ? error.message : String(error)}`,
            },
            null,
            2
          ),
        },
      ],
      isError: true,
    };
  }
}

// ---------------------------------------------------------------------------
// Fase 4: Oracle — Trend Report e Predizione
// ---------------------------------------------------------------------------

/**
 * Gestisce l'azione trend_report: genera un report completo di trend.
 * Analizza modelli, produttività agenti e pattern di errore.
 *
 * Supporta parametri opzionali:
 * - domain (string): dominio per analisi metriche specifiche (quality, perf, etc.)
 * - metric_names (string[]): metriche specifiche da analizzare per il dominio
 */
function handleTrendReport(args: Record<string, unknown>): ToolResult {
  try {
    const domain = args.domain ? String(args.domain) : undefined;
    const metricNames = args.metric_names
      ? (args.metric_names as string[])
      : undefined;

    const report = generateTrendReport(domain, metricNames);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: true,
              data: report,
            },
            null,
            2
          ),
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: false,
              error: `trend_report failed: ${error instanceof Error ? error.message : String(error)}`,
            },
            null,
            2
          ),
        },
      ],
      isError: true,
    };
  }
}

/**
 * Gestisce l'azione oracle_predict: predice raccomandazioni per un agente.
 *
 * Parametri:
 * - agent (obbligatorio): nome dell'agente
 * - task (obbligatorio): descrizione del task
 */
async function handleOraclePredict(args: Record<string, unknown>): Promise<ToolResult> {
  const agent = String(args.agent ?? '');
  const task = String(args.task ?? '');

  if (agent) {
    const oracleAgentErr = validateAgentName(agent);
    if (oracleAgentErr) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ success: false, error: `oracle_predict validation error: ${oracleAgentErr}` }, null, 2) }],
        isError: true,
      };
    }
  }

  if (!agent || !task) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: false,
              error: 'oracle_predict requires agent and task parameters',
            },
            null,
            2
          ),
        },
      ],
      isError: true,
    };
  }

  try {
    const prediction = await predictForTask(agent, task);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: true,
              data: prediction,
            },
            null,
            2
          ),
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: false,
              error: `oracle_predict failed: ${error instanceof Error ? error.message : String(error)}`,
            },
            null,
            2
          ),
        },
      ],
      isError: true,
    };
  }
}
