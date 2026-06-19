import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { EmptyState } from '../empty-state';

describe('EmptyState', () => {
  // --- Render base con default ---
  it('renderizza con message di default', () => {
    render(<EmptyState />);
    expect(screen.getByText('Nessun dato disponibile')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: /nessun dato disponibile/i }),
    ).toBeInTheDocument();
  });

  // --- Message personalizzato ---
  it('renderizza message personalizzato', () => {
    render(<EmptyState message="Nessun risultato trovato" />);
    expect(screen.getByText('Nessun risultato trovato')).toBeInTheDocument();
  });

  // --- Description ---
  it('renderizza description se fornita', () => {
    render(
      <EmptyState
        message="Nessun dato"
        description="Prova a modificare i filtri di ricerca"
      />,
    );
    expect(
      screen.getByText('Prova a modificare i filtri di ricerca'),
    ).toBeInTheDocument();
  });

  it('non renderizza description se non fornita', () => {
    render(<EmptyState message="Vuoto" />);
    expect(
      screen.queryByText('Prova a modificare i filtri di ricerca'),
    ).not.toBeInTheDocument();
  });

  // --- Action ---
  it('mostra il pulsante action se fornito', () => {
    const action = { label: 'Aggiungi elemento', onClick: vi.fn() };
    render(<EmptyState action={action} />);
    const btn = screen.getByRole('button', { name: /aggiungi elemento/i });
    expect(btn).toBeInTheDocument();
  });

  it('chiama action.onClick al click del pulsante', () => {
    const onClick = vi.fn();
    const action = { label: 'Clicca qui', onClick };
    render(<EmptyState action={action} />);
    fireEvent.click(screen.getByRole('button', { name: /clicca qui/i }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('non mostra il pulsante action se action non è fornito', () => {
    render(<EmptyState message="Vuoto" />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  // --- Icona personalizzata ---
  it('renderizza icona personalizzata se fornita', () => {
    const CustomIcon = (props: { className?: string }) => (
      <svg data-testid="custom-icon" className={props.className} />
    );
    render(<EmptyState icon={CustomIcon} />);
    expect(screen.getByTestId('custom-icon')).toBeInTheDocument();
  });

  it('usa Inbox come icona di default', () => {
    const { container } = render(<EmptyState />);
    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
    expect(svg).toHaveAttribute('aria-hidden', 'true');
  });

  // --- displayName ---
  it('ha displayName corretto', () => {
    expect(EmptyState.displayName).toBe('EmptyState');
  });
});
