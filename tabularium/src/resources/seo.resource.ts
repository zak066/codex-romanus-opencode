/**
 * resources/seo.resource.ts
 * Resource MCP per SEO: sitemap e structured data JSON-LD.
 * URI: tabularium://seo/{type}?parametri
 *
 * Endpoint supportati:
 *   - tabularium://seo/sitemap?baseUrl=...&paths=["/","/about"]
 *   - tabularium://seo/breadcrumb?name=Home&url=/&name=Products&url=/products
 *   - tabularium://seo/organization?name=...&url=...&logo=...
 *
 * @module resources/seo
 */

import type { ResourceContent, ResourceHandler } from '../types/mcp.js';
import {
  generateSitemap,
  generateBreadcrumbJsonLd,
  generateOrganizationJsonLd,
  validateStructuredData,
} from '../core/seo-builder.js';

// ---------------------------------------------------------------------------
// Costanti
// ---------------------------------------------------------------------------

const BASE_URI = 'tabularium://seo';

// Pattern: tabularium://seo/{type}[?param=value&...]
const URI_PATTERN = /^tabularium:\/\/seo\/([a-z]+)(?:\?(.+))?$/;

// ---------------------------------------------------------------------------
// Resource Handler
// ---------------------------------------------------------------------------

/**
 * Resource handler per SEO.
 * Risponde a tabularium://seo/{type} con parametri variabili.
 */
export const seoResourceHandler: ResourceHandler = {
  uri: BASE_URI,
  name: 'SEO Builder',
  description:
    'Risorse SEO: sitemap XML, BreadcrumbList JSON-LD, Organization JSON-LD, validazione structured data.',
  mimeType: 'application/json',

  handler: async (): Promise<ResourceContent[]> => {
    return [
      {
        uri: `${BASE_URI}/help`,
        mimeType: 'application/json',
        text: JSON.stringify(
          {
            description: 'SEO Builder resources for search engine optimization',
            endpoints: [
              {
                uri: `${BASE_URI}/sitemap?baseUrl=...&paths=[...]`,
                description:
                  'Genera sitemap.xml. baseUrl (string) e paths (JSON array di stringhe) sono obbligatori.',
                example:
                  'tabularium://seo/sitemap?baseUrl=https://example.com&paths=%5B%22/%22,%22/about%22%5D',
              },
              {
                uri: `${BASE_URI}/breadcrumb?name=...&url=...`,
                description:
                  'Genera BreadcrumbList JSON-LD. Ripetere name e url per ogni livello della breadcrumb.',
                example:
                  'tabularium://seo/breadcrumb?name=Home&url=https://example.com/&name=Prodotti&url=https://example.com/prodotti',
              },
              {
                uri: `${BASE_URI}/organization?name=...&url=...&logo=...`,
                description:
                  'Genera Organization JSON-LD. name e url obbligatori, logo opzionale.',
                example:
                  'tabularium://seo/organization?name=Codex+Romanus&url=https://codex-romanus.app&logo=https://codex-romanus.app/logo.png',
              },
              {
                uri: `${BASE_URI}/validate?jsonLd=...`,
                description:
                  'Valida un JSON-LD (URL encoded). Verifica @context, @type e sintassi JSON.',
              },
            ],
          },
          null,
          2
        ),
      },
    ];
  },
};

// ---------------------------------------------------------------------------
// URI Resolution
// ---------------------------------------------------------------------------

/**
 * Risolve un URI specifico di SEO e restituisce i contenuti.
 * Chiamato dal router centrale quando l'URI inizia con tabularium://seo.
 *
 * @param uri - URI completo da risolvere
 * @returns Array di ResourceContent
 */
