'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  FileText,
  Search,
  AlertCircle,
  Eye,
  Calendar,
  Clock,
  FileCode,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import { ErrorState, EmptyState, PageHeader } from '@/components/ui';
import type { DecisionDTO, DecisionsResponse, DecisionDetailDTO } from '@/lib/types';

// ─── Status config ────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { variant: 'success' | 'info' | 'warning' | 'error'; label: string }> = {
  accepted: { variant: 'success', label: 'Accepted' },
  proposed: { variant: 'info', label: 'Proposed' },
  deprecated: { variant: 'error', label: 'Deprecated' },
  superseded: { variant: 'warning', label: 'Superseded' },
};

const STATUS_OPTIONS = [
  { value: '', label: 'All Statuses' },
  { value: 'proposed', label: 'Proposed' },
  { value: 'accepted', label: 'Accepted' },
  { value: 'deprecated', label: 'Deprecated' },
  { value: 'superseded', label: 'Superseded' },
];

// ─── Loading State ────────────────────────────────────────────────────────────

function LoadingState() {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-text-muted">
      <LoadingSpinner size="lg" className="mb-4 text-roman-gold" />
      <p className="text-sm">Loading decisions…</p>
    </div>
  );
}

// ─── Detail Row ───────────────────────────────────────────────────────────────

function DetailRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-start gap-3 py-2">
      <div className="shrink-0 mt-0.5 text-text-muted">{icon}</div>
      <div className="flex-1 min-w-0">
        <p className="text-xs text-text-muted">{label}</p>
        <p className="text-sm text-text-primary font-mono break-all">{value}</p>
      </div>
    </div>
  );
}

// ─── ADR Detail Modal ─────────────────────────────────────────────────────────

