/**
 * tools/skill.tool.ts
 * Tool MCP per la gestione delle skill degli agenti.
 * Supporta query e statistiche sulle skill configurate.
 */

import type { ToolHandler, ToolResult } from '../types/mcp.js';
import { getAllAgents } from '../core/agent-reader.js';
import * as fs from 'fs';
import * as path from 'path';

export const skillToolHandler: ToolHandler = {
  name: 'skill_manager',
  description:
    'Gestisce le skill degli agenti Codex Romanus: elenca, verifica esistenza file SKILL.md, statistiche.',
  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['list', 'check', 'stats', 'read'],
        description: 'Azione: list (agenti con skill), check (verifica file), stats (statistiche), read (leggi SKILL.md)',
      },
      agent: {
        type: 'string',
        description: "Nome dell'agente (per action=check o read)",
      },
    },
    required: ['action'],
  },

  handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
    const action = String(args.action ?? 'list');
    const agents = await getAllAgents();

    switch (action) {
      case 'list': {
        const skilled = agents.filter((a) => a.hasSkill);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                skilled.map((a) => ({
                  name: a.name,
                  latinName: a.latinName,
                  role: a.role,
                  skillPath: `.opencode/skills/${a.skill || a.name}/SKILL.md`,
                })),
                null,
                2
              ),
            },
          ],
        };
      }

      case 'check': {
        const agentName = String(args.agent ?? '');
        const agent = agents.find((a) => a.name === agentName);
        if (!agent) {
          return {
            content: [{ type: 'text', text: `Agent '${agentName}' not found` }],
            isError: true,
          };
        }

        const skillPath = path.resolve(
          process.cwd(),
          '.opencode',
          'skills',
          agentName,
          'SKILL.md'
        );

        const exists = fs.existsSync(skillPath);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  agent: agentName,
                  hasSkill: agent.hasSkill,
                  skillFileExists: exists,
                  skillPath,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case 'stats':
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  totalAgents: agents.length,
                  withSkills: agents.filter((a) => a.hasSkill).length,
                  withoutSkills: agents.filter((a) => !a.hasSkill).length,
                  breakdown: agents.map((a) => ({
                    name: a.name,
                    hasSkill: a.hasSkill,
                  })),
                },
                null,
                2
              ),
            },
          ],
        };

      case 'read': {
        const agentName = String(args.agent ?? '');
        const agent = agents.find((a) => a.name === agentName);
        if (!agent) {
          return {
            content: [{ type: 'text', text: `Agent '${agentName}' not found` }],
            isError: true,
          };
        }

        const skillPath = path.resolve(
          process.cwd(),
          '.opencode',
          'skills',
          agentName,
          'SKILL.md'
        );

        if (!fs.existsSync(skillPath)) {
          return {
            content: [{ type: 'text', text: `Skill file not found: ${skillPath}` }],
            isError: true,
          };
        }

        const content = fs.readFileSync(skillPath, 'utf-8');
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ agent: agentName, skillContent: content }, null, 2),
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
