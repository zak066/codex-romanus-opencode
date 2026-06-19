import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import MetricsPage from '../metrics/page';

vi.mock('next/navigation', () => ({ usePathname: () => '/metrics' }));

// Mock recharts to avoid issues in jsdom
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  BarChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Bar: () => <div />,
  LineChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Line: () => <div />,
  PieChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Pie: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Cell: () => <div />,
  XAxis: () => <div />,
  YAxis: () => <div />,
  CartesianGrid: () => <div />,
  Tooltip: () => <div />,
}));

describe('Metrics Page', () => {
  it('renderizza titolo Metrics (async)', async () => {
    render(<MetricsPage />);
    expect(await screen.findByText('Metrics')).toBeInTheDocument();
  });

  it('mostra i tab Performance, Quality, System, Cache', async () => {
    render(<MetricsPage />);
    expect(await screen.findByText('Performance')).toBeInTheDocument();
    expect(await screen.findByText('Quality')).toBeInTheDocument();
    expect(await screen.findByText('System')).toBeInTheDocument();
    expect(await screen.findByText('Cache')).toBeInTheDocument();
  });

  it('mostra descrizione', async () => {
    render(<MetricsPage />);
    expect(await screen.findByText('Metriche di sistema, performance e qualità in tempo reale.')).toBeInTheDocument();
  });

  it('mostra loading state inizialmente', () => {
    render(<MetricsPage />);
    expect(screen.getByText('Loading metrics…')).toBeInTheDocument();
  });
});

describe('Metrics Page - Error State', () => {
  it('mostra errore quando la fetch fallisce', async () => {
    // Crea un fetch mock che fallisce
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

    render(<MetricsPage />);
    expect(await screen.findByText('Network error')).toBeInTheDocument();

    globalThis.fetch = originalFetch;
  });
});

describe('Metrics Page - con dati reali', () => {
  it('mostra Performance stat cards quando arrivano dati', async () => {
    const metricData = {
      perf: {
        data: [
          { metric_name: 'session_total_tokens', value: 1500000, recorded_at: '2026-06-19T08:00:00Z', tags: {} },
          { metric_name: 'cache_hit_rate', value: 85, recorded_at: '2026-06-19T08:00:00Z', tags: {} },
          { metric_name: 'session_api_calls', value: 42, recorded_at: '2026-06-19T08:00:00Z', tags: {} },
          { metric_name: 'session_total_cost', value: 0.0425, recorded_at: '2026-06-19T08:00:00Z', tags: {} },
        ],
      },
      quality: { data: [] },
      system: { agent_distribution: {} },
      cache: { data: [] },
      tabs: ['Performance', 'Quality', 'System', 'Cache'],
    };

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(metricData),
    } as unknown as Response);

    render(<MetricsPage />);
    // Attendiamo che i dati siano caricati
    await waitFor(() => {
      expect(screen.getByText('Total Tokens')).toBeInTheDocument();
    });
    expect(screen.getByText('1.5M')).toBeInTheDocument();
    expect(screen.getByText('Cache Hit Rate')).toBeInTheDocument();
    expect(screen.getByText('85%')).toBeInTheDocument();
    expect(screen.getByText('API Calls')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getByText('Total Cost')).toBeInTheDocument();
    expect(screen.getByText('$0.0425')).toBeInTheDocument();

    globalThis.fetch = originalFetch;
  });

  it('mostra agent distribution nel tab System', async () => {
    const metricData = {
      perf: { data: [] },
      quality: { data: [] },
      system: {
        agent_distribution: { idle: 5, busy: 3, error: 1, offline: 2 },
      },
      cache: { data: [] },
      tabs: ['Performance', 'Quality', 'System', 'Cache'],
    };

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(metricData),
    } as unknown as Response);

    render(<MetricsPage />);
    // Click sul tab System
    const systemTab = await screen.findByText('System');
    systemTab.click();

    await waitFor(() => {
      expect(screen.getByText('Agent Status Distribution')).toBeInTheDocument();
    });
    expect(screen.getByText('idle')).toBeInTheDocument();
    expect(screen.getByText('5 agents')).toBeInTheDocument();
    expect(screen.getByText('busy')).toBeInTheDocument();
    expect(screen.getByText('3 agents')).toBeInTheDocument();

    globalThis.fetch = originalFetch;
  });
});
