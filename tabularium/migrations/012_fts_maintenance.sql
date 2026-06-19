-- Migration: 012_fts_maintenance.sql
-- Aggiunge trigger per mantenere sincronizzato l'indice FTS5 external content
-- con la tabella knowledge_entries. Previene SQLITE_CORRUPT_VTAB quando
-- il WAL viene checkpointato o quando entry vengono eliminate.

-- Trigger: sync FTS dopo INSERT su knowledge_entries
CREATE TRIGGER IF NOT EXISTS trg_knowledge_fts_insert
  AFTER INSERT ON knowledge_entries
  FOR EACH ROW
BEGIN
  INSERT OR REPLACE INTO knowledge_fts (rowid, title, body)
  VALUES (NEW.rowid, NEW.title, NEW.body);
END;

-- Trigger: sync FTS dopo DELETE su knowledge_entries
-- Usa la sintassi corretta per eliminare un documento dall'indice FTS5
CREATE TRIGGER IF NOT EXISTS trg_knowledge_fts_delete
  AFTER DELETE ON knowledge_entries
  FOR EACH ROW
BEGIN
  INSERT INTO knowledge_fts(knowledge_fts, rowid, title, body)
  VALUES ('delete', OLD.rowid, OLD.title, OLD.body);
END;