export async function resolveSeoUri(uri: string): Promise<ResourceContent[]> {
  const match = uri.match(URI_PATTERN);
  if (!match) {
    // URI non riconosciuto, restituisci help
    return seoResourceHandler.handler();
  }

  const type = match[1];
  const queryString = match[2] ?? '';

  // Parsing parametri con supporto multi-valore
  const params = parseMultiValueQueryString(queryString);

  switch (type) {
    case 'sitemap':
      return handleSitemapRequest(uri, params);
    case 'breadcrumb':
      return handleBreadcrumbRequest(uri, params);
    case 'organization':
      return handleOrganizationRequest(uri, params);
    case 'validate':
      return handleValidateRequest(uri, params);
    default:
      return [
        {
          uri,
          mimeType: 'application/json',
          text: JSON.stringify({
            error: `Unknown SEO resource type: "${type}". Supported types: sitemap, breadcrumb, organization, validate`,
          }),
        },
      ];
  }
}

// ---------------------------------------------------------------------------
// Request Handlers
// ---------------------------------------------------------------------------

/**
 * Gestisce la richiesta di generazione sitemap.
 * Parametri: baseUrl (string), paths (JSON array string)
 */
async function handleSitemapRequest(
  uri: string,
  params: Map<string, string[]>
): Promise<ResourceContent[]> {
  const baseUrl = params.get('baseUrl')?.[0];
  const pathsRaw = params.get('paths')?.[0];

  const errors: string[] = [];
  if (!baseUrl) {
    errors.push('Missing required parameter: baseUrl');
  }
  if (!pathsRaw) {
    errors.push('Missing required parameter: paths (JSON array of strings)');
  }

  if (errors.length > 0) {
    return [
      {
        uri,
        mimeType: 'application/json',
        text: JSON.stringify({ valid: false, errors }),
      },
    ];
  }

  let paths: string[];
  try {
    paths = JSON.parse(pathsRaw!) as string[];
    if (!Array.isArray(paths) || paths.length === 0) {
      throw new Error('paths must be a non-empty array');
    }
  } catch (e) {
    return [
      {
        uri,
        mimeType: 'application/json',
        text: JSON.stringify({
          valid: false,
          errors: [
            `Invalid paths parameter: ${
              e instanceof Error ? e.message : String(e)
            }. Expected JSON array of strings.`,
          ],
        }),
      },
    ];
  }

  try {
    const result = generateSitemap(baseUrl!, paths);
    return [
      {
        uri,
        mimeType: 'application/json',
        text: JSON.stringify(
          {
            count: result.count,
            generatedAt: result.generatedAt,
            xml: result.xml,
            entries: result.entries.map((e) => ({
              loc: e.loc,
              lastmod: e.lastmod,
              changefreq: e.changefreq,
              priority: e.priority,
            })),
          },
          null,
          2
        ),
      },
    ];
  } catch (error) {
    return [
      {
        uri,
        mimeType: 'application/json',
        text: JSON.stringify({
          valid: false,
          error: `Sitemap generation failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        }),
      },
    ];
  }
}

/**
 * Gestisce la richiesta di generazione BreadcrumbList JSON-LD.
 * Parametri: name (string, multi-valore), url (string, multi-valore)
 * I valori vengono accoppiati per posizione.
 */
async function handleBreadcrumbRequest(
  uri: string,
  params: Map<string, string[]>
): Promise<ResourceContent[]> {
  const names = params.get('name') ?? [];
  const urls = params.get('url') ?? [];

  if (names.length === 0 || urls.length === 0) {
    return [
      {
        uri,
        mimeType: 'application/json',
        text: JSON.stringify({
          valid: false,
          errors: [
            'Breadcrumb requires at least one pair of name and url parameters. ' +
              'Esempio: ?name=Home&url=https://example.com/&name=Prodotti&url=https://example.com/prodotti',
          ],
        }),
      },
    ];
  }

  // Accoppia name e url per posizione
  const items: Array<{ name: string; url: string }> = [];
  const maxLen = Math.min(names.length, urls.length);

  for (let i = 0; i < maxLen; i++) {
    items.push({ name: names[i], url: urls[i] });
  }

  if (items.length !== Math.max(names.length, urls.length)) {
    // C'è disallineamento tra name e url
    return [
      {
        uri,
        mimeType: 'application/json',
        text: JSON.stringify({
          valid: false,
          errors: [
            `Mismatch between name (${names.length}) and url (${urls.length}) parameters. Each name must have a corresponding url.`,
          ],
        }),
      },
    ];
  }

  try {
    const structuredData = generateBreadcrumbJsonLd(items);
    return [
      {
        uri,
        mimeType: 'application/json',
        text: JSON.stringify(structuredData, null, 2),
      },
    ];
  } catch (error) {
    return [
      {
        uri,
        mimeType: 'application/json',
        text: JSON.stringify({
          valid: false,
          error: `Breadcrumb generation failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        }),
      },
    ];
  }
}

