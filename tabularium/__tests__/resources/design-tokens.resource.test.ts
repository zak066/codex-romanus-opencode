/**
 * __tests__/resources/design-tokens.resource.test.ts
 * Test per resources/design-tokens.resource.ts — Design Token Vault (Fase 8 PANTHEON)
 *
 * Copertura:
 * - ResourceHandler: metadati corretti
 * - ResourceHandler: handler restituisce token con conteggio temi/categorie
 * - resolveDesignTokenUri: tutti i token (23 Roman Dark)
 * - resolveDesignTokenUri: filtro per tema e categoria
 * - Token contiene campi: name, value, category, description
 * - Categorie: color, spacing, typography, shadow, border
 *
 * @module tests/resources/design-tokens
 */

import {
  designTokenResourceHandler,
  resolveDesignTokenUri,
} from '../../src/resources/design-tokens.resource.js';

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('DesignTokensResource', () => {
  // ── ResourceHandler ────────────────────────────────────────────────────

  describe('designTokenResourceHandler', () => {
    it('ha i metadati corretti', () => {
      expect(designTokenResourceHandler.uri).toBe('tabularium://design/tokens');
      expect(designTokenResourceHandler.name).toBe('Design Tokens');
      expect(designTokenResourceHandler.mimeType).toBe('application/json');
      expect(designTokenResourceHandler.description).toBeTruthy();
    });

    it('handler restituisce token, temi e categorie', async () => {
      const result = await designTokenResourceHandler.handler();

      // Primo content: panoramica token
      const parsed = JSON.parse(result[0].text);
      expect(parsed).toHaveProperty('tokens');
      expect(parsed).toHaveProperty('total');
      expect(parsed).toHaveProperty('themes');
      expect(parsed).toHaveProperty('categories');
      expect(parsed.total).toBe(23); // 23 token Dark Roman
      expect(parsed.categories).toContain('color');

      // Secondo content: temi
      const themesParsed = JSON.parse(result[1].text);
      expect(themesParsed).toHaveProperty('themes');
      expect(themesParsed.themes).toContain('dark_roman');

      // Terzo content: categorie
      const catsParsed = JSON.parse(result[2].text);
      expect(catsParsed).toHaveProperty('categories');
    });
  });

  // ── resolveDesignTokenUri ──────────────────────────────────────────────

  describe('resolveDesignTokenUri', () => {
    it('restituisce tutti i token per URI base /tokens', async () => {
      const result = await resolveDesignTokenUri('tabularium://design/tokens');

      expect(result).toHaveLength(1);
      const parsed = JSON.parse(result[0].text);
      expect(parsed).toHaveProperty('tokens');
      expect(parsed.total).toBe(23);
    });

    it('ogni token ha name, value, category', async () => {
      const result = await resolveDesignTokenUri('tabularium://design/tokens');
      const parsed = JSON.parse(result[0].text);
      const tokens = parsed.tokens;

      for (const token of tokens) {
        expect(token).toHaveProperty('name');
        expect(token).toHaveProperty('value');
        expect(token).toHaveProperty('category');
      }

      // Verifica che ci siano token di color, font, spacing
      const categories = new Set(tokens.map((t: { category: string }) => t.category));
      expect(categories).toContain('color');
      expect(categories).toContain('typography');
      expect(categories).toContain('spacing');
      expect(categories).toContain('shadow');
      expect(categories).toContain('border');
    });

    it('filtra per categoria color', async () => {
      const result = await resolveDesignTokenUri(
        'tabularium://design/tokens?category=color'
      );

      const parsed = JSON.parse(result[0].text);
      expect(parsed.filters.category).toBe('color');
      expect(parsed.total).toBe(7); // 7 color tokens
      for (const token of parsed.tokens) {
        expect(token.category).toBe('color');
      }
    });

    it('restituisce temi per URI /themes', async () => {
      const result = await resolveDesignTokenUri('tabularium://design/themes');

      expect(result).toHaveLength(1);
      const parsed = JSON.parse(result[0].text);
      expect(parsed.themes).toContain('dark_roman');
    });

    it('restituisce categorie per URI /categories', async () => {
      const result = await resolveDesignTokenUri('tabularium://design/categories');

      expect(result).toHaveLength(1);
      const parsed = JSON.parse(result[0].text);
      expect(parsed.categories).toEqual(
        expect.arrayContaining(['color', 'spacing', 'typography', 'shadow', 'border'])
      );
    });

    it('restituisce fallback per URI non riconosciuto', async () => {
      const result = await resolveDesignTokenUri('tabularium://design/unknown');

      expect(result.length).toBeGreaterThanOrEqual(1);
      const parsed = JSON.parse(result[0].text);
      expect(parsed).toHaveProperty('tokens');
    });
  });
});
