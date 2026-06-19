import { NextResponse } from 'next/server';
import type { MetricsDTO, MetricPointDTO } from '@/lib/types';

const TABULARIUM_URL =
  process.env.NEXT_PUBLIC_TABULARIUM_URL || 'http://localhost:3100';

async function fetchResource<T>(uri: string): Promise<T> {
  const encoded = encodeURIComponent(uri);
  const res = await fetch(`${TABULARIUM_URL}/api/resources/${encoded}`);
  if (!res.ok) throw new Error(`Tabularium returned ${res.status}`);
  const raw = await res.json();
  const text: string = raw?.contents?.[0]?.text || '[]';
  return JSON.parse(text) as T;
}

export async function GET() {
  try {
    const [perf, quality, agentsRaw, cache] = await Promise.allSettled([
      fetchResource<{ domain: string; data: MetricPointDTO[] }>(
        'tabularium://metrics/perf',
      ),
      fetchResource<{ domain: string; data: MetricPointDTO[] }>(
        'tabularium://metrics/quality',
      ),
      fetchResource<{ agents: { agent_name: string; status: string }[] }>(
        'tabularium://agents/status',
      ),
      fetchResource<{ domain: string; data: MetricPointDTO[] }>(
        'tabularium://metrics/cache',
      ),
    ]);

    const perfData =
      perf.status === 'fulfilled'
        ? perf.value
        : { domain: 'perf', data: [] as MetricPointDTO[] };
    const qualityData =
      quality.status === 'fulfilled'
        ? quality.value
        : { domain: 'quality', data: [] as MetricPointDTO[] };

    // Build agent distribution from agents list
    const agents =
      agentsRaw.status === 'fulfilled' ? agentsRaw.value.agents ?? [] : [];
    const cacheData =
      cache.status === 'fulfilled'
        ? cache.value
        : { domain: 'cache', data: [] as MetricPointDTO[] };
    const agentDistribution: Record<string, number> = {};
    for (const agent of agents) {
      const status = agent.status || 'offline';
      agentDistribution[status] = (agentDistribution[status] || 0) + 1;
    }

    const response: MetricsDTO = {
      perf: perfData,
      quality: qualityData,
      cache: cacheData,
      system: { agent_distribution: agentDistribution },
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('/api/metrics error:', error);
    const fallback: MetricsDTO = {
      perf: { domain: 'perf', data: [] },
      quality: { domain: 'quality', data: [] },
      cache: { domain: 'cache', data: [] },
      system: { agent_distribution: {} },
    };
    return NextResponse.json(fallback);
  }
}
