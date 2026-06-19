import { render, screen, fireEvent } from '@testing-library/react';
import { ErrorState } from '../error-state';

describe('ErrorState', () => {
  // --- Render base ---
  it('renderizza con message di default', () => {
    render(<ErrorState message="Si è verificato un errore" />);
    expect(screen.getByText('Si è verificato un errore')).toBeInTheDocument();
  });

  it('renderizza il titolo di default', () => {
    render(<ErrorState message="Errore" />);
    expect(screen.getByText('Errore nel caricamento')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: /errore nel caricamento/i }),
    ).toBeInTheDocument();
  });

  // --- Title personalizzato ---
  it('renderizza title personalizzato', () => {
    render(<ErrorState message="Errore" title="Attenzione" />);
    expect(screen.getByText('Attenzione')).toBeInTheDocument();
    expect(screen.queryByText('Errore nel caricamento')).not.toBeInTheDocument();
  });

  // --- Message personalizzato ---
  it('renderizza message personalizzato', () => {
    render(
      <ErrorState message="Impossibile connettersi al server" />,
    );
    expect(
      screen.getByText('Impossibile connettersi al server'),
    ).toBeInTheDocument();
  });

  // --- onRetry ---
  it('mostra il pulsante Riprova se onRetry è fornito', () => {
    const onRetry = vi.fn();
    render(<ErrorState message="Errore" onRetry={onRetry} />);
    const retryButton = screen.getByRole('button', { name: /riprova/i });
    expect(retryButton).toBeInTheDocument();
  });

  it('chiama onRetry al click del pulsante Riprova', () => {
    const onRetry = vi.fn();
    render(<ErrorState message="Errore" onRetry={onRetry} />);
    fireEvent.click(screen.getByRole('button', { name: /riprova/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  // --- Nessun pulsante senza onRetry ---
  it('non mostra il pulsante Riprova se onRetry non è fornito', () => {
    render(<ErrorState message="Errore" />);
    expect(
      screen.queryByRole('button', { name: /riprova/i }),
    ).not.toBeInTheDocument();
  });

  // --- Accessibilità ---
  it('ha ruolo alert e aria-live assertive per accessibilità', () => {
    render(<ErrorState message="Errore" />);
    const alertElement = screen.getByRole('alert');
    expect(alertElement).toHaveAttribute('aria-live', 'assertive');
  });

  // --- Icona ---
  it('renderizza l\'icona AlertCircle', () => {
    const { container } = render(<ErrorState message="Errore" />);
    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
    expect(svg).toHaveAttribute('aria-hidden', 'true');
  });

  // --- displayName ---
  it('ha displayName corretto', () => {
    expect(ErrorState.displayName).toBe('ErrorState');
  });
});
