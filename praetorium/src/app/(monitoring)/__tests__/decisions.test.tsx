import { beforeEach, describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import DecisionsPage from '../decisions/page';

const mockDecisionsResponse = {
  total_adrs: 3,
  active_adrs: 2,
  active_details: [
    { id: 'ADR-045', title: 'Praetorium ADR', status: 'accepted' },
    { id: 'ADR-042', title: 'Migration Strategy', status: 'proposed' },
    { id: 'ADR-038', title: 'Authentication Flow', status: 'deprecated' },
  ],
};

beforeEach(() => {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: vi.fn().mockResolvedValue(mockDecisionsResponse),
  });
});

describe('Decisions Page', () => {
  it('renderizza titolo Decisions', () => {
    render(<DecisionsPage />);
    expect(screen.getByText('Decisions')).toBeInTheDocument();
  });

  it('mostra ADR cards', async () => {
    render(<DecisionsPage />);
    expect(await screen.findByText('ADR-045')).toBeInTheDocument();
    expect(await screen.findByText('ADR-042')).toBeInTheDocument();
  });

  it('filtra decisioni per testo ricerca', async () => {
    render(<DecisionsPage />);
    const searchInput = await screen.findByPlaceholderText(/search/i);
    fireEvent.change(searchInput, { target: { value: 'Praetorium' } });
    expect(await screen.findByText('ADR-045')).toBeInTheDocument();
  });
});