/**
 * Gestisce la richiesta di generazione Organization JSON-LD.
 * Parametri: name (string), url (string), logo (string, opzionale)
 */
async function handleOrganizationRequest(
  uri: string,
  params: Map<string, string[]>
): Promise<ResourceContent[]> {
  const name = params.get('name')?.[0];
  const url = params.get('url')?.[0];
  const logo = params.get('logo')?.[0];

  const errors: string[] = [];
  if (!name) errors.push('Missing required parameter: name');
  if (!url) errors.push('Missing required parameter: url');

  if (errors.length > 0) {
    return [
      {
        uri,
        mimeType: 'application/json',
        text: JSON.stringify({ valid: false, errors }),
      },
    ];
  }

  try {
    const structuredData = generateOrganizationJsonLd(name!, url!, logo);
    return [
      {
        uri,
        mimeType: 'application/json',
        text: JSON.stringify(structuredData, null, 2),
      },
    ];
  } catch (error) {
    return [
      {
        uri,
        mimeType: 'application/json',
        text: JSON.stringify({
          valid: false,
          error: `Organization generation failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        }),
      },
    ];
  }
}

/**
 * Gestisce la richiesta di validazione JSON-LD.
 * Parametri: jsonLd (string, URL encoded)
 */
async function handleValidateRequest(
  uri: string,
  params: Map<string, string[]>
): Promise<ResourceContent[]> {
  const jsonLd = params.get('jsonLd')?.[0];

  if (!jsonLd) {
    return [
      {
        uri,
        mimeType: 'application/json',
        text: JSON.stringify({
          valid: false,
          errors: ['Missing required parameter: jsonLd (URL-encoded JSON-LD string)'],
        }),
      },
    ];
  }

  try {
    const result = validateStructuredData(jsonLd);
    return [
      {
        uri,
        mimeType: 'application/json',
        text: JSON.stringify(result, null, 2),
      },
    ];
  } catch (error) {
    return [
      {
        uri,
        mimeType: 'application/json',
        text: JSON.stringify({
          valid: false,
          errors: [
            `Validation failed: ${
              error instanceof Error ? error.message : String(error)
            }`,
          ],
        }),
      },
    ];
  }
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

/**
 * Parser di query string con supporto multi-valore (chiavi duplicate).
 *
 * @param queryString - Query string (con o senza ? iniziale)
 * @returns Map dove ogni chiave punta a un array di valori (ordinati per occorrenza)
 *
 * @example
 * parseMultiValueQueryString("name=Home&url=/&name=Products&url=/products")
 * // Map { "name" => ["Home", "Products"], "url" => ["/", "/products"] }
 */
function parseMultiValueQueryString(queryString: string): Map<string, string[]> {
  const params = new Map<string, string[]>();

  if (!queryString) return params;

  const qs = queryString.startsWith('?') ? queryString.substring(1) : queryString;

  for (const part of qs.split('&')) {
    if (!part) continue;
    const eqIndex = part.indexOf('=');
    let key: string;
    let value: string;

    if (eqIndex === -1) {
      key = decodeURIComponent(part);
      value = '';
    } else {
      try {
        key = decodeURIComponent(part.substring(0, eqIndex));
        value = decodeURIComponent(part.substring(eqIndex + 1));
      } catch {
        key = part.substring(0, eqIndex);
        value = part.substring(eqIndex + 1);
      }
    }

    const existing = params.get(key);
    if (existing) {
      existing.push(value);
    } else {
      params.set(key, [value]);
    }
  }

  return params;
}
