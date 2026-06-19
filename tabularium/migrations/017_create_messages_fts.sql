-- Migration: 017_create_messages_fts.sql
-- Crea tabella virtuale FTS5 per ricerca full-text sui messaggi
-- e trigger per mantenere l'indice sincronizzato con la tabella messages.
--
-- Dipende da: 013_create_messaging.sql (tabella messages)
-- Usa: FTS5 integrato in SQLite (zero dipendenze esterne)
--
-- Design:
--   - External content FTS5 table legata a messages via rowid
--   - Triggers AFTER INSERT/UPDATE/DELETE per sync automatico
--   - Tokenizer: porter + unicode61 per stemming inglese e UTF-8
--   - sender e channel_id come UNINDEXED (non ricercabili ma presenti nei risultati)

-- ──────────────────────────────────────────
-- FTS5 virtual table for message search
-- ──────────────────────────────────────────
CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
  content,
  sender UNINDEXED,
  channel_id UNINDEXED,
  content=messages,
  content_rowid=rowid,
  tokenize='porter unicode61'
);

-- ──────────────────────────────────────────
-- Triggers to keep FTS in sync with messages
-- ──────────────────────────────────────────

-- AFTER INSERT: aggiunge il nuovo messaggio all'indice FTS5
CREATE TRIGGER IF NOT EXISTS messages_ai
  AFTER INSERT ON messages
  FOR EACH ROW
BEGIN
  INSERT INTO messages_fts(rowid, content, sender, channel_id)
  VALUES (new.rowid, new.content, new.sender, new.channel_id);
END;

-- AFTER DELETE: rimuove il messaggio dall'indice FTS5
CREATE TRIGGER IF NOT EXISTS messages_ad
  AFTER DELETE ON messages
  FOR EACH ROW
BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, content, sender, channel_id)
  VALUES('delete', old.rowid, old.content, old.sender, old.channel_id);
END;

-- AFTER UPDATE: rimuove il vecchio e inserisce il nuovo
CREATE TRIGGER IF NOT EXISTS messages_au
  AFTER UPDATE ON messages
  FOR EACH ROW
BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, content, sender, channel_id)
  VALUES('delete', old.rowid, old.content, old.sender, old.channel_id);
  INSERT INTO messages_fts(rowid, content, sender, channel_id)
  VALUES (new.rowid, new.content, new.sender, new.channel_id);
END;
