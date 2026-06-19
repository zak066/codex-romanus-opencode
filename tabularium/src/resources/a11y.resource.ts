/**
 * resources/a11y.resource.ts
 * Resource MCP per Accessibility Audit Trail.
 *
 * URI supportati:
 *   tabularium://a11y/checklist                              — tutti i criteri WCAG
 *   tabularium://a11y/checklist?category=perceivable         — filtrati per categoria
 *   tabularium://a11y/history?component=Button               — cronologia audit per componente
 *   tabularium://a11y/components                             — lista componenti auditatati
 *
 * @module resources/a11y
 */

import type { ResourceContent, ResourceHandler } from '../types/mcp.js';
import {
  getChecklist,
  getAuditHistory,
  getAllAuditedComponents,
} from '../core/a11y-auditor.js';

// ---------------------------------------------------------------------------
//  Costanti URI
// ---------------------------------------------------------------------------

const BASE_URI = 'tabularium://a11y';

// ---------------------------------------------------------------------------
//  URI Patterns
// ---------------------------------------------------------------------------

const URI_PATTERNS = [
  { pattern: /^tabularium:\/\/a11y\/checklist\?(.+)$/, handler: 'checklistFiltered' },
  { pattern: /^tabularium:\/\/a11y\/checklist$/, handler: 'checklistAll' },
  { pattern: /^tabularium:\/\/a11y\/history\?(.+)$/, handler: 'history' },
  { pattern: /^tabularium:\/\/a11y\/components$/, handler: 'components' },
];

// ---------------------------------------------------------------------------
//  Resource Handler registrato
// ---------------------------------------------------------------------------

export const a11yResourceHandler: ResourceHandler = {
  uri: BASE_URI + '/checklist',
  name: 'Accessibility Audit Trail',
  description:
    'Checklist WCAG e storico audit per componente. ' +
    'Filtrabile per categoria o consultabile per componente via query string.',
  mimeType: 'application/json',

  handler: async (): Promise<ResourceContent[]> => {
    const checklist = getChecklist();
    const components = getAllAuditedComponents();

    return [
      {
        uri: `${BASE_URI}/checklist`,
        mimeType: 'application/json',
        text: JSON.stringify(
          {
            checklist,
            total: checklist.length,
            hint: 'Usa ?category=perceivable per filtrare, o /history?component=Nome per audit',
          },
          null,
          2,
        ),
      },
      {
        uri: `${BASE_URI}/components`,
        mimeType: 'application/json',
        text: JSON.stringify({ components, total: components.length }),
      },
    ];
  },
};

// ---------------------------------------------------------------------------
//  URI Resolution (chiamato da resolveResource)
// ---------------------------------------------------------------------------

/**
 * Risolve un URI specifico a11y e restituisce i contenuti.
 * Chiamato dal router centrale quando un URI inizia con tabularium://a11y.
 *
 * @param uri - URI completo da risolvere
 * @returns Array di ResourceContent
 */
export async function resolveA11yUri(uri: string): Promise<ResourceContent[]> {
  for (const { pattern, handler } of URI_PATTERNS) {
    const match = uri.match(pattern);
    if (!match) continue;

    switch (handler) {
      case 'checklistFiltered':
        return handleChecklistFiltered(match[1]);
      case 'checklistAll':
        return handleChecklistAll();
      case 'history':
        return handleHistory(match[1]);
      case 'components':
        return handleComponents();
    }
  }

  // Fallback: panoramica
  return a11yResourceHandler.handler();
}

// ---------------------------------------------------------------------------
//  Handler interni
// ---------------------------------------------------------------------------

/**
 * Gestisce: tabularium://a11y/checklist?category=...
 */
function handleChecklistFiltered(queryString: string): ResourceContent[] {
  const params = parseQueryString(queryString);
  const category = params.category as string | undefined;

  const checklist = getChecklist(category);

  return [
    {
      uri: `tabularium://a11y/checklist?${queryString}`,
      mimeType: 'application/json',
      text: JSON.stringify(
        {
          checklist,
          total: checklist.length,
          filters: { category: category ?? 'all' },
        },
        null,
        2,
      ),
    },
  ];
}

/**
 * Gestisce: tabularium://a11y/checklist
 */
function handleChecklistAll(): ResourceContent[] {
  const checklist = getChecklist();

  return [
    {
      uri: 'tabularium://a11y/checklist',
      mimeType: 'application/json',
      text: JSON.stringify({ checklist, total: checklist.length }, null, 2),
    },
  ];
}

/**
 * Gestisce: tabularium://a11y/history?component=...
 */
function handleHistory(queryString: string): ResourceContent[] {
  const params = parseQueryString(queryString);
  const component = params.component as string | undefined;

  if (!component) {
    return [
      {
        uri: `tabularium://a11y/history?${queryString}`,
        mimeType: 'application/json',
        text: JSON.stringify({ error: 'Parametro "component" obbligatorio' }),
      },
    ];
  }

  const history = getAuditHistory(component);

  return [
    {
      uri: `tabularium://a11y/history?component=${encodeURIComponent(component)}`,
      mimeType: 'application/json',
      text: JSON.stringify({ history }, null, 2),
    },
  ];
}

/**
 * Gestisce: tabularium://a11y/components
 */
function handleComponents(): ResourceContent[] {
  const components = getAllAuditedComponents();

  return [
    {
      uri: 'tabularium://a11y/components',
      mimeType: 'application/json',
      text: JSON.stringify({ components, total: components.length }, null, 2),
    },
  ];
}

// ---------------------------------------------------------------------------
//  Utility
// ---------------------------------------------------------------------------

/**
 * Parser semplice di query string.
 * Converte "category=perceivable" in { category: 'perceivable' }
 */
function parseQueryString(queryString: string): Record<string, string> {
  const params: Record<string, string> = {};
  if (!queryString) return params;

  const qs = queryString.startsWith('?') ? queryString.substring(1) : queryString;

  for (const part of qs.split('&')) {
    const [key, value] = part.split('=');
    if (key && value) {
      try {
        params[decodeURIComponent(key)] = decodeURIComponent(value);
      } catch {
        params[key] = value;
      }
    }
  }

  return params;
}
