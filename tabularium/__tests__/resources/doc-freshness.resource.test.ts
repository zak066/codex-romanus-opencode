/**
 * __tests__/resources/doc-freshness.resource.test.ts
 * Test per resources/doc-freshness.resource.ts
 *
 * Verifica:
 * - ResourceHandler base
 * - URI resolution per tabularium://project/docs
 * - Query parameter coverage=true
 * - Query parameter status/filter
 */

import {
  docFreshnessResourceHandler,
  resolveDocFreshnessUri,
} from '../../src/resources/doc-freshness.resource.js';
import type { DocFreshnessReport } from '../../src/core/doc-freshness.js';

describe('DocFreshnessResource', () => {
  // =============================================
  //  ResourceHandler base
  // =============================================

  describe('docFreshnessResourceHandler', () => {
    it('ha i metadati corretti', () => {
      expect(docFreshnessResourceHandler.uri).toBe(
        'tabularium://project/docs'
      );
      expect(docFreshnessResourceHandler.name).toBe('Doc Freshness');
      expect(docFreshnessResourceHandler.mimeType).toBe(
        'application/json'
      );
      expect(
        docFreshnessResourceHandler.description
      ).toBeTruthy();
    });

    it('handler restituisce un report valido', async () => {
      const result = await docFreshnessResourceHandler.handler();

      expect(result).toHaveLength(1);
      expect(result[0].uri).toBe('tabularium://project/docs');
      expect(result[0].mimeType).toBe('application/json');

      const parsed = JSON.parse(result[0].text);
      expect(parsed).toHaveProperty('entries');
      expect(parsed).toHaveProperty('totalDocs');
      expect(parsed).toHaveProperty('freshCount');
      expect(parsed).toHaveProperty('staleCount');
      expect(parsed).toHaveProperty('missingCount');
      expect(parsed).toHaveProperty('overallScore');
      expect(parsed).toHaveProperty('generatedAt');
      expect(typeof parsed.overallScore).toBe('number');
      expect(parsed.overallScore).toBeGreaterThanOrEqual(0);
      expect(parsed.overallScore).toBeLessThanOrEqual(100);
    });
  });

  // =============================================
  //  resolveDocFreshnessUri
  // =============================================

  describe('resolveDocFreshnessUri', () => {
    it('restituisce report completo per URI base', async () => {
      const result = await resolveDocFreshnessUri(
        'tabularium://project/docs'
      );

      expect(result).toHaveLength(1);
      const parsed = JSON.parse(result[0].text);
      expect(parsed).toHaveProperty('entries');
      expect(parsed).toHaveProperty('overallScore');
    });

    it('restituisce solo metriche aggregate con coverage=true', async () => {
      const result = await resolveDocFreshnessUri(
        'tabularium://project/docs?coverage=true'
      );

      expect(result).toHaveLength(1);
      const parsed = JSON.parse(result[0].text);

      // Coverage response: solo metriche, niente entries
      expect(parsed).not.toHaveProperty('entries');
      expect(parsed).toHaveProperty('totalDocs');
      expect(parsed).toHaveProperty('freshCount');
      expect(parsed).toHaveProperty('staleCount');
      expect(parsed).toHaveProperty('missingCount');
      expect(parsed).toHaveProperty('overallScore');
      expect(parsed).toHaveProperty('generatedAt');
    });

    it('filtra per status con parametro status', async () => {
      // Prendiamo il report completo per sapere se ci sono fresh
      const fullResult = await resolveDocFreshnessUri(
        'tabularium://project/docs'
      );
      const fullParsed = JSON.parse(fullResult[0].text) as DocFreshnessReport;

      // Se ci sono fresh, verifichiamo il filtro
      const result = await resolveDocFreshnessUri(
        'tabularium://project/docs?status=fresh'
      );
      const parsed = JSON.parse(result[0].text);

      expect(parsed).toHaveProperty('entries');
      for (const entry of parsed.entries) {
        expect(entry.status).toBe('fresh');
      }
    });

    it('filtra per punteggio minimo con minScore', async () => {
      const result = await resolveDocFreshnessUri(
        'tabularium://project/docs?minScore=50'
      );
      const parsed = JSON.parse(result[0].text);

      expect(parsed).toHaveProperty('entries');
      for (const entry of parsed.entries) {
        expect(entry.score).toBeGreaterThanOrEqual(50);
      }
    });

    it('restituisce report completo per URI non riconosciuto', async () => {
      const result = await resolveDocFreshnessUri(
        'tabularium://project/docs/sconosciuto'
      );

      expect(result).toHaveLength(1);
      const parsed = JSON.parse(result[0].text);
      expect(parsed).toHaveProperty('entries');
      expect(parsed).toHaveProperty('overallScore');
    });

    it('gestisce URI con coverage=true e status insieme', async () => {
      const result = await resolveDocFreshnessUri(
        'tabularium://project/docs?coverage=true&status=missing'
      );

      expect(result).toHaveLength(1);
      const parsed = JSON.parse(result[0].text);

      // coverage=true ha priorità: solo metriche
      expect(parsed).not.toHaveProperty('entries');
      expect(parsed).toHaveProperty('totalDocs');
    });
  });
});
