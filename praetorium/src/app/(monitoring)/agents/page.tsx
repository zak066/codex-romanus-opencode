'use client';

import { useState } from 'react';
import {
  Users,
  Cpu,
  Wrench,
  Brain,
  Palette,
  Crosshair,
  Shield,
  CheckCircle2,
  AlertCircle,
  Clock,
  Circle,
  Eye,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import { ErrorState, EmptyState, PageHeader } from '@/components/ui';
import { usePraetorium } from '@/lib/praetorium-context';

// ─── Types ────────────────────────────────────────────────────────────────────

interface AgentMock {
  name: string;
  status: 'idle' | 'busy' | 'error' | 'offline';
  model: string;
  lastSeen: string;
  task: string;
}

// ─── Mock data ────────────────────────────────────────────────────────────────

const agentsMock: AgentMock[] = [
  { name: 'iuppiter', status: 'idle', model: 'sonnet', lastSeen: '2 min ago', task: 'Idle' },
  { name: 'vulcanus', status: 'busy', model: 'gpt-4o', lastSeen: 'just now', task: 'Building API routes' },
  { name: 'minerva', status: 'idle', model: 'sonnet', lastSeen: '5 min ago', task: 'Reviewing ADR' },
  { name: 'ovidio', status: 'busy', model: 'gpt-4.1', lastSeen: '1 min ago', task: 'Creating UI components' },
  { name: 'diana', status: 'busy', model: 'gpt-4o', lastSeen: '30s ago', task: 'Running tests' },
  { name: 'janus', status: 'error', model: 'sonnet', lastSeen: '15 min ago', task: 'Security audit failed' },
];

// ─── Mapping helpers ──────────────────────────────────────────────────────────

const agentIconMap: Record<string, React.ElementType> = {
  iuppiter: Cpu,
  vulcanus: Wrench,
  minerva: Brain,
  ovidio: Palette,
  diana: Crosshair,
  janus: Shield,
};

function getStatusBadgeVariant(
  status: AgentMock['status'],
): 'success' | 'warning' | 'error' | 'default' {
  switch (status) {
    case 'idle':
      return 'success';
    case 'busy':
      return 'warning';
    case 'error':
      return 'error';
    case 'offline':
      return 'default';
  }
}

function getStatusIcon(status: AgentMock['status']) {
  const className = 'w-4 h-4';
  switch (status) {
    case 'idle':
      return <CheckCircle2 className={`${className} text-semantic-success`} />;
    case 'busy':
      return <Clock className={`${className} text-roman-gold`} />;
    case 'error':
      return <AlertCircle className={`${className} text-semantic-error`} />;
    case 'offline':
      return <Circle className={`${className} text-text-disabled`} />;
  }
}

// ─── Agent Card ───────────────────────────────────────────────────────────────

function AgentCard({
  agent,
  onViewDetails,
}: {
  agent: AgentMock;
  onViewDetails: () => void;
}) {
  const AgentIcon = agentIconMap[agent.name] ?? Users;

  return (
    <Card className="flex flex-col sm:flex-row items-start gap-4 p-5" role="article" aria-label={`Agent ${agent.name}`}>
      {/* Icon */}
      <div className="shrink-0 w-10 h-10 rounded-full bg-surface-overlay flex items-center justify-center" aria-hidden="true">
        <AgentIcon className="w-5 h-5 text-roman-gold" />
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0 space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="text-base font-semibold text-text-primary">{agent.name}</h3>
          <Badge
            variant={getStatusBadgeVariant(agent.status)}
            size="sm"
            icon={getStatusIcon(agent.status)}
          >
            {agent.status}
          </Badge>
          <span className="text-xs text-text-muted font-mono">{agent.model}</span>
        </div>

        <p className="text-sm text-text-muted">
          <span className="text-text-secondary font-medium">Task:</span> {agent.task}
        </p>

        <p className="text-xs text-text-disabled">
          Last seen: {agent.lastSeen}
        </p>
      </div>

      {/* Action */}
      <div className="shrink-0 self-start sm:self-center">
        <Button
          variant="secondary"
          size="sm"
          icon={<Eye className="w-4 h-4" />}
          onClick={onViewDetails}
          aria-label={`View details for ${agent.name}`}
        >
          View Details
        </Button>
      </div>
    </Card>
  );
}

// ─── Agent Detail Modal ───────────────────────────────────────────────────────

function AgentDetailModal({
  agent,
  isOpen,
  onClose,
}: {
  agent: AgentMock | null;
  isOpen: boolean;
  onClose: () => void;
}) {
  if (!agent) return null;

  const AgentIcon = agentIconMap[agent.name] ?? Users;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`Agent: ${agent.name}`}>
      <div className="space-y-5">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-full bg-surface-overlay flex items-center justify-center" aria-hidden="true">
            <AgentIcon className="w-6 h-6 text-roman-gold" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-text-primary">{agent.name}</h3>
            <Badge
              variant={getStatusBadgeVariant(agent.status)}
              size="sm"
              icon={getStatusIcon(agent.status)}
            >
              {agent.status}
            </Badge>
          </div>
        </div>

        {/* Details */}
        <div className="space-y-3 divide-y divide-border-subtle">
          <DetailRow label="Status" value={agent.status} />
          <DetailRow label="Model" value={agent.model} />
          <DetailRow label="Current Task" value={agent.task} />
          <DetailRow label="Last Heartbeat" value={agent.lastSeen} />
        </div>
      </div>
    </Modal>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-2 text-sm">
      <span className="text-text-muted">{label}</span>
      <span className="text-text-primary font-medium">{value}</span>
    </div>
  );
}

// ─── Loading State ────────────────────────────────────────────────────────────

function LoadingState() {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-text-muted">
      <LoadingSpinner size="lg" className="mb-4 text-roman-gold" />
      <p className="text-sm">Loading agents…</p>
    </div>
  );
}

// ─── Page Component ───────────────────────────────────────────────────────────

export default function AgentsPage() {
  const { agents, agentsLoading, error } = usePraetorium();
  const [selectedAgent, setSelectedAgent] = useState<AgentMock | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  // Fallback to mock data when API is not available
  const displayAgents = agents.length > 0
    ? agents
        .filter((a) => !a.agent_name.startsWith('$'))
        .map((a) => ({
        name: a.agent_name,
        status: a.status,
        model: a.model ?? 'unknown',
        lastSeen: a.last_seen,
        task: a.current_task ?? 'Idle',
      }))
    : agentsMock;

  const handleViewDetails = (agent: AgentMock) => {
    setSelectedAgent(agent);
    setModalOpen(true);
  };

  const handleCloseModal = () => {
    setModalOpen(false);
    setSelectedAgent(null);
  };

  if (error) return <ErrorState message={error} />;
  if (agentsLoading) return <LoadingState />;
  if (displayAgents.length === 0) return <EmptyState />;

  return (
    <div className="space-y-6">
      {/* Title */}
      <PageHeader title="Agents" description="Stato in tempo reale degli agenti Codex Romanus." icon={<Users className="w-6 h-6 text-roman-gold" aria-hidden="true" />} />

      {/* Agent cards grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {displayAgents.map((agent) => (
          <AgentCard
            key={agent.name}
            agent={agent}
            onViewDetails={() => handleViewDetails(agent)}
          />
        ))}
      </div>

      {/* Detail Modal */}
      <AgentDetailModal
        agent={selectedAgent}
        isOpen={modalOpen}
        onClose={handleCloseModal}
      />
    </div>
  );
}
