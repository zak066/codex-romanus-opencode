-- Migration: 008_create_adr_status.sql
-- Fase 8: PANTHEON — Domain Extensions
-- Crea la tabella adr_status per il ciclo di vita delle ADR.
--
-- Design:
--   - Tabella dedicata con status e CHECK constraint per valori validi
--   - superseded_by per tracciare sostituzioni tra ADR
--   - Indice su status per query di filtro rapide
--   - Consistency con timestamp TEXT ISO 8601

-- ──────────────────────────────────────────
-- ADR Status: ciclo di vita delle decisioni architetturali
-- ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS adr_status (
    id            TEXT PRIMARY KEY,        -- 'adr_' + numero (es. 'adr_012')
    title         TEXT NOT NULL,
    status        TEXT NOT NULL DEFAULT 'proposed' CHECK(status IN ('proposed','accepted','deprecated','superseded')),
    superseded_by TEXT,                    -- id dell'ADR che lo ha sostituito
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ──────────────────────────────────────────
-- Indici per performance delle query
-- ──────────────────────────────────────────

-- Query per stato (filtro/dashboard)
CREATE INDEX IF NOT EXISTS idx_adr_status
    ON adr_status(status);

-- ──────────────────────────────────────────
-- Trigger: aggiorna updated_at automaticamente
-- ──────────────────────────────────────────
CREATE TRIGGER IF NOT EXISTS trg_adr_status_updated_at
    AFTER UPDATE ON adr_status
BEGIN
    UPDATE adr_status SET updated_at = datetime('now') WHERE id = NEW.id;
END;

-- Registra la migration
INSERT OR IGNORE INTO _migrations (name) VALUES ('008_create_adr_status');
