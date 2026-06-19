/**
 * fs_html_lint — Ianus Liminalis
 *
 * Validazione base di file HTML: struttura documento, attributi accessibilità,
 * tags semantici, meta tags essenziali.
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

interface HtmlIssue {
  line: number;
  column: number;
  type: 'error' | 'warning' | 'info';
  rule: string;
  message: string;
  suggestion?: string;
}

interface HtmlLintResult {
  path: string;
  valid: boolean;
  issues: HtmlIssue[];
  totalIssues: number;
}

type HtmlCheck = 'structure' | 'a11y' | 'semantic' | 'meta';

const ALL_CHECKS: HtmlCheck[] = ['structure', 'a11y', 'semantic', 'meta'];

// ────────────────────────────────────────────────────────────
// Tag mapping: semantic tags e loro ruoli
// ────────────────────────────────────────────────────────────

const SEMANTIC_TAGS = new Set([
  'nav', 'main', 'section', 'article', 'header', 'footer', 'aside',
  'figure', 'figcaption', 'mark', 'time', 'details', 'summary',
  'dialog', 'progress', 'meter', 'address',
]);

const ROLE_ATTRS = new Set([
  'banner', 'navigation', 'main', 'complementary', 'contentinfo',
  'region', 'form', 'search', 'alert', 'dialog', 'tablist',
  'tabpanel', 'tree', 'grid', 'listbox', 'menubar',
]);

// ────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────

/**
 * Trova tutti i tag HTML aperti in una riga.
 * restituisce array di { tag, attrs, colStart, colEnd, isClosing, isSelfClosing }
 */
function findTags(line: string): Array<{
  tag: string;
  attrs: string;
  colStart: number;
  colEnd: number;
  isClosing: boolean;
  isSelfClosing: boolean;
}> {
  const tags: Array<{
    tag: string;
    attrs: string;
    colStart: number;
    colEnd: number;
    isClosing: boolean;
    isSelfClosing: boolean;
  }> = [];

  // Pattern per tag HTML: <tagname ...> oppure </tagname> oppure <tagname ... />
  const tagRegex = /<\/?([a-zA-Z][a-zA-Z0-9]*)\b([^>]*?)(\/?\s*>)/g;
  let match: RegExpExecArray | null;

  while ((match = tagRegex.exec(line)) !== null) {
    const fullMatch = match[0];
    const tagName = match[1].toLowerCase();
    const attrs = match[2].trim();
    const isClosing = fullMatch.startsWith('</');
    const isSelfClosing = fullMatch.endsWith('/>') || fullMatch.endsWith(' />');
    const colStart = match.index + 1;
    const colEnd = match.index + fullMatch.length;

    tags.push({
      tag: tagName,
      attrs,
      colStart,
      colEnd,
      isClosing,
      isSelfClosing,
    });
  }

  return tags;
}

/**
 * Estrae un attributo dal testo degli attributi di un tag.
 */
function getAttrValue(attrs: string, attrName: string): string | null {
  const regex = new RegExp(`${attrName}\\s*=\\s*"([^"]*)"`, 'i');
  const match = regex.exec(attrs);
  return match ? match[1] : null;
}

/**
 * Verifica se un attributo esiste (booleano o con valore).
 */
function hasAttr(attrs: string, attrName: string): boolean {
  const regex = new RegExp(`\\b${attrName}(\\s*=\\s*["']|\\b)`, 'i');
  return regex.test(attrs);
}

// ────────────────────────────────────────────────────────────
// Analyzer
// ────────────────────────────────────────────────────────────

