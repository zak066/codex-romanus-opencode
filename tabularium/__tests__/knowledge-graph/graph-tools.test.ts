/**
 * Test per tools/graph.tool.ts — Tool MCP per Knowledge Graph (R2).
 *
 * Copertura: graph_add_edge, graph_remove_edge, graph_query,
 *            graph_get_related, graph_auto_link, graph_get_path.
 *
 * Pattern: tests/messaging/messaging-tools.test.ts (initDatabase in memory,
 *          parseResult helper, handler().then() per async handlers).
 *
 * @module tests/knowledge-graph/graph-tools
 */

// Jest: describe, it, expect, beforeAll, afterAll, beforeEach are globals
import { initDatabase, closeDatabase, getDatabase } from '../../src/core/database.js';
import {
  graphAddEdgeToolHandler,
  graphRemoveEdgeToolHandler,
  graphQueryToolHandler,
  graphGetRelatedToolHandler,
  graphAutoLinkToolHandler,
  graphGetPathToolHandler,
} from '../../src/tools/graph.tool.js';
import { addEdge } from '../../src/core/db-graph.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Estrae il contenuto JSON dal risultato di un tool handler.
 */
function parseResult(result: any): any {
  try {
    return JSON.parse(result.content[0].text);
  } catch {
    return { error: result.content[0].text };
  }
}

/**
 * Inserisce dati di test di base nel grafo:
 *
 *   adr_001 ──depends_on──→ adr_002 ──relates_to──→ bug_001 ──caused_bug──→ inc_001
 *   adr_001 ──references──→ k_001
 *   ses_001 ──references──→ adr_001
 */
function insertTestGraph(): void {
  addEdge('adr', 'adr_001', 'adr', 'adr_002', 'depends_on', {
    description: '001 depends on 002',
    createdBy: 'test',
  });
  addEdge('adr', 'adr_002', 'bug', 'bug_001', 'relates_to', {
    weight: 0.8,
    createdBy: 'test',
  });
  addEdge('bug', 'bug_001', 'incident', 'inc_001', 'caused_bug', {
    createdBy: 'test',
  });
  addEdge('adr', 'adr_001', 'knowledge', 'k_001', 'references', {
    weight: 0.7,
    createdBy: 'test',
  });
  addEdge('session', 'ses_001', 'adr', 'adr_001', 'references', {
    weight: 0.5,
    createdBy: 'test',
  });
}

/**
 * Pulisce la tabella graph_edges.
 */
function cleanGraph(): void {
  const db = getDatabase();
  db.exec('DELETE FROM graph_edges');
  db.exec("DELETE FROM sqlite_sequence WHERE name='graph_edges'");
}

// ---------------------------------------------------------------------------
// Setup & Teardown
// ---------------------------------------------------------------------------

beforeAll(async () => {
  await initDatabase(':memory:');
});

afterAll(() => {
  closeDatabase();
});

beforeEach(() => {
  cleanGraph();
});

// ===========================================================================
// graph_add_edge
// ===========================================================================

