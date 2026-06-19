/**
 * Tipi per i task del progetto Codex Romanus.
 * I task sono tracciati in docs/codex-romanus/tasks.md.
 */

export type TaskStatus =
  | 'pending'
  | 'in_progress'
  | 'completed'
  | 'blocked'
  | 'cancelled';

export type TaskPriority = 'high' | 'medium' | 'low';

export interface Task {
  id?: string;
  title?: string;
  agent: string;
  task: string;
  status: TaskStatus;
  notes?: string;
  timestamp?: string;
  priority?: TaskPriority;
}

/**
 * Risultato del parsing dei task.
 */
export interface TaskList {
  tasks: Task[];
  updatedAt: string;
  summary: {
    total: number;
    pending: number;
    in_progress: number;
    completed: number;
    blocked: number;
    cancelled: number;
  };
}
