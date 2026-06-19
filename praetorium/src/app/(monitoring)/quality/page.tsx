'use client';

import {
  Target,
  AlertCircle,
  Gauge,
} from 'lucide-react';
import { usePraetorium } from '@/lib/praetorium-context';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import { ErrorState, EmptyState, PageHeader } from '@/components/ui';
import type { QualityScorecardDTO, QualityComponent } from '@/lib/types';

// ─── Grade colour mapping ─────────────────────────────────────────────────────

const GRADE_COLORS: Record<string, { text: string; bg: string; border: string }> = {
  A: { text: 'text-semantic-success', bg: 'bg-semantic-success-bg', border: 'border-semantic-success' },
  B: { text: 'text-emerald-400', bg: 'bg-emerald-950', border: 'border-emerald-500' },
  C: { text: 'text-semantic-warning', bg: 'bg-semantic-warning-bg', border: 'border-semantic-warning' },
  D: { text: 'text-orange-400', bg: 'bg-orange-950', border: 'border-orange-500' },
  E: { text: 'text-semantic-error', bg: 'bg-semantic-error-bg', border: 'border-semantic-error' },
  F: { text: 'text-red-600', bg: 'bg-red-950', border: 'border-red-700' },
};

function getGradeColour(grade: string) {
  return GRADE_COLORS[grade.toUpperCase()] ?? GRADE_COLORS.F;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function GradeGauge({ grade, score }: { grade: string; score: number }) {
  const colours = getGradeColour(grade);

  return (
    <div className="flex flex-col items-center gap-2">
      <div
        className={`w-32 h-32 rounded-full flex items-center justify-center border-4 ${colours.border} ${colours.bg}`}
      >
        <div className="text-center">
          <div className={`text-5xl font-bold ${colours.text}`}>{grade}</div>
          <div className="text-sm text-text-muted mt-0.5">{score.toFixed(0)}%</div>
        </div>
      </div>
    </div>
  );
}

function ComponentCard({ component }: { component: QualityComponent }) {
  const colours = getGradeColour(component.grade);
  const barWidth = Math.min(component.score, 100);

  return (
    <Card>
      <Card.Body className="space-y-3">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-text-primary capitalize">
            {component.name.replace(/_/g, ' ')}
          </h3>
          <Badge
            variant={component.grade === 'A' ? 'success' : component.grade === 'B' ? 'info' : component.grade === 'C' ? 'warning' : 'error'}
            size="sm"
          >
            {component.grade}
          </Badge>
        </div>

        {/* Weight */}
        <p className="text-xs text-text-muted">
          Weight: <span className="text-text-secondary font-mono">{(component.weight * 100).toFixed(0)}%</span>
        </p>

        {/* Progress bar */}
        <div className="w-full h-2 bg-surface-overlay rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${colours.text.replace('text-', 'bg-')}`}
            style={{ width: `${barWidth}%` }}
          />
        </div>

        {/* Score */}
        <p className={`text-sm font-mono font-semibold ${colours.text}`}>
          {component.score.toFixed(1)} / 100
        </p>
      </Card.Body>
    </Card>
  );
}

function MetricGridSkeleton() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {Array.from({ length: 6 }).map((_, i) => (
        <Card key={i}>
          <Card.Body className="space-y-3">
            <div className="h-4 w-24 bg-surface-overlay rounded animate-pulse" />
            <div className="h-2 w-full bg-surface-overlay rounded animate-pulse" />
            <div className="h-4 w-16 bg-surface-overlay rounded animate-pulse" />
          </Card.Body>
        </Card>
      ))}
    </div>
  );
}

// ─── Loading State ────────────────────────────────────────────────────────────

function LoadingState() {
  return (
    <div className="space-y-6">
      {/* Grade gauge skeleton */}
      <Card>
        <Card.Body className="flex flex-col items-center py-8">
          <div className="w-32 h-32 rounded-full bg-surface-overlay animate-pulse" />
          <div className="h-4 w-64 bg-surface-overlay rounded mt-4 animate-pulse" />
        </Card.Body>
      </Card>

      {/* Metric cards skeleton */}
      <MetricGridSkeleton />
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function QualityPage() {
  const { quality, qualityLoading, error } = usePraetorium();

  // ── Loading ──
  if (qualityLoading) return <LoadingState />;

  // ── Error ──
  if (error) return <ErrorState message={error} />;

  // ── Empty ──
  if (!quality || quality.components.length === 0) return <EmptyState message="Nessun dato qualità" description="Esegui un quality gate per vedere i risultati." />;

  const { grade, score, components, window_days, period, generatedAt } = quality;

  return (
    <div className="space-y-6">
      {/* Header */}
      <PageHeader title="Quality" description="Scorecard di qualità del codice." icon={<Target className="w-6 h-6 text-roman-gold" aria-hidden="true" />} />

      {/* Summary metadata */}
      <div className="flex flex-wrap items-center gap-4 text-xs text-text-muted">
        <span>Window: {window_days} days</span>
        {period.from && <span>From: {new Date(period.from).toLocaleDateString()}</span>}
        {period.to && <span>To: {new Date(period.to).toLocaleDateString()}</span>}
        {generatedAt && (
          <span className="flex items-center gap-1">
            <Gauge className="w-3.5 h-3.5" />
            Generated: {new Date(generatedAt).toLocaleString()}
          </span>
        )}
      </div>

      {/* Grade + Score */}
      <Card>
        <Card.Body className="flex flex-col items-center py-8">
          <GradeGauge grade={grade} score={score} />
          <p className="text-sm text-text-muted mt-4 text-center max-w-md">
            Il Quality Score riflette lo stato complessivo del progetto basato su
            lint, TypeScript, test, coverage e vulnerabilità.
          </p>
        </Card.Body>
      </Card>

      {/* Component Cards */}
      <h2 className="text-lg font-semibold text-text-primary">Components</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {components.map((comp) => (
          <ComponentCard key={comp.name} component={comp} />
        ))}
      </div>
    </div>
  );
}
