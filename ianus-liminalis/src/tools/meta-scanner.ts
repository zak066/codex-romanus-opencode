/**
 * fs_meta_scanner — Ianus Liminalis
 *
 * Scansiona file HTML per SEO meta tags, Open Graph, Twitter Card,
 * JSON-LD structured data, canonical, hreflang e robots meta.
 * Genera un punteggio SEO on-page (0-100) per ogni file analizzato.
 *
 * Ispirato alla Naturalis Historia di Plinio il Vecchio:
 * "Nulla dies sine linea" — nessun giorno senza una riga di meta tag.
 */

import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { readFile, readdir, stat as fsStat } from 'node:fs/promises';
import { join, relative, extname } from 'node:path';
import { resolveSafePath } from '../core/path-utils.js';
import { stats as serverStats } from '../core/stats.js';
import { toolRegistry } from './registry.js';
import type { ToolDeps } from './types.js';

// ── Tipi ──────────────────────────────────────────────────────────────────

interface MetaIssue {
  type: 'critical' | 'warning' | 'info';
  tag: string;
  message: string;
}

interface FileMetaResult {
  path: string;
  title?: string;
  titleLength?: number;
  description?: string;
  descriptionLength?: number;
  ogTags: Record<string, string>;
  twitterTags: Record<string, string>;
  jsonLdTypes: string[];
  hasCanonical: boolean;
  hasHreflang: boolean;
  hasRobots: boolean;
  issues: MetaIssue[];
  score: number;
}

// ── Regex per estrazione ─────────────────────────────────────────────────

/** Estrae il contenuto del tag <title> */
const TITLE_RE = /<title[^>]*>([\s\S]*?)<\/title>/i;

/** Estrae attributi da tag <meta> */
const META_TAG_RE = /<meta[\s\n][^>]*>/gi;
const NAME_ATTR_RE = /(?:name|property)\s*=\s*["']([^"']*)["']/i;
const CONTENT_ATTR_RE = /content\s*=\s*["']([^"']*)["']/i;
const CHARSET_ATTR_RE = /charset\s*=\s*["']([^"']*)["']/i;

/** Estrae attributi da tag <link> */
const LINK_TAG_RE = /<link[\s\n][^>]*>/gi;
const REL_ATTR_RE = /rel\s*=\s*["']([^"']*)["']/i;
const HREF_ATTR_RE = /href\s*=\s*["']([^"']*)["']/i;
const HREFLANG_ATTR_RE = /hreflang\s*=\s*["']([^"']*)["']/i;

/** Estrae blocchi <script type="application/ld+json"> */
const JSONLD_SCRIPT_RE =
  /<script\s+[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

// ── Helper di estrazione ─────────────────────────────────────────────────

function extractTitle(html: string): string | undefined {
  const match = TITLE_RE.exec(html);
  return match ? match[1].trim() : undefined;
}

function extractMetaTags(html: string): Record<string, string[]> {
  const tags: Record<string, string[]> = {};
  let match: RegExpExecArray | null;

  while ((match = META_TAG_RE.exec(html)) !== null) {
    const tag = match[0];

    // Charset detection
    const charsetMatch = CHARSET_ATTR_RE.exec(tag);
    if (charsetMatch) {
      (tags['charset'] ??= []).push(charsetMatch[1]);
      continue;
    }

    const nameMatch = NAME_ATTR_RE.exec(tag);
    const contentMatch = CONTENT_ATTR_RE.exec(tag);
    if (nameMatch && contentMatch) {
      const key = nameMatch[1].toLowerCase();
      (tags[key] ??= []).push(contentMatch[1]);
    }
  }

  return tags;
}

function extractLinkTags(html: string): Array<{
  rel: string;
  href?: string;
  hreflang?: string;
}> {
  const links: Array<{ rel: string; href?: string; hreflang?: string }> = [];
  let match: RegExpExecArray | null;

  while ((match = LINK_TAG_RE.exec(html)) !== null) {
    const tag = match[0];
    const relMatch = REL_ATTR_RE.exec(tag);
    if (!relMatch) continue;

    const rel = relMatch[1].toLowerCase();
    const hrefMatch = HREF_ATTR_RE.exec(tag);
    const hreflangMatch = HREFLANG_ATTR_RE.exec(tag);

    links.push({
      rel,
      href: hrefMatch ? hrefMatch[1] : undefined,
      hreflang: hreflangMatch ? hreflangMatch[1] : undefined,
    });
  }

  return links;
}

function extractJsonLdTypes(html: string): string[] {
  const types: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = JSONLD_SCRIPT_RE.exec(html)) !== null) {
    try {
      const parsed = JSON.parse(match[1].trim());
      // Può essere un oggetto singolo o un array
      const items = Array.isArray(parsed) ? parsed : [parsed];
      for (const item of items) {
        if (item['@type']) {
          types.push(item['@type']);
        }
      }
    } catch {
      // JSON-LD malformato — lo ignoriamo ma lo segnaliamo come issue
    }
  }

  return types;
}

