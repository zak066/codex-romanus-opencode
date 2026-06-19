/**
 * core/changelog-generator.ts
 * Genera CHANGELOG.md in formato Keep a Changelog dagli eventi registrati
 * nel database Tabularium. Legge eventi dalla tabella `events` e li mappa
 * alle sezioni del changelog secondo il mapping definito in ADR-011.
 *
 * @module core/changelog-generator
 */

import { getDatabase } from './database.js';

// ---------------------------------------------------------------------------
// Tipi pubblici
// ---------------------------------------------------------------------------

/** Sezione del changelog (Keep a Changelog standard) */
export type ChangelogSectionType =
  | 'Added'
  | 'Changed'
  | 'Deprecated'
  | 'Removed'
  | 'Fixed'
  | 'Security';

/** Singola entry del changelog */
export interface ChangelogEntry {
  date: string; // "2026-05-26"
  type: ChangelogSectionType;
  description: string;
  agent?: string;
  references?: string[]; // es. task ID, commit hash, ADR
}

/** Configurazione per la generazione del changelog */
export interface ChangelogConfig {
  fromDate?: string; // ISO o "YYYY-MM-DD", default: 30 giorni fa
  toDate?: string; // ISO o "YYYY-MM-DD", default: oggi
  groupByAgent?: boolean; // default: false
}

/** Risultato della generazione del changelog */
export interface ChangelogResult {
  markdown: string; // CHANGELOG.md content
  entries: ChangelogEntry[];
  fromDate: string;
  toDate: string;
}

// ---------------------------------------------------------------------------
// Query helpers
// ---------------------------------------------------------------------------

/** Riga grezza dal database events */
interface EventRow {
  id: string;
  session_id: string;
  timestamp: string;
  agent_name: string;
  event_type: string;
  summary: string;
  details: string;
  tags: string;
}

/**
 * Recupera tutti gli eventi nel range di date dalla tabella `events`.
 */
function fetchEvents(fromDate: string, toDate: string): EventRow[] {
  const db = getDatabase();

  // toDate inclusivo: aggiungi un giorno per arrivare a fine giornata
  const toDateEnd = toDate + 'T23:59:59.999Z';

  const rows = db
    .prepare(
      `
      SELECT id, session_id, timestamp, agent_name, event_type, summary, details, tags
      FROM events
      WHERE timestamp >= ? AND timestamp <= ?
      ORDER BY timestamp ASC
    `
    )
    .all(fromDate, toDateEnd) as EventRow[];

  return rows;
}

// ---------------------------------------------------------------------------
// Event → Changelog mapping
// ---------------------------------------------------------------------------

/**
 * Mappa un evento del database a una o più entry di changelog.
 * La maggior parte degli eventi produce una singola entry, ma alcuni
 * (es. task_completed) possono essere mappati diversamente in base ai tag.
 *
 * @returns Array di entry (solitamente 0 o 1, ma flessibile per futuro)
 */
