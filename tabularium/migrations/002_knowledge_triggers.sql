-- Migration: 002_knowledge_triggers.sql
-- Fase 2: Scriptorium — Trigger per la knowledge base
-- Aggiunge trigger per aggiornamento automatico di updated_at
-- e registrazione della migration.

-- ──────────────────────────────────────────
-- Trigger: aggiorna updated_at quando una entry viene modificata
-- ──────────────────────────────────────────
CREATE TRIGGER IF NOT EXISTS trg_knowledge_updated
  AFTER UPDATE ON knowledge_entries
  FOR EACH ROW
BEGIN
  UPDATE knowledge_entries SET updated_at = datetime('now') WHERE id = NEW.id;
END;

-- ──────────────────────────────────────────
-- Trigger: aggiorna updated_at anche per le sessioni
-- ──────────────────────────────────────────
CREATE TRIGGER IF NOT EXISTS trg_session_updated
  AFTER UPDATE ON sessions
  FOR EACH ROW
BEGIN
  UPDATE sessions SET updated_at = datetime('now') WHERE id = NEW.id;
END;

-- Registra la migration
INSERT OR IGNORE INTO _migrations (name) VALUES ('002_knowledge_triggers');
