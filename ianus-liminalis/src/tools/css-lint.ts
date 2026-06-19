/**
 * fs_css_lint — Ianus Liminalis
 *
 * Validazione base di file CSS: syntax check, vendor prefix detection,
 * unità obsolete, selettori duplicati.
 */

import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { readFile } from 'node:fs/promises';
import { resolveSafePath } from '../core/path-utils.js';
import { logToJournal } from '../core/journal-logger.js';
import { stats as serverStats } from '../core/stats.js';
import { toolRegistry } from './registry.js';
import type { ToolDeps } from './types.js';

// ────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────

interface CssIssue {
  line: number;
  column: number;
  type: 'error' | 'warning' | 'info';
  rule: string;
  message: string;
}

interface CssLintResult {
  path: string;
  valid: boolean;
  issues: CssIssue[];
  totalIssues: number;
}

type CssCheck = 'syntax' | 'vendor' | 'units' | 'duplicates';

const ALL_CHECKS: CssCheck[] = ['syntax', 'vendor', 'units', 'duplicates'];

// ────────────────────────────────────────────────────────────
// Vendor prefixes che possono essere sostituiti da standard
// ────────────────────────────────────────────────────────────

const VENDOR_PREFIX_MAP: Record<string, string[]> = {
  '-webkit-': [
    'animation', 'appearance', 'backdrop-filter', 'background-clip',
    'border-image', 'border-radius', 'box-shadow', 'box-sizing',
    'column-count', 'column-gap', 'filter', 'flex', 'flex-basis',
    'flex-direction', 'flex-flow', 'flex-grow', 'flex-shrink',
    'flex-wrap', 'font-smoothing', 'hyphens', 'justify-content',
    'keyframes', 'line-clamp', 'mask', 'mask-image', 'mask-size',
    'opacity', 'order', 'outline', 'overflow-scrolling', 'perspective',
    'reflection', 'scrollbar', 'text-combine-upright', 'text-decoration',
    'text-emphasis', 'text-orientation', 'text-size-adjust',
    'transform', 'transform-origin', 'transform-style',
    'transition', 'user-modify', 'user-select', 'writing-mode',
  ],
  '-moz-': [
    'appearance', 'background-clip', 'border-image', 'border-radius',
    'box-shadow', 'box-sizing', 'column-count', 'column-gap',
    'filter', 'flex', 'flex-basis', 'flex-direction', 'flex-flow',
    'flex-grow', 'flex-shrink', 'flex-wrap', 'font-feature-settings',
    'font-smoothing', 'hyphens', 'keyframes', 'mask', 'opacity',
    'order', 'outline', 'perspective', 'scrollbar', 'tab-size',
    'text-decoration', 'text-size-adjust', 'transform',
    'transform-origin', 'transform-style', 'transition',
    'user-select',
  ],
  '-ms-': [
    'align-content', 'align-items', 'align-self', 'animation',
    'backface-visibility', 'background-clip', 'background-origin',
    'background-size', 'border-image', 'border-radius', 'box-shadow',
    'box-sizing', 'column-count', 'column-gap', 'display',
    'flex', 'flex-basis', 'flex-direction', 'flex-flow',
    'flex-grow', 'flex-shrink', 'flex-wrap', 'font-feature-settings',
    'hyphens', 'justify-content', 'keyframes', 'order',
    'perspective', 'scrollbar', 'scroll-snap-points-x',
    'scroll-snap-points-y', 'scroll-snap-type', 'text-size-adjust',
    'transform', 'transform-origin', 'transform-style',
    'transition', 'user-select', 'writing-mode',
  ],
  '-o-': [
    'animation', 'border-image', 'column-count', 'column-gap',
    'filter', 'flex', 'keyframes', 'object-fit', 'object-position',
    'opacity', 'order', 'perspective', 'tab-size',
    'text-decoration', 'text-overflow', 'transform',
    'transform-origin', 'transform-style', 'transition',
  ],
};

// ────────────────────────────────────────────────────────────
// Unità obsolete
// ────────────────────────────────────────────────────────────

