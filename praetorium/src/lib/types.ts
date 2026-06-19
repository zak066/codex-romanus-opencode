// ─── Agent Types ──
export type AgentStatus = 'idle' | 'busy' | 'error' | 'offline';

export interface AgentDTO {
  agent_name: string;
  status: AgentStatus;
  current_task: string | null;
  last_seen: string;
  is_online: boolean;
  seconds_since_heartbeat: number;
  model: string;

}

export interface AgentsResponse {
  total: number;
  online: number;
  offline: number;
  agents: AgentDTO[];
}

// ─── Quality Types ──
export interface QualityComponent {
  name: string;
  weight: number;
  score: number;
  grade: string;
  metrics: Record<string, unknown>;
}

export interface QualityScorecardDTO {
  grade: string;
  score: number;
  generatedAt: string;
  window_days: number;
  period: { from: string; to: string };
  components: QualityComponent[];
}

// ─── Decision Types ──
export type DecisionStatus = 'proposed' | 'accepted' | 'deprecated' | 'superseded';

export interface DecisionDTO {
  id: string;
  title: string;
  status: string;
}

export interface DecisionsResponse {
  total_adrs: number;
  active_adrs: number;
  active_details: DecisionDTO[];
}

export interface DecisionDetailDTO {
  id: string;
  title: string;
  status: string;
  created_at: string;
  updated_at: string;
  has_file: boolean;

  file_path: string | null;
  content_markdown: string;
  content_truncated: boolean;
}

// ─── Keep these existing ones ──
export type AgentModel = 'go' | 'zen' | 'sonnet' | 'gpt-4o' | 'gpt-4.1';
export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'blocked' | 'cancelled';

export interface TaskInfo {
  id: string;
  title: string;
  status: TaskStatus;
  agent?: string;
  priority: 'high' | 'medium' | 'low';
  created_at: string;
}

export interface ModelConfig {
  name: string;
  type: AgentModel;
  provider: string;
  capabilities: string[];
  temperature?: number;
  maxTokens?: number;
}

export interface AdvisoryEntry {
  type: 'warning' | 'info' | 'critical';
  message: string;
  timestamp: string;
  source: string;
}

// ─── Channel Types ──
export interface ChannelDTO {
  id: string;
  name: string;
  description: string;
  is_default: boolean;
  message_count?: number;
  last_message?: { content: string; sender: string; created_at: string };
}

export interface ChannelMessageDTO {
  id: string;
  sender: string;
  content: string;
  created_at: string;
}

export interface ChannelsResponse {
  channels: ChannelDTO[];
  total: number;
}

export interface ChannelDetailResponse {
  channel: ChannelDTO;
  messages: ChannelMessageDTO[];
  total: number;
}

// ─── Graph Types ──
export interface GraphNodeDTO {
  id: string;
  type: string;
  title?: string;
  entity_type: string;
}

export interface GraphEdgeDTO {
  source: string;
  target: string;
  relation: string;
  weight: number;
}

export interface GraphOverviewDTO {
  total_edges: number;
  by_entity_type: Record<string, number>;
  by_relation: Record<string, number>;
  last_updated: string;
  nodes: GraphNodeDTO[];
  edges: GraphEdgeDTO[];
}

// ─── Metrics Types ──
export interface MetricPointDTO {
  recorded_at: string;
  metric_name: string;
  value: number;
  tags?: Record<string, string>;
}

export interface MetricsDTO {
  perf: { domain: string; data: MetricPointDTO[] };
  quality: { domain: string; data: MetricPointDTO[] };
  cache: { domain: string; data: MetricPointDTO[] };
  system: {
    agent_distribution: Record<string, number>;
  };
}
