/**
 * core/design-tokens.ts
 * Design Token Vault — archivio centralizzato di token di design
 * con tema "Dark Roman" predefinito.
 *
 * Pattern: sync, dati in memoria, nessun DB.
 *
 * @module core/design-tokens
 */

// ──────────────────────────────────────────────
//  Tipi
// ──────────────────────────────────────────────

export interface DesignToken {
  name: string;
  value: string;
  category: 'color' | 'spacing' | 'typography' | 'shadow' | 'border';
  description?: string;
}

export interface DesignTokenTheme {
  name: string;
  tokens: DesignToken[];
}

// ──────────────────────────────────────────────
//  Token predefiniti — Tema Dark Roman
// ──────────────────────────────────────────────

const DARK_ROMAN_TOKENS: DesignToken[] = [
  // ── Colori ──
  { name: '--color-bg-primary', value: '#1a1a2e', category: 'color', description: 'Sfondo principale' },
  { name: '--color-bg-secondary', value: '#16213e', category: 'color', description: 'Sfondo secondario' },
  { name: '--color-text-primary', value: '#e8d5b7', category: 'color', description: 'Testo principale (pergamena)' },
  { name: '--color-text-secondary', value: '#a08c6b', category: 'color', description: 'Testo secondario' },
  { name: '--color-accent', value: '#c9a84c', category: 'color', description: 'Accento oro romano' },
  { name: '--color-danger', value: '#8b0000', category: 'color', description: 'Pericolo/errore' },
  { name: '--color-success', value: '#2d5a27', category: 'color', description: 'Successo' },
  // ── Spacing ──
  { name: '--spacing-xs', value: '4px', category: 'spacing' },
  { name: '--spacing-sm', value: '8px', category: 'spacing' },
  { name: '--spacing-md', value: '16px', category: 'spacing' },
  { name: '--spacing-lg', value: '24px', category: 'spacing' },
  { name: '--spacing-xl', value: '48px', category: 'spacing' },
  // ── Typography ──
  { name: '--font-family', value: "'Times New Roman', serif", category: 'typography' },
  { name: '--font-size-sm', value: '0.875rem', category: 'typography' },
  { name: '--font-size-md', value: '1rem', category: 'typography' },
  { name: '--font-size-lg', value: '1.25rem', category: 'typography' },
  { name: '--font-size-xl', value: '1.5rem', category: 'typography' },
  // ── Shadows ──
  { name: '--shadow-sm', value: '0 1px 3px rgba(0,0,0,0.3)', category: 'shadow' },
  { name: '--shadow-md', value: '0 4px 6px rgba(0,0,0,0.4)', category: 'shadow' },
  { name: '--shadow-lg', value: '0 10px 25px rgba(0,0,0,0.5)', category: 'shadow' },
  // ── Border ──
  { name: '--border-radius-sm', value: '4px', category: 'border' },
  { name: '--border-radius-md', value: '8px', category: 'border' },
  { name: '--border-color', value: '#c9a84c', category: 'border' },
];

// ──────────────────────────────────────────────
//  Temi registrati
// ──────────────────────────────────────────────

const THEMES: DesignTokenTheme[] = [
  {
    name: 'dark_roman',
    tokens: DARK_ROMAN_TOKENS,
  },
];

// ──────────────────────────────────────────────
//  Public API
// ──────────────────────────────────────────────

/**
 * Restituisce i token di design, opzionalmente filtrati per tema e categoria.
 *
 * @param theme  - Nome del tema (default: 'dark_roman')
 * @param category - Categoria per filtrare (opzionale)
 * @returns Array di DesignToken corrispondenti ai criteri
 */
export function getTokens(theme?: string, category?: string): DesignToken[] {
  const themeName = theme ?? 'dark_roman';
  const found = THEMES.find((t) => t.name === themeName);

  if (!found) return [];

  if (!category) return [...found.tokens];

  return found.tokens.filter(
    (t) => t.category === category
  );
}

/**
 * Cerca un token per nome CSS (es. `--color-accent`).
 *
 * @param name - Nome del token (con `--` iniziale)
 * @returns Il token trovato o undefined
 */
export function getToken(name: string): DesignToken | undefined {
  for (const theme of THEMES) {
    const found = theme.tokens.find((t) => t.name === name);
    if (found) return found;
  }
  return undefined;
}

/**
 * Restituisce la lista dei nomi dei temi disponibili.
 */
export function getThemes(): string[] {
  return THEMES.map((t) => t.name);
}

/**
 * Restituisce la lista delle categorie di token disponibili.
 */
export function getCategories(): string[] {
  const cats = new Set<DesignToken['category']>();
  for (const theme of THEMES) {
    for (const token of theme.tokens) {
      cats.add(token.category);
    }
  }
  return Array.from(cats);
}
