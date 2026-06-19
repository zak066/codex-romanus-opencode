import { vi, Mock } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import AdvisoryPage from '../advisory/page';

vi.mock('next/navigation', () => ({ usePathname: () => '/advisory' }));

const mockAdvisoryResponse = {
  mode: 'high',
  generatedAt: '2026-06-08T10:00:00.000Z',
  modelsEvaluated: 10,
  agents: [],
};

describe('Advisory Page', () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  it('renderizza titolo Consulenza Modelli', async () => {
    (global.fetch as Mock).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockAdvisoryResponse),
    });
    render(<AdvisoryPage />);

    // The header h1 is always rendered regardless of loading/data state
    expect(screen.getByText('Consulenza Modelli')).toBeInTheDocument();
  });

  it('mostra stato di loading mentre il fetch è in corso', () => {
    // Keep the promise pending — fetch never resolves
    (global.fetch as Mock).mockReturnValue(new Promise(() => {}));
    render(<AdvisoryPage />);

    // Loading indicator and text should be visible
    expect(screen.getByText('Analisi in corso...')).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('mostra errore con opzione riprova quando la richiesta fallisce', async () => {
    (global.fetch as Mock).mockRejectedValue(new Error('Errore di caricamento dati'));
    render(<AdvisoryPage />);

    // Wait for the async effect to process the rejection
    await waitFor(() => {
      expect(screen.getByText('Errore di caricamento dati')).toBeInTheDocument();
    });

    // A retry button should be available
    expect(screen.getByText('Riprova')).toBeInTheDocument();
  });

  it('mostra dati quando la richiesta ha successo (agenti vuoti)', async () => {
    (global.fetch as Mock).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockAdvisoryResponse),
    });
    render(<AdvisoryPage />);

    // Wait for loading to finish and data to render
    await waitFor(() => {
      expect(screen.getByText(/Ultimo aggiornamento/)).toBeInTheDocument();
    });

    // The component renders without crashing and shows the data section
    expect(screen.getByText('Consulenza Modelli')).toBeInTheDocument();
    expect(
      screen.getByLabelText('Raccomandazioni per agente'),
    ).toBeInTheDocument();
  });
});