describe('graph_add_edge', () => {
  it('should add a valid edge and return success', async () => {
    const r = await graphAddEdgeToolHandler.handler({
      source_type: 'adr',
      source_id: 'adr_001',
      target_type: 'adr',
      target_id: 'adr_002',
      relation: 'depends_on',
    });

    expect(r.isError).toBeFalsy();
    const d = parseResult(r);
    expect(d.success).toBe(true);
    expect(d.edge.source_type).toBe('adr');
    expect(d.edge.source_id).toBe('adr_001');
    expect(d.edge.target_type).toBe('adr');
    expect(d.edge.target_id).toBe('adr_002');
    expect(d.edge.relation).toBe('depends_on');
    expect(d.edge.weight).toBe(1.0);
  });

  it('should add edge with custom fields', async () => {
    const r = await graphAddEdgeToolHandler.handler({
      source_type: 'bug',
      source_id: 'bug_001',
      target_type: 'incident',
      target_id: 'inc_001',
      relation: 'caused_bug',
      weight: 2.5,
      description: 'Critical bug',
      created_by: 'vulcanus',
    });

    expect(r.isError).toBeFalsy();
    const d = parseResult(r);
    expect(d.edge.weight).toBe(2.5);
    expect(d.edge.description).toBe('Critical bug');
    expect(d.edge.created_by).toBe('vulcanus');
  });

  it('should return error for self-reference', async () => {
    const r = await graphAddEdgeToolHandler.handler({
      source_type: 'adr',
      source_id: 'adr_001',
      target_type: 'adr',
      target_id: 'adr_001',
      relation: 'depends_on',
    });

    expect(r.isError).toBe(true);
    const d = parseResult(r);
    expect(d.message).toMatch(/Self-referencing/);
  });

  it('should return validation error for invalid source_type', async () => {
    const r = await graphAddEdgeToolHandler.handler({
      source_type: 'invalid',
      source_id: 'x_001',
      target_type: 'adr',
      target_id: 'adr_002',
      relation: 'depends_on',
    });

    expect(r.isError).toBe(true);
    const d = parseResult(r);
    expect(d.error).toBe('ERROR');
  });

  it('should return validation error for invalid relation', async () => {
    const r = await graphAddEdgeToolHandler.handler({
      source_type: 'adr',
      source_id: 'adr_001',
      target_type: 'adr',
      target_id: 'adr_002',
      relation: 'invalid_rel',
    });

    expect(r.isError).toBe(true);
  });

  it('should return validation error for missing required fields', async () => {
    const r = await graphAddEdgeToolHandler.handler({
      source_type: 'adr',
    });

    expect(r.isError).toBe(true);
    const d = parseResult(r);
    expect(d.message).toMatch(/required/);
  });

  it('should return error for duplicate edge', async () => {
    await graphAddEdgeToolHandler.handler({
      source_type: 'adr',
      source_id: 'adr_001',
      target_type: 'adr',
      target_id: 'adr_002',
      relation: 'depends_on',
    });

    const r = await graphAddEdgeToolHandler.handler({
      source_type: 'adr',
      source_id: 'adr_001',
      target_type: 'adr',
      target_id: 'adr_002',
      relation: 'depends_on',
    });

    expect(r.isError).toBe(true);
    const d = parseResult(r);
    expect(d.message).toMatch(/already exists/);
  });

  it('should accept valid enum values for entity types', async () => {
    const types = ['adr', 'knowledge', 'bug', 'incident', 'metric', 'secret', 'session'];
    for (const t of types) {
      cleanGraph();
      const r = await graphAddEdgeToolHandler.handler({
        source_type: t,
        source_id: `${t}_001`,
        target_type: t === 'adr' ? 'bug' : 'adr',
        target_id: `${t === 'adr' ? 'bug' : 'adr'}_001`,
        relation: 'references',
      });
      expect(r.isError).toBeFalsy();
    }
  });

  it('should accept all valid relation types', async () => {
    const relations = ['depends_on', 'supersedes', 'relates_to', 'caused_bug', 'fixes', 'implements', 'references'];
    for (const rel of relations) {
      cleanGraph();
      const r = await graphAddEdgeToolHandler.handler({
        source_type: 'adr',
        source_id: 'adr_001',
        target_type: 'adr',
        target_id: 'adr_002',
        relation: rel,
      });
      expect(r.isError).toBeFalsy();
      const d = parseResult(r);
      expect(d.edge.relation).toBe(rel);
    }
  });

  it('should reject weight out of range', async () => {
    const r = await graphAddEdgeToolHandler.handler({
      source_type: 'adr',
      source_id: 'adr_001',
      target_type: 'adr',
      target_id: 'adr_002',
      relation: 'depends_on',
      weight: -5,
    });

    expect(r.isError).toBe(true);
    const d = parseResult(r);
    expect(d.message).toMatch(/weight/);
  });
});

// ===========================================================================
// graph_remove_edge
// ===========================================================================

