/**
 * __tests__/resources/a11y.resource.test.ts
 * Test per resources/a11y.resource.ts — Accessibility Audit Trail (Fase 8 PANTHEON)
 *
 * Copertura:
 * - ResourceHandler: metadati corretti
 * - Handler restituisce checklist con 10 criteri WCAG
 * - Ogni criterio ha: criterion, status, recommendation (via category/level/description)
 * - resolveA11yUri: lista completa, filtro per categoria, storico, componenti
 * - Filtro per categoria
 *
 * @module tests/resources/a11y
 */

import {
  a11yResourceHandler,
  resolveA11yUri,
} from '../../src/resources/a11y.resource.js';

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('A11yResource', () => {
  // ── ResourceHandler ────────────────────────────────────────────────────

  describe('a11yResourceHandler', () => {
    it('ha i metadati corretti', () => {
      expect(a11yResourceHandler.uri).toBe('tabularium://a11y/checklist');
      expect(a11yResourceHandler.name).toBe('Accessibility Audit Trail');
      expect(a11yResourceHandler.mimeType).toBe('application/json');
      expect(a11yResourceHandler.description).toBeTruthy();
    });

    it('handler restituisce checklist WCAG e componenti', async () => {
      const result = await a11yResourceHandler.handler();

      expect(result).toHaveLength(2);

      // Primo content: checklist
      const checklistParsed = JSON.parse(result[0].text);
      expect(checklistParsed).toHaveProperty('checklist');
      expect(checklistParsed).toHaveProperty('total');
      expect(checklistParsed.total).toBe(10); // 10 criteri WCAG
      expect(checklistParsed).toHaveProperty('hint');

      // Secondo content: componenti
      const componentsParsed = JSON.parse(result[1].text);
      expect(componentsParsed).toHaveProperty('components');
      expect(componentsParsed).toHaveProperty('total');
    });

    it('ogni criterio WCAG ha i campi obbligatori', async () => {
      const result = await a11yResourceHandler.handler();
      const parsed = JSON.parse(result[0].text);
      const checklist = parsed.checklist;

      expect(checklist).toHaveLength(10);

      for (const item of checklist) {
        expect(item).toHaveProperty('id');
        expect(item).toHaveProperty('criterion');
        expect(item).toHaveProperty('level');
        expect(item).toHaveProperty('description');
        expect(item).toHaveProperty('category');
        // Ogni criterio ha level A, AA, o AAA
        expect(['A', 'AA', 'AAA']).toContain(item.level);
      }
    });

    it('checklist contiene criteri di tutte e 4 le categorie', async () => {
      const result = await a11yResourceHandler.handler();
      const parsed = JSON.parse(result[0].text);
      const categories = new Set(parsed.checklist.map((c: { category: string }) => c.category));

      expect(categories).toContain('perceivable');
      expect(categories).toContain('operable');
      expect(categories).toContain('understandable');
      expect(categories).toContain('robust');
    });
  });

  // ── resolveA11yUri ─────────────────────────────────────────────────────

  describe('resolveA11yUri', () => {
    it('restituisce checklist completa per URI /checklist', async () => {
      const result = await resolveA11yUri('tabularium://a11y/checklist');

      expect(result).toHaveLength(1);
      const parsed = JSON.parse(result[0].text);
      expect(parsed).toHaveProperty('checklist');
      expect(parsed.total).toBe(10);
    });

    it('filtra per categoria perceivable', async () => {
      const result = await resolveA11yUri(
        'tabularium://a11y/checklist?category=perceivable'
      );

      const parsed = JSON.parse(result[0].text);
      expect(parsed.filters.category).toBe('perceivable');
      for (const item of parsed.checklist) {
        expect(item.category).toBe('perceivable');
      }
    });

    it('filtra per categoria operable', async () => {
      const result = await resolveA11yUri(
        'tabularium://a11y/checklist?category=operable'
      );

      const parsed = JSON.parse(result[0].text);
      expect(parsed.filters.category).toBe('operable');
      for (const item of parsed.checklist) {
        expect(item.category).toBe('operable');
      }
    });

    it('restituisce componenti per URI /components', async () => {
      const result = await resolveA11yUri('tabularium://a11y/components');

      const parsed = JSON.parse(result[0].text);
      expect(parsed).toHaveProperty('components');
      expect(parsed).toHaveProperty('total');
    });

    it('restituisce history vuota per componente inesistente', async () => {
      const result = await resolveA11yUri('tabularium://a11y/history?component=Nonexistent');

      const parsed = JSON.parse(result[0].text);
      expect(parsed).toHaveProperty('history');
      expect(parsed.history).toHaveProperty('component', 'Nonexistent');
      expect(parsed.history).toHaveProperty('audits');
      expect(parsed.history.audits).toHaveLength(0);
      expect(parsed.history).toHaveProperty('latestScore', 0);
    });

    it('restituisce history per componente esistente', async () => {
      const result = await resolveA11yUri(
        'tabularium://a11y/history?component=Button'
      );

      const parsed = JSON.parse(result[0].text);
      expect(parsed).toHaveProperty('history');
      expect(parsed.history).toHaveProperty('component', 'Button');
    });

    it('restituisce fallback per URI sconosciuto', async () => {
      const result = await resolveA11yUri('tabularium://a11y/unknown');

      expect(result.length).toBeGreaterThanOrEqual(1);
      const parsed = JSON.parse(result[0].text);
      // Fallback è la panoramica con checklist
      expect(parsed).toHaveProperty('checklist');
    });
  });
});
