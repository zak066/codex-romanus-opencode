'use client';

import { useState, useEffect, useMemo } from 'react';
import {
  LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell,
} from 'recharts';
import { Tabs } from '@/components/ui/tabs';
import { Card } from '@/components/ui/card';
import { LoadingSpinner } from '@/components/ui/loading-spinner';

import { ErrorState, PageHeader } from '@/components/ui';
import { FileText, Zap, Activity, DollarSign, Database, Trash2 } from 'lucide-react';
import type { MetricsDTO, MetricPointDTO } from '@/lib/types';

const chartTooltipStyle = {
  contentStyle: {
    backgroundColor: '#1f2937',
    border: '1px solid #374151',
    borderRadius: '8px',
    color: '#f3f4f6',
    fontSize: '13px',
  },
};

// ─── Transform helpers ────────────────────────────────────────────────────────

function extractMetric(data: MetricPointDTO[], name: string): number | null {
  const point = data.find((p) => p.metric_name === name);
  return point ? point.value : null;
}

function formatTokenValue(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toLocaleString();
}

interface QualityChartRow {
  day: string;
  test_passed_total: number;
  quality_gate_score: number;
  tsc_errors: number;
}

function transformQualityData(data: MetricPointDTO[]): QualityChartRow[] {
  const grouped: Record<string, QualityChartRow> = {};
  for (const point of data) {
    const day = point.recorded_at
      ? new Date(point.recorded_at).toLocaleDateString([], {
          weekday: 'short',
        })
      : 'N/A';
    if (!grouped[day])
      grouped[day] = { day, test_passed_total: 0, quality_gate_score: 0, tsc_errors: 0 };
    if (point.metric_name === 'test_passed_total')
      grouped[day].test_passed_total = point.value;
    if (point.metric_name === 'quality_gate_score')
      grouped[day].quality_gate_score = point.value;
    if (point.metric_name === 'tsc_errors')
      grouped[day].tsc_errors = point.value;
  }
  return Object.values(grouped);
}

interface AgentDistItem {
  name: string;
  value: number;
  color: string;
}

const STATUS_COLORS: Record<string, string> = {
  idle: '#22c55e',
  busy: '#f59e0b',
  error: '#ef4444',
  offline: '#6b7280',
};

function transformAgentDistribution(
  dist: Record<string, number>,
): AgentDistItem[] {
  return Object.entries(dist).map(([name, value]) => ({
    name,
    value,
    color: STATUS_COLORS[name] ?? '#6b7280',
  }));
}

// ─── Loading State ────────────────────────────────────────────────────────────