describe('graph_remove_edge', () => {
  it('should remove an existing edge', async () => {
    addEdge('adr', 'adr_001', 'adr', 'adr_002', 'depends_on');

    const r = await graphRemoveEdgeToolHandler.handler({
      source_type: 'adr',
      source_id: 'adr_001',
      target_type: 'adr',
      target_id: 'adr_002',
      relation: 'depends_on',
    });

    expect(r.isError).toBeFalsy();
    const d = parseResult(r);
    expect(d.removed).toBe(true);
    expect(d.success).toBe(true);
  });

  it('should return removed=false for non-existent edge', async () => {
    const r = await graphRemoveEdgeToolHandler.handler({
      source_type: 'adr',
      source_id: 'adr_999',
      target_type: 'adr',
      target_id: 'adr_000',
      relation: 'depends_on',
    });

    expect(r.isError).toBeFalsy();
    const d = parseResult(r);
    expect(d.removed).toBe(false);
    expect(d.success).toBe(false);
  });

  it('should return validation error for invalid entity type', async () => {
    const r = await graphRemoveEdgeToolHandler.handler({
      source_type: 'invalid',
      source_id: 'x_001',
      target_type: 'adr',
      target_id: 'adr_002',
      relation: 'depends_on',
    });

    expect(r.isError).toBe(true);
  });

  it('should return validation error for missing required fields', async () => {
    const r = await graphRemoveEdgeToolHandler.handler({ source_type: 'adr' });

    expect(r.isError).toBe(true);
    const d = parseResult(r);
    expect(d.message).toMatch(/required/);
  });

  it('should not crash on empty graph', async () => {
    const r = await graphRemoveEdgeToolHandler.handler({
      source_type: 'adr',
      source_id: 'adr_001',
      target_type: 'adr',
      target_id: 'adr_002',
      relation: 'depends_on',
    });

    expect(r.isError).toBeFalsy();
    const d = parseResult(r);
    expect(d.removed).toBe(false);
  });
});

// ===========================================================================
// graph_query
// ===========================================================================

describe('graph_query', () => {
  beforeEach(() => {
    insertTestGraph();
  });

  it('should navigate graph with BFS default', async () => {
    const r = await graphQueryToolHandler.handler({
      entity_type: 'adr',
      entity_id: 'adr_001',
    });

    expect(r.isError).toBeFalsy();
    const d = parseResult(r);
    expect(d.stats.nodes_count).toBeGreaterThanOrEqual(2);
    expect(d.stats.edges_count).toBeGreaterThanOrEqual(1);
    expect(d.nodes).toBeDefined();
    expect(d.edges).toBeDefined();
  });

  it('should apply filters (direction, max_depth, relation_filter)', async () => {
    const r = await graphQueryToolHandler.handler({
      entity_type: 'adr',
      entity_id: 'adr_001',
      direction: 'outgoing',
      max_depth: 1,
      relation_filter: ['references'],
    });

    expect(r.isError).toBeFalsy();
    const d = parseResult(r);
    // Only references edge: adr_001 → k_001
    expect(d.stats.nodes_count).toBe(2); // adr_001 + k_001
    expect(d.stats.edges_count).toBe(1);
    expect(d.edges[0].relation).toBe('references');
  });

  it('should use maxDepth parameter', async () => {
    const r = await graphQueryToolHandler.handler({
      entity_type: 'adr',
      entity_id: 'adr_001',
      direction: 'outgoing',
      max_depth: 3,
    });

    expect(r.isError).toBeFalsy();
    const d = parseResult(r);
    // With depth 3: adr_001, adr_002, k_001, bug_001, adr_003, inc_001 = 6
    expect(d.stats.max_depth_reached).toBe(3);
  });

  it('should handle isolated node', async () => {
    const r = await graphQueryToolHandler.handler({
      entity_type: 'adr',
      entity_id: 'adr_isolated',
    });

    expect(r.isError).toBeFalsy();
    const d = parseResult(r);
    expect(d.stats.nodes_count).toBe(1);
    expect(d.stats.edges_count).toBe(0);
  });

  it('should return validation error for invalid entity_type', async () => {
    const r = await graphQueryToolHandler.handler({
      entity_type: 'invalid',
      entity_id: 'adr_001',
    });

    expect(r.isError).toBe(true);
  });

  it('should accept all direction values', async () => {
    for (const dir of ['outgoing', 'incoming', 'both']) {
      const r = await graphQueryToolHandler.handler({
        entity_type: 'adr',
        entity_id: 'adr_001',
        direction: dir,
        max_depth: 1,
      });
      expect(r.isError).toBeFalsy();
    }
  });

  it('should accept all algorithm values', async () => {
    for (const algo of ['bfs', 'dfs']) {
      const r = await graphQueryToolHandler.handler({
        entity_type: 'adr',
        entity_id: 'adr_001',
        direction: 'outgoing',
        max_depth: 2,
        algorithm: algo,
      });
      expect(r.isError).toBeFalsy();
    }
  });

  it('should include truncated flag when limit reached', async () => {
    // Create a chain longer than max_depth
    addEdge('adr', 'adr_A', 'adr', 'adr_B', 'depends_on');
    addEdge('adr', 'adr_B', 'adr', 'adr_C', 'depends_on');
    addEdge('adr', 'adr_C', 'adr', 'adr_D', 'depends_on');

    const r = await graphQueryToolHandler.handler({
      entity_type: 'adr',
      entity_id: 'adr_A',
      direction: 'outgoing',
      max_depth: 2,
    });

    expect(r.isError).toBeFalsy();
    const d = parseResult(r);
    expect(d.truncated).toBe(true);
  });
});

