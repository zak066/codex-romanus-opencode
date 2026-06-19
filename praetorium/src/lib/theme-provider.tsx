'use client';

import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
} from 'react';
import type { Theme } from './themes';
import { resolveTheme, buildCssVariables } from './themes';

// ─── Context ─────────────────────────────────────────────────────────────────

interface ThemeContextValue {
  /** Il tema salvato dall'utente (light|dark|system|cyberpunk) */
  theme: Theme;
  /** Il tema effettivamente applicato dopo risoluzione */
  resolvedTheme: 'light' | 'dark' | 'cyberpunk';
  /** Imposta il tema */
  setTheme: (theme: Theme) => Promise<void>;
  /** Se sta salvando */
  saving: boolean;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return ctx;
}

// ─── Provider ─────────────────────────────────────────────────────────────────

interface ThemeProviderProps {
  children: React.ReactNode;
  /** Tema di fallback se non caricato (default: 'system') */
  defaultTheme?: Theme;
}

export function ThemeProvider({
  children,
  defaultTheme = 'system',
}: ThemeProviderProps) {
  const [theme, setThemeState] = useState<Theme>(defaultTheme);
  const [resolvedTheme, setResolvedTheme] = useState<'light' | 'dark' | 'cyberpunk'>('dark');
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const mediaRef = useRef<MediaQueryList | null>(null);

  // ── Applica CSS variables al DOM ──────────────────────────────────────────
  const applyTheme = useCallback((resolved: 'light' | 'dark' | 'cyberpunk') => {
    const root = document.documentElement;
    const vars = buildCssVariables(resolved);

    // Imposta data-theme sull'html
    root.setAttribute('data-theme', resolved);

    // Applica ogni variabile CSS
    for (const [key, value] of Object.entries(vars)) {
      root.style.setProperty(key, value);
    }

    // Aggiorna meta theme-color
    const meta = document.querySelector('meta[name="theme-color"]');
    const bgColor = resolved === 'cyberpunk' ? '#0a0a0f' : resolved === 'dark' ? '#0f0f0f' : '#f5f0e8';
    if (meta) {
      meta.setAttribute('content', bgColor);
    } else {
      const m = document.createElement('meta');
      m.name = 'theme-color';
      m.content = bgColor;
      document.head.appendChild(m);
    }
  }, []);

  // ── Carica tema salvato ──────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    async function loadSettings() {
      try {
        const res = await fetch('/api/settings');
        if (res.ok) {
          const data = (await res.json()) as { theme?: Theme };
          if (!cancelled && data.theme) {
            setThemeState(data.theme);
            return data.theme;
          }
        }
      } catch {
        // Fallback a defaultTheme se API non disponibile
      }
      if (!cancelled) {
        setThemeState(defaultTheme);
      }
      return defaultTheme;
    }

    loadSettings().then((t) => {
      if (!cancelled) {
        setLoaded(true);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [defaultTheme]);

  // ── Risolvi e applica quando theme cambia ────────────────────────────────
  useEffect(() => {
    if (!loaded) return;

    const resolved = resolveTheme(theme);
    setResolvedTheme(resolved);
    applyTheme(resolved);

    // Se system, ascolta cambi di prefers-color-scheme
    if (theme === 'system') {
      const mql = window.matchMedia('(prefers-color-scheme: light)');
      mediaRef.current = mql;

      const handler = () => {
        const newResolved = resolveTheme('system');
        setResolvedTheme(newResolved);
        applyTheme(newResolved);
      };

      mql.addEventListener('change', handler);
      return () => mql.removeEventListener('change', handler);
    }
  }, [theme, loaded, applyTheme]);

  // ── Setter che persiste su file ──────────────────────────────────────────
  const setTheme = useCallback(async (newTheme: Theme) => {
    setSaving(true);
    setThemeState(newTheme);

    try {
      await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ theme: newTheme }),
      });
    } catch (err) {
      console.error('Failed to save theme setting:', err);
    } finally {
      setSaving(false);
    }
  }, []);

  return (
    <ThemeContext.Provider
      value={{ theme, resolvedTheme, setTheme, saving }}
    >
      {children}
    </ThemeContext.Provider>
  );
}