function LoadingState() {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-text-muted">
      <LoadingSpinner size="lg" className="mb-4 text-roman-gold" />
      <p className="text-sm">Loading metrics…</p>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function MetricsPage() {
  const [metricsData, setMetricsData] = useState<MetricsDTO | null>(null);
  const [loading, setLoading] = useState(true);
  // Cache data
  const cacheMetrics = useMemo(
    () => metricsData?.cache?.data ?? [],
    [metricsData],
  );

  // Group cache metrics by instance name (from tags)
  const cacheInstances = useMemo(() => {
    const data = cacheMetrics;
    if (data.length === 0) return [];

    const instanceMap = new Map<string, { hits: number; misses: number; size: number }>();
    for (const point of data) {
      const name = point.tags?.cache_name || 'default';
      if (!instanceMap.has(name)) {
        instanceMap.set(name, { hits: 0, misses: 0, size: 0 });
      }
      const entry = instanceMap.get(name)!;
      if (point.metric_name === 'cache_hits_total') entry.hits = point.value;
      else if (point.metric_name === 'cache_misses_total') entry.misses = point.value;
      else if (point.metric_name === 'cache_size') entry.size = point.value;
    }
    return Array.from(instanceMap.entries()).map(([name, stats]) => ({
      name,
      ...stats,
      total: stats.hits + stats.misses,
      hitRate: stats.hits + stats.misses > 0
        ? Math.round((stats.hits / (stats.hits + stats.misses)) * 100)
        : 0,
    }));
  }, [cacheMetrics]);

  // Hit rate trend for line chart
  const cacheHitRateTrend = useMemo(() => {
    return cacheMetrics
      .filter((p) => p.metric_name === 'cache_hit_rate')
      .map((p) => ({
        time: p.recorded_at
          ? new Date(p.recorded_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          : '',
        rate: p.value,
      }));
  }, [cacheMetrics]);

  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('performance');

  // Fetch metrics on mount
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch('/api/metrics')
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<MetricsDTO>;
      })
      .then((data) => {
        if (!cancelled) setMetricsData(data);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load metrics');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, []);

  // Transform data for charts
  const perfMetrics = useMemo(
    () => metricsData?.perf?.data ?? [],
    [metricsData],
  );
  const subagentTokens = useMemo(
    () => (metricsData?.perf?.data ?? []).filter(
      (p) => p.metric_name === 'subagent_tokens' && p.tags?.subagent && p.tags.subagent !== 'all_subagents',
    ),
    [metricsData],
  );
  const qualityTrend = useMemo(
    () => transformQualityData(metricsData?.quality?.data ?? []),
    [metricsData],
  );
  const agentDistribution = useMemo(
    () =>
      transformAgentDistribution(
        metricsData?.system?.agent_distribution ?? {},
      ),
    [metricsData],
  );

  const customTabs = [
    {
      id: 'performance',
      label: 'Performance',
      content: (
        <div className="space-y-4">
          <h3 className="text-text-primary font-semibold">Performance Metrics (24h)</h3>
          {perfMetrics.length === 0 ? (
            <p className="text-sm text-text-disabled text-center py-12">
              No performance data available yet.
            </p>
          ) : (
            <div className="space-y-6">
              {/* Stat Cards */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {(() => {
                  const v = extractMetric(perfMetrics, 'session_total_tokens');
                  return (
                    <div className="bg-surface-raised border border-border-subtle p-4 rounded-lg">
                      <div className="flex items-center gap-2 text-text-muted text-sm mb-1">
                        <FileText size={18} />
                        <span>Total Tokens</span>
                      </div>
                      <p className="text-2xl font-semibold text-text-primary font-mono">
                        {v !== null ? formatTokenValue(v) : '—'}
                      </p>
                    </div>
                  );
                })()}
                {(() => {
                  const v = extractMetric(perfMetrics, 'cache_hit_rate');
                  return (
                    <div className="bg-surface-raised border border-border-subtle p-4 rounded-lg">
                      <div className="flex items-center gap-2 text-text-muted text-sm mb-1">
                        <Zap size={18} />
                        <span>Cache Hit Rate</span>
                      </div>
                      <p className="text-2xl font-semibold text-text-primary font-mono">
                        {v !== null ? `${v}%` : '—'}
                      </p>
                    </div>
                  );
                })()}
                {(() => {
                  const v = extractMetric(perfMetrics, 'session_api_calls');
                  return (
                    <div className="bg-surface-raised border border-border-subtle p-4 rounded-lg">
                      <div className="flex items-center gap-2 text-text-muted text-sm mb-1">
                        <Activity size={18} />
                        <span>API Calls</span>
                      </div>
                      <p className="text-2xl font-semibold text-text-primary font-mono">
                        {v !== null ? v.toLocaleString() : '—'}
                      </p>
                    </div>
                  );
                })()}
                {(() => {
                  const v = extractMetric(perfMetrics, 'session_total_cost');
                  return (
                    <div className="bg-surface-raised border border-border-subtle p-4 rounded-lg">
                      <div className="flex items-center gap-2 text-text-muted text-sm mb-1">
                        <DollarSign size={18} />
                        <span>Total Cost</span>
                      </div>
                      <p className="text-2xl font-semibold text-text-primary font-mono">
                        {v !== null ? `$${v.toFixed(4)}` : '—'}
                      </p>
                    </div>
                  );
                })()}
              </div>

              {/* Subagent Token Breakdown */}
              {subagentTokens.length > 0 && (
                <div className="bg-surface-raised rounded-lg p-4 border border-border-subtle">
                  <h4 className="text-text-primary font-medium mb-3">Subagent Token Breakdown</h4>
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart
                      data={subagentTokens.map((p) => ({
                        name: p.tags!.subagent!,
                        value: p.value,
                      }))}
                      layout="vertical"
                      margin={{ left: 20, right: 20, top: 5, bottom: 5 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#374151" horizontal={false} />
                      <XAxis type="number" stroke="#6b7280" tick={{ fill: '#6b7280', fontSize: 12 }} />
                      <YAxis
                        type="category"
                        dataKey="name"
                        stroke="#6b7280"
                        tick={{ fill: '#6b7280', fontSize: 12 }}
                        width={140}
                      />
                      <Tooltip {...chartTooltipStyle} />
                      <Bar dataKey="value" fill="#C9A84C" radius={[0, 4, 4, 0]} name="Tokens" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          )}
        </div>
      ),
    },
    {
      id: 'quality',
      label: 'Quality',
      content: (
        <div className="space-y-4">
          <h3 className="text-text-primary font-semibold">Tests, Quality Gate & TSC Errors</h3>
          <div className="bg-surface-raised rounded-lg p-4 border border-border-subtle">
            {qualityTrend.length === 0 ? (
              <p className="text-sm text-text-disabled text-center py-12">
                No quality data available yet.
              </p>
            ) : (
<div className="h-[200px] sm:h-[300px]"><ResponsiveContainer width="100%" height={300}>
                <BarChart data={qualityTrend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                  <XAxis dataKey="day" stroke="#6b7280" tick={{ fill: '#6b7280', fontSize: 12 }} />
                  <YAxis stroke="#6b7280" tick={{ fill: '#6b7280', fontSize: 12 }} />
                  <Tooltip {...chartTooltipStyle} />
                  <Bar dataKey="test_passed_total" fill="#22c55e" radius={[4, 4, 0, 0]} name="Tests Passed" />
                  <Bar dataKey="quality_gate_score" fill="#C9A84C" radius={[4, 4, 0, 0]} name="Quality Gate Score" />
                  <Bar dataKey="tsc_errors" fill="#ef4444" radius={[4, 4, 0, 0]} name="TSC Errors" />
                </BarChart>
              </ResponsiveContainer>
            </div>
            )}
          </div>
        </div>
      ),
    },
    {
      id: 'system',
      label: 'System',
      content: (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-surface-raised rounded-lg p-4 border border-border-subtle">
            <h3 className="text-text-primary font-semibold mb-4">Agent Status Distribution</h3>
            {agentDistribution.length === 0 ? (
              <p className="text-sm text-text-disabled text-center py-12">
                No agent data available yet.
              </p>
            ) : (
              <>
                <ResponsiveContainer width="100%" height={250}>
                  <PieChart>
                    <Pie
                      data={agentDistribution}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={100}
                      paddingAngle={4}
                      dataKey="value"
                    >
                      {agentDistribution.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip {...chartTooltipStyle} />
                  </PieChart>
                </ResponsiveContainer>
              </>
            )}
          </div>
          <div className="space-y-3">
            <h3 className="text-text-primary font-semibold">Legend</h3>
            {agentDistribution.length === 0 ? (
              <p className="text-sm text-text-disabled">No agents registered.</p>
            ) : (
              agentDistribution.map((item) => (
                <div
                  key={item.name}
                  className="flex items-center gap-3 p-3 bg-surface-raised rounded-lg border border-border-subtle"
                >
                  <div
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: item.color }}
                  />
                  <span className="text-text-primary flex-1 capitalize">{item.name}</span>
                  <span className="text-text-secondary font-mono">{item.value} agents</span>
                </div>
              ))
            )}
          </div>
        </div>
      ),
    },
    {
      id: 'cache',
      label: 'Cache',
      content: (
        <div className="space-y-4">
          <h3 className="text-text-primary font-semibold">Cache Metrics</h3>
          {cacheMetrics.length === 0 ? (
            <p className="text-sm text-text-disabled text-center py-12">
              No cache data available yet. Start sending cache metrics to see them here.
            </p>
          ) : (
            <div className="space-y-6">
              {/* Stat Cards */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {(() => {
                  const v = extractMetric(cacheMetrics, 'cache_hits_total');
                  return (
                    <div className="bg-surface-raised border border-border-subtle p-4 rounded-lg">
                      <div className="flex items-center gap-2 text-text-muted text-sm mb-1">
                        <Database size={18} />
                        <span>Cache Hits</span>
                      </div>
                      <p className="text-2xl font-semibold text-text-primary font-mono">
                        {v !== null ? v.toLocaleString() : '—'}
                      </p>
                    </div>
                  );
                })()}
                {(() => {
                  const v = extractMetric(cacheMetrics, 'cache_misses_total');
                  return (
                    <div className="bg-surface-raised border border-border-subtle p-4 rounded-lg">
                      <div className="flex items-center gap-2 text-text-muted text-sm mb-1">
                        <Database size={18} />
                        <span>Cache Misses</span>
                      </div>
                      <p className="text-2xl font-semibold text-text-primary font-mono">
                        {v !== null ? v.toLocaleString() : '—'}
                      </p>
                    </div>
                  );
                })()}
                {(() => {
                  const v = extractMetric(cacheMetrics, 'cache_hit_rate');
                  return (
                    <div className="bg-surface-raised border border-border-subtle p-4 rounded-lg">
                      <div className="flex items-center gap-2 text-text-muted text-sm mb-1">
                        <Zap size={18} />
                        <span>Hit Rate</span>
                      </div>
                      <p className="text-2xl font-semibold text-text-primary font-mono">
                        {v !== null ? `${v}%` : '—'}
                      </p>
                    </div>
                  );
                })()}
                {(() => {
                  const v = extractMetric(cacheMetrics, 'cache_eviction_count');
                  return (
                    <div className="bg-surface-raised border border-border-subtle p-4 rounded-lg">
                      <div className="flex items-center gap-2 text-text-muted text-sm mb-1">
                        <Trash2 size={18} />
                        <span>Evictions</span>
                      </div>
                      <p className="text-2xl font-semibold text-text-primary font-mono">
                        {v !== null ? v.toLocaleString() : '—'}
                      </p>
                    </div>
                  );
                })()}
              </div>

              {/* Cache Instances Breakdown */}
              {cacheInstances.length > 0 && (
                <div className="bg-surface-raised rounded-lg p-4 border border-border-subtle">
                  <h4 className="text-text-primary font-medium mb-3">Cache Instances</h4>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-text-muted border-b border-border-subtle">
                          <th className="text-left py-2 pr-4 font-medium">Instance</th>
                          <th className="text-right py-2 px-4 font-medium">Entries</th>
                          <th className="text-right py-2 px-4 font-medium">Hits</th>
                          <th className="text-right py-2 px-4 font-medium">Misses</th>
                          <th className="text-right py-2 pl-4 font-medium">Hit Rate</th>
                        </tr>
                      </thead>
                      <tbody>
                        {cacheInstances.map((inst) => (
                          <tr key={inst.name} className="border-b border-border-subtle/50 last:border-0">
                            <td className="py-2 pr-4 font-mono text-text-primary">{inst.name}</td>
                            <td className="py-2 px-4 text-right font-mono text-text-secondary">{inst.size.toLocaleString()}</td>
                            <td className="py-2 px-4 text-right font-mono text-green-400">{inst.hits.toLocaleString()}</td>
                            <td className="py-2 px-4 text-right font-mono text-red-400">{inst.misses.toLocaleString()}</td>
                            <td className="py-2 pl-4 text-right font-mono text-roman-gold">{inst.hitRate}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Hit Rate Trend */}
              {cacheHitRateTrend.length >= 2 && (
                <div className="bg-surface-raised rounded-lg p-4 border border-border-subtle">
                  <h4 className="text-text-primary font-medium mb-3">Cache Hit Rate Over Time</h4>
                  <ResponsiveContainer width="100%" height={200}>
                    <LineChart data={cacheHitRateTrend}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                      <XAxis dataKey="time" stroke="#6b7280" tick={{ fill: '#6b7280', fontSize: 12 }} />
                      <YAxis stroke="#6b7280" tick={{ fill: '#6b7280', fontSize: 12 }} domain={[0, 100]} />
                      <Tooltip {...chartTooltipStyle} />
                      <Line type="monotone" dataKey="rate" stroke="#C9A84C" strokeWidth={2} dot={{ fill: '#C9A84C', r: 3 }} name="Hit Rate %" />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          )}
        </div>
      ),
    },

  ];

  if (error) return <ErrorState message={error} />;
  if (loading) return <LoadingState />;

  return (
    <div className="space-y-6">
      <PageHeader title="Metrics" description="Metriche di sistema, performance e qualità in tempo reale." />

      <Card>
        <Card.Body>
          <Tabs
            tabs={customTabs}
            defaultTab="performance"
            onChange={(id) => setActiveTab(id)}
          />
        </Card.Body>
      </Card>
    </div>
  );
}
