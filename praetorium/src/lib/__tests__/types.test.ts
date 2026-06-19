import { describe, it, expectTypeOf } from 'vitest'
import type {
  AgentStatus,
  AgentDTO,
  AgentsResponse,
  QualityComponent,
  QualityScorecardDTO,
  DecisionStatus,
  DecisionDTO,
  DecisionsResponse,
  DecisionDetailDTO,
  AgentModel,
  TaskStatus,
  TaskInfo,
  ModelConfig,
  AdvisoryEntry,
  ChannelDTO,
  ChannelMessageDTO,
  ChannelsResponse,
  ChannelDetailResponse,
  GraphNodeDTO,
  GraphEdgeDTO,
  GraphOverviewDTO,
  MetricPointDTO,
  MetricsDTO,
} from '../types'

describe('Tipi esportati da types.ts', () => {
  it('AgentStatus è un tipo letterale union', () => {
    expectTypeOf<AgentStatus>().toEqualTypeOf<
      'idle' | 'busy' | 'error' | 'offline'
    >()
  })

  it('AgentDTO ha le proprietà attese', () => {
    expectTypeOf<AgentDTO>().toHaveProperty('agent_name')
    expectTypeOf<AgentDTO>().toHaveProperty('status')
    expectTypeOf<AgentDTO>().toHaveProperty('current_task')
    expectTypeOf<AgentDTO>().toHaveProperty('last_seen')
    expectTypeOf<AgentDTO>().toHaveProperty('is_online')
  })

  it('AgentsResponse ha agents come array', () => {
    expectTypeOf<AgentsResponse>().toHaveProperty('agents')
    expectTypeOf<AgentsResponse['agents']>().toEqualTypeOf<AgentDTO[]>()
  })

  it('DecisionStatus ha i 4 stati', () => {
    expectTypeOf<DecisionStatus>().toEqualTypeOf<
      'proposed' | 'accepted' | 'deprecated' | 'superseded'
    >()
  })

  it('TaskStatus ha i 5 stati', () => {
    expectTypeOf<TaskStatus>().toEqualTypeOf<
      'pending' | 'in_progress' | 'completed' | 'blocked' | 'cancelled'
    >()
  })

  it('AgentModel include go e zen', () => {
    expectTypeOf<AgentModel>().toEqualTypeOf<
      'go' | 'zen' | 'sonnet' | 'gpt-4o' | 'gpt-4.1'
    >()
  })

  it('TaskInfo ha id, title, status, priority', () => {
    expectTypeOf<TaskInfo>().toHaveProperty('id')
    expectTypeOf<TaskInfo>().toHaveProperty('title')
    expectTypeOf<TaskInfo>().toHaveProperty('status')
    expectTypeOf<TaskInfo>().toHaveProperty('priority')
  })

  it('ChannelDTO ha id, name, description', () => {
    expectTypeOf<ChannelDTO>().toHaveProperty('id')
    expectTypeOf<ChannelDTO>().toHaveProperty('name')
    expectTypeOf<ChannelDTO>().toHaveProperty('description')
  })

  it('GraphNodeDTO ha id, type, entity_type', () => {
    expectTypeOf<GraphNodeDTO>().toHaveProperty('id')
    expectTypeOf<GraphNodeDTO>().toHaveProperty('type')
    expectTypeOf<GraphNodeDTO>().toHaveProperty('entity_type')
  })

  it('GraphEdgeDTO ha source, target, relation, weight', () => {
    expectTypeOf<GraphEdgeDTO>().toHaveProperty('source')
    expectTypeOf<GraphEdgeDTO>().toHaveProperty('target')
    expectTypeOf<GraphEdgeDTO>().toHaveProperty('relation')
    expectTypeOf<GraphEdgeDTO>().toHaveProperty('weight')
  })

  it('MetricPointDTO ha recorded_at, metric_name, value', () => {
    expectTypeOf<MetricPointDTO>().toHaveProperty('recorded_at')
    expectTypeOf<MetricPointDTO>().toHaveProperty('metric_name')
    expectTypeOf<MetricPointDTO>().toHaveProperty('value')
  })
})
