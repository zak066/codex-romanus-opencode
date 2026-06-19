import { render, screen } from '@testing-library/react';
import PackagePage from '../package/page';

vi.mock('next/navigation', () => ({ usePathname: () => '/package' }));

describe('Package Page (Packaging)', () => {
  it('renderizza titolo Packaging', () => {
    render(<PackagePage />);
    expect(screen.getByText('Packaging')).toBeInTheDocument();
  });

  it('mostra sottotitolo', () => {
    render(<PackagePage />);
    expect(screen.getByText('Crea archivi compressi personalizzati di Codex Romanus')).toBeInTheDocument();
  });

  it('mostra sezione Server', () => {
    render(<PackagePage />);
    expect(screen.getByRole('heading', { name: 'Server' })).toBeInTheDocument();
  });

  it('mostra sezione Preset Agenti', () => {
    render(<PackagePage />);
    expect(screen.getByText('Preset Agenti')).toBeInTheDocument();
  });

  it('mostra sezione Extra', () => {
    render(<PackagePage />);
    expect(screen.getByRole('heading', { name: 'Extra' })).toBeInTheDocument();
  });

  it('mostra sezione Stima Dimensioni', () => {
    render(<PackagePage />);
    expect(screen.getByText('Stima Dimensioni')).toBeInTheDocument();
  });

  it('mostra server Tabularium', () => {
    render(<PackagePage />);
    expect(screen.getAllByText('Tabularium')[0]).toBeInTheDocument();
  });

  it('mostra pulsante Genera Archivio', () => {
    render(<PackagePage />);
    expect(screen.getByText('Genera Archivio')).toBeInTheDocument();
  });
});
