/**
 * tools/knowledge-inject.tool.ts
 * Tool MCP per iniezione di contesto strutturato per agenti.
 *
 * Crea una knowledge entry nel database per contestualizzare un agente
 * con informazioni mirate. Opzionalmente suggerisce categoria e tag.
 *
 * @module tools/knowledge-inject
 */

import type { ToolHandler, ToolResult } from '../types/mcp.js';
import { getDatabase } from '../core/database.js';
import { suggestCategoryAndTags } from '../core/knowledge-manager.js';
import { validateAgentName } from '../messaging/agent-validator.js';
import crypto from 'node:crypto';

// ---------------------------------------------------------------------------
// Context types validi
// ---------------------------------------------------------------------------

const VALID_CONTEXT_TYPES = [
  'session_start',
  'session_end',
  'task_context',
  'handoff_context',
  'snapshot',
  'manual_save',
  'agent_profile',
  'domain_knowledge',
  'project_rules',
  'custom',
];

// ---------------------------------------------------------------------------
// Tool: knowledge_inject
// ---------------------------------------------------------------------------

export const knowledgeInjectToolHandler: ToolHandler = {
  name: 'knowledge_inject',
  description:
    "Iniezione di contesto strutturato per agenti. " +
    "Crea una knowledge entry nel database associata a un agente " +
    "con tipo di contesto, contenuto e tag opzionali.",
  inputSchema: {
    type: 'object',
    properties: {
      agent: {
        type: 'string',
        description: "Nome dell'agente target (es. 'vulcanus-senior-dev')",
      },
      context_type: {
        type: 'string',
        description:
          "Tipo di contesto: session_start, session_end, task_context, " +
          "handoff_context, snapshot, manual_save, agent_profile, " +
          "domain_knowledge, project_rules, custom",
      },
      content: {
        type: 'string',
        description: 'Contenuto strutturato del contesto (testo libero o JSON)',
      },
      source: {
        type: 'string',
        description: "Origine del contesto: auto, manual, file, tool (default: 'tool')",
      },
      tags: {
        type: 'array',
        items: { type: 'string' },
        description: 'Tag opzionali per categorizzare la knowledge entry',
      },
    },
    required: ['agent', 'context_type', 'content'],
  },

  handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
    // Validazione agent
    if (!args.agent || typeof args.agent !== 'string' || args.agent.trim().length === 0) {
      return errorResult('agent is required and must be a non-empty string');
    }
    const kiAgentErr = validateAgentName(String(args.agent));
    if (kiAgentErr) {
      return errorResult(kiAgentErr);
    }

    // Validazione context_type
    if (!args.context_type || typeof args.context_type !== 'string') {
      return errorResult('context_type is required and must be a string');
    }

    const contextType = args.context_type.toLowerCase().trim();
    if (!VALID_CONTEXT_TYPES.includes(contextType)) {
      return errorResult(
        `Invalid context_type '${args.context_type}'. Supported: ${VALID_CONTEXT_TYPES.join(', ')}`
      );
    }

    // Validazione content
    if (!args.content || typeof args.content !== 'string' || args.content.trim().length === 0) {
      return errorResult('content is required and must be a non-empty string');
    }

    // Validazione source
    const source = args.source ? String(args.source).toLowerCase().trim() : 'tool';
    const validSources = ['auto', 'manual', 'file', 'tool'];
    if (!validSources.includes(source)) {
      return errorResult(`Invalid source '${args.source}'. Supported: ${validSources.join(', ')}`);
    }

    try {
      const db = getDatabase();

      const agent = String(args.agent);
      const content = String(args.content);
      const tags = args.tags
        ? (args.tags as string[]).filter((t) => typeof t === 'string')
        : [];

      // Suggerisci categoria e tag se non forniti
      const suggested = suggestCategoryAndTags(
        `Context injection for ${agent}: ${contextType}`,
        content.substring(0, 500)
      );
      const finalTags = tags.length > 0 ? tags : suggested.tags;

      // Crea la knowledge entry
      const id = `kni_${crypto.randomUUID()}`;
      const now = new Date().toISOString();
      const tagsJson = JSON.stringify(finalTags);

      db.prepare(`
        INSERT INTO knowledge_entries (id, created_at, updated_at, title, body,
          category, tags, source_agent, relevance_score, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        now,
        now,
        `[${contextType}] Context injection for ${agent}`,
        content,
        suggested.category,
        tagsJson,
        agent,
        1.0,
        'active'
      );

      // Fire event per notifica (messaging-compatible type)
      try {
        const { emit } = await import('../messaging/event-bus.js');
        emit({
          type: 'message_sent',
          payload: {
            knowledge_id: id,
            agent,
            context_type: contextType,
            category: suggested.category,
            tags: finalTags,
            action: 'knowledge_injected',
          },
          timestamp: now,
          agent_name: agent,
        });
      } catch {
        // Event bus non disponibile — continua senza notifica
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                data: {
                  id,
                  agent,
                  context_type: contextType,
                  category: suggested.category,
                  tags: finalTags,
                  created_at: now,
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
                error: 'KNOWLEDGE_INJECT_ERROR',
                message: `knowledge_inject failed: ${error instanceof Error ? error.message : String(error)}`,
              },
              null,
              2
            ),
          },
        ],
        isError: true,
      };
    }
  },
};

/**
 * Crea un ToolResult di errore.
 */
function errorResult(message: string): ToolResult {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          {
            success: false,
            error: 'VALIDATION_ERROR',
            message,
          },
          null,
          2
        ),
      },
    ],
    isError: true,
  };
}
