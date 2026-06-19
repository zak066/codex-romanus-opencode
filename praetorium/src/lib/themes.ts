// ─── Theme System ───────────────────────────────────────────────────────────
// Definisce i 3 temi: dark (Roman Dark di default), light, system

export type Theme = 'light' | 'dark' | 'system' | 'cyberpunk';

export interface ThemeConfig {
  id: Theme;
  name: string;
  description: string;
  icon: string;
  colors: {
    background: string;
    surface: string;
    surfaceHover: string;
    text: string;
    textSecondary: string;
    border: string;
    primary: string;
    primaryHover: string;
    accent: string;
    success: string;
    warning: string;
    error: string;
  };
}

export const themes: Record<Theme, ThemeConfig> = {
  dark: {
    id: 'dark',
    name: 'Dark',
    description: 'Tema scuro ispirato alla Roma imperiale',
    icon: '🌙',
    colors: {
      background: '#0f0f0f',
      surface: '#1a1a24',
      surfaceHover: '#252533',
      text: '#e8e4db',
      textSecondary: '#b0aaa0',
      border: '#2a2a3a',
      primary: '#d4a54a',
      primaryHover: '#b8892e',
      accent: '#d4a54a',
      success: '#22c55e',
      warning: '#f59e0b',
      error: '#ef4444',
    },
  },
  light: {
    id: 'light',
    name: 'Light',
    description: 'Tema chiaro su pergamena',
    icon: '☀️',
    colors: {
      background: '#f5f0e8',
      surface: '#ffffff',
      surfaceHover: '#f0ece4',
      text: '#2c2416',
      textSecondary: '#6b5e4a',
      border: '#e0d8c8',
      primary: '#b8892e',
      primaryHover: '#9a7526',
      accent: '#d4a54a',
      success: '#16a34a',
      warning: '#d97706',
      error: '#dc2626',
    },
  },
  system: {
    id: 'system',
    name: 'System',
    description: 'Segue le preferenze del sistema operativo',
    icon: '💻',
    colors: {
      background: '#0f0f0f',
      surface: '#1a1a24',
      surfaceHover: '#252533',
      text: '#e8e4db',
      textSecondary: '#b0aaa0',
      border: '#2a2a3a',
      primary: '#d4a54a',
      primaryHover: '#b8892e',
      accent: '#d4a54a',
      success: '#22c55e',
      warning: '#f59e0b',
      error: '#ef4444',
    },
  },
  cyberpunk: {
    id: 'cyberpunk',
    name: 'Cyberpunk',
    description: 'Estetica futuristica neon e grigio scuro',
    icon: '🤖',
    colors: {
      background: '#0a0a0f',
      surface: '#12121a',
      surfaceHover: '#1a1a28',
      text: '#e0e0ff',
      textSecondary: '#8888aa',
      border: '#2a2a40',
      primary: '#ff2a6d',      // neon pink/magenta
      primaryHover: '#cc1f57',
      accent: '#05d9e8',        // neon cyan
      success: '#01ff70',       // neon green
      warning: '#ff6e27',       // neon orange
      error: '#ff0033',         // neon red
    },
  },
};

/**
 * Risolve il tema effettivo: se 'system', usa prefers-color-scheme.
 * Fallback a 'dark' se non disponibile.
 */
export function resolveTheme(theme: Theme): 'light' | 'dark' | 'cyberpunk' {
  if (theme === 'cyberpunk') return 'cyberpunk';
  if (theme === 'system') {
    if (typeof window !== 'undefined' && window.matchMedia) {
      return window.matchMedia('(prefers-color-scheme: light)').matches
        ? 'light'
        : 'dark';
    }
    return 'dark';
  }
  return theme;
}

/**
 * Costruisce un oggetto di variabili CSS dal tema effettivo.
 */
export function buildCssVariables(resolved: 'light' | 'dark' | 'cyberpunk'): Record<string, string> {
  if (resolved === 'cyberpunk') {
    return {
      '--color-surface-base': '#12121a',
      '--color-surface-raised': '#181824',
      '--color-surface-overlay': '#1a1a28',
      '--color-surface-panel': '#222233',
      '--color-surface-floating': '#2a2a3d',
      '--color-surface-deep': '#0a0a0f',
      '--color-text-primary': '#e0e0ff',
      '--color-text-secondary': '#8888aa',
      '--color-text-muted': '#666688',
      '--color-text-dim': '#444466',
      '--color-text-inverse': '#0a0a0f',
      '--color-border-subtle': '#2a2a40',
      '--color-border-default': '#3a3a55',
      '--color-border-focus': '#ff2a6d',
      '--color-roman-gold': '#ff2a6d',
      '--color-roman-gold-dark': '#cc1f57',
      '--color-roman-gold-light': '#ff5c8a',
      '--color-roman-gold-glow': 'rgba(255,42,109,0.15)',
      '--color-pompeii-blue': '#05d9e8',
      '--color-pompeii-blue-light': '#33e0ec',
      '--color-pompeii-green': '#01ff70',
      '--color-pompeii-green-light': '#33ff8f',
      '--color-semantic-success': '#01ff70',
      '--color-semantic-success-bg': '#003319',
      '--color-semantic-error': '#ff0033',
      '--color-semantic-error-bg': '#33000d',
      '--color-semantic-warning': '#ff6e27',
      '--color-semantic-warning-bg': '#331709',
      '--color-semantic-info': '#05d9e8',
      '--color-semantic-info-bg': '#001a1f',
    };
  }

  const t = themes[resolved].colors;
  return {
    '--color-surface-base': t.surface,
    '--color-surface-raised': t.surface,
    '--color-surface-overlay': t.surfaceHover,
    '--color-surface-panel': t.surface,
    '--color-surface-floating': t.surfaceHover,
    '--color-surface-deep': t.background,
    '--color-text-primary': t.text,
    '--color-text-secondary': t.textSecondary,
    '--color-text-muted': t.textSecondary,
    '--color-text-dim': t.textSecondary,
    '--color-text-inverse': resolved === 'dark' ? '#030712' : '#f5f0e8',
    '--color-border-subtle': t.border,
    '--color-border-default': t.border,
    '--color-border-focus': t.primary,
    '--color-roman-gold': t.primary,
    '--color-roman-gold-dark': t.primaryHover,
    '--color-roman-gold-light': resolved === 'dark' ? '#e8c97a' : '#d4a54a',
    '--color-roman-gold-glow':
      resolved === 'dark'
        ? 'rgba(212,165,74,0.12)'
        : 'rgba(212,165,74,0.08)',
    '--color-pompeii-blue': resolved === 'dark' ? '#1a3a5c' : '#2a6a9c',
    '--color-pompeii-blue-light': resolved === 'dark' ? '#2a5a8c' : '#4a8abc',
    '--color-pompeii-green': resolved === 'dark' ? '#2d5a3a' : '#3d8a5a',
    '--color-pompeii-green-light': resolved === 'dark' ? '#3d7a4e' : '#5daa7a',
  };
}
