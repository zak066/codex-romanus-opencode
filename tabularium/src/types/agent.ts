/**
 * Tipi per gli agenti del progetto Codex Romanus.
 * Ogni agente è un'entità configurata in opencode.json.
 */

export interface Agent {
  name: string;
  role: string;
  latinName: string;
  emoji: string;
  color: string;
  model: string;
  mode: 'primary' | 'subagent';
  temperature: number;
  steps?: number;
  variant?: string;
  permissions: AgentPermissions;
  skill?: string;
  hasSkill: boolean;
}

export interface AgentPermissions {
  bash: 'allow' | 'deny' | 'ask' | Record<string, string>;
  edit: 'allow' | 'deny' | 'ask';
  task: 'allow' | 'deny' | 'ask';
  webfetch?: 'allow' | 'deny' | 'ask';
  websearch?: 'allow' | 'deny' | 'ask';
}

/**
 * Mappa degli agenti per nome (da opencode.json).
 */
export interface AgentManifest {
  agents: Record<string, Agent>;
  primaryAgent: string;
}
