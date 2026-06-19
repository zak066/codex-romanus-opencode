import { render, screen } from '@testing-library/react';
import AgentsPage from '../agents/page';

vi.mock('next/navigation', () => ({ usePathname: () => '/agents' }));

vi.mock('@/lib/praetorium-context', () => ({
  usePraetorium: () => ({
    agents: [
      { agent_name: 'iuppiter-orchestrator', status: 'idle', current_task: 'Orchestrating', last_seen: new Date(Date.now() - 120000).toISOString(), is_online: true, seconds_since_heartbeat: 120 },
      { agent_name: 'vulcanus-senior-dev', status: 'busy', current_task: 'Building API', last_seen: new Date().toISOString(), is_online: true, seconds_since_heartbeat: 5 },
      { agent_name: 'minerva-architect', status: 'idle', current_task: 'Reviewing ADR', last_seen: new Date(Date.now() - 300000).toISOString(), is_online: true, seconds_since_heartbeat: 300 },
    ],
    agentsLoading: false,
    error: null,
    quality: null,
    qualityLoading: false,
    modelConfig: null,
    modelConfigLoading: false,
    lastRefresh: new Date(),
    refresh: vi.fn(),
    setModelConfig: vi.fn(),
    clearError: vi.fn(),
  }),
  PraetoriumProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

describe('Agents Page', () => {
  it('renderizza titolo Agents', () => {
    render(<AgentsPage />);
    expect(screen.getByText('Agents')).toBeInTheDocument();
  });

  it('mostra lista agenti mock', () => {
    render(<AgentsPage />);
    // agent names appear in both desktop (hidden sm:inline) and mobile (sm:hidden) spans
    const iuppiterElements = screen.getAllByText('iuppiter-orchestrator');
    expect(iuppiterElements.length).toBeGreaterThanOrEqual(1);
    const vulcanusElements = screen.getAllByText('vulcanus-senior-dev');
    expect(vulcanusElements.length).toBeGreaterThanOrEqual(1);
  });

  it('mostra badge status agent', () => {
    render(<AgentsPage />);
    const iuppiterElements = screen.getAllByText('iuppiter-orchestrator');
    expect(iuppiterElements.length).toBeGreaterThanOrEqual(1);
        expect(screen.getAllByText('idle').length).toBeGreaterThanOrEqual(1);
  });
});