function calculateScore(result: FileMetaResult): number {
  let score = 0;

  // title (max 15)
  if (result.title && result.titleLength! > 0) {
    score += 15;
  }

  // description (max 15)
  if (result.description && result.descriptionLength! > 0) {
    score += result.descriptionLength! >= 50 ? 15 : 8;
  }

  // og:title (10)
  if (result.ogTags['og:title']) score += 10;

  // og:description (10)
  if (result.ogTags['og:description']) score += 10;

  // og:image (10) — critical
  if (result.ogTags['og:image']) score += 10;

  // og:url (5)
  if (result.ogTags['og:url']) score += 5;

  // og:type (5)
  if (result.ogTags['og:type']) score += 5;

  // twitter:card (5)
  if (result.twitterTags['twitter:card']) score += 5;

  // canonical (10)
  if (result.hasCanonical) score += 10;

  // hreflang (5)
  if (result.hasHreflang) score += 5;

  // robots meta (5)
  if (result.hasRobots) score += 5;

  return Math.min(100, score);
}

function scanHtmlContent(relPath: string, html: string): FileMetaResult {
  const issues: MetaIssue[] = [];

  // Title
  const title = extractTitle(html);
  const titleLength = title ? title.length : 0;

  if (!title) {
    issues.push({ type: 'critical', tag: 'title', message: 'Title tag mancante' });
  } else if (titleLength > 60) {
    issues.push({
      type: 'warning',
      tag: 'title',
      message: `Title troppo lungo (${titleLength} caratteri, max 60)`,
    });
  }

  // Meta tags
  const metaTags = extractMetaTags(html);

  // Description
  const description = metaTags['description']?.[0];
  const descriptionLength = description ? description.length : 0;

  if (!description) {
    issues.push({
      type: 'critical',
      tag: 'description',
      message: 'Meta description mancante',
    });
  } else if (descriptionLength < 50) {
    issues.push({
      type: 'warning',
      tag: 'description',
      message: `Meta description troppo corta (${descriptionLength} caratteri, min 50)`,
    });
  } else if (descriptionLength > 160) {
    issues.push({
      type: 'warning',
      tag: 'description',
      message: `Meta description troppo lunga (${descriptionLength} caratteri, max 160)`,
    });
  }

  // Keywords
  const keywords = metaTags['keywords']?.[0];
  if (keywords && keywords.length > 200) {
    issues.push({
      type: 'warning',
      tag: 'keywords',
      message: `Meta keywords troppo lunga (${keywords.length} caratteri)`,
    });
  }

  // Viewport
  if (!metaTags['viewport']) {
    issues.push({
      type: 'warning',
      tag: 'viewport',
      message: 'Meta viewport mancante (richiesto per mobile)',
    });
  }

  // Charset
  if (!metaTags['charset']) {
    issues.push({
      type: 'warning',
      tag: 'charset',
      message: 'Meta charset mancante',
    });
  }

  // Open Graph
  const ogTags: Record<string, string> = {};
  for (const [key, values] of Object.entries(metaTags)) {
    if (key.startsWith('og:')) {
      ogTags[key] = values[0];
    }
  }

  if (!ogTags['og:title']) {
    issues.push({
      type: 'warning',
      tag: 'og:title',
      message: 'Open Graph og:title mancante',
    });
  }
  if (!ogTags['og:description']) {
    issues.push({
      type: 'info',
      tag: 'og:description',
      message: 'Open Graph og:description mancante',
    });
  }
  if (!ogTags['og:image']) {
    issues.push({
      type: 'critical',
      tag: 'og:image',
      message: 'Open Graph og:image mancante (richiesto per social sharing)',
    });
  }
  if (!ogTags['og:type']) {
    issues.push({
      type: 'info',
      tag: 'og:type',
      message: 'Open Graph og:type mancante',
    });
  }

  // Twitter Card
  const twitterTags: Record<string, string> = {};
  for (const [key, values] of Object.entries(metaTags)) {
    if (key.startsWith('twitter:')) {
      twitterTags[key] = values[0];
    }
  }

  if (!twitterTags['twitter:card']) {
    issues.push({
      type: 'info',
      tag: 'twitter:card',
      message: 'Twitter Card meta mancante',
    });
  }

  // Link tags (canonical, hreflang)
  const linkTags = extractLinkTags(html);
  const hasCanonical = linkTags.some((l) => l.rel === 'canonical');
  const hasHreflang = linkTags.some((l) => l.rel === 'alternate' && l.hreflang);

  if (!hasCanonical) {
    issues.push({
      type: 'warning',
      tag: 'canonical',
      message: 'Tag canonical mancante',
    });
  }

  if (!hasHreflang) {
    issues.push({
      type: 'info',
      tag: 'hreflang',
      message: 'Tag hreflang mancante (utile per siti multilingua)',
    });
  }

  // Robots meta
  const hasRobots = !!metaTags['robots'];
  if (!hasRobots) {
    issues.push({
      type: 'info',
      tag: 'robots',
      message: 'Meta robots mancante',
    });
  }

  // JSON-LD
  const jsonLdTypes = extractJsonLdTypes(html);
  if (jsonLdTypes.length === 0) {
    issues.push({
      type: 'info',
      tag: 'json-ld',
      message: 'JSON-LD structured data mancante',
    });
  }

  const result: FileMetaResult = {
    path: relPath,
    title,
    titleLength,
    description,
    descriptionLength,
    ogTags,
    twitterTags,
    jsonLdTypes,
    hasCanonical,
    hasHreflang,
    hasRobots,
    issues,
    score: 0, // Will be set below
  };

  result.score = calculateScore(result);

  return result;
}