function analyzeHtml(
  content: string,
  checks: Set<HtmlCheck>,
): HtmlIssue[] {
  const issues: HtmlIssue[] = [];
  const lines = content.split('\n');

  // Stato per struttura
  let hasHtml = false;
  let hasHead = false;
  let hasBody = false;
  let titleInHead = false;
  let hasCharset = false;
  let hasViewport = false;
  let hasDescription = false;

  // Stack per tag balance
  const tagStack: Array<{ tag: string; line: number }> = [];

  // Rilevamento div con classi navigazionali
  const NAV_CLASSES = /nav(igation)?|menu|sidebar|header|footer|main-content|toolbar/i;

  // Per ogni riga
  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1;
    const line = lines[i];

    // Trova tag in questa riga
    const tags = findTags(line);

    for (const t of tags) {
      const { tag, attrs, colStart, isClosing, isSelfClosing } = t;

      // ── STRUTTURA ──
      if (checks.has('structure')) {
        if (tag === 'html' && !isClosing) hasHtml = true;
        if (tag === 'head' && !isClosing) hasHead = true;
        if (tag === 'body' && !isClosing) hasBody = true;
        if (tag === 'title' && !isClosing && hasHead && !hasBody) {
          titleInHead = true;
        }

        // Tag balance tracking
        if (isClosing) {
          if (tagStack.length > 0 && tagStack[tagStack.length - 1].tag === tag) {
            tagStack.pop();
          } else if (!isSelfClosing && !['br', 'hr', 'img', 'input', 'meta', 'link', 'area', 'base', 'col', 'embed', 'source', 'track', 'wbr'].includes(tag)) {
            issues.push({
              line: lineNum,
              column: colStart,
              type: 'warning',
              rule: 'structure',
              message: `Tag di chiusura </${tag}> senza corrispondente apertura`,
              suggestion: `Verifica che <${tag}> sia aperto prima di questa riga`,
            });
          }
        } else if (!isSelfClosing && !['br', 'hr', 'img', 'input', 'meta', 'link', 'area', 'base', 'col', 'embed', 'source', 'track', 'wbr'].includes(tag)) {
          tagStack.push({ tag, line: lineNum });
        }
      }

      // ── A11Y ──
      if (checks.has('a11y')) {
        // <img> senza alt
        if (tag === 'img' && !isClosing) {
          const alt = getAttrValue(attrs, 'alt');
          if (alt === null) {
            issues.push({
              line: lineNum,
              column: colStart,
              type: 'error',
              rule: 'a11y',
              message: `<img> senza attributo "alt" — essenziale per screen reader`,
              suggestion: 'Aggiungi alt="descrizione" o alt="" se decorativa',
            });
          }
        }

        // <input> senza label associata
        if (tag === 'input' && !isClosing) {
          const id = getAttrValue(attrs, 'id');
          const ariaLabel = getAttrValue(attrs, 'aria-label');
          const ariaLabelledBy = getAttrValue(attrs, 'aria-labelledby');
          const type = getAttrValue(attrs, 'type');

          // hidden input non necessita di label
          if (type !== 'hidden' && !id && !ariaLabel && !ariaLabelledBy) {
            issues.push({
              line: lineNum,
              column: colStart,
              type: 'warning',
              rule: 'a11y',
              message: `<input> senza id, aria-label o aria-labelledby — difficile da associare a una label`,
              suggestion: 'Aggiungi un id per associarlo a <label for="..."> o usa aria-label',
            });
          }
        }

        // <select> e <textarea> senza label
        if ((tag === 'select' || tag === 'textarea') && !isClosing) {
          const id = getAttrValue(attrs, 'id');
          const ariaLabel = getAttrValue(attrs, 'aria-label');
          if (!id && !ariaLabel) {
            issues.push({
              line: lineNum,
              column: colStart,
              type: 'warning',
              rule: 'a11y',
              message: `<${tag}> senza id o aria-label — difficile da associare a una label`,
              suggestion: `Aggiungi un id per associarlo a <label for="..."> o usa aria-label`,
            });
          }
        }

        // <button> senza testo o aria-label
        if (tag === 'button' && !isClosing) {
          const ariaLabel = getAttrValue(attrs, 'aria-label');
          // Prendi il contenuto della riga dopo il tag button
          const afterTag = line.substring(line.indexOf('>', colStart - 1) + 1).trim();
          if (!ariaLabel && (!afterTag || afterTag.startsWith('</'))) {
            // Potrebbe avere contenuto su righe successive — segnaliamo solo se non c'è neppure aria-label
            if (!ariaLabel) {
              issues.push({
                line: lineNum,
                column: colStart,
                type: 'info',
                rule: 'a11y',
                message: `<button> senza aria-label — se il contenuto testuale è su un'altra riga, ignora questo avviso`,
              });
            }
          }
        }
      }

      // ── SEMANTIC ──
      if (checks.has('semantic')) {
        if (tag === 'div' && !isClosing) {
          const classAttr = getAttrValue(attrs, 'class');
          const idAttr = getAttrValue(attrs, 'id');
          const roleAttr = getAttrValue(attrs, 'role');

          // Suggerisci tag semantici in base a class/id
          const combined = `${classAttr || ''} ${idAttr || ''}`.toLowerCase();

          if (/\bnav\b/.test(combined) || /\bmenu\b/.test(combined)) {
            issues.push({
              line: lineNum,
              column: colStart,
              type: 'info',
              rule: 'semantic',
              message: `<div class="${classAttr}"> potrebbe essere sostituito da <nav>`,
              suggestion: 'Usa <nav> per blocchi di navigazione',
            });
          } else if (/\bmain\b/.test(combined) || /\bcontent\b/.test(combined)) {
            issues.push({
              line: lineNum,
              column: colStart,
              type: 'info',
              rule: 'semantic',
              message: `<div class="${classAttr}"> potrebbe essere sostituito da <main>`,
              suggestion: 'Usa <main> per il contenuto principale',
            });
          } else if (/\bsection\b/.test(combined)) {
            issues.push({
              line: lineNum,
              column: colStart,
              type: 'info',
              rule: 'semantic',
              message: `<div class="${classAttr}"> potrebbe essere sostituito da <section>`,
              suggestion: 'Usa <section> per sezioni di contenuto',
            });
          } else if (/\barticle\b/.test(combined) || /\bpost\b/.test(combined)) {
            issues.push({
              line: lineNum,
              column: colStart,
              type: 'info',
              rule: 'semantic',
              message: `<div class="${classAttr}"> potrebbe essere sostituito da <article>`,
              suggestion: 'Usa <article> per contenuti autonomi',
            });
          } else if (/\bheader\b/.test(combined)) {
            issues.push({
              line: lineNum,
              column: colStart,
              type: 'info',
              rule: 'semantic',
              message: `<div class="${classAttr}"> potrebbe essere sostituito da <header>`,
              suggestion: 'Usa <header> per intestazioni di pagina/sezione',
            });
          } else if (/\bfooter\b/.test(combined)) {
            issues.push({
              line: lineNum,
              column: colStart,
              type: 'info',
              rule: 'semantic',
              message: `<div class="${classAttr}"> potrebbe essere sostituito da <footer>`,
              suggestion: 'Usa <footer> per piè di pagina',
            });
          } else if (/\baside\b/.test(combined) || /\bsidebar\b/.test(combined)) {
            issues.push({
              line: lineNum,
              column: colStart,
              type: 'info',
              rule: 'semantic',
              message: `<div class="${classAttr}"> potrebbe essere sostituito da <aside>`,
              suggestion: 'Usa <aside> per contenuti complementari',
            });
          }
        }
      }

      // ── META ──
      if (checks.has('meta')) {
        if (tag === 'meta' && !isClosing) {
          const charset = getAttrValue(attrs, 'charset');
          const name = getAttrValue(attrs, 'name');
          const content = getAttrValue(attrs, 'content');

          if (charset && charset.toLowerCase() === 'utf-8') {
            hasCharset = true;
          }
          if (name === 'viewport') {
            hasViewport = true;
          }
          if (name === 'description') {
            hasDescription = true;
          }
        }
      }
    }
  }

  // ── STRUCTURE: Segnala elementi mancanti ──
  if (checks.has('structure')) {
    // Tag non chiusi
    if (tagStack.length > 0) {
      for (const openTag of tagStack) {
        issues.push({
          line: openTag.line,
          column: 1,
          type: 'error',
          rule: 'structure',
          message: `Tag <${openTag.tag}> aperto ma mai chiuso`,
          suggestion: `Aggiungi </${openTag.tag}> alla fine del contenuto`,
        });
      }
    }
  }

  // ── META: Segnala meta mancanti (alla fine, una volta sola) ──
  if (checks.has('meta')) {
    if (!hasCharset) {
      issues.push({
        line: 1,
        column: 1,
        type: 'error',
        rule: 'meta',
        message: 'Manca <meta charset="utf-8"> nel <head>',
        suggestion: 'Aggiungi <meta charset="utf-8"> come primo tag in <head>',
      });
    }
    if (!hasViewport) {
      issues.push({
        line: 1,
        column: 1,
        type: 'error',
        rule: 'meta',
        message: 'Manca <meta name="viewport" content="width=device-width, initial-scale=1">',
        suggestion: 'Aggiungi <meta name="viewport" ...> per responsive design',
      });
    }
    if (!hasDescription) {
      issues.push({
        line: 1,
        column: 1,
        type: 'warning',
        rule: 'meta',
        message: 'Manca <meta name="description"> — importante per SEO',
        suggestion: 'Aggiungi <meta name="description" content="..."> nel <head>',
      });
    }
  }

  return issues;
}

