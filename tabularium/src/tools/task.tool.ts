/**
 * tools/task.tool.ts
 * Tool MCP per la gestione dei task: lettura, filtro e riepilogo.
 */

import type { ToolHandler, ToolResult } from '../types/mcp.js';
import { parseProgress } from '../core/progress-parser.js';
import { getAllAgents } from '../core/agent-reader.js';
import type { TaskStatus, TaskPriority } from '../types/task.js';

export const taskToolHandler: ToolHandler = {
  name: 'task_list',
  description:
    'Elenca e filtra i task del progetto Codex Romanus. Supporta filtro per agente, status e priorità.',
  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['list', 'filter', 'summary', 'by-agent'],
        description: 'Azione da eseguire: list (tutti), filter (per criteri), summary (riepilogo), by-agent (per agente)',
      },
      agent: {
        type: 'string',
        description: "Nome dell'agente per filtrare (es. 'iuppiter', 'minerva')",
      },
      status: {
        type: 'string',
        enum: ['pending', 'in_progress', 'completed', 'blocked', 'cancelled'],
        description: 'Filtra per stato del task',
      },
      priority: {
        type: 'string',
        enum: ['high', 'medium', 'low'],
        description: 'Filtra per priorità',
      },
    },
    required: ['action'],
  },

  handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
    const action = String(args.action ?? 'list');
    const taskList = await parseProgress();
    let filtered = [...taskList.tasks];

    switch (action) {
      case 'list':
        // Restituisce tutti i task
        break;

      case 'filter':
        if (args.agent) {
          filtered = filtered.filter((t) => t.agent === String(args.agent));
        }
        if (args.status) {
          filtered = filtered.filter((t) => t.status === (args.status as TaskStatus));
        }
        if (args.priority) {
          filtered = filtered.filter((t) => t.priority === (args.priority as TaskPriority));
        }
        break;

      case 'summary':
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  action: 'summary',
                  summary: taskList.summary,
                  updatedAt: taskList.updatedAt,
                },
                null,
                2
              ),
            },
          ],
        };

      case 'by-agent':
        if (!args.agent) {
          return {
            content: [{ type: 'text', text: 'Error: agent parameter required for by-agent action' }],
            isError: true,
          };
        }
        filtered = filtered.filter((t) => t.agent === String(args.agent));
        break;

      default:
        return {
          content: [{ type: 'text', text: `Unknown action: ${action}` }],
          isError: true,
        };
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              action,
              count: filtered.length,
              tasks: filtered,
            },
            null,
            2
          ),
        },
      ],
    };
  },
};
