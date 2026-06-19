/**
 * messaging/agent-validator.ts
 * Validazione condivisa dei nomi agente per tutti i tool MCP di Tabularium.
 *
 * I nomi agente devono matchare: solo lettere minuscole, numeri, trattini, underscore.
 * Lunghezza: 1-80 caratteri.
 * Rifiuta: placeholder ($), spazi, caratteri speciali.
 *
 * @module messaging/agent-validator
 */

/**
 * Regex per nomi agente validi.
 * - Deve iniziare con una lettera (a-z, case-insensitive)
 - - Seguito da lettere, numeri, trattini o underscore
 * - Lunghezza totale: 1-80 caratteri
 */
export const AGENT_NAME_REGEX = /^[a-z][a-z0-9_-]{0,79}$/i;

/**
 * Valida un nome agente.
 *
 * @param name - Il nome agente da validare
 * @returns `null` se valido, altrimenti una stringa di errore descrittiva
 */
export function validateAgentName(name: string): string | null {
  if (!name || !name.trim()) {
    return 'Agent name is required';
  }

  const trimmed = name.trim();

  if (!AGENT_NAME_REGEX.test(trimmed)) {
    return (
      `Invalid agent name '${name}'. ` +
      `Must match: ${AGENT_NAME_REGEX.source} ` +
      `(alphanumeric, hyphens, underscores, 1-80 chars)`
    );
  }

  return null; // valid
}