// ────────────────────────────────────────────────────────────
// Tool Registration
// ────────────────────────────────────────────────────────────

export function registerHtmlLint(_server: Server, deps: ToolDeps): void {
  toolRegistry.register({
    name: 'fs_html_lint',
    description:
      'Validate HTML files for document structure, accessibility attributes (a11y), ' +
      'semantic HTML usage, and essential meta tags. Supports selective check execution.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to the HTML file to validate (required)',
        },
        checks: {
          type: 'array',
          items: {
            type: 'string',
            enum: ['structure', 'a11y', 'semantic', 'meta'],
          },
          description: 'Specific checks to run: structure, a11y, semantic, meta (default: all)',
        },
        agent: {
          type: 'string',
          description: 'Nome dell agente chiamante (opzionale, default: "ianus")',
        },
      },
      required: ['path'],
    },
    handler: async (args) => {
      const htmlPath = args.path as string | undefined;
      if (!htmlPath) {
        return {
          content: [{ type: 'text', text: 'Missing required parameter: "path"' }],
          isError: true,
        };
      }

      const rawChecks = args.checks as string[] | undefined;
      const activeChecks: Set<HtmlCheck> = new Set(
        rawChecks && rawChecks.length > 0
          ? rawChecks.filter((c): c is HtmlCheck => ALL_CHECKS.includes(c as HtmlCheck))
          : ALL_CHECKS,
      );

      const callerAgent = (args.agent as string) || 'ianus';

      // Permission check
      const permCheck = await deps.permission.checkOperation(
        callerAgent,
        'read',
        htmlPath,
        deps.workspaceRoot,
      );
      if (!permCheck.allowed) {
        return {
          content: [{ type: 'text', text: `Permission denied: ${permCheck.reason}` }],
          isError: true,
        };
      }

      try {
        const safePath = resolveSafePath(htmlPath, deps.workspaceRoot);

        // Verifica estensione
        const ext = safePath.toLowerCase().match(/\.(html?|xhtml)$/);
        if (!ext) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  path: htmlPath,
                  valid: false,
                  issues: [
                    {
                      line: 0,
                      column: 0,
                      type: 'error',
                      rule: 'structure',
                      message: `Il file "${htmlPath}" non ha estensione .html o .xhtml`,
                    },
                  ],
                  totalIssues: 1,
                } as HtmlLintResult),
              },
            ],
          };
        }

        const content = await readFile(safePath, 'utf-8');
        const issues = analyzeHtml(content, activeChecks);

        const result: HtmlLintResult = {
          path: htmlPath,
          valid: issues.length === 0,
          issues,
          totalIssues: issues.length,
        };

        // Log to journal
        await logToJournal(deps.workspaceRoot, {
          agent: 'ianus',
          operation: 'html_lint',
          path: htmlPath,
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
              text: `Error linting HTML file: ${(err as Error).message}`,
            },
          ],
          isError: true,
        };
      }
    },
  });
}
