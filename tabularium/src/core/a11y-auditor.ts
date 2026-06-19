/**
 * core/a11y-auditor.ts
 * Accessibility Audit Trail — checklist WCAG + storico audit per componente.
 *
 * Pattern: sync, dati in memoria (array). Niente DB.
 * I dati sono persi al riavvio (accettabile per ora).
 *
 * @module core/a11y-auditor
 */

// ──────────────────────────────────────────────
//  Tipi
// ──────────────────────────────────────────────

export interface A11yChecklistItem {
  id: string;
  criterion: string; // es. "1.1.1 Non-text Content"
  level: 'A' | 'AA' | 'AAA';
  description: string;
  category: 'perceivable' | 'operable' | 'understandable' | 'robust';
}

export interface A11yAuditEntry {
  component: string;
  checkedAt: string;
  passed: boolean;
  failures: string[]; // checklist item IDs
  notes?: string;
}

export interface A11yHistory {
  component: string;
  audits: A11yAuditEntry[];
  latestScore: number; // % passati
}

// ──────────────────────────────────────────────
//  Checklist WCAG predefinita (10 criteri essenziali)
// ──────────────────────────────────────────────

const WCAG_CHECKLIST: A11yChecklistItem[] = [
  {
    id: '1.1.1',
    criterion: 'Non-text Content',
    level: 'A',
    description: 'Tutte le immagini hanno alt text',
    category: 'perceivable',
  },
  {
    id: '1.4.3',
    criterion: 'Contrast (Minimum)',
    level: 'AA',
    description: 'Contrasto testo ≥ 4.5:1',
    category: 'perceivable',
  },
  {
    id: '2.1.1',
    criterion: 'Keyboard',
    level: 'A',
    description: 'Tutte le funzionalità da tastiera',
    category: 'operable',
  },
  {
    id: '2.4.1',
    criterion: 'Bypass Blocks',
    level: 'A',
    description: 'Skip navigation presente',
    category: 'operable',
  },
  {
    id: '2.4.4',
    criterion: 'Link Purpose (In Context)',
    level: 'A',
    description: 'Link con testo descrittivo',
    category: 'operable',
  },
  {
    id: '2.4.6',
    criterion: 'Headings and Labels',
    level: 'AA',
    description: 'Heading e label descrittivi',
    category: 'operable',
  },
  {
    id: '3.1.1',
    criterion: 'Language of Page',
    level: 'A',
    description: 'Attributo lang definito',
    category: 'understandable',
  },
  {
    id: '3.2.2',
    criterion: 'On Input',
    level: 'A',
    description: 'Cambiamenti contesto prevedibili',
    category: 'understandable',
  },
  {
    id: '3.3.2',
    criterion: 'Labels or Instructions',
    level: 'A',
    description: 'Label per tutti gli input',
    category: 'understandable',
  },
  {
    id: '4.1.2',
    criterion: 'Name, Role, Value',
    level: 'A',
    description: 'Elementi custom hanno ruoli ARIA',
    category: 'robust',
  },
];

// ──────────────────────────────────────────────
//  Stato in memoria (volatile)
// ──────────────────────────────────────────────

/** Mappa componente → lista audit registrati */
const auditStore: Map<string, A11yAuditEntry[]> = new Map();

// ──────────────────────────────────────────────
//  Public API
// ──────────────────────────────────────────────

/**
 * Restituisce la checklist WCAG, opzionalmente filtrata per categoria.
 *
 * @param category - Categoria per filtrare (opzionale)
 * @returns Array di A11yChecklistItem
 */
export function getChecklist(category?: string): A11yChecklistItem[] {
  if (!category) return [...WCAG_CHECKLIST];
  return WCAG_CHECKLIST.filter((item) => item.category === category);
}

/**
 * Registra un audit per un componente.
 *
 * @param component - Nome del componente (es. "Button", "Card")
 * @param passed    - true se tutti i criteri sono soddisfatti
 * @param failures  - Array di ID dei criteri falliti
 * @param notes     - Note opzionali sull'audit
 */
export function recordAudit(
  component: string,
  passed: boolean,
  failures: string[],
  notes?: string,
): void {
  const entry: A11yAuditEntry = {
    component,
    checkedAt: new Date().toISOString(),
    passed,
    failures,
    notes,
  };

  const existing = auditStore.get(component) ?? [];
  existing.push(entry);
  auditStore.set(component, existing);
}

/**
 * Restituisce la cronologia audit per un componente.
 *
 * @param component - Nome del componente
 * @returns A11yHistory con audit, score calcolato
 */
export function getAuditHistory(component: string): A11yHistory {
  const audits = auditStore.get(component) ?? [];

  if (audits.length === 0) {
    return {
      component,
      audits: [],
      latestScore: 0,
    };
  }

  const latestAudit = audits[audits.length - 1];
  const totalCriteria = WCAG_CHECKLIST.length;
  const passedCount = totalCriteria - latestAudit.failures.length;
  const latestScore = Math.round((passedCount / totalCriteria) * 100);

  return {
    component,
    audits: [...audits],
    latestScore,
  };
}

/**
 * Restituisce la lista di tutti i componenti con almeno un audit registrato.
 */
export function getAllAuditedComponents(): string[] {
  return Array.from(auditStore.keys());
}
