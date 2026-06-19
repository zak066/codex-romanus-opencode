/**
 * resources/project.resource.ts
 * Resource MCP che espone i task e lo stato del progetto.
 * URI: tabularium://project
 */

import type { ResourceContent, ResourceHandler } from '../types/mcp.js';
import { parseProgress } from '../core/progress-parser.js';

export const projectResourceHandler: ResourceHandler = {
  uri: 'tabularium://project',
  name: 'Project Status',
  description:
    'Stato del progetto Codex Romanus: task per agente, avanzamento, priorità. Dati da docs/codex-romanus/progress.md.',
  mimeType: 'application/json',

  handler: async (): Promise<ResourceContent[]> => {
    const taskList = await parseProgress();

    return [
      {
        uri: 'tabularium://project/tasks',
        mimeType: 'application/json',
        text: JSON.stringify(taskList.tasks, null, 2),
      },
      {
        uri: 'tabularium://project/summary',
        mimeType: 'application/json',
        text: JSON.stringify(taskList.summary, null, 2),
      },
      {
        uri: 'tabularium://project/meta',
        mimeType: 'application/json',
        text: JSON.stringify({ updatedAt: taskList.updatedAt, totalTasks: taskList.tasks.length }, null, 2),
      },
    ];
  },
};
