-- Migration: 007_create_file_changes.sql
-- Fase 7: FABRICA — Developer Tooling
-- Crea la tabella file_changes per tracciare le modifiche ai file del progetto.
--
-- Design:
--   - Tabella dedicata con change_type per classificare il tipo di modifica
--   - change_type con CHECK constraint per valori validi
--   - summary obbligatorio, diff opzionale per il dettaglio
--   - session_id e task_id per tracciabilità completa
--   - Indici per le query più frequenti: file_path, agent, task_id, created_at
--   - Consistency con timestamp TEXT ISO 8601

-- ──────────────────────────────────────────
-- File Changes: journal delle modifiche ai file
-- ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS file_changes (
    id          TEXT PRIMARY KEY,              -- 'fc_' + uuid
    file_path   TEXT NOT NULL,                 -- percorso relativo del file
    agent       TEXT NOT NULL,                 -- agente che ha modificato
    session_id  TEXT,                          -- ID sessione
    task_id     TEXT,                          -- ID task associato
    change_type TEXT NOT NULL CHECK(change_type IN ('created', 'modified', 'deleted', 'renamed')),
    summary     TEXT NOT NULL,                 -- descrizione della modifica
    diff        TEXT,                          -- diff opzionale
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ──────────────────────────────────────────
-- Indici per performance delle query
-- ──────────────────────────────────────────

-- Query per storico file
CREATE INDEX IF NOT EXISTS idx_file_changes_file_path
    ON file_changes(file_path);

-- Query per agente
CREATE INDEX IF NOT EXISTS idx_file_changes_agent
    ON file_changes(agent);

-- Query per task associato
CREATE INDEX IF NOT EXISTS idx_file_changes_task_id
    ON file_changes(task_id);

-- Query per ordinamento temporale
CREATE INDEX IF NOT EXISTS idx_file_changes_created_at
    ON file_changes(created_at);

-- Registra la migration
INSERT OR IGNORE INTO _migrations (name) VALUES ('007_create_file_changes');
