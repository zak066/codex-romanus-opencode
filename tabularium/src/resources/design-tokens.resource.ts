/**
 * resources/design-tokens.resource.ts
 * Resource MCP per il Design Token Vault.
 *
 * URI supportati:
 *   tabularium://design/tokens                              — tutti i token (tema default)
 *   tabularium://design/tokens?theme=dark_roman             — token di un tema specifico
 *   tabularium://design/tokens?theme=dark_roman&category=color — filtrati per categoria
 *   tabularium://design/tokens?category=spacing             — categoria su tema default
 *   tabularium://design/themes                              — lista temi
 *   tabularium://design/categories                          — lista categorie
 *
 * @module resources/design-tokens
 */

import type { ResourceContent, ResourceHandler } from '../types/mcp.js';
import { getTokens, getToken, getThemes, getCategories } from '../core/design-tokens.js';

// ---------------------------------------------------------------------------
//  Costanti URI
// ---------------------------------------------------------------------------

const BASE_URI = 'tabularium://design';

// ---------------------------------------------------------------------------
//  URI Patterns
// ---------------------------------------------------------------------------

const URI_PATTERNS = [
  { pattern: /^tabularium:\/\/design\/tokens\?(.+)$/, handler: 'tokensFiltered' },
  { pattern: /^tabularium:\/\/design\/tokens$/, handler: 'tokensAll' },
  { pattern: /^tabularium:\/\/design\/themes$/, handler: 'themes' },
  { pattern: /^tabularium:\/\/design\/categories$/, handler: 'categories' },
];

// ---------------------------------------------------------------------------
//  Resource Handler registrato
// ---------------------------------------------------------------------------

export const designTokenResourceHandler: ResourceHandler = {
  uri: BASE_URI + '/tokens',
  name: 'Design Tokens',
  description:
    'Design Token Vault — tema Dark Roman predefinito. ' +
    'Filtrabile per theme e/o category via query string.',
  mimeType: 'application/json',

  handler: async (): Promise<ResourceContent[]> => {
    // Panoramica di tutti i token (default dark_roman)
    const tokens = getTokens();
    const themes = getThemes();
    const categories = getCategories();

    return [
      {
        uri: `${BASE_URI}/tokens`,
        mimeType: 'application/json',
        text: JSON.stringify(
          {
            tokens,
            total: tokens.length,
            themes: themes.join(', '),
            categories: categories.join(', '),
            hint: 'Usa ?theme=dark_roman&category=color per filtrare',
          },
          null,
          2,
        ),
      },
      {
        uri: `${BASE_URI}/themes`,
        mimeType: 'application/json',
        text: JSON.stringify({ themes }),
      },
      {
        uri: `${BASE_URI}/categories`,
        mimeType: 'application/json',
        text: JSON.stringify({ categories }),
      },
    ];
  },
};

// ---------------------------------------------------------------------------
//  URI Resolution (chiamato da resolveResource)
// ---------------------------------------------------------------------------

/**
 * Risolve un URI specifico design-token e restituisce i contenuti.
 * Chiamato dal router centrale quando un URI inizia con tabularium://design.
 *
 * @param uri - URI completo da risolvere
 * @returns Array di ResourceContent
 */
export async function resolveDesignTokenUri(uri: string): Promise<ResourceContent[]> {
  for (const { pattern, handler } of URI_PATTERNS) {
    const match = uri.match(pattern);
    if (!match) continue;

    switch (handler) {
      case 'tokensFiltered':
        return handleTokensFiltered(match[1]);
      case 'tokensAll':
        return handleTokensAll();
      case 'themes':
        return handleThemes();
      case 'categories':
        return handleCategories();
    }
  }

  // Fallback: panoramica
  return designTokenResourceHandler.handler();
}

// ---------------------------------------------------------------------------
//  Handler interni
// ---------------------------------------------------------------------------

/**
 * Gestisce: tabularium://design/tokens?theme=...&category=...
 */
function handleTokensFiltered(queryString: string): ResourceContent[] {
  const params = parseQueryString(queryString);
  const theme = params.theme as string | undefined;
  const category = params.category as string | undefined;

  const tokens = getTokens(theme, category);

  return [
    {
      uri: `tabularium://design/tokens?${queryString}`,
      mimeType: 'application/json',
      text: JSON.stringify(
        {
          tokens,
          total: tokens.length,
          filters: { theme: theme ?? 'dark_roman', category: category ?? 'all' },
        },
        null,
        2,
      ),
    },
  ];
}

/**
 * Gestisce: tabularium://design/tokens
 */
function handleTokensAll(): ResourceContent[] {
  const tokens = getTokens();

  return [
    {
      uri: 'tabularium://design/tokens',
      mimeType: 'application/json',
      text: JSON.stringify(
        {
          tokens,
          total: tokens.length,
        },
        null,
        2,
      ),
    },
  ];
}

/**
 * Gestisce: tabularium://design/themes
 */
function handleThemes(): ResourceContent[] {
  return [
    {
      uri: 'tabularium://design/themes',
      mimeType: 'application/json',
      text: JSON.stringify({ themes: getThemes() }, null, 2),
    },
  ];
}

/**
 * Gestisce: tabularium://design/categories
 */
function handleCategories(): ResourceContent[] {
  return [
    {
      uri: 'tabularium://design/categories',
      mimeType: 'application/json',
      text: JSON.stringify({ categories: getCategories() }, null, 2),
    },
  ];
}

// ---------------------------------------------------------------------------
//  Utility
// ---------------------------------------------------------------------------

/**
 * Parser semplice di query string.
 * Converte "theme=dark_roman&category=color" in { theme: 'dark_roman', category: 'color' }
 */
function parseQueryString(queryString: string): Record<string, string> {
  const params: Record<string, string> = {};
  if (!queryString) return params;

  const qs = queryString.startsWith('?') ? queryString.substring(1) : queryString;

  for (const part of qs.split('&')) {
    const [key, value] = part.split('=');
    if (key && value) {
      try {
        params[decodeURIComponent(key)] = decodeURIComponent(value);
      } catch {
        params[key] = value;
      }
    }
  }

  return params;
}
