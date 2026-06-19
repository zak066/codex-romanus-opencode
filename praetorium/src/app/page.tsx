'use client';

import { useEffect, useState } from 'react';
import type {
  AgentsResponse,
  QualityScorecardDTO,
  DecisionsResponse,
  MetricsDTO,
  AgentDTO,
  QualityComponent,
  DecisionDTO,
} from '@/lib/types';

// ═══════════════════════════════════════════════════════════════
//  INLINE SVG ICONS
// ═══════════════════════════════════════════════════════════════

function IconUsers({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function IconTasks({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
      <line x1="9" y1="9" x2="15" y2="9" />
      <line x1="9" y1="13" x2="15" y2="13" />
      <line x1="9" y1="17" x2="13" y2="17" />
    </svg>
  );
}

function IconStar({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  );
}

function IconFile({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
      <polyline points="10 9 9 9 8 9" />
    </svg>
  );
}

function IconClock({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

function IconCheck({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  );
}

function IconBarChart({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="20" x2="12" y2="10" />
      <line x1="18" y1="20" x2="18" y2="4" />
      <line x1="6" y1="20" x2="6" y2="16" />
    </svg>
  );
}

function IconList({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="8" y1="6" x2="21" y2="6" />
      <line x1="8" y1="12" x2="21" y2="12" />
      <line x1="8" y1="18" x2="21" y2="18" />
      <line x1="3" y1="6" x2="3.01" y2="6" />
      <line x1="3" y1="12" x2="3.01" y2="12" />
      <line x1="3" y1="18" x2="3.01" y2="18" />
    </svg>
  );
}

function IconActivity({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
    </svg>
  );
}

function IconCrown({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 4l3 12h14l3-12-6 7-4-7-4 7-6-7z" />
      <path d="M3 20h18" />
    </svg>
  );
}

// ─── Constants ──────────────────────────────────────────────────────────────

const AGENT_DISPLAY: Record<string, string> = {
  'iuppiter-orchestrator': 'Iuppiter',
  'minerva-architect': 'Minerva',
  'vulcanus-senior-dev': 'Vulcanus',
  'catone-quality': 'Catone',
  'janus-security': 'Janus',
  'agrippa-devops': 'Agrippa',
  'scipione-perf': 'Scipione',
  'ovidio-frontend': 'Ovidio',
  'plinioilvecchio-seo': 'Plinio',
  'mercurius-junior-dev': 'Mercurius',
  'diana-tester': 'Diana',
  'tacito-docs': 'Tacito',
};

const AGENT_ROLES: Record<string, string> = {
  'iuppiter-orchestrator': 'Orchestrator',
  'minerva-architect': 'Architect',
  'vulcanus-senior-dev': 'Senior Developer',
  'catone-quality': 'Quality',
  'janus-security': 'Security',
  'agrippa-devops': 'DevOps',
  'scipione-perf': 'Performance',
  'ovidio-frontend': 'Frontend',
  'plinioilvecchio-seo': 'SEO',
  'mercurius-junior-dev': 'Junior Dev',
  'diana-tester': 'Tester',
  'tacito-docs': 'Documenter',
};

// ─── Helper ─────────────────────────────────────────────────────────────────

function formatHeartbeatTime(seconds: number): string {
  if (seconds < 60) return '1 min';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}g`;
}

function formatUptime(seconds: number): string {
  if (seconds < 60) return '<1m';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  return `${days}g ${hours}h`;
}

// ─── Data types ─────────────────────────────────────────────────────────────

interface AgentData {
  name: string;
  role: string;
  status: 'idle' | 'busy' | 'error' | 'offline';
  task: string;
  model?: string;
  time?: string;
}

interface QualityItem {
  label: string;
  grade: string;
  value: string;
  percentage: number;
}

interface DecisionItem {
  id: string;
  title: string;
  status: 'Accepted' | 'Proposed';
}

// ─── Status dot colour map ──────────────────────────────────────────────────

const STATUS_DOT: Record<string, string> = {
  idle: 'bg-semantic-success',
  busy: 'bg-roman-gold',
  error: 'bg-semantic-error',
  offline: 'bg-text-dim',
};

const STATUS_LABEL_CLASS: Record<string, string> = {
  idle: 'text-semantic-success',
  busy: 'text-roman-gold',
  error: 'text-semantic-error',
  offline: 'text-text-dim',
};

// ─── Grade bar colour map ──────────────────────────────────────────────────

const GRADE_COLOUR: Record<string, string> = {
  A: 'bg-semantic-success',
  B: 'bg-roman-gold',
  C: 'bg-semantic-warning',
  D: 'bg-semantic-error',
};

// ═══════════════════════════════════════════════════════════════════════════════
//  COMPONENTS
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Section Header ─────────────────────────────────────────────────────────

function SectionHeader({
  icon,
  title,
  count,
  delay = 0,
}: {
  icon: React.ReactNode;
  title: React.ReactNode;
  count?: string;
  delay?: number;
}) {
  return (
    <div
      className="flex items-center justify-between animate-slide-up"
      style={{ animationDelay: `${delay}s` }}
    >
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 pl-3 border-l-2 border-roman-gold-dark">
          <span className="text-text-muted shrink-0">{icon}</span>
          <h2 className="font-roman text-xs font-semibold tracking-[0.15em] uppercase text-text-primary">
            {title}
          </h2>
        </div>
        {count && (
          <span className="bg-roman-gold/10 text-roman-gold text-[0.6rem] rounded-full px-2.5 py-0.5 font-medium font-roman tracking-wide">
            {count}
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Metric Tile ────────────────────────────────────────────────────────────

function MetricTile({
  icon,
  value,
  label,
  subtitle,
  gold = false,
  trend,
  delay,
}: {
  icon: React.ReactNode;
  value: string;
  label: string;
  subtitle?: string;
  gold?: boolean;
  trend?: 'up' | 'down';
  delay: number;
}) {
  return (
    <div
      className="bg-surface-raised rounded-lg border border-border-subtle p-4 shadow-sm transition-all duration-200 hover:shadow-md hover:-translate-y-0.5 animate-slide-up cursor-default"
      style={{ animationDelay: `${delay}s` }}
    >
      <div className="flex items-center gap-3 mb-3">
        <div className={`shrink-0 ${gold ? 'text-roman-gold' : 'text-text-muted'}`}>
          {icon}
        </div>
        <span className="text-[0.6rem] uppercase tracking-widest font-semibold font-roman text-text-muted">
          {label}
        </span>
      </div>
      <div className="flex items-baseline gap-1.5">
        <span
          className={`text-2xl font-bold font-roman leading-tight ${
            gold ? 'text-roman-gold' : 'text-text-primary'
          }`}
        >
          {value}
        </span>
        {trend && (
          <span
            className={`text-xs font-medium ${
              trend === 'up' ? 'text-semantic-success' : 'text-semantic-error'
            }`}
          >
            <svg className="w-3 h-3 inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              {trend === 'up' ? (
                <polyline points="18 15 12 9 6 15" />
              ) : (
                <polyline points="6 9 12 15 18 9" />
              )}
            </svg>
          </span>
        )}
      </div>
      {subtitle && (
        <div className="text-xs text-text-dim mt-1">{subtitle}</div>
      )}
    </div>
  );
}

// ─── Agent Panel ────────────────────────────────────────────────────────────

function AgentPanel({
  agent,
  featured = false,
  delay,
}: {
  agent: AgentData;
  featured?: boolean;
  delay: number;
}) {
  const isError = agent.status === 'error';

  return (
    <div
      className={[
        'relative rounded-lg border shadow-sm transition-all duration-200 cursor-default animate-panel-reveal',
        featured
          ? 'border-roman-gold-dark/40 bg-gradient-to-br from-surface-raised via-surface-raised to-surface-overlay overflow-hidden border-l-[3px]'
          : 'border-border-subtle bg-surface-raised hover:shadow-md hover:-translate-y-0.5',
      ].join(' ')}
      style={{ animationDelay: `${delay}s` }}
      role="listitem"
    >
      {/* Featured gold glow */}
      {featured && (
        <>
          <div
            className="absolute -top-16 -right-16 w-40 h-40 bg-[radial-gradient(circle,rgba(212,165,74,0.06)_0%,transparent_70%)] pointer-events-none"
            aria-hidden="true"
          />
          <div
            className="absolute top-3 right-3 text-roman-gold/30"
            aria-hidden="true"
          >
            <IconCrown className="w-4 h-4" />
          </div>
        </>
      )}

      {/* Header: name + role (left), status dot (right) */}
      <div className="p-4 pb-0">
        <div className="flex items-start justify-between">
          <div className="min-w-0 flex-1">
            <div
              className={`font-roman font-semibold tracking-tight truncate ${
                featured ? 'text-roman-gold text-base' : 'text-text-primary text-sm'
              }`}
            >
              {agent.name}
            </div>
            <div className={`text-text-muted font-normal truncate ${
              featured ? 'text-xs mt-0.5' : 'text-[0.68rem] mt-px'
            }`}>
              {agent.role}
            </div>
          </div>
          {/* Status dot with tooltip-like label */}
          <div className="flex flex-col items-center gap-1 shrink-0 ml-2">
            <div
              className={`w-2.5 h-2.5 rounded-full ${STATUS_DOT[agent.status]} ${
                agent.status === 'busy' ? 'animate-pulse' : ''
              }`}
              aria-label={`Status: ${agent.status}`}
              title={agent.status}
            />
            <span className={`text-[0.45rem] uppercase tracking-widest font-semibold ${STATUS_LABEL_CLASS[agent.status]}`}>
              {agent.status}
            </span>
          </div>
        </div>
      </div>

      {/* Task description */}
      <div className="px-4 py-2.5">
        <p
          className={`text-text-secondary leading-relaxed line-clamp-2 min-h-[2.5em] ${
            featured ? 'text-sm' : 'text-xs'
          }`}
        >
          {isError ? (
            <span className="text-semantic-error font-medium">{agent.task}</span>
          ) : (
            <em>{agent.task}</em>
          )}
        </p>
      </div>

      {/* Meta footer */}
      <div className="px-4 pb-4">
        <div className="flex items-center justify-between gap-3 text-xs text-text-muted border-t border-border-subtle pt-2.5">
          {agent.model ? (
            <span className="text-[0.55rem] uppercase tracking-wider text-text-dim truncate font-medium">
              {agent.model}
            </span>
          ) : (
            <span className="text-text-dim italic text-[0.55rem]">{agent.role}</span>
          )}
          {agent.time && (
            <span className="text-[0.6rem] text-text-dim shrink-0">{agent.time}</span>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Quality Bar ────────────────────────────────────────────────────────────

function QualityBar({ item, delay }: { item: QualityItem; delay: number }) {
  return (
    <div
      className="flex items-center gap-3 py-2.5 border-b border-border-subtle last:border-b-0 animate-slide-up"
      style={{ animationDelay: `${delay}s` }}
    >
      <span className="text-sm text-text-secondary min-w-[110px] font-medium">{item.label}</span>

      <div className="flex-1 h-2 bg-surface-panel rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-1000 ease-out ${GRADE_COLOUR[item.grade] ?? 'bg-roman-gold'}`}
          style={{ width: `${item.percentage}%` }}
        />
      </div>

      <span className="text-sm font-semibold font-roman text-text-primary min-w-[48px] text-right tabular-nums">
        {item.value}
      </span>
    </div>
  );
}

// ─── Decision Chip ──────────────────────────────────────────────────────────

function DecisionChip({ decision, delay }: { decision: DecisionItem; delay: number }) {
  const isAccepted = decision.status === 'Accepted';

  return (
    <div
      className="flex items-center gap-3 py-2.5 border-b border-border-subtle last:border-b-0 animate-slide-up"
      style={{ animationDelay: `${delay}s` }}
    >
      <span
        className={`text-[0.5rem] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full border font-roman shrink-0 ${
          isAccepted
            ? 'bg-semantic-success/5 text-semantic-success border-semantic-success/10'
            : 'bg-roman-gold/5 text-roman-gold border-roman-gold/10'
        }`}
      >
        {isAccepted ? 'Acc' : 'Prop'}
      </span>
      <div className="min-w-0 flex-1">
        <span className="text-sm text-text-secondary">
          <strong className="text-text-primary font-medium font-roman">{decision.id}:</strong>{' '}
          <span className="text-text-muted">{decision.title}</span>
        </span>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  PAGE
// ═══════════════════════════════════════════════════════════════════════════════

export default function Home() {
  const [agentsData, setAgentsData] = useState<AgentsResponse | null>(null);
  const [qualityData, setQualityData] = useState<QualityScorecardDTO | null>(null);
  const [decisionsData, setDecisionsData] = useState<DecisionsResponse | null>(null);
  const [metricsData, setMetricsData] = useState<MetricsDTO | null>(null);
  const [modelsData, setModelsData] = useState<{ agents: Array<{ name: string; model?: string }> } | null>(null);
  const [healthData, setHealthData] = useState<{ uptime: number; startTime: string } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();

    async function fetchDashboardData() {
      try {
        const [agentsRes, qualityRes, decisionsRes, metricsRes, modelsRes, healthRes] = await Promise.all([
          fetch('/api/agents', { signal: controller.signal }),
          fetch('/api/quality', { signal: controller.signal }),
          fetch('/api/decisions', { signal: controller.signal }),
          fetch('/api/metrics', { signal: controller.signal }),
          fetch('/api/models', { signal: controller.signal }),
          fetch('/api/health', { signal: controller.signal }),
        ]);

        const [a, q, d, m, mod, h] = await Promise.all([
          agentsRes.json() as Promise<AgentsResponse>,
          qualityRes.json() as Promise<QualityScorecardDTO>,
          decisionsRes.json() as Promise<DecisionsResponse>,
          metricsRes.json() as Promise<MetricsDTO>,
          modelsRes.json() as Promise<{ agents: Array<{ name: string; model?: string }> }>,
          healthRes.json() as Promise<{ uptime: number; startTime: string }>,
        ]);

        if (!controller.signal.aborted) {
          setAgentsData(a);
          setQualityData(q);
          setDecisionsData(d);
          setMetricsData(m);
          setModelsData(mod);
          setHealthData(h);
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        console.error('Failed to fetch dashboard data:', err);
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }

    fetchDashboardData();
    return () => controller.abort();
  }, []);

  // ── Derived data ───────────────────────────────────────────────────────────

  const realAgents = agentsData?.agents?.filter((a: AgentDTO) => !a.agent_name.startsWith('$')) ?? [];
  const onlineCount = realAgents.filter((a: AgentDTO) => a.status !== 'offline').length;
  const totalCount = realAgents.length;
  const busyCount = realAgents.filter((a: AgentDTO) => a.status === 'busy').length;
  const grade = qualityData?.grade ?? '\u2014';
  const score = qualityData?.score ?? 0;
  const activeAdrs = decisionsData?.active_adrs ?? 0;

  const latestTests = (() => {
    const testPassEntries = metricsData?.quality?.data?.filter(
      (d: { metric_name: string; value: number }) => d.metric_name === 'test_pass'
    );
    if (testPassEntries && testPassEntries.length > 0) {
      return testPassEntries[0].value.toString();
    }
    return '\u2014';
  })();

  const modelMap: Record<string, string> = {};
  if (modelsData) {
    for (const agent of modelsData.agents) {
      if (agent.model) {
        modelMap[agent.name] = agent.model;
      }
    }
  }

  const agentsList: AgentData[] = agentsData
    ? realAgents.map((a: AgentDTO) => ({
        name: AGENT_DISPLAY[a.agent_name] ?? a.agent_name,
        role: AGENT_ROLES[a.agent_name] ?? 'Agent',
        status: a.status,
        task: a.current_task ?? '\u2014',
        time: formatHeartbeatTime(a.seconds_since_heartbeat),
        model: modelMap[a.agent_name] ?? undefined,
      }))
    : [];

  const qualityItems: QualityItem[] = qualityData
    ? [
        {
          label: 'Overall Score',
          grade: qualityData.grade,
          value: `${qualityData.grade} (${qualityData.score}%)`,
          percentage: qualityData.score,
        },
        ...qualityData.components.map((c: QualityComponent) => ({
          label: c.name,
          grade: c.grade,
          value: `${c.grade} (${c.score}%)`,
          percentage: c.score,
        })),
      ]
    : [];

  const decisionsList: DecisionItem[] = decisionsData
    ? decisionsData.active_details.map((d: DecisionDTO) => ({
        id: d.id,
        title: d.title,
        status: d.status === 'accepted' ? 'Accepted' : 'Proposed',
      }))
    : [];

  return (
    <div className="space-y-8 animate-fade-in">

      {/* ═══════ Metric Tiles ═══════ */}
      <section aria-label="Metric tiles">
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-4">
          <MetricTile
            icon={<IconUsers className="w-4 h-4" />}
            value={loading ? '\u2014' : `${onlineCount}`}
            label="Agenti Online"
            subtitle={loading ? undefined : `su ${totalCount} totali`}
            gold
            trend={onlineCount > (totalCount === 0 ? 1 : 0) ? 'up' : undefined}
            delay={0.08}
          />
          <MetricTile
            icon={<IconTasks className="w-4 h-4" />}
            value={loading ? '\u2014' : `${busyCount}`}
            label="Task in corso"
            delay={0.12}
          />
          <MetricTile
            icon={<IconStar className="w-4 h-4" />}
            value={loading ? '\u2014' : `${grade}`}
            label="Quality Score"
            subtitle={loading ? undefined : `${score}/100`}
            gold
            delay={0.16}
          />
          <MetricTile
            icon={<IconFile className="w-4 h-4" />}
            value={loading ? '\u2014' : `${activeAdrs}`}
            label="Decisioni Attive"
            delay={0.20}
          />
          <MetricTile
            icon={<IconClock className="w-4 h-4" />}
            value={healthData ? formatUptime(healthData.uptime) : (loading ? '\u2014' : '\u2014')}
            label="Uptime"
            subtitle={healthData ? 'da ' + new Date(healthData.startTime).toLocaleDateString() : undefined}
            gold
            delay={0.24}
          />
          <MetricTile
            icon={<IconCheck className="w-4 h-4" />}
            value={loading ? '\u2014' : latestTests}
            label="Tests Passati"
            subtitle={loading ? undefined : 'ultimo data point'}
            delay={0.28}
          />
        </div>
      </section>

      {/* ═══════ Section Header: Agenti ═══════ */}
      <SectionHeader
        icon={<IconActivity className="w-4 h-4" />}
        title={<span>Stato <span className="text-roman-gold font-bold">Agentes</span></span>}
        count={loading ? '\u2026' : `${totalCount} agenti`}
        delay={0.2}
      />

      {/* ═══════ Agents Mosaic Grid ═══════ */}
      <section aria-label="Agent status overview">
        <div
          className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4"
          role="list"
          aria-label="Elenco agenti"
        >
          {agentsList.map((agent, i) => (
            <AgentPanel
              key={agent.name}
              agent={agent}
              featured={agent.name === 'Iuppiter'}
              delay={0.15 + i * 0.05}
            />
          ))}
          {/* Skeleton placeholders during loading */}
          {loading && (
            Array.from({ length: 12 }).map((_, i) => (
              <div
                key={`skeleton-${i}`}
                className="bg-surface-raised rounded-lg border border-border-subtle p-4 animate-pulse"
                style={{ animationDelay: `${0.15 + i * 0.05}s` }}
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="space-y-2 flex-1">
                    <div className="h-4 bg-surface-panel rounded w-20" />
                    <div className="h-3 bg-surface-panel rounded w-28" />
                  </div>
                  <div className="w-2.5 h-2.5 rounded-full bg-surface-panel" />
                </div>
                <div className="space-y-1.5 mb-3">
                  <div className="h-3 bg-surface-panel rounded w-full" />
                  <div className="h-3 bg-surface-panel rounded w-3/4" />
                </div>
                <div className="h-px bg-surface-panel my-2" />
                <div className="flex justify-between">
                  <div className="h-2.5 bg-surface-panel rounded w-16" />
                  <div className="h-2.5 bg-surface-panel rounded w-10" />
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      {/* ═══════ Quality + Decisions ═══════ */}
      <section aria-label="Quality and decision metrics">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

          {/* ── Quality Metrics ── */}
          <div
            className="bg-surface-raised rounded-lg border border-border-subtle shadow-sm p-6 relative overflow-hidden animate-slide-up"
            style={{ animationDelay: '0.35s' }}
          >
            <div
              className="absolute top-0 right-0 w-24 h-24 bg-[radial-gradient(circle_at_top_right,rgba(212,165,74,0.03),transparent_70%)] pointer-events-none"
              aria-hidden="true"
            />
            <div className="flex items-center gap-2.5 mb-5 pb-4 border-b border-border-subtle">
              <div className="text-roman-gold">
                <IconBarChart className="w-4 h-4" />
              </div>
              <h3 className="font-roman text-[0.65rem] font-semibold tracking-[0.15em] uppercase text-text-muted">
                Quality Metrics
              </h3>
            </div>
            <div>
              {qualityItems.length > 0
                ? qualityItems.map((item, i) => (
                    <QualityBar key={item.label} item={item} delay={0.4 + i * 0.08} />
                  ))
                : loading && (
                    <div className="py-4 text-center text-text-dim text-sm">Loading quality data...</div>
                  )
              }
            </div>
          </div>

          {/* ── Decisioni Recenti ── */}
          <div
            className="bg-surface-raised rounded-lg border border-border-subtle shadow-sm p-6 relative overflow-hidden animate-slide-up"
            style={{ animationDelay: '0.45s' }}
          >
            <div
              className="absolute top-0 right-0 w-24 h-24 bg-[radial-gradient(circle_at_top_right,rgba(212,165,74,0.03),transparent_70%)] pointer-events-none"
              aria-hidden="true"
            />
            <div className="flex items-center gap-2.5 mb-5 pb-4 border-b border-border-subtle">
              <div className="text-roman-gold">
                <IconList className="w-4 h-4" />
              </div>
              <h3 className="font-roman text-[0.65rem] font-semibold tracking-[0.15em] uppercase text-text-muted">
                Decisioni Recenti
              </h3>
            </div>
            <div>
              {decisionsList.length > 0
                ? decisionsList.map((decision, i) => (
                    <DecisionChip key={decision.id} decision={decision} delay={0.5 + i * 0.06} />
                  ))
                : loading && (
                    <div className="py-4 text-center text-text-dim text-sm">Loading decisions...</div>
                  )
              }
            </div>
          </div>

        </div>
      </section>

    </div>
  );
}