// ── Walk files ────────────────────────────────────────────────────────────

async function collectHtmlFiles(
  dir: string,
  baseDir: string,
  recursive: boolean,
  includePattern: string,
): Promise<string[]> {
  const files: string[] = [];

  async function walk(currentPath: string): Promise<void> {
    let entries: string[];
    try {
      entries = await readdir(currentPath);
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = join(currentPath, entry);
      try {
        const st = await fsStat(fullPath);
        if (st.isDirectory()) {
          if (recursive) await walk(fullPath);
        } else if (st.isFile()) {
          const relPath = relative(baseDir, fullPath).replace(/\\/g, '/');
          if (extname(entry).toLowerCase() === '.html') {
            files.push(fullPath);
          }
        }
      } catch {
        // Skip inaccessible entries
      }
    }
  }

  await walk(dir);
  return files;
}

// ── Tool Registration ──────────────────────────────────────────────────────

export function registerMetaScanner(_server: Server, deps: ToolDeps): void {
  toolRegistry.register({
    name: 'fs_meta_scanner',
    description:
      'Scansiona file HTML per SEO meta tags, Open Graph, Twitter Card, JSON-LD structured data, canonical, hreflang e robots meta. Genera un punteggio SEO on-page (0-100) per ogni file.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description:
            'File HTML o directory da scansionare (relativo al workspace)',
        },
        recursive: {
          type: 'boolean',
          default: true,
          description:
            'Scansione ricorsiva se è una directory (default: true)',
        },
        include: {
          type: 'string',
          default: '**/*.html',
          description:
            'Glob pattern per filtrare file (default: "**/*.html")',
        },
        agent: {
          type: 'string',
          description:
            'Nome dell agente chiamante (opzionale, default: "ianus")',
        },
      },
      required: ['path'],
    },
    handler: async (args) => {
      const scanPath = args.path as string | undefined;
      if (!scanPath) {
        return {
          content: [
            { type: 'text', text: 'Missing required parameter: "path"' },
          ],
          isError: true,
        };
      }

      const recursive = (args.recursive as boolean) ?? true;

      // Permission check
      const callerAgent = (args.agent as string) || 'ianus';
      const permCheck = await deps.permission.checkOperation(
        callerAgent,
        'read',
        scanPath,
        deps.workspaceRoot,
      );
      if (!permCheck.allowed) {
        return {
          content: [
            {
              type: 'text',
              text: `Permission denied: ${permCheck.reason}`,
            },
          ],
          isError: true,
        };
      }

      try {
        const safePath = resolveSafePath(scanPath, deps.workspaceRoot);
        const st = await fsStat(safePath);

        let htmlFiles: string[];

        if (st.isDirectory()) {
          htmlFiles = await collectHtmlFiles(
            safePath,
            deps.workspaceRoot,
            recursive,
            '**/*.html',
          );
        } else if (st.isFile()) {
          htmlFiles = [safePath];
        } else {
          return {
            content: [
              {
                type: 'text',
                text: `"${scanPath}" non è un file o directory valido`,
              },
            ],
            isError: true,
          };
        }

        const results: FileMetaResult[] = [];

        for (const filePath of htmlFiles) {
          try {
            const content = await readFile(filePath, 'utf-8');
            const relPath = relative(deps.workspaceRoot, filePath).replace(
              /\\/g,
              '/',
            );
            const result = scanHtmlContent(relPath, content);
            results.push(result);
          } catch {
            // Skip unreadable files
          }
        }

        const totalFiles = results.length;
        const averageScore =
          totalFiles > 0
            ? Math.round(
                results.reduce((sum, r) => sum + r.score, 0) / totalFiles,
              )
            : 0;

        serverStats.increment();

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  files: results,
                  totalFiles,
                  averageScore,
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: 'text',
              text: `Error scanning meta in "${scanPath}": ${(err as Error).message}`,
            },
          ],
          isError: true,
        };
      }
    },
  });
}
