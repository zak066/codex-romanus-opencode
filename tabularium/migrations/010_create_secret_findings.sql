-- Migration: 010_create_secret_findings.sql
-- Fase 8: PANTHEON — Estensioni di Dominio
-- Crea la tabella secret_findings per il Secret Scanner (Custos Secret Monitor).
--
-- Design:
--   - Tabella per tracciare segreti hardcodati trovati durante le scansioni
--   - secret_type classifica il tipo di segreto: api_key, password, token, private_key, connection_string
--   - severity con CHECK constraint per valori validi (low, medium, high, critical)
--   - status per il ciclo di vita: open → acknowledged → false_positive/fixed
--   - content offuscato (primi 4 + ultimi 4 caratteri)
--   - Indici per le query più frequenti: file_path, secret_type, status
--   - Consistency con timestamp TEXT ISO 8601

-- ──────────────────────────────────────────
-- Secret Findings: segreti hardcodati
-- ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS secret_findings (
    id            TEXT PRIMARY KEY,              -- 'sec_' + uuid
    file_path     TEXT NOT NULL,
    line_number   INTEGER,
    secret_type   TEXT NOT NULL,                 -- 'api_key', 'password', 'token', 'private_key', 'connection_string'
    severity      TEXT NOT NULL CHECK(severity IN ('low','medium','high','critical')),
    description   TEXT NOT NULL,
    content       TEXT,                          -- snippet offuscato
    status        TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','acknowledged','false_positive','fixed')),
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    resolved_at   TEXT
);

-- ──────────────────────────────────────────
-- Indici per performance delle query
-- ──────────────────────────────────────────

-- Query per file path (raggruppa findings per file)
CREATE INDEX IF NOT EXISTS idx_secret_file
    ON secret_findings(file_path);

-- Query per tipo di segreto (filtra per categoria)
CREATE INDEX IF NOT EXISTS idx_secret_type
    ON secret_findings(secret_type);

-- Query per stato (triage/gestione)
CREATE INDEX IF NOT EXISTS idx_secret_status
    ON secret_findings(status);

-- ──────────────────────────────────────────
-- Trigger: imposta resolved_at quando il finding viene risolto
-- ──────────────────────────────────────────
CREATE TRIGGER IF NOT EXISTS trg_secret_resolved
    AFTER UPDATE OF status ON secret_findings
    WHEN NEW.status IN ('fixed', 'false_positive') AND OLD.status NOT IN ('fixed', 'false_positive')
BEGIN
    UPDATE secret_findings SET resolved_at = datetime('now') WHERE id = NEW.id;
END;

-- Registra la migration
INSERT OR IGNORE INTO _migrations (name) VALUES ('010_create_secret_findings');
