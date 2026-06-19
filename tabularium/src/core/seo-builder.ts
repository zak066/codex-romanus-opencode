/**
 * core/seo-builder.ts
 * SEO Builder — Generazione Sitemap XML e validazione Structured Data JSON-LD.
 * Come la Naturalis Historia cataloga tutto il sapere, questo modulo
 * rende ogni pagina del progetto trovabile dai motori di ricerca.
 *
 * @module core/seo-builder
 */

// ---------------------------------------------------------------------------
// Tipi pubblici
// ---------------------------------------------------------------------------

/**
 * Voce di una sitemap XML.
 * Ogni entry rappresenta una pagina del sito con metadati di indicizzazione.
 */
export interface SitemapEntry {
  /** URL assoluto della pagina (es. https://example.com/prodotti) */
  loc: string;
  /** Data dell'ultima modifica in formato ISO 8601 */
  lastmod?: string;
  /** Frequenza di aggiornamento suggerita per i crawler */
  changefreq?: 'always' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'never';
  /** Priorità rispetto alle altre pagine (0.0 - 1.0) */
  priority?: number;
}

/**
 * Struttura base per dati JSON-LD (Schema.org).
 * Qualsiasi @type di schema.org è supportato.
 */
export interface StructuredData {
  '@context': 'https://schema.org';
  '@type': string;
  [key: string]: unknown;
}

/**
 * Risultato della generazione della sitemap.
 */
export interface SitemapResult {
  /** Elenco delle voci processate */
  entries: SitemapEntry[];
  /** XML completo della sitemap */
  xml: string;
  /** Timestamp di generazione in formato ISO */
  generatedAt: string;
  /** Numero di URL nella sitemap */
  count: number;
}

/**
 * Risultato della validazione di un JSON-LD.
 */
export interface ValidationResult {
  /** true se il JSON-LD è valido secondo i criteri SEO */
  valid: boolean;
  /** Elenco descrittivo degli errori riscontrati */
  errors: string[];
}

// ---------------------------------------------------------------------------
// Costanti
// ---------------------------------------------------------------------------

/** Frequenze di aggiornamento consentite dal protocollo sitemaps */
const VALID_CHANGEFREQ = new Set([
  'always', 'hourly', 'daily', 'weekly', 'monthly', 'yearly', 'never',
]);

// ---------------------------------------------------------------------------
// Sitemap Generator
// ---------------------------------------------------------------------------

/**
 * Genera il documento XML di una sitemap a partire da un URL base e una lista di path.
 *
 * @param baseUrl - URL base del sito (es. https://example.com)
 * @param paths   - Array di path relativi (es. ['/', '/about', '/contact'])
 * @returns SitemapResult con XML, entries e metadati
 *
 * @example
 * const result = generateSitemap('https://codex-romanus.app', ['/', '/docs', '/api']);
 * console.log(result.xml);
 * // <?xml version="1.0" encoding="UTF-8"?>
 * // <urlset xmlns="...">
 * //   <url><loc>https://codex-romanus.app/</loc>...</url>
 * //   ...
 * // </urlset>
 */
export function generateSitemap(baseUrl: string, paths: string[]): SitemapResult {
  const generatedAt = new Date().toISOString();
  const today = generatedAt.slice(0, 10); // YYYY-MM-DD

  const entries: SitemapEntry[] = paths.map((p) => {
    // Normalizza il path: assicura che inizi con /
    const normalizedPath = p.startsWith('/') ? p : `/${p}`;
    // Costruisce URL assoluto
    const loc = `${baseUrl.replace(/\/+$/, '')}${normalizedPath}`;

    const entry: SitemapEntry = {
      loc: escapeXml(loc),
      lastmod: today,
      changefreq: normalizedPath === '/' ? 'daily' : 'weekly',
      priority: normalizedPath === '/' ? 1.0 : 0.8,
    };

    return entry;
  });

  const xml = buildSitemapXml(entries);

  return {
    entries,
    xml,
    generatedAt,
    count: entries.length,
  };
}

/**
 * Costruisce il documento XML completo della sitemap.
 *
 * @param entries - Array di SitemapEntry da serializzare
 * @returns Stringa XML completa con intestazione e urlset
 */
