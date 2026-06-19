/**
 * resources/skills.resource.ts
 * Resource MCP che espone le skill configurate per gli agenti.
 * URI: tabularium://skills
 */

import type { ResourceContent, ResourceHandler } from '../types/mcp.js';
import { getAllAgents } from '../core/agent-reader.js';

export const skillResourceHandler: ResourceHandler = {
  uri: 'tabularium://skills',
  name: 'Agent Skills',
  description:
    'Skill assegnate agli agenti Codex Romanus. Chi ha una skill, cosa sa fare.',
  mimeType: 'application/json',

  handler: async (): Promise<ResourceContent[]> => {
    const agents = await getAllAgents();
    const skilledAgents = agents
      .filter((a) => a.hasSkill)
      .map((a) => ({
        name: a.name,
        latinName: a.latinName,
        role: a.role,
        skillFile: `.opencode/skills/${a.skill || a.name}/SKILL.md`,
      }));

    const unskilledAgents = agents
      .filter((a) => !a.hasSkill)
      .map((a) => ({
        name: a.name,
        latinName: a.latinName,
      }));

    return [
      {
        uri: 'tabularium://skills/list',
        mimeType: 'application/json',
        text: JSON.stringify(skilledAgents, null, 2),
      },
      {
        uri: 'tabularium://skills/without',
        mimeType: 'application/json',
        text: JSON.stringify(unskilledAgents, null, 2),
      },
      {
        uri: 'tabularium://skills/summary',
        mimeType: 'application/json',
        text: JSON.stringify(
          {
            total: agents.length,
            withSkills: skilledAgents.length,
            withoutSkills: unskilledAgents.length,
          },
          null,
          2
        ),
      },
    ];
  },
};