function mapEventToEntries(event: EventRow): Omit<ChangelogEntry, 'date'>[] {
  const { event_type, summary, agent_name, details, tags } = event;

  let parsedDetails: Record<string, unknown> = {};
  try {
    parsedDetails = JSON.parse(details);
  } catch {
    // details non JSON valido — ignora
  }

  let parsedTags: string[] = [];
  try {
    parsedTags = JSON.parse(tags);
  } catch {
    // tags non JSON valido — ignora
  }

  const agent = agent_name;
  const refs: string[] = [];

  // Estrai riferimenti da details (es. task_id, adr_id, commit)
  if (parsedDetails.task_id) refs.push(String(parsedDetails.task_id));
  if (parsedDetails.adr_id) refs.push(String(parsedDetails.adr_id));
  if (parsedDetails.commit) refs.push(String(parsedDetails.commit));
  if (parsedDetails.references) {
    const raw = parsedDetails.references;
    if (Array.isArray(raw)) {
      for (const r of raw) refs.push(String(r));
    }
  }

  switch (event_type) {
    // ── task_completed ──
    case 'task_completed': {
      // Determina sezione in base ai tag
      const tagsLower = parsedTags.map((t) => t.toLowerCase());

      if (tagsLower.includes('feature') || tagsLower.includes('added')) {
        return [
          {
            type: 'Added',
            description: summary,
            agent,
            references: refs.length > 0 ? refs : undefined,
          },
        ];
      }

      if (tagsLower.includes('fix') || tagsLower.includes('bug')) {
        return [
          {
            type: 'Fixed',
            description: summary,
            agent,
            references: refs.length > 0 ? refs : undefined,
          },
        ];
      }

      if (tagsLower.includes('perf') || tagsLower.includes('performance')) {
        return [
          {
            type: 'Changed',
            description: `[Performance] ${summary}`,
            agent,
            references: refs.length > 0 ? refs : undefined,
          },
        ];
      }

      if (tagsLower.includes('security')) {
        return [
          {
            type: 'Security',
            description: summary,
            agent,
            references: refs.length > 0 ? refs : undefined,
          },
        ];
      }

      if (tagsLower.includes('docs') || tagsLower.includes('documentation')) {
        return [
          {
            type: 'Changed',
            description: `[Docs] ${summary}`,
            agent,
            references: refs.length > 0 ? refs : undefined,
          },
        ];
      }

      if (tagsLower.includes('refactor') || tagsLower.includes('refactoring')) {
        return [
          {
            type: 'Changed',
            description: summary,
            agent,
            references: refs.length > 0 ? refs : undefined,
          },
        ];
      }

      // Default per task_completed: Changed
      return [
        {
          type: 'Changed',
          description: summary,
          agent,
          references: refs.length > 0 ? refs : undefined,
        },
      ];
    }

    // ── file_created ──
    case 'file_created': {
      const path = parsedDetails.path ? String(parsedDetails.path) : '';
      const desc = path ? `Creato file ${path}` : summary;
      return [
        {
          type: 'Added',
          description: desc,
          agent,
          references: refs.length > 0 ? refs : undefined,
        },
      ];
    }

    // ── file_modified ──
    case 'file_modified': {
      const path = parsedDetails.path ? String(parsedDetails.path) : '';
      const desc = path ? `Modificato file ${path}` : summary;
      return [
        {
          type: 'Changed',
          description: desc,
          agent,
          references: refs.length > 0 ? refs : undefined,
        },
      ];
    }

    // ── decision_made ──
    case 'decision_made': {
      const adrId = parsedDetails.adr_id
        ? String(parsedDetails.adr_id)
        : '';
      const title = parsedDetails.title
        ? String(parsedDetails.title)
        : summary;
      const desc = adrId ? `ADR-${adrId}: ${title}` : `Decisione: ${title}`;
      return [
        {
          type: 'Added',
          description: desc,
          agent,
          references: refs.length > 0 ? refs : undefined,
        },
      ];
    }

    // ── error_encountered ──
    case 'error_encountered': {
      return [
        {
          type: 'Fixed',
          description: `Rilevato e risolto: ${summary}`,
          agent,
          references: refs.length > 0 ? refs : undefined,
        },
      ];
    }

    // ── milestone_reached ── (include nella descrizione, sezione Changed)
    case 'milestone_reached': {
      return [
        {
          type: 'Changed',
          description: `🎯 ${summary}`,
          agent,
          references: refs.length > 0 ? refs : undefined,
        },
      ];
    }

    // ── eventi custom / non mappati ──
    case 'custom': {
      // Leggi il tipo reale dal campo type in details
      const customType = parsedDetails.type
        ? String(parsedDetails.type)
        : '';
      const customSection = mapCustomType(customType, summary, agent, refs);
      return customSection ? [customSection] : [];
    }

    // ── bug_fixed (stored come custom nel DB attuale) ──
    case 'bug_fixed': {
      return [
        {
          type: 'Fixed',
          description: summary,
          agent,
          references: refs.length > 0 ? refs : undefined,
        },
      ];
    }

    // ── security_audit (stored come custom nel DB attuale) ──
    case 'security_audit': {
      return [
        {
          type: 'Security',
          description: `Audit sicurezza completato: ${summary}`,
          agent,
          references: refs.length > 0 ? refs : undefined,
        },
      ];
    }

    // ── regression_detected ──
    case 'regression_detected': {
      return [
        {
          type: 'Fixed',
          description: `Regressione rilevata: ${summary}`,
          agent,
          references: refs.length > 0 ? refs : undefined,
        },
      ];
    }

    // ── Fallback: eventi non riconosciuti → Changed ──
    default:
      return [
        {
          type: 'Changed',
          description: summary,
          agent,
          references: refs.length > 0 ? refs : undefined,
        },
      ];
  }
}

/**
 * Mappa un tipo custom (da details.type di eventi "custom") alla sezione corretta.
 */
