/**
 * messaging/mentions.ts
 * @mention system (GAP-05) — Parsing, detection, and DM channel auto-creation.
 *
 * @module messaging/mentions
 */

/**
 * Regex pattern for @mentions.
 * Matches @ followed by a word character sequence (agent names: lowercase, numbers, hyphens).
 */
const MENTION_REGEX = /@([a-z][a-z0-9-]+)/gi;

/**
 * Extract unique agent names from @mentions in text content.
 * Returns deduplicated array of mentioned agent names.
 *
 * @param content - The message content to scan for @mentions
 * @returns Array of unique mentioned agent names (lowercase)
 *
 * @example
 * extractMentions('Hello @vulcanus-senior-dev and @minerva-architect');
 * // Returns: ['vulcanus-senior-dev', 'minerva-architect']
 *
 * @example
 * extractMentions('No mentions here');
 * // Returns: []
 *
 * @example
 * extractMentions('');
 * // Returns: []
 */
export function extractMentions(content: string): string[] {
  if (!content || typeof content !== 'string') return [];
  const mentions = new Set<string>();
  const regex = new RegExp(MENTION_REGEX.source, 'gi');
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    mentions.add(match[1].toLowerCase());
  }
  return Array.from(mentions);
}