const OBSOLETE_UNITS = [
  { unit: 'pt', reason: 'pt è un\'unità tipografica per stampa; preferisci px o rem per schermo' },
  { unit: 'ex', reason: 'ex è raramente supportata consistentemente; preferisci em o rem' },
  { unit: 'cm', reason: 'cm è un\'unità fisica per stampa; preferisci px o rem per web' },
  { unit: 'mm', reason: 'mm è un\'unità fisica per stampa; preferisci px o rem per web' },
  { unit: 'pc', reason: 'pc è un\'unità tipografica obsoleta; preferisci px o rem' },
  { unit: 'in', reason: 'in è un\'unità fisica per stampa; preferisci px o rem per web' },
];

// ────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────

/**
 * Analizza le righe di un file CSS e restituisce le issue trovate.
 */
function analyzeCss(
  lines: string[],
  checks: Set<CssCheck>,
): CssIssue[] {
  const issues: CssIssue[] = [];
  const selectorStack: string[] = [];
  let braceDepth = 0;
  let inSelector = true;
  let currentSelector = '';

  // Per rilevare selettori duplicati
  const selectorLines: Map<string, number[]> = new Map();

  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1;
    const rawLine = lines[i];
    const line = rawLine.trim();

    // Salta linee vuote e commenti
    if (!line || line.startsWith('/*') || line.startsWith('*') || line.endsWith('*/')) {
      continue;
    }

    // ── SYNTAX CHECKS ──
    if (checks.has('syntax')) {
      // Controlla parentesi graffe
      for (let col = 0; col < line.length; col++) {
        const ch = line[col];
        if (ch === '{') {
          braceDepth++;
          if (inSelector) {
            inSelector = false;
            // Il selettore è ciò che precede {
            currentSelector = line.substring(0, col).trim();
            if (currentSelector) {
              const existing = selectorLines.get(currentSelector) || [];
              existing.push(lineNum);
              selectorLines.set(currentSelector, existing);
            }
          }
        } else if (ch === '}') {
          braceDepth--;
          if (braceDepth < 0) {
            issues.push({
              line: lineNum,
              column: col + 1,
              type: 'error',
              rule: 'syntax',
              message: `Chiusura graffa senza apertura corrispondente`,
            });
            braceDepth = 0;
          }
          inSelector = true;
          currentSelector = '';
        }
      }

      // Controlla dichiarazioni senza :
      if (!inSelector && line.includes(':') && !line.startsWith('/*')) {
        const colonIdx = line.indexOf(':');
        // Salta pseudo-selectori e regole @
        if (colonIdx > 0 && !line.startsWith('@') && !line.startsWith('--')) {
          // Non è un errore, ma controlliamo il formato property: value
        }
      }

      // Controlla dichiarazioni senza ; alla fine (dentro un blocco)
      if (!inSelector && braceDepth > 0 && !line.endsWith(';') && !line.endsWith('}') && !line.endsWith('{') && !line.startsWith('/*') && !line.startsWith('@') && !line.startsWith('//')) {
        // Potrebbe essere un warning se la riga non è vuota
        if (line.length > 0 && !line.endsWith(';') && !line.endsWith(',') && !line.endsWith('/*')) {
          issues.push({
            line: lineNum,
            column: line.length,
            type: 'warning',
            rule: 'syntax',
            message: `Dichiarazione senza punto e virgola finale`,
          });
        }
      }
    }

    // ── VENDOR PREFIX CHECKS ──
    if (checks.has('vendor')) {
      for (const [prefix, properties] of Object.entries(VENDOR_PREFIX_MAP)) {
        const vendorRegex = new RegExp(`\\t*${prefix}([a-z-]+)\\s*:`, 'gi');
        let match: RegExpExecArray | null;
        while ((match = vendorRegex.exec(line)) !== null) {
          const propName = match[1].toLowerCase();
          const stdVersion = properties.find((p) => p === propName);
          if (stdVersion) {
            issues.push({
              line: lineNum,
              column: match.index + 1,
              type: 'warning',
              rule: 'vendor',
              message: `Prefisso vendor ${prefix} per "${propName}" — può essere sostituito dalla proprietà standard "${propName}"`,
            });
          } else {
            issues.push({
              line: lineNum,
              column: match.index + 1,
              type: 'info',
              rule: 'vendor',
              message: `Prefisso vendor ${prefix} per "${propName}" — verifica se esiste equivalente standard`,
            });
          }
        }
      }
    }

    // ── UNITS CHECKS ──
    if (checks.has('units')) {
      for (const { unit, reason } of OBSOLETE_UNITS) {
        // Cerca valori come 12pt, 1.5cm, ecc. ma non dentro stringhe/commenti
        const unitRegex = new RegExp(`\\b(\\d+(?:\\.\\d+)?)${unit}\\b`, 'g');
        let match: RegExpExecArray | null;
        while ((match = unitRegex.exec(line)) !== null) {
          issues.push({
            line: lineNum,
            column: match.index + 1,
            type: 'warning',
            rule: 'units',
            message: `Unità "${unit}" (${reason})`,
          });
        }
      }
    }
  }

  // ── DUPLICATE SELECTOR CHECKS ──
  if (checks.has('duplicates')) {
    for (const [selector, lineNumbers] of selectorLines.entries()) {
      if (lineNumbers.length > 1) {
        issues.push({
          line: lineNumbers[1], // segnala sulla seconda occorrenza
          column: 1,
          type: 'warning',
          rule: 'duplicates',
          message: `Selettore duplicato "${selector}" trovato anche alla riga ${lineNumbers[0]}`,
        });
      }
    }
  }

  return issues;
}

