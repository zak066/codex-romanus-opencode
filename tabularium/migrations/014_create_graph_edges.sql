-- Migration: 014_create_graph_edges.sql
-- R2: Knowledge Graph — graph_edges
--
-- Crea la tabella graph_edges per relazioni strutturate tra tutte le
-- entita Tabularium (ADR, knowledge, bug, incident, metric, secret, session).
-- Estende il pattern di decision_dependencies (009) a un grafo
-- multi-entita generico con weight e metadata JSON.
--
-- Design:
--   - source_type / target_type discriminano il tipo di entita
--   - relation con CHECK constraint per 7 valori validi
--   - UNIQUE su (source_type, source_id, target_type, target_id, relation)
--   - weight REAL per ranking e confidence scoring
--   - metadata JSON per attributi estensibili per tipo di relazione
--   - 3 indici composti per query source, target e relation

-- ──────────────────────────────────────────
-- Graph Edges: tabella unica per il knowledge graph
-- ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS graph_edges (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    source_type     TEXT NOT NULL CHECK(source_type IN ('adr','knowledge','bug','incident','metric','secret','session')),
    source_id       TEXT NOT NULL,
    target_type     TEXT NOT NULL CHECK(target_type IN ('adr','knowledge','bug','incident','metric','secret','session')),
    target_id       TEXT NOT NULL,
    relation        TEXT NOT NULL CHECK(relation IN (
                        'depends_on',
                        'supersedes',
                        'relates_to',
                        'caused_bug',
                        'fixes',
                        'implements',
                        'references'
                    )),
    weight          REAL NOT NULL DEFAULT 1.0,
    description     TEXT,
    created_by      TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    metadata        TEXT DEFAULT '{}',
    UNIQUE(source_type, source_id, target_type, target_id, relation)
);

-- ──────────────────────────────────────────
-- Indici per query navigazionali
-- ──────────────────────────────────────────

-- Query source: tutte le uscite da un nodo
CREATE INDEX IF NOT EXISTS idx_graph_source
    ON graph_edges(source_type, source_id);

-- Query target: tutti gli ingressi a un nodo
CREATE INDEX IF NOT EXISTS idx_graph_target
    ON graph_edges(target_type, target_id);

-- Query filtro per tipo di relazione
CREATE INDEX IF NOT EXISTS idx_graph_relation
    ON graph_edges(relation);

-- ──────────────────────────────────────────
-- Seed: migrazione relazioni ADR esistenti da decision_dependencies
-- Mappa i 3 tipi di relazione ADR ai 7 tipi del knowledge graph:
--   depends_on  -> depends_on
--   supersedes  -> supersedes
--   related_to  -> relates_to
-- ──────────────────────────────────────────
INSERT OR IGNORE INTO graph_edges
    (source_type, source_id, target_type, target_id, relation, description, created_by, created_at)
SELECT
    'adr'               AS source_type,
    from_adr            AS source_id,
    'adr'               AS target_type,
    to_adr              AS target_id,
    CASE relation_type
        WHEN 'related_to' THEN 'relates_to'
        ELSE relation_type
    END                 AS relation,
    description,
    'migration-014'     AS created_by,
    created_at
FROM decision_dependencies;