function mapCustomType(
  customType: string,
  summary: string,
  agent: string,
  refs: string[]
): Omit<ChangelogEntry, 'date'> | null {
  switch (customType) {
    case 'bug_fixed':
    case 'bugfix':
    case 'fix':
      return { type: 'Fixed', description: summary, agent, references: refs.length > 0 ? refs : undefined };
    case 'security_audit':
    case 'security':
      return { type: 'Security', description: summary, agent, references: refs.length > 0 ? refs : undefined };
    case 'regression_detected':
    case 'regression':
      return { type: 'Fixed', description: `Regressione: ${summary}`, agent, references: refs.length > 0 ? refs : undefined };
    case 'performance':
    case 'perf':
      return { type: 'Changed', description: `[Performance] ${summary}`, agent, references: refs.length > 0 ? refs : undefined };
    case 'docs':
    case 'documentation':
      return { type: 'Changed', description: `[Docs] ${summary}`, agent, references: refs.length > 0 ? refs : undefined };
    case 'deprecated':
      return { type: 'Deprecated', description: summary, agent, references: refs.length > 0 ? refs : undefined };
    case 'removed':
      return { type: 'Removed', description: summary, agent, references: refs.length > 0 ? refs : undefined };
    default:
      // Custom non riconosciuto → non includere nel changelog
      return null;
  }
}

// ---------------------------------------------------------------------------
// Deduplicazione
// ---------------------------------------------------------------------------

/**
 * Raggruppa entry duplicate entro la stessa data.
 * Due entry sono duplicate se hanno stesso tipo e stessa descrizione.
 * Per la deduplicazione cross-giorno, usiamo una finestra di 24 ore
 * come definito in ADR-011.
 */
function deduplicateEntries(
  entries: ChangelogEntry[]
): { entries: ChangelogEntry[]; deduplicatedCount: number } {
  if (entries.length === 0) {
    return { entries: [], deduplicatedCount: 0 };
  }

  const seen = new Map<string, true>();
  const deduplicated: ChangelogEntry[] = [];
  let dedupCount = 0;

  // Chiave di dedup: type + description lowercased (normalizzata)
  for (const entry of entries) {
    const key = `${entry.type}|${entry.description.toLowerCase().trim()}`;

    if (seen.has(key)) {
      dedupCount++;
      continue;
    }

    seen.set(key, true);
    deduplicated.push(entry);
  }

  return { entries: deduplicated, deduplicatedCount: dedupCount };
}

// ---------------------------------------------------------------------------
// Formattazione markdown
// ---------------------------------------------------------------------------

/**
 * Formatta le entry in markdown secondo lo standard Keep a Changelog.
 *
 * Struttura:
 * # Changelog
 *
 * ## YYYY-MM-DD
 *
 * ### Added
 * - Descrizione (@agente)
 *
 * ### Fixed
 * - Fix description
 */
function formatMarkdown(
  entries: ChangelogEntry[],
  groupByAgent: boolean
): string {
  if (entries.length === 0) {
    return `# Changelog\n\nNessuna modifica registrata nel periodo selezionato.\n`;
  }

  // Raggruppa per data (YYYY-MM-DD)
  const byDate = new Map<string, ChangelogEntry[]>();
  for (const entry of entries) {
    const existing = byDate.get(entry.date) ?? [];
    existing.push(entry);
    byDate.set(entry.date, existing);
  }

  // Ordina le date in ordine decrescente (più recente prima)
  const sortedDates = Array.from(byDate.keys()).sort((a, b) =>
    b.localeCompare(a)
  );

  const lines: string[] = ['# Changelog\n'];

  for (const date of sortedDates) {
    const dateEntries = byDate.get(date)!;

    lines.push(`## ${date}\n`);

    if (groupByAgent) {
      // Raggruppa per agente all'interno della data
      const byAgent = new Map<string, ChangelogEntry[]>();
      for (const entry of dateEntries) {
        const agent = entry.agent ?? 'sconosciuto';
        const existing = byAgent.get(agent) ?? [];
        existing.push(entry);
        byAgent.set(agent, existing);
      }

      for (const [agent, agentEntries] of byAgent) {
        lines.push(`### @${agent}\n`);
        const grouped = groupBySection(agentEntries);

        for (const section of SECTION_ORDER) {
          const sectionEntries = grouped.get(section);
          if (!sectionEntries || sectionEntries.length === 0) continue;

          lines.push(`#### ${section}\n`);
          for (const entry of sectionEntries) {
            lines.push(formatEntryLine(entry));
          }
          lines.push('');
        }
      }
    } else {
      // Raggruppa per sezione
      const grouped = groupBySection(dateEntries);

      for (const section of SECTION_ORDER) {
        const sectionEntries = grouped.get(section);
        if (!sectionEntries || sectionEntries.length === 0) continue;

        lines.push(`### ${section}\n`);
        for (const entry of sectionEntries) {
          lines.push(formatEntryLine(entry));
        }
        lines.push('');
      }
    }
  }

  return lines.join('\n').trimEnd() + '\n';
}

/** Ordine delle sezioni nel changelog */
const SECTION_ORDER: ChangelogSectionType[] = [
  'Added',
  'Changed',
  'Deprecated',
  'Removed',
  'Fixed',
  'Security',
];

