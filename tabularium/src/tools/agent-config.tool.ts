/**
 * tools/agent-config.tool.ts
 * Tool MCP per la gestione della configurazione degli agenti.
 * Supporta lettura, validazione e modifica di opencode.json.
 */

import type { ToolHandler, ToolResult } from '../types/mcp.js';
import { getAgentByName, getAllAgents, getModelAssignments } from '../core/agent-reader.js';
import { validateConfig } from '../core/validator.js';
import { updateAgentConfig } from '../core/config-writer.js';

export const agentConfigToolHandler: ToolHandler = {
  name: 'agent_config',
  description:
    'Gestisce la configurazione degli agenti in opencode.json: lettura, validazione e modifica.',
  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['list', 'get', 'validate', 'update', 'assignments'],
        description: 'Azione: list (tutti), get (singolo), validate, update, assignments',
      },
      agent: {
        type: 'string',
        description: "Nome dell'agente target",
      },
      updates: {
        type: 'object',
        description: 'Campi da aggiornare (per action=update)',
      },
    },
    required: ['action'],
  },

  handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
    const action = String(args.action ?? 'list');

    switch (action) {
      case 'list': {
        const agents = await getAllAgents();
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                agents.map((a) => ({
                  name: a.name,
                  latinName: a.latinName,
                  role: a.role,
                  emoji: a.emoji,
                  model: a.model,
                  mode: a.mode,
                  hasSkill: a.hasSkill,
                })),
                null,
                2
              ),
            },
          ],
        };
      }

      case 'get': {
        const agentName = String(args.agent ?? '');
        const agent = await getAgentByName(agentName);
        if (!agent) {
          return {
            content: [{ type: 'text', text: `Agent '${agentName}' not found` }],
            isError: true,
          };
        }
        return {
          content: [{ type: 'text', text: JSON.stringify(agent, null, 2) }],
        };
      }

      case 'validate': {
        const errors = await validateConfig();
        const isValid = errors.length === 0;
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ valid: isValid, errors }, null, 2),
            },
          ],
        };
      }

      case 'update': {
        const agentName = String(args.agent ?? '');
        const updates = (args.updates as Record<string, unknown>) ?? {};
        try {
          const result = await updateAgentConfig(agentName, updates);
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  { success: true, agent: agentName, backupPath: result.backupPath },
                  null,
                  2
                ),
              },
            ],
          };
        } catch (err) {
          return {
            content: [
              {
                type: 'text',
                text: `Update failed: ${err instanceof Error ? err.message : String(err)}`,
              },
            ],
            isError: true,
          };
        }
      }

      case 'assignments': {
        const assignments = await getModelAssignments();
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(assignments, null, 2),
            },
          ],
        };
      }

      default:
        return {
          content: [{ type: 'text', text: `Unknown action: ${action}` }],
          isError: true,
        };
    }
  },
};
