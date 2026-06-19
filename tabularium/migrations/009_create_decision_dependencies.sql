-- Migration: 009_create_decision_dependencies.sql
-- Fase 8: PANTHEON — Domain Extensions
-- Crea la tabella decision_dependencies per il grafo delle dipendenze ADR.
--
-- Design:
--   - Tabella ponte con relazione N:M tra ADR
--   - relation_type con CHECK constraint per valori validi (depends_on, supersedes, related_to)
--   - description opzionale per annotazioni semantiche
--   - FK verso adr_status per integrità referenziale
--   - Indici su from_adr e to_adr per query di navigazione del grafo
--   - Consistency con timestamp TEXT ISO 8601

-- ──────────────────────────────────────────
-- Decision Dependencies: grafo delle dipendenze tra ADR
-- ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS decision_dependencies (
    id            TEXT PRIMARY KEY,        -- 'dep_' + from + '_' + to + '_' + type
    from_adr      TEXT NOT NULL,           -- ADR che dipende
    to_adr        TEXT NOT NULL,           -- ADR da cui dipende
    relation_type TEXT NOT NULL CHECK(relation_type IN ('depends_on','supersedes','related_to')),
    description   TEXT,                    -- annotazione semantica opzionale
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (from_adr) REFERENCES adr_status(id),
    FOREIGN KEY (to_adr) REFERENCES adr_status(id)
);

-- ──────────────────────────────────────────
-- Indici per performance delle query
-- ──────────────────────────────────────────

-- Query per ADR sorgente (cosa dipende da cosa)
CREATE INDEX IF NOT EXISTS idx_dep_from
    ON decision_dependencies(from_adr);

-- Query per ADR target (da cosa dipende)
CREATE INDEX IF NOT EXISTS idx_dep_to
    ON decision_dependencies(to_adr);

-- Registra la migration
INSERT OR IGNORE INTO _migrations (name) VALUES ('009_create_decision_dependencies');
