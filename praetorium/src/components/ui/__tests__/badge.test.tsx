import { render, screen } from '@testing-library/react';
import { Badge } from '../badge';

describe('Badge', () => {
  it('renderizza testo', () => {
    render(<Badge>Attivo</Badge>);
    expect(screen.getByText('Attivo')).toBeInTheDocument();
  });

  // --- Varianti ---
  it.each([
    ['default', 'bg-surface-overlay'],
    ['success', 'bg-semantic-success-bg'],
    ['error', 'bg-semantic-error-bg'],
    ['warning', 'bg-semantic-warning-bg'],
    ['info', 'bg-semantic-info-bg'],
  ] as const)('variante %s ha classe %s', (variant, expectedClass) => {
    render(<Badge variant={variant}>Test</Badge>);
    const badge = screen.getByText('Test');
    expect(badge.className).toContain(expectedClass);
  });

  // --- Taglie ---
  it.each([
    ['sm', 'text-xs'],
    ['md', 'text-sm'],
  ] as const)('taglia %s ha classe %s', (size, expectedClass) => {
    render(<Badge size={size}>Test</Badge>);
    const badge = screen.getByText('Test');
    expect(badge.className).toContain(expectedClass);
  });

  // --- Icona opzionale ---
  it('icona opzionale viene renderizzata', () => {
    render(<Badge icon={<span data-testid="badge-icon">⭐</span>}>Test</Badge>);
    expect(screen.getByTestId('badge-icon')).toBeInTheDocument();
  });

  it('icona è aria-hidden="true"', () => {
    render(<Badge icon={<span data-testid="badge-icon">⭐</span>}>Test</Badge>);
    const iconContainer = screen.getByTestId('badge-icon').parentElement;
    expect(iconContainer).toHaveAttribute('aria-hidden', 'true');
  });

  it('non renderizza icona se non fornita', () => {
    const { container } = render(<Badge>Test</Badge>);
    const spans = container.querySelectorAll('[aria-hidden="true"]');
    expect(spans.length).toBe(0);
  });

  // --- className custom ---
  it('className custom merge', () => {
    render(<Badge className="extra-class">Test</Badge>);
    const badge = screen.getByText('Test');
    expect(badge.className).toContain('extra-class');
  });
});
