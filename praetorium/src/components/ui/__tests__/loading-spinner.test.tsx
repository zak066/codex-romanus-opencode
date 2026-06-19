import { render, screen } from '@testing-library/react';
import { LoadingSpinner } from '../loading-spinner';

describe('LoadingSpinner', () => {
  it('renderizza con sr-only text', () => {
    render(<LoadingSpinner />);
    expect(screen.getByText('Caricamento in corso')).toBeInTheDocument();
    expect(screen.getByText('Caricamento in corso')).toHaveClass('sr-only');
  });

  it('ha role="status" e aria-label', () => {
    render(<LoadingSpinner />);
    const spinner = screen.getByRole('status');
    expect(spinner).toHaveAttribute('aria-label', 'Caricamento in corso');
  });

  // --- Taglie ---
  it.each([
    ['sm', 'h-5'],
    ['md', 'h-8'],
    ['lg', 'h-12'],
  ] as const)('taglia %s ha classe %s', (size, expectedHeightClass) => {
    const { container } = render(<LoadingSpinner size={size} />);
    const spinner = container.firstElementChild!;
    expect(spinner.className).toContain(expectedHeightClass);
  });

  // --- Colore custom via className ---
  it('colore custom via className', () => {
    const { container } = render(<LoadingSpinner className="text-red-500" />);
    const spinner = container.firstElementChild!;
    expect(spinner.className).toContain('text-red-500');
  });

  // --- La classe animate-spin è sempre presente ---
  it('ha classe animate-spin', () => {
    const { container } = render(<LoadingSpinner />);
    expect(container.firstElementChild!.className).toContain('animate-spin');
  });
});
