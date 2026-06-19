/**
 * types/memory.ts
 * Tipi per il sistema di memoria persistente di Tabularium.
 * Definisce interfacce per Sessioni, Eventi, Contesti, Knowledge e Decision Rationale.
 *
 * @module types/memory
 */

export type SessionStatus = 'active' | 'completed' | 'aborted' | 'interrupted';

export type EventType =
  | 'task_started' | 'task_completed' | 'task_failed'
  | 'decision_made' | 'file_created' | 'file_modified'
  | 'handoff_sent' | 'handoff_received'
  | 'error_encountered' | 'milestone_reached'
  | 'context_saved' | 'knowledge_added'
  | 'query_executed' | 'advisory_requested'
  | 'config_changed' | 'session_started' | 'session_ended'
  | 'custom';

export type ContextType =
  | 'session_start' | 'session_end' | 'task_context'
  | 'handoff_context' | 'snapshot' | 'manual_save';

export type KnowledgeCategory =
  | 'lesson' | 'faq' | 'pattern' | 'tip' | 'pitfall' | 'tutorial';

export interface MemorySession {
  id: string;
  agent_name: string;
  start_time: string;
  end_time?: string;
  focus?: string;
  status: SessionStatus;
  metadata?: Record<string, unknown>;
  event_count?: number;
}

export interface MemoryEvent {
  id: string;
  session_id: string;
  timestamp: string;
  agent_name: string;
  event_type: EventType;
  summary: string;
  details?: Record<string, unknown>;
  tags?: string[];
}

export interface MemoryContext {
  id: string;
  session_id: string;
  agent_name: string;
  created_at: string;
  context_type: ContextType;
  content: string;
  source: 'auto' | 'manual' | 'file' | 'tool';
  metadata?: Record<string, unknown>;
}

export interface KnowledgeEntry {
  id: string;
  created_at: string;
  updated_at: string;
  title: string;
  body: string;
  category: KnowledgeCategory;
  tags?: string[];
  source_agent?: string;
  source_task_id?: string;
  relevance_score: number;
  status: 'active' | 'archived' | 'draft';
}

export interface DecisionRationale {
  id: string;
  adr_id: string;
  created_at: string;
  agent_name: string;
  alternatives: Array<{ name: string; pros: string[]; cons: string[]; score?: number }>;
  tradeoffs: Array<{ aspect: string; gained: string; lost: string }>;
  metrics: Record<string, unknown>;
  notes: string;
}

export interface MemoryConfig {
  path: string;
  enableWAL: boolean;
  cacheTTL: number;
  autoMigrate: boolean;
}
