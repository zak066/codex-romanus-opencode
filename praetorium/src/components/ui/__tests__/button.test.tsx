import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Button } from '../button';

describe('Button', () => {
  // --- Render ---
  it('renderizza con children di testo', () => {
    render(<Button>Cliccami</Button>);
    expect(screen.getByRole('button', { name: /cliccami/i })).toBeInTheDocument();
  });

  it('applica className custom', () => {
    render(<Button className="my-custom-class">Test</Button>);
    const btn = screen.getByRole('button');
    expect(btn.className).toContain('my-custom-class');
  });

  // --- Varianti ---
  it.each([
    ['primary', 'bg-roman-gold'],
    ['secondary', 'bg-surface-overlay'],
    ['ghost', 'bg-transparent'],
    ['danger', 'bg-semantic-error'],
  ] as const)('variante %s ha classe %s', (variant, expectedClass) => {
    render(<Button variant={variant}>Test</Button>);
    const btn = screen.getByRole('button');
    expect(btn.className).toContain(expectedClass);
  });

  // --- Taglie ---
  it.each([
    ['sm', 'px-3'],
    ['md', 'px-4'],
    ['lg', 'px-6'],
  ] as const)('taglia %s ha padding %s', (size, expectedPadding) => {
    render(<Button size={size}>Test</Button>);
    const btn = screen.getByRole('button');
    expect(btn.className).toContain(expectedPadding);
  });

  // --- Loading ---
  it('loading mostra spinner, aria-busy="true" e disabilita il pulsante', () => {
    render(<Button loading>Caricamento</Button>);
    const btn = screen.getByRole('button');
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('aria-busy', 'true');
    // Il pulsante contiene un SVG (spinner)
    const svg = btn.querySelector('svg');
    expect(svg).toBeInTheDocument();
  });

  // --- Icon ---
  it('icon prop mostra icona', () => {
    render(<Button icon={<span data-testid="custom-icon">🔍</span>}>Cerca</Button>);
    expect(screen.getByTestId('custom-icon')).toBeInTheDocument();
  });

  // --- Disabled ---
  it('disabled funziona', () => {
    render(<Button disabled>Disabilitato</Button>);
    const btn = screen.getByRole('button');
    expect(btn).toBeDisabled();
  });

  // --- onClick ---
  it('onClick viene chiamato al click', async () => {
    const handleClick = vi.fn();
    render(<Button onClick={handleClick}>Click</Button>);
    await userEvent.click(screen.getByRole('button'));
    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  // --- forwardRef ---
  it('forwardRef funziona', () => {
    const ref = vi.fn();
    render(<Button ref={ref}>Ref</Button>);
    expect(ref).toHaveBeenCalled();
    expect(ref.mock.calls[0][0]).toBeInstanceOf(HTMLButtonElement);
  });

  // --- loading disabilita anche se disabled non è impostato ---
  it('loading disabilita anche senza disabled prop esplicita', () => {
    render(<Button loading>Load</Button>);
    expect(screen.getByRole('button')).toBeDisabled();
  });
});
