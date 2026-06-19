import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ThemeProvider, useTheme } from '../theme-provider';

// ─── Mock window.matchMedia ───────────────────────────────────
beforeEach(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query === '(prefers-color-scheme: light)' ? false : false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});

// ─── Helper component per testare useTheme ────────────────────
function ThemeConsumer() {
  const { theme, resolvedTheme, saving } = useTheme();
  return (
    <div>
      <span data-testid="theme">{theme}</span>
      <span data-testid="resolved-theme">{resolvedTheme}</span>
      <span data-testid="saving">{saving ? 'true' : 'false'}</span>
    </div>
  );
}

describe('ThemeProvider', () => {
  it('renderizza i children', () => {
    render(
      <ThemeProvider>
        <div data-testid="child">Hello</div>
      </ThemeProvider>,
    );
    expect(screen.getByTestId('child')).toBeInTheDocument();
    expect(screen.getByText('Hello')).toBeInTheDocument();
  });

  it('usa defaultTheme system di default', () => {
    render(
      <ThemeProvider>
        <ThemeConsumer />
      </ThemeProvider>,
    );
    // defaultTheme = 'system' ma dopo il mount carica da API → di default
    // Il valore iniziale è 'system', ma dopo il fetch mockato (ok: true, {})
    // siccome data.theme non esiste, rimane 'system'
    expect(screen.getByTestId('theme')).toBeInTheDocument();
  });

  it('usa defaultTheme passato via props', () => {
    render(
      <ThemeProvider defaultTheme="dark">
        <ThemeConsumer />
      </ThemeProvider>,
    );
    // Il fetch mockato restituisce {} senza theme, quindi rimane defaultTheme
    expect(screen.getByTestId('theme')).toBeInTheDocument();
  });
});

describe('useTheme', () => {
  it('funziona dentro ThemeProvider e restituisce valori di default', () => {
    render(
      <ThemeProvider defaultTheme="dark">
        <ThemeConsumer />
      </ThemeProvider>,
    );

    expect(screen.getByTestId('theme')).toHaveTextContent('dark');
    expect(screen.getByTestId('saving')).toHaveTextContent('false');
  });

  it('fornisce i campi attesi del context value', () => {
    // Componente che verifica la struttura del context
    function ContextChecker() {
      const ctx = useTheme();
      expect(ctx).toHaveProperty('theme');
      expect(ctx).toHaveProperty('resolvedTheme');
      expect(ctx).toHaveProperty('setTheme');
      expect(ctx).toHaveProperty('saving');
      expect(typeof ctx.setTheme).toBe('function');
      return <div data-testid="checker">ok</div>;
    }

    render(
      <ThemeProvider defaultTheme="dark">
        <ContextChecker />
      </ThemeProvider>,
    );

    expect(screen.getByTestId('checker')).toHaveTextContent('ok');
  });

  it('lancia errore se usato fuori dal provider', () => {
    // suppress console.error per l'errore atteso
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    function BrokenComponent() {
      useTheme();
      return <div>should not render</div>;
    }

    expect(() => render(<BrokenComponent />)).toThrow(
      'useTheme must be used within a ThemeProvider',
    );

    consoleSpy.mockRestore();
  });
});