function AdrDetailModal({
  adrId,
  isOpen,
  onClose,
}: {
  adrId: string | null;
  isOpen: boolean;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<DecisionDetailDTO | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || !adrId) return;

    setLoading(true);
    setError(null);
    setDetail(null);

    fetch(`/api/decisions?id=${adrId}`)
      .then((r) => r.json())
      .then((data) => {
        setDetail(data as DecisionDetailDTO);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Failed to load detail');
      })
      .finally(() => {
        setLoading(false);
      });
  }, [adrId, isOpen]);

  const statusConfig = detail ? STATUS_CONFIG[detail.status] ?? STATUS_CONFIG.accepted : null;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={adrId ?? 'ADR Detail'}>
      {loading && (
        <div className="flex justify-center py-8">
          <LoadingSpinner size="md" />
        </div>
      )}

      {error && (
        <div className="flex flex-col items-center gap-3 py-8">
          <AlertCircle className="w-8 h-8 text-semantic-error" />
          <p className="text-sm text-semantic-error">{error}</p>
        </div>
      )}

      {detail && statusConfig && (
        <div className="space-y-5">
          {/* Status badge */}
          <div className="flex items-center gap-3">
            <Badge variant={statusConfig.variant}>{statusConfig.label}</Badge>
          </div>

          {/* Title */}
          <h2 className="text-lg font-semibold text-text-primary">{detail.title}</h2>

          {/* Metadata */}
          <div className="space-y-1 divide-y divide-border-subtle">
            <DetailRow
              icon={<Calendar className="w-4 h-4" />}
              label="Created"
              value={detail.created_at ? new Date(detail.created_at).toLocaleString() : 'N/A'}
            />
            <DetailRow
              icon={<Clock className="w-4 h-4" />}
              label="Updated"
              value={detail.updated_at ? new Date(detail.updated_at).toLocaleString() : 'N/A'}
            />
            <DetailRow
              icon={<FileCode className="w-4 h-4" />}
              label="File Path"
              value={detail.file_path ?? 'N/A'}
            />
          </div>

          {/* Content */}
          {detail.content_markdown && (
            <div>
              <p className="text-xs text-text-muted mb-2 uppercase tracking-wider font-medium">
                Content
              </p>
              <pre className="text-xs text-text-secondary bg-surface-overlay rounded-lg p-4 overflow-x-auto max-h-80 whitespace-pre-wrap font-mono border border-border-subtle">
                {detail.content_markdown}
              </pre>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function DecisionsPage() {
  const [decisions, setDecisions] = useState<DecisionDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [selectedAdrId, setSelectedAdrId] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  const totalAdrs = decisions.length;
  const activeAdrs = decisions.filter((d) => d.status === 'accepted' || d.status === 'proposed').length;

  // Fetch decisions
  const fetchDecisions = useCallback(async () => {
    try {
      setLoading(true);
      setFetchError(null);
      const res = await fetch('/api/decisions');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as DecisionsResponse;
      setDecisions(data.active_details ?? []);
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : 'Failed to load decisions');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDecisions();
  }, [fetchDecisions]);

  // Filter
  const filtered = useMemo(
    () =>
      decisions.filter((d) => {
        const matchesSearch =
          d.id.toLowerCase().includes(search.toLowerCase()) ||
          d.title.toLowerCase().includes(search.toLowerCase());
        const matchesStatus = !statusFilter || d.status === statusFilter;
        return matchesSearch && matchesStatus;
      }),
    [decisions, search, statusFilter],
  );

  const handleViewDetail = (id: string) => {
    setSelectedAdrId(id);
    setModalOpen(true);
  };

  const handleCloseModal = () => {
    setModalOpen(false);
    setSelectedAdrId(null);
  };

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Header */}
      <PageHeader title="Decisions" description="Architecture Decision Records del Codex Romanus." icon={<FileText className="w-6 h-6 text-roman-gold" aria-hidden="true" />} />

      {/* Summary */}
      <p className="text-sm text-text-muted">
        <span className="text-text-primary font-semibold">{activeAdrs} active</span>
        {' · '}
        <span>{totalAdrs} total</span>
      </p>

      {/* Search + Filter */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1 max-w-md">
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted"
            aria-hidden="true"
          />
          <input
            type="text"
            placeholder="Search by ID or title…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-surface-overlay border border-border-default rounded-lg text-text-primary placeholder-text-muted focus:outline-none focus:border-border-focus transition-colors"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2 bg-surface-overlay border border-border-default rounded-lg text-text-primary text-sm focus:outline-none focus:border-border-focus transition-colors"
          aria-label="Filter by status"
        >
          {STATUS_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {/* Content */}
      {loading && <LoadingState />}

      {fetchError && !loading && <ErrorState message={fetchError} onRetry={fetchDecisions} />}

      {!loading && !fetchError && filtered.length === 0 && (
        <EmptyState
          message={search ? `Nessuna decisione trovata per "${search}"` : 'Nessuna decisione registrata'}
        />
      )}

      {!loading && !fetchError && filtered.length > 0 && (
        <div className="space-y-3">
          {filtered.map((decision) => {
            const config = STATUS_CONFIG[decision.status] ?? STATUS_CONFIG.accepted;
            return (
              <div
                key={decision.id}
                onClick={() => handleViewDetail(decision.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handleViewDetail(decision.id);
                  }
                }}
                role="button"
                tabIndex={0}
                className="text-left w-full cursor-pointer focus:outline-none focus:ring-2 focus:ring-roman-gold/50 rounded-lg"
              >
                <Card className="hover:border-border-focus transition-colors cursor-pointer">
                  <Card.Body>
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-3 mb-1">
                          <span className="text-sm font-mono text-roman-gold font-bold">
                            {decision.id}
                          </span>
                          <Badge variant={config.variant} size="sm">
                            {config.label}
                          </Badge>
                        </div>
                        <h3 className="text-text-primary font-medium truncate">
                          {decision.title}
                        </h3>
                      </div>
                      <div className="shrink-0">
                        <Button
                          variant="ghost"
                          size="sm"
                          icon={<Eye className="w-4 h-4" />}
                          aria-label={`View details for ${decision.id}`}
                        >
                          View
                        </Button>
                      </div>
                    </div>
                  </Card.Body>
                </Card>
              </div>
            );
          })}
        </div>
      )}

      {/* Detail Modal */}
      <AdrDetailModal
        adrId={selectedAdrId}
        isOpen={modalOpen}
        onClose={handleCloseModal}
      />
    </div>
  );
}