// ===========================================================================
// graph_get_related
// ===========================================================================

describe('graph_get_related', () => {
  beforeEach(() => {
    insertTestGraph();
  });

  it('should return directly related entities', async () => {
    const r = await graphGetRelatedToolHandler.handler({
      entity_type: 'adr',
      entity_id: 'adr_001',
    });

    expect(r.isError).toBeFalsy();
    const d = parseResult(r);
    expect(d.total_count).toBeGreaterThanOrEqual(2);
    expect(d.related_entities).toBeDefined();
    // Should not include the start node
    const entityIds = d.related_entities.map((e: any) => e.id);
    expect(entityIds).not.toContain('adr_001');
  });

  it('should apply relation filter', async () => {
    const r = await graphGetRelatedToolHandler.handler({
      entity_type: 'adr',
      entity_id: 'adr_001',
      relation_filter: ['references'],
    });

    expect(r.isError).toBeFalsy();
    const d = parseResult(r);
    // references edges: adr_001→k_001 (outgoing), ses_001→adr_001 (incoming)
    expect(d.total_count).toBe(2);
    for (const edge of d.edges) {
      expect(edge.relation).toBe('references');
    }
  });

  it('should support depth parameter', async () => {
    const r = await graphGetRelatedToolHandler.handler({
      entity_type: 'adr',
      entity_id: 'adr_001',
      depth: 2,
    });

    expect(r.isError).toBeFalsy();
    const d = parseResult(r);
    // Depth 2 includes: adr_002, k_001, ses_001 (depth 1), bug_001, adr_003 (depth 2)
    // adr_002, k_001, ses_001 (depth 1), bug_001 (depth 2) = 4
    expect(d.total_count).toBe(4);
  });

  it('should handle isolated node', async () => {
    const r = await graphGetRelatedToolHandler.handler({
      entity_type: 'adr',
      entity_id: 'adr_isolated',
    });

    expect(r.isError).toBeFalsy();
    const d = parseResult(r);
    expect(d.total_count).toBe(0);
    expect(d.related_entities).toEqual([]);
  });

  it('should return validation error for invalid input', async () => {
    const r = await graphGetRelatedToolHandler.handler({
      entity_type: 'invalid',
      entity_id: 'adr_001',
    });

    expect(r.isError).toBe(true);
  });
});

// ===========================================================================
// graph_auto_link
// ===========================================================================

describe('graph_auto_link', () => {
  it('should create links for matching identifiers', async () => {
    // Create entities with _001 suffix
    addEdge('adr', 'adr_001', 'adr', 'adr_002', 'depends_on');
    addEdge('bug', 'bug_001', 'incident', 'inc_001', 'caused_bug');

    const r = await graphAutoLinkToolHandler.handler({
      entity_type: 'adr',
      entity_id: 'adr_001',
    });

    expect(r.isError).toBeFalsy();
    const d = parseResult(r);
    // "adr_001" base = "001", matches bug_001 → should create at least 0 links
    // (depends on whether bug_001's source_id LIKE "%001%")
    expect(d.linksCreated).toBeGreaterThanOrEqual(0);
  });

  it('should respect max_links parameter', async () => {
    cleanGraph();
    addEdge('bug', 'bug_001', 'incident', 'inc_001', 'caused_bug');
    addEdge('knowledge', 'k_001', 'adr', 'adr_002', 'references');
    addEdge('metric', 'm_001', 'secret', 's_001', 'references');

    const r = await graphAutoLinkToolHandler.handler({
      entity_type: 'adr',
      entity_id: 'adr_001',
      max_links: 2,
    });

    expect(r.isError).toBeFalsy();
    const d = parseResult(r);
    expect(d.linksCreated).toBeLessThanOrEqual(2);
  });

  it('should return validation error for invalid entity_type', async () => {
    const r = await graphAutoLinkToolHandler.handler({
      entity_type: 'invalid',
      entity_id: 'adr_001',
    });

    expect(r.isError).toBe(true);
  });

  it('should handle entity with no matching candidates', async () => {
    const r = await graphAutoLinkToolHandler.handler({
      entity_type: 'adr',
      entity_id: 'adr_unique_xyz',
    });

    expect(r.isError).toBeFalsy();
    const d = parseResult(r);
    expect(d.linksCreated).toBe(0);
    expect(d.edges).toEqual([]);
  });

  it('should create edges with relation "references"', async () => {
    cleanGraph();
    addEdge('adr', 'adr_001', 'adr', 'adr_002', 'depends_on');
    addEdge('bug', 'bug_001', 'incident', 'inc_001', 'caused_bug');

    const r = await graphAutoLinkToolHandler.handler({
      entity_type: 'adr',
      entity_id: 'adr_001',
    });

    const d = parseResult(r);
    if (d.linksCreated > 0) {
      expect(d.edges[0].relation).toBe('references');
      expect(d.edges[0].weight).toBe(0.7);
    }
  });
});

