-- Migration: 015_clean_old_heartbeat_aliases.sql
-- R1: Pulizia heartbeat vecchi alias
--
-- Rimuove le entry con agent_name corrispondenti ad alias vecchi
-- che sono stati sostituiti da nomi canonicali:
--   'diana'    → 'diana-tester'
--   'vulcanus'  → 'vulcanus-senior-dev'
--   'iuppiter'  → 'iuppiter-orchestrator'
--
-- NOTA: Nessun BEGIN/COMMIT — il migration runner gestisce la transazione.

-- Logga quante righe verranno rimosse (utile per audit)
SELECT 'Migration 015: removing ' || agent_name || ' (status: ' || status || ', last_seen: ' || last_seen || ')' AS log
FROM agent_heartbeats
WHERE agent_name IN ('diana', 'vulcanus', 'iuppiter');

-- Rimuove le entry con alias vecchi
DELETE FROM agent_heartbeats
WHERE agent_name IN ('diana', 'vulcanus', 'iuppiter');

-- Verifica post-pulizia
SELECT 'Migration 015: ' || CAST(changes() AS TEXT) || ' rows removed' AS result;
