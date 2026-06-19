-- Migration: 018_add_read_at.sql
-- Aggiunge la colonna read_at alla tabella messages per il tracking
-- read/unread dei messaggi DM (GAP-02 — R2.3).
--
-- read_at è NULL finché il messaggio non viene letto dal destinatario.
-- Quando un agente legge il messaggio (via agent_mark_read),
-- read_at viene impostato al timestamp ISO 8601 corrente.
--
-- Dipende da: 013_create_messaging.sql (tabella messages)

-- ──────────────────────────────────────────
-- Add read_at column to messages
-- ──────────────────────────────────────────
ALTER TABLE messages ADD COLUMN read_at TEXT;

-- ──────────────────────────────────────────
-- Index per performance su channel_id + read_at
-- (ADR-043 — Schema Database)
-- ──────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_messages_read_at_channel
  ON messages(channel_id, read_at);