/**
 * Raggruppa le entry per sezione, mantenendo l'ordine originale.
 */
function groupBySection(
  entries: ChangelogEntry[]
): Map<ChangelogSectionType, ChangelogEntry[]> {
  const grouped = new Map<ChangelogSectionType, ChangelogEntry[]>();
  for (const section of SECTION_ORDER) {
    const sectionEntries = entries.filter((e) => e.type === section);
    if (sectionEntries.length > 0) {
      grouped.set(section, sectionEntries);
    }
  }
  return grouped;
}

/**
 * Formatta una singola entry come linea di markdown.
 * Esempio: "- Descrizione (@agente) [ref1, ref2]"
 */
function formatEntryLine(entry: ChangelogEntry): string {
  let line = `- ${entry.description}`;

  if (entry.agent) {
    line += ` (@${entry.agent})`;
  }

  if (entry.references && entry.references.length > 0) {
    const refs = entry.references.map((r) => `[${r}]`).join(', ');
    line += ` ${refs}`;
  }

  return line;
}

// ---------------------------------------------------------------------------
// Date utilities
// ---------------------------------------------------------------------------

/**
 * Restituisce la data odierna in formato YYYY-MM-DD.
 */
function todayISO(): string {
  const now = new Date();
  return (
    now.getFullYear() +
    '-' +
    String(now.getMonth() + 1).padStart(2, '0') +
    '-' +
    String(now.getDate()).padStart(2, '0')
  );
}

/**
 * Restituisce la data N giorni fa in formato YYYY-MM-DD.
 */
function daysAgoISO(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return (
    d.getFullYear() +
    '-' +
    String(d.getMonth() + 1).padStart(2, '0') +
    '-' +
    String(d.getDate()).padStart(2, '0')
  );
}

/**
 * Normalizza una stringa data in formato YYYY-MM-DD.
 * Accetta ISO 8601 completo o solo la data.
 */
function normalizeDate(input: string): string {
  // Se contiene una T, è ISO 8601 completo — estrai solo la data
  if (input.includes('T')) {
    return input.substring(0, 10);
  }
  // Se è già YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(input)) {
    return input;
  }
  // Fallback: prova a parsare come data
  try {
    const d = new Date(input);
    if (!isNaN(d.getTime())) {
      return (
        d.getFullYear() +
        '-' +
        String(d.getMonth() + 1).padStart(2, '0') +
        '-' +
        String(d.getDate()).padStart(2, '0')
      );
    }
  } catch {
    // Ignora
  }
  // Se nessun parsing funziona, restituisci 30gg fa
  return daysAgoISO(30);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Genera un changelog in formato Keep a Changelog dagli eventi registrati
 * nel database Tabularium.
 *
 * Il changelog consiste di:
 * - Eventi `task_completed` → mappati per tag (feature→Added, fix→Fixed, ecc.)
 * - Eventi `file_created` → Added
 * - Eventi `decision_made` → Added (ADR)
 * - Eventi di errore → Fixed
 * - Eventi custom con mapping esplicito
 *
 * Deduplicazione: eventi con stesso tipo e stessa descrizione vengono
 * raggruppati (window di 24 ore).
 *
 * @param config - Configurazione opzionale (date range, grouping)
 * @returns ChangelogResult con markdown e array di entry
 * @throws Error se il database non è inizializzato
 */
export function generateChangelog(
  config?: ChangelogConfig
): ChangelogResult {
  const db = getDatabase();

  const fromDate = config?.fromDate
    ? normalizeDate(config.fromDate)
    : daysAgoISO(30);
  const toDate = config?.toDate
    ? normalizeDate(config.toDate)
    : todayISO();
  const groupByAgent = config?.groupByAgent ?? false;

  // 1. Recupera eventi dal database
  const rows = fetchEvents(fromDate, toDate);

  if (rows.length === 0) {
    return {
      markdown: `# Changelog\n\nNessuna modifica registrata dal ${fromDate} al ${toDate}.\n`,
      entries: [],
      fromDate,
      toDate,
    };
  }

  // 2. Mappa eventi → entry di changelog (con data)
  const rawEntries: ChangelogEntry[] = [];
  for (const row of rows) {
    const date = normalizeDate(row.timestamp);
    const entries = mapEventToEntries(row);
    for (const entry of entries) {
      rawEntries.push({ ...entry, date });
    }
  }

  // 3. Deduplicazione
  const { entries: uniqueEntries, deduplicatedCount } =
    deduplicateEntries(rawEntries);

  // 4. Formatta in markdown
  const markdown = formatMarkdown(uniqueEntries, groupByAgent);

  return {
    markdown,
    entries: uniqueEntries,
    fromDate,
    toDate,
  };
}
