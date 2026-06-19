'use client';

import React, { useState, useEffect } from 'react';
import {
  Network,
  AlertCircle,
  Hash,
  CalendarDays,
  Layers,
  ArrowRightLeft,
} from 'lucide-react';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import { ErrorState, EmptyState, PageHeader } from '@/components/ui';
import type { GraphOverviewDTO } from '@/lib/types';

// ─── Color Maps ─────────────────────────────────────────────────────────────

const ENTITY_COLORS: Record<string, string> = {
  adr: '#d4a54a',
  knowledge: '#3b82f6',
  bug: '#ef4444',
  incident: '#f97316',
  metric: '#22c55e',
  secret: '#a855f7',
  session: '#14b8a6',
};

function getEntityColor(type: string): string {
  return ENTITY_COLORS[type.toLowerCase()] ?? '#787268';
}

function getEntityLabel(type: string): string {
  return type
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

const RELATION_LABELS: Record<string, string> = {
  depends_on: 'Depends On',
  supersedes: 'Supersedes',
  relates_to: 'Relates To',
  caused_bug: 'Caused Bug',
  fixes: 'Fixes',
  implements: 'Implements',
  references: 'References',
};

const RELATION_COLORS = [
  '#60a5fa',
  '#f472b6',
  '#34d399',
  '#fbbf24',
  '#a78bfa',
  '#fb923c',
  '#f87171',
];

function getRelationLabel(rel: string): string {
  return (
    RELATION_LABELS[rel] ??
    rel
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase())
  );
}

function getRelationColor(index: number): string {
  return RELATION_COLORS[index % RELATION_COLORS.length];
}

// ─── Loading State ──────────────────────────────────────────────────────────

function LoadingState() {
  return (
    <div
      className="flex flex-col items-center justify-center py-20 text-text-muted"
      role="status"
      aria-label="Caricamento dati grafo"
    >
      <LoadingSpinner size="lg" className="mb-4 text-roman-gold" />
      <p className="text-sm">Loading graph data…</p>
    </div>
  );
}

// ─── Summary Card ───────────────────────────────────────────────────────────

interface SummaryCardProps {
  icon: React.ElementType;
  label: string;
  value: string | number;
  delay: number;
}

function SummaryCard({ icon: Icon, label, value, delay }: SummaryCardProps) {
  return (
    <div
      className="bg-surface-raised border border-border-subtle rounded-lg p-5 flex items-center gap-4 animate-slide-up"
      style={{ animationDelay: `${delay}ms` }}
      role="region"
      aria-label={label}
    >
      <div
        className="shrink-0 w-10 h-10 rounded-lg flex items-center justify-center"
        style={{ backgroundColor: 'rgba(212,165,74,0.12)' }}
        aria-hidden="true"
      >
        <Icon className="w-5 h-5 text-roman-gold" />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-text-muted uppercase tracking-wider font-medium">
          {label}
        </p>
        <p className="text-2xl font-bold text-text-primary mt-0.5 tabular-nums">
          {value}
        </p>
      </div>
    </div>
  );
}

// ─── Bar Chart Card ─────────────────────────────────────────────────────────

interface BarItem {
  label: string;
  count: number;
  color: string;
}

function BarChartCard({
  title,
  items,
  delay,
}: {
  title: string;
  items: BarItem[];
  delay: number;
}) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setMounted(true), 50);
    return () => clearTimeout(timer);
  }, []);

  const maxCount = Math.max(...items.map((i) => i.count), 1);

  return (
    <div
      className="bg-surface-raised border border-border-subtle rounded-lg p-5 animate-slide-up"
      style={{ animationDelay: `${delay}ms` }}
      role="region"
      aria-label={title}
    >
      <h3 className="text-sm font-semibold text-text-primary mb-4">{title}</h3>
      {items.length === 0 ? (
        <p className="text-xs text-text-dim">No data available</p>
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <div key={item.label}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-text-secondary">
                  {item.label}
                </span>
                <span className="text-xs text-text-muted tabular-nums">
                  {item.count}
                </span>
              </div>
              <div className="h-2 rounded-full bg-surface-panel overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-700 ease-out"
                  style={{
                    width: mounted
                      ? `${(item.count / maxCount) * 100}%`
                      : '0%',
                    backgroundColor: item.color,
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Format Date ────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('it-IT', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ─── Page ───────────────────────────────────────────────────────────────────

export default function GraphPage() {
  const [graphData, setGraphData] = useState<GraphOverviewDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch('/api/graph')
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<GraphOverviewDTO>;
      })
      .then((data) => {
        if (!cancelled) setGraphData(data);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : 'Failed to load graph',
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // ── Derived data ──

  const entityTypes = graphData?.by_entity_type
    ? Object.entries(graphData.by_entity_type).filter(([, v]) => v > 0)
    : [];

  const relationTypes = graphData?.by_relation
    ? Object.entries(graphData.by_relation).filter(([, v]) => v > 0)
    : [];

  const entityTypeCount = entityTypes.length;
  const relationTypeCount = relationTypes.length;
  const totalEdges = graphData?.total_edges ?? 0;

  // ── Render ──

  if (error) return <ErrorState message={error} />;
  if (loading) return <LoadingState />;
  if (totalEdges === 0) return <EmptyState message="No graph data available" description="Aggiungi connessioni tra entità per visualizzare il grafo." />;

  return (
    <div className="space-y-6">
      {/* Header */}
      <PageHeader title="Graph" description="Knowledge Graph delle decisioni architetturali." icon={<Network className="w-6 h-6 text-roman-gold" aria-hidden="true" />} />

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <SummaryCard
          icon={Hash}
          label="Total Edges"
          value={totalEdges}
          delay={0}
        />
        <SummaryCard
          icon={CalendarDays}
          label="Last Updated"
          value={formatDate(graphData?.last_updated ?? '')}
          delay={100}
        />
        <SummaryCard
          icon={Layers}
          label="Entity Types"
          value={entityTypeCount}
          delay={200}
        />
        <SummaryCard
          icon={ArrowRightLeft}
          label="Active Relations"
          value={relationTypeCount}
          delay={300}
        />
      </div>

      {/* Distribution Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <BarChartCard
          title="Entity Type Distribution"
          items={entityTypes.map(([type, count]) => ({
            label: getEntityLabel(type),
            count,
            color: getEntityColor(type),
          }))}
          delay={400}
        />
        <BarChartCard
          title="Relation Distribution"
          items={relationTypes.map(([rel, count], i) => ({
            label: getRelationLabel(rel),
            count,
            color: getRelationColor(i),
          }))}
          delay={500}
        />
      </div>
    </div>
  );
}
