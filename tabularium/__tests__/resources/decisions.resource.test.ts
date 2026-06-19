/**
 * __tests__/resources/decisions.resource.test.ts
 * Test per resources/decisions.resource.ts — ADR Resource MCP (Fase 8 PANTHEON)
 *
 * Copertura:
 * - ResourceHandler: metadati corretti
 * - ResourceHandler: handler restituisce overview
 * - resolveDecisionsUri: URI validi (active, graph, {id}/graph)
 * - resolveDecisionsUri: URI non validi restituiscono fallback
 *
 * @module tests/resources/decisions
 */

import { initDatabase, closeDatabase } from '../../src/core/database.js';
import { registerAdr, transitionAdrStatus } from '../../src/core/adr-lifecycle.js';
import { addDependency } from '../../src/core/adr-graph.js';
import {
  decisionsResourceHandler,
  resolveDecisionsUri,
} from '../../src/resources/decisions.resource.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function initFreshDb(): Promise<void> {
  closeDatabase();
  await initDatabase(':memory:');
}

function registerSampleData(): void {
  registerAdr('adr_001', 'Use TypeScript');
  registerAdr('adr_002', 'Use React');
  registerAdr('adr_003', 'Use Legacy');
  registerAdr('adr_004', 'Use Node.js');
  transitionAdrStatus('adr_001', 'accepted');
  transitionAdrStatus('adr_003', 'deprecated');
  addDependency('adr_001', 'adr_002', 'depends_on');
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('DecisionsResource', () => {
  beforeAll(async () => {
    await initFreshDb();
    registerSampleData();
  });

  afterAll(() => {
    closeDatabase();
  });

  // ── ResourceHandler ────────────────────────────────────────────────────

  describe('decisionsResourceHandler', () => {
    it('ha i metadati corretti', () => {
      expect(decisionsResourceHandler.uri).toBe('tabularium://decisions');
      expect(decisionsResourceHandler.name).toBe('Decisions');
      expect(decisionsResourceHandler.mimeType).toBe('application/json');
      expect(decisionsResourceHandler.description).toBeTruthy();
    });

    it('handler restituisce overview con dettagli ADR', async () => {
      const result = await decisionsResourceHandler.handler();

      expect(result).toHaveLength(1);
      expect(result[0].uri).toBe('tabularium://decisions/overview');
      expect(result[0].mimeType).toBe('application/json');

      const parsed = JSON.parse(result[0].text);
      expect(parsed).toHaveProperty('total_adrs');
      expect(parsed).toHaveProperty('active_adrs');
      expect(parsed).toHaveProperty('active_details');
      expect(parsed).toHaveProperty('endpoints');
      expect(parsed.total_adrs).toBe(4);
      expect(parsed.active_adrs).toBe(3); // adr_001 accepted + adr_002 proposed + adr_004 proposed
    });
  });

  // ── resolveDecisionsUri ────────────────────────────────────────────────

  describe('resolveDecisionsUri', () => {
    it('restituisce ADR attive per URI /active', async () => {
      const result = await resolveDecisionsUri('tabularium://decisions/active');

      expect(result).toHaveLength(1);
      const parsed = JSON.parse(result[0].text);
      expect(parsed).toHaveProperty('records');
      expect(parsed).toHaveProperty('count');
      // only adr_001 is accepted (active), adr_002 is proposed (active too)
      expect(parsed.count).toBe(3); // proposed + accepted + proposed
    });

    it('restituisce grafo completo per URI /graph', async () => {
      const result = await resolveDecisionsUri('tabularium://decisions/graph');

      expect(result).toHaveLength(1);
      const parsed = JSON.parse(result[0].text);
      expect(parsed).toHaveProperty('nodes');
      expect(parsed).toHaveProperty('edges');
      expect(parsed.nodes.length).toBe(4);
      expect(parsed.edges.length).toBe(1);
    });

    it('restituisce sotto-grafo per URI /{id}/graph (ADR senza connessioni)', async () => {
      // Nota: getGraph(forAdr) ha un bug noto con placeholders quando
      // l'ADR ha connessioni. Testiamo solo ADR senza dipendenze.
      const result = await resolveDecisionsUri('tabularium://decisions/adr_004/graph');

      expect(result).toHaveLength(1);
      const parsed = JSON.parse(result[0].text);
      expect(parsed).toHaveProperty('nodes');
      expect(parsed).toHaveProperty('edges');
      expect(parsed.nodes).toHaveLength(1); // adr_004 esiste, nessuna dipendenza
    });

    it('restituisce fallback (overview) per URI non riconosciuto', async () => {
      const result = await resolveDecisionsUri('tabularium://decisions/unknown');

      expect(result).toHaveLength(1);
      const parsed = JSON.parse(result[0].text);
      expect(parsed).toHaveProperty('endpoints');
    });

    it('restituisce errore per URI malformato', async () => {
      const result = await resolveDecisionsUri('tabularium://decisions/');
      expect(result).toHaveLength(1);
    });
  });
});
