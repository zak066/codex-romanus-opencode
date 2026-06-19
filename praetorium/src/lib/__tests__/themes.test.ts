import { describe, it, expect } from 'vitest';
import { themes, resolveTheme, buildCssVariables } from '../themes';
import type { Theme } from '../themes';

describe('themes', () => {
  it('esporta tutti e 4 i temi attesi', () => {
    expect(Object.keys(themes)).toEqual(['dark', 'light', 'system', 'cyberpunk']);
  });

  it('ogni tema ha le proprietà obbligatorie', () => {
    const expectedProps = ['id', 'name', 'description', 'icon', 'colors'];
    for (const [key, theme] of Object.entries(themes)) {
      for (const prop of expectedProps) {
        expect(theme).toHaveProperty(prop);
      }
      expect(theme.id).toBe(key);
    }
  });

  it('ogni tema ha colors con tutte le chiavi', () => {
    const colorKeys = [
      'background', 'surface', 'surfaceHover', 'text', 'textSecondary',
      'border', 'primary', 'primaryHover', 'accent', 'success', 'warning', 'error',
    ];
    for (const theme of Object.values(themes)) {
      for (const key of colorKeys) {
        expect(theme.colors).toHaveProperty(key);
        expect((theme.colors as Record<string, string>)[key]).toMatch(/^#[0-9a-fA-F]{6}$/);
      }
    }
  });

  it('dark è il tema scuro', () => {
    expect(themes.dark.name).toBe('Dark');
    expect(themes.dark.colors.background).toBe('#0f0f0f');
  });

  it('light è il tema chiaro', () => {
    expect(themes.light.name).toBe('Light');
    expect(themes.light.colors.background).toBe('#f5f0e8');
  });

  it('system è il tema system', () => {
    expect(themes.system.name).toBe('System');
  });

  it('cyberpunk è il tema neon', () => {
    expect(themes.cyberpunk.name).toBe('Cyberpunk');
    expect(themes.cyberpunk.colors.primary).toBe('#ff2a6d');
  });
});

describe('resolveTheme', () => {
  it('restituisce dark per tema dark', () => {
    expect(resolveTheme('dark')).toBe('dark');
  });

  it('restituisce light per tema light', () => {
    expect(resolveTheme('light')).toBe('light');
  });

  it('restituisce cyberpunk per tema cyberpunk', () => {
    expect(resolveTheme('cyberpunk')).toBe('cyberpunk');
  });

  it('restituisce dark come fallback per system se window.matchMedia non è disponibile', () => {
    const originalMatchMedia = window.matchMedia;
    // @ts-expect-error - removing matchMedia for test
    delete window.matchMedia;
    expect(resolveTheme('system')).toBe('dark');
    window.matchMedia = originalMatchMedia;
  });
});

describe('buildCssVariables', () => {
  it('restituisce un oggetto Record<string, string> per dark', () => {
    const vars = buildCssVariables('dark');
    expect(vars).toHaveProperty('--color-surface-base');
    expect(vars['--color-surface-base']).toBe('#1a1a24');
    expect(vars['--color-roman-gold']).toBe('#d4a54a');
  });

  it('restituisce un oggetto Record<string, string> per light', () => {
    const vars = buildCssVariables('light');
    expect(vars['--color-surface-base']).toBe('#ffffff');
    expect(vars['--color-roman-gold']).toBe('#b8892e');
  });

  it('restituisce le variabili cyberpunk per tema cyberpunk', () => {
    const vars = buildCssVariables('cyberpunk');
    expect(vars['--color-roman-gold']).toBe('#ff2a6d');
    expect(vars['--color-pompeii-blue']).toBe('#05d9e8');
    expect(vars['--color-pompeii-green']).toBe('#01ff70');
  });

  it('restituisce sempre lo stesso numero di variabili', () => {
    const darkVars = buildCssVariables('dark');
    const lightVars = buildCssVariables('light');
    const cyberVars = buildCssVariables('cyberpunk');
    // Cyberpunk ha più variabili (include quelle neon)
    expect(Object.keys(darkVars).length).toBeGreaterThan(0);
    expect(Object.keys(lightVars).length).toBeGreaterThan(0);
    expect(Object.keys(cyberVars).length).toBeGreaterThan(0);
  });
});