function buildSitemapXml(entries: SitemapEntry[]): string {
  const urlElements = entries.map((e) => {
    const props: string[] = [];
    props.push(`    <loc>${e.loc}</loc>`);
    if (e.lastmod) {
      props.push(`    <lastmod>${e.lastmod}</lastmod>`);
    }
    if (e.changefreq) {
      props.push(`    <changefreq>${e.changefreq}</changefreq>`);
    }
    if (e.priority !== undefined) {
      props.push(`    <priority>${e.priority.toFixed(1)}</priority>`);
    }
    return `  <url>\n${props.join('\n')}\n  </url>`;
  });

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urlElements,
    '</urlset>',
  ].join('\n');
}

/**
 * Escape minimo per XML (caratteri speciali).
 * Necessario per garantire che URL con &, <, >, ", ' siano validi XML.
 *
 * @param str - Stringa da esporti in XML
 * @returns Stringa con caratteri speciali escapati
 */
function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// ---------------------------------------------------------------------------
// Structured Data Generators
// ---------------------------------------------------------------------------

/**
 * Genera un JSON-LD BreadcrumbList a partire da un array di item.
 * Ogni item rappresenta un livello della breadcrumb navigation.
 *
 * @param items - Array di { name, url } in ordine dal root al corrente
 * @returns StructuredData pronto per serializzazione JSON
 *
 * @example
 * const breadcrumb = generateBreadcrumbJsonLd([
 *   { name: 'Home', url: 'https://example.com/' },
 *   { name: 'Prodotti', url: 'https://example.com/prodotti' },
 * ]);
 */
export function generateBreadcrumbJsonLd(
  items: Array<{ name: string; url: string }>
): StructuredData {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: item.url,
    })),
  };
}

/**
 * Genera un JSON-LD Organization.
 * Utile per il sito principale, specifica nome, URL e logo.
 *
 * @param name - Nome dell'organizzazione
 * @param url  - URL del sito web
 * @param logo - URL del logo (opzionale)
 * @returns StructuredData pronto per serializzazione JSON
 */
export function generateOrganizationJsonLd(
  name: string,
  url: string,
  logo?: string
): StructuredData {
  const result: StructuredData = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name,
    url,
  };

  if (logo) {
    result.logo = logo;
  }

  return result;
}

// ---------------------------------------------------------------------------
// Validator
// ---------------------------------------------------------------------------

/**
 * Valida una stringa JSON-LD verificando:
 * - Parsing JSON valido
 * - Presenza dei campi obbligatori (@context, @type)
 * - @context deve essere "https://schema.org"
 *
 * @param json - Stringa JSON-LD da validare
 * @returns ValidationResult con flag valid e array di errori
 *
 * @example
 * const result = validateStructuredData('{"@context":"https://schema.org","@type":"WebSite"}');
 * // { valid: true, errors: [] }
 */
export function validateStructuredData(json: string): ValidationResult {
  const errors: string[] = [];

  if (!json || json.trim().length === 0) {
    return { valid: false, errors: ['JSON-LD input is empty'] };
  }

  // 1) Parsing JSON
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (e) {
    return {
      valid: false,
      errors: [
        `Invalid JSON: ${e instanceof Error ? e.message : String(e)}`,
      ],
    };
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return {
      valid: false,
      errors: ['JSON-LD must be a JSON object'],
    };
  }

  const obj = parsed as Record<string, unknown>;

  // 2) Verifica @context
  if (!obj['@context']) {
    errors.push('Missing required field: @context');
  } else if (obj['@context'] !== 'https://schema.org') {
    errors.push(
      `Invalid @context: expected "https://schema.org", got "${String(obj['@context'])}"`
    );
  }

  // 3) Verifica @type
  if (!obj['@type']) {
    errors.push('Missing required field: @type');
  } else if (typeof obj['@type'] !== 'string') {
    errors.push('@type must be a string');
  }

  // 4) Warning per @type vuoto
  if (obj['@type'] && typeof obj['@type'] === 'string' && obj['@type'].trim() === '') {
    errors.push('@type must not be empty');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