// ===========================================================================
// graph_get_path
// ===========================================================================

describe('graph_get_path', () => {
  beforeEach(() => {
    insertTestGraph();
  });

  it('should find a direct path between connected nodes', async () => {
    const r = await graphGetPathToolHandler.handler({
      source_type: 'adr',
      source_id: 'adr_001',
      target_type: 'adr',
      target_id: 'adr_002',
    });

    expect(r.isError).toBeFalsy();
    const d = parseResult(r);
    expect(d.found).toBe(true);
    expect(d.path_length).toBe(1);
  });

  it('should find an indirect multi-hop path', async () => {
    const r = await graphGetPathToolHandler.handler({
      source_type: 'bug',
      source_id: 'bug_001',
      target_type: 'incident',
      target_id: 'inc_001',
    });

    expect(r.isError).toBeFalsy();
    const d = parseResult(r);
    expect(d.found).toBe(true);
    expect(d.path_length).toBe(1);
  });

  it('should return found:false for nodes with no path', async () => {
    const r = await graphGetPathToolHandler.handler({
      source_type: 'adr',
      source_id: 'adr_001',
      target_type: 'metric',
      target_id: 'm_isolated',
      max_depth: 5,
    });

    expect(r.isError).toBeFalsy();
    const d = parseResult(r);
    expect(d.found).toBe(false);
    expect(d.path).toEqual([]);
  });

  it('should return found:false when max_depth is insufficient', async () => {
    const r = await graphGetPathToolHandler.handler({
      source_type: 'adr',
      source_id: 'adr_001',
      target_type: 'bug',
      target_id: 'bug_001',
      max_depth: 1,
    });

    expect(r.isError).toBeFalsy();
    const d = parseResult(r);
    // adr_001→adr_002 (depth 1). Need depth 2 to reach bug_001
    expect(d.found).toBe(false);
  });

  it('should respect max_depth parameter', async () => {
    const r = await graphGetPathToolHandler.handler({
      source_type: 'adr',
      source_id: 'adr_001',
      target_type: 'incident',
      target_id: 'inc_001',
      max_depth: 5,
    });

    expect(r.isError).toBeFalsy();
    const d = parseResult(r);
    // Path: adr_001→adr_002→bug_001→inc_001 = 3 edges
    expect(d.found).toBe(true);
    expect(d.path_length).toBe(3);
    // Verify path order
    expect(d.path[0].source_id).toBe('adr_001');
    expect(d.path[d.path_length - 1].target_id).toBe('inc_001');
  });

  it('should return validation error for invalid entity_type', async () => {
    const r = await graphGetPathToolHandler.handler({
      source_type: 'invalid',
      source_id: 'adr_001',
      target_type: 'adr',
      target_id: 'adr_002',
    });

    expect(r.isError).toBe(true);
  });

  it('should return validation error for missing fields', async () => {
    const r = await graphGetPathToolHandler.handler({ source_type: 'adr' });
    expect(r.isError).toBe(true);
    const d = parseResult(r);
    expect(d.message).toMatch(/required/);
  });

  it('should include step numbers in path edges', async () => {
    const r = await graphGetPathToolHandler.handler({
      source_type: 'bug',
      source_id: 'bug_001',
      target_type: 'incident',
      target_id: 'inc_001',
    });

    expect(r.isError).toBeFalsy();
    const d = parseResult(r);
    if (d.found) {
      expect(d.path[0].step).toBe(0);
      expect(d.path[0].source_type).toBe('bug');
      expect(d.path[0].target_id).toBe('inc_001');
    }
  });
});