// ────────────────────────────────────────────────────────────
// Tool Registration
// ────────────────────────────────────────────────────────────

export function registerCssLint(_server: Server, deps: ToolDeps): void {
  toolRegistry.register({
    name: 'fs_css_lint',
    description:
      'Validate CSS files for syntax errors, vendor prefix usage, obsolete units, and duplicate selectors. ' +
      'Supports selective check execution via the "checks" parameter.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to the CSS file to validate (required)',
        },
        checks: {
          type: 'array',
          items: {
            type: 'string',
            enum: ['syntax', 'vendor', 'units', 'duplicates'],
          },
          description: 'Specific checks to run: syntax, vendor, units, duplicates (default: all)',
        },
        agent: {
          type: 'string',
          description: 'Nome dell agente chiamante (opzionale, default: "ianus")',
        },
      },
      required: ['path'],
    },
    handler: async (args) => {
      const cssPath = args.path as string | undefined;
      if (!cssPath) {
        return {
          content: [{ type: 'text', text: 'Missing required parameter: "path"' }],
          isError: true,
        };
      }

      const rawChecks = args.checks as string[] | undefined;
      const activeChecks: Set<CssCheck> = new Set(
        rawChecks && rawChecks.length > 0
          ? rawChecks.filter((c): c is CssCheck => ALL_CHECKS.includes(c as CssCheck))
          : ALL_CHECKS,
      );

      const callerAgent = (args.agent as string) || 'ianus';

      // Permission check
      const permCheck = await deps.permission.checkOperation(
        callerAgent,
        'read',
        cssPath,
        deps.workspaceRoot,
      );
      if (!permCheck.allowed) {
        return {
          content: [{ type: 'text', text: `Permission denied: ${permCheck.reason}` }],
          isError: true,
        };
      }

      try {
        const safePath = resolveSafePath(cssPath, deps.workspaceRoot);

        // Verifica estensione
        if (!safePath.endsWith('.css')) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  path: cssPath,
                  valid: false,
                  issues: [
                    {
                      line: 0,
                      column: 0,
                      type: 'error',
                      rule: 'syntax',
                      message: `Il file "${cssPath}" non ha estensione .css`,
                    },
                  ],
                  totalIssues: 1,
                } as CssLintResult),
              },
            ],
          };
        }

        const content = await readFile(safePath, 'utf-8');
        const lines = content.split('\n');

        const issues = analyzeCss(lines, activeChecks);

        const result: CssLintResult = {
          path: cssPath,
          valid: issues.length === 0,
          issues,
          totalIssues: issues.length,
        };

        // Log to journal
        await logToJournal(deps.workspaceRoot, {
          agent: 'ianus',
          operation: 'css_lint',
          path: cssPath,
          details: {
            totalIssues: issues.length,
            checks: Array.from(activeChecks),
          },
        });

        serverStats.increment();

        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        return {
          content: [
            {
              type: 'text',
              text: `Error linting CSS file: ${(err as Error).message}`,
            },
          ],
          isError: true,
        };
      }
    },
  });
}
