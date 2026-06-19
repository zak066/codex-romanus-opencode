/**
 * fs_sitemap_scanner — Ianus Liminalis
 *
 * Genera sitemap XML dalla struttura file/directory del progetto.
 * Supporta esclusione/inclusione tramite glob patterns, split automatico
 * oltre maxEntries, e sitemap index per sitemap multiple.
 *
 * Come diceva Plinio il Vecchio nella Naturalis Historia:
 * "Omnia ordinata" — tutto sia ordinato e trovabile.
 */

import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { readdir, stat as fsStat, writeFile, mkdir } from 'node:fs/promises';
import { join, relative, extname, dirname } from 'node:path';
import { minimatch } from 'minimatch';
import { resolveSafePath } from '../core/path-utils.js';
import { stats as serverStats } from '../core/stats.js';
import { toolRegistry } from './registry.js';
import type { ToolDeps } from './types.js';

// ── Tipi ──────────────────────────────────────────────────────────────────

interface SitemapEntry {
  filePath: string;
  lastmod: string;
}

// ── Walk files con filtri include/exclude ─────────────────────────────────

async function collectFiles(
  dir: string,
  baseDir: string,
  include: string[],
  exclude: string[],
  maxEntries: number,
): Promise<string[]> {
  const files: string[] = [];

  async function walk(currentPath: string): Promise<void> {
    if (files.length >= maxEntries) return;

    let entries: string[];
    try {
      entries = await readdir(currentPath);
    } catch {
      return;
    }

    for (const entry of entries) {
      if (files.length >= maxEntries) return;

      // Skip hidden dirs on first level? No, they're handled by exclude patterns
      const fullPath = join(currentPath, entry);
      try {
        const st = await fsStat(fullPath);
        const relPath = relative(baseDir, fullPath).replace(/\\/g, '/');

        // Exclude check first (quicker rejection)
        let excluded = false;
        for (const ex of exclude) {
          if (minimatch(relPath, ex, { dot: true, matchBase: false })) {
            excluded = true;
            break;
          }
          // Also check with trailing /** for directories
          if (minimatch(relPath + '/**', ex, { dot: true, matchBase: false })) {
            excluded = true;
            break;
          }
        }
        if (excluded) continue;

        if (st.isDirectory()) {
          await walk(fullPath);
        } else if (st.isFile()) {
          // Include check
          let included = false;
          for (const inc of include) {
            if (minimatch(relPath, inc, { dot: true, matchBase: false })) {
              included = true;
              break;
            }
          }
          if (included) {
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

// ── URL conversion ────────────────────────────────────────────────────────

function filePathToUrl(filePath: string, baseDir: string, baseUrl: string): string {
  const relPath = relative(baseDir, filePath).replace(/\\/g, '/');
  const normalized = relPath
    .replace(/\/index\.html?$/i, '/')
    .replace(/\.html?$/i, '')
    .replace(/\/$/, '');

  // Ensure trailing slash for directory-style URLs
  const urlPath = normalized === '' ? '/' : '/' + normalized + '/';

  // Remove double slashes
  const cleanUrlPath = urlPath.replace(/\/+/g, '/');

  const base = baseUrl.replace(/\/+$/, '');
  return base + cleanUrlPath;
}

// ── XML Generators ───────────────────────────────────────────────────────

function xmlEscape(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function generateSitemapXml(
  entries: SitemapEntry[],
  baseDir: string,
  baseUrl: string,
): string {
  const urls = entries
    .map((entry) => {
      const loc = xmlEscape(filePathToUrl(entry.filePath, baseDir, baseUrl));
      const lastmod = entry.lastmod;
      const isRoot = /\/\/?$/.test(loc) && !loc.replace(baseUrl, '').replace(/\/+/g, '/').replace(/^\//, '');
      
      // Check if it's root index
      const relPath = relative(baseDir, entry.filePath).replace(/\\/g, '/');
      const isRootIndex = /^index\.html?$/i.test(relPath);
      const isRootDirIndex = /^\/?index\.html?$/i.test(relPath);

      const priority = isRootIndex || isRootDirIndex ? '1.0' : '0.8';
      const changefreq = isRootIndex || isRootDirIndex ? 'weekly' : 'monthly';

      return `  <url>
    <loc>${loc}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>${changefreq}</changefreq>
    <priority>${priority}</priority>
  </url>`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>`;
}

function generateSitemapIndexXml(
  sitemapFiles: string[],
  baseUrl: string,
): string {
  const sitemaps = sitemapFiles
    .map((file) => {
      const loc = xmlEscape(
        baseUrl.replace(/\/+$/, '') + '/' + file.replace(/\\/g, '/'),
      );
      return `  <sitemap>
    <loc>${loc}</loc>
  </sitemap>`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sitemaps}
</sitemapindex>`;
}

// ── Tool Registration ──────────────────────────────────────────────────────

export function registerSitemapScanner(_server: Server, deps: ToolDeps): void {
  toolRegistry.register({
    name: 'fs_sitemap_scanner',
    description:
      'Genera sitemap XML dalla struttura file/directory del progetto. Supporta filtri include/exclude glob, split automatico oltre maxEntries, e sitemap index per sitemap multiple.',
    annotations: { idempotentHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description:
            'Path base del progetto da scansionare (relativo al workspace)',
        },
        baseUrl: {
          type: 'string',
          description:
            'URL base del sito (es. "https://example.com")',
        },
        output: {
          type: 'string',
          description:
            'Path del file sitemap output (default: "sitemap.xml" nella directory path)',
        },
        include: {
          type: 'array',
          items: { type: 'string' },
          default: ['**/*.html', '**/*.htm'],
          description:
            'Glob patterns per includere file (default: ["**/*.html", "**/*.htm"])',
        },
        exclude: {
          type: 'array',
          items: { type: 'string' },
          default: ['**/node_modules/**', '**/.git/**'],
          description:
            'Glob patterns per escludere (default: ["**/node_modules/**", "**/.git/**"])',
        },
        changefreq: {
          type: 'string',
          default: 'monthly',
          description:
            'Changefreq di default per pagine non root (default: "monthly")',
        },
        priority: {
          type: 'number',
          default: 0.8,
          description:
            'Priority di default per pagine non root (default: 0.8)',
        },
        maxEntries: {
          type: 'number',
          default: 50000,
          description:
            'Max URL per sitemap (default: 50000). Se superato, genera sitemap index',
        },
        agent: {
          type: 'string',
          description:
            'Nome dell agente chiamante (opzionale, default: "ianus")',
        },
      },
      required: ['path', 'baseUrl'],
    },
    handler: async (args) => {
      const scanPath = args.path as string | undefined;
      const baseUrl = args.baseUrl as string | undefined;

      if (!scanPath) {
        return {
          content: [
            {
              type: 'text',
              text: 'Missing required parameter: "path"',
            },
          ],
          isError: true,
        };
      }
      if (!baseUrl) {
        return {
          content: [
            {
              type: 'text',
              text: 'Missing required parameter: "baseUrl"',
            },
          ],
          isError: true,
        };
      }

      const include = (args.include as string[]) ?? [
        '**/*.html',
        '**/*.htm',
      ];
      const exclude = (args.exclude as string[]) ?? [
        '**/node_modules/**',
        '**/.git/**',
      ];
      const changefreq = (args.changefreq as string) ?? 'monthly';
      const priority = (args.priority as number) ?? 0.8;
      const maxEntries = (args.maxEntries as number) ?? 50000;

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

        if (!st.isDirectory()) {
          return {
            content: [
              {
                type: 'text',
                text: `"${scanPath}" non è una directory valida`,
              },
            ],
            isError: true,
          };
        }

        // Determina output path
        const outputPath = args.output
          ? resolveSafePath(args.output as string, deps.workspaceRoot)
          : join(safePath, 'sitemap.xml');

        // Permessi anche per scrittura output
        const outputRelPath = relative(deps.workspaceRoot, outputPath).replace(
          /\\/g,
          '/',
        );
        const writePermCheck = await deps.permission.checkOperation(
          callerAgent,
          'write',
          outputRelPath,
          deps.workspaceRoot,
        );
        if (!writePermCheck.allowed) {
          return {
            content: [
              {
                type: 'text',
                text: `Permission denied for output path: ${writePermCheck.reason}`,
              },
            ],
            isError: true,
          };
        }

        // Colleziona file
        const collectedFiles = await collectFiles(
          safePath,
          deps.workspaceRoot,
          include,
          exclude,
          maxEntries,
        );

        if (collectedFiles.length === 0) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  output: outputRelPath,
                  urlCount: 0,
                  baseUrl,
                  sitemapFiles: [],
                  warnings: [
                    'Nessun file HTML trovato con i pattern specificati',
                  ],
                }),
              },
            ],
          };
        }

        // Raccogli lastmod per ogni file
        const entries: SitemapEntry[] = [];
        for (const filePath of collectedFiles) {
          try {
            const st = await fsStat(filePath);
            entries.push({
              filePath,
              lastmod: st.mtime.toISOString().split('T')[0], // Solo YYYY-MM-DD
            });
          } catch {
            entries.push({
              filePath,
              lastmod: new Date().toISOString().split('T')[0],
            });
          }
        }

        // Ordina per path
        entries.sort((a, b) => a.filePath.localeCompare(b.filePath));

        // Assicura che la directory output esista
        const outputDir = dirname(outputPath);
        await mkdir(outputDir, { recursive: true });

        const warnings: string[] = [];
        const sitemapFiles: string[] = [];
        const outputBaseName = extname(outputPath)
          ? outputPath.replace(/\.[^.]+$/, '')
          : outputPath;
        const outputExt = '.xml';

        if (entries.length <= maxEntries) {
          // Singola sitemap
          const xml = generateSitemapXml(entries, deps.workspaceRoot, baseUrl);
          await writeFile(outputPath, xml, 'utf-8');
          sitemapFiles.push(relative(deps.workspaceRoot, outputPath).replace(/\\/g, '/'));
        } else {
          // Sitemap index — splitta in più file
          const totalFiles = entries.length;
          const numSitemaps = Math.ceil(totalFiles / maxEntries);
          const sitemapIndexPaths: string[] = [];

          for (let i = 0; i < numSitemaps; i++) {
            const chunk = entries.slice(i * maxEntries, (i + 1) * maxEntries);
            const sitemapFileName = `${outputBaseName}-${i + 1}${outputExt}`;
            const sitemapPath = join(dirname(outputPath), sitemapFileName);
            const xml = generateSitemapXml(chunk, deps.workspaceRoot, baseUrl);
            await writeFile(sitemapPath, xml, 'utf-8');
            sitemapIndexPaths.push(sitemapFileName);
            sitemapFiles.push(
              relative(deps.workspaceRoot, sitemapPath).replace(/\\/g, '/'),
            );
          }

          // Genera sitemap index
          const indexXml = generateSitemapIndexXml(
            sitemapIndexPaths,
            baseUrl,
          );

          // Se output è "sitemap.xml", l'index sarà "sitemap-index.xml"
          const indexFileName = `${outputBaseName}-index${outputExt}`;
          const indexPath = join(dirname(outputPath), indexFileName);
          await writeFile(indexPath, indexXml, 'utf-8');
          sitemapFiles.unshift(
            relative(deps.workspaceRoot, indexPath).replace(/\\/g, '/'),
          );

          warnings.push(
            `Superato il limite di ${maxEntries} URL per sitemap: generate ${numSitemaps} sitemap + sitemap index`,
          );
        }

        serverStats.increment();

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  output: relative(deps.workspaceRoot, outputPath).replace(
                    /\\/g,
                    '/',
                  ),
                  urlCount: entries.length,
                  baseUrl,
                  sitemapFiles,
                  warnings,
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
              text: `Error generating sitemap: ${(err as Error).message}`,
            },
          ],
          isError: true,
        };
      }
    },
  });
}
