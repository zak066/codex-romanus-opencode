/**
 * fs_doc_scaffold — Ianus Liminalis
 *
 * Genera scaffolding per file di documentazione standard:
 * README.md, CHANGELOG.md, CONTRIBUTING.md, LICENSE, SECURITY.md.
 * Supporta template variabili (nome progetto, descrizione, autore, licenza).
 */

import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { writeFile, mkdir, access } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { resolveSafePath } from '../core/path-utils.js';
import { logToJournal } from '../core/journal-logger.js';
import { stats as serverStats } from '../core/stats.js';
import { toolRegistry } from './registry.js';
import type { ToolDeps } from './types.js';

// ────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────

type DocType = 'readme' | 'changelog' | 'contributing' | 'license' | 'security';
type LicenseType = 'MIT' | 'Apache-2.0' | 'GPL-3.0';

interface DocScaffoldArgs {
  type: DocType | 'all';
  output: string;
  name: string;
  description?: string;
  author?: string;
  license?: string;
  overwrite?: boolean;
}

interface DocScaffoldResult {
  type: string | string[];
  files: string[];
  baseDir: string;
}

// ────────────────────────────────────────────────────────────
// Template Generators
// ────────────────────────────────────────────────────────────

/**
 * Genera il contenuto del template README.md.
 */
function generateReadme(name: string, description?: string, author?: string, license?: string): string {
  const desc = description ?? `A brief description of ${name}.`;
  const authorLine = author ? `\n\n© ${new Date().getFullYear()} ${author}` : '';
  const licenseLine = license ? `\n\n${license}${authorLine}` : authorLine;

  return `# ${name}

${desc}

## Installazione

\`\`\`bash
npm install ${name.toLowerCase()}
\`\`\`

## Utilizzo

\`\`\`typescript
import { /* ... */ } from '${name.toLowerCase()}';

// Esempio di utilizzo
const result = await /* ... */;
console.log(result);
\`\`\`

## API

### \`functionName(params)\`

Descrizione della funzione.

## Contributi

Vedi [CONTRIBUTING.md](./CONTRIBUTING.md)

## Licenza

${licenseLine.trim()}
`;
}

/**
 * Genera il contenuto del template CHANGELOG.md (Keep a Changelog).
 */
function generateChangelog(): string {
  const today = new Date().toISOString().split('T')[0];

  return `# Changelog

Tutte le modifiche notevoli a questo progetto saranno documentate in questo file.

Il formato è basato su [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
e il progetto aderisce al [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - ${today}

### Added

- Implementazione iniziale del progetto
`;
}

/**
 * Genera il contenuto del template CONTRIBUTING.md.
 */
function generateContributing(): string {
  return `# Contributing

Grazie per il tuo interesse nel contribuire a questo progetto!

## Come contribuire

1. **Forka** il repository
2. **Crea un branch** per la tua feature (\`git checkout -b feat/nome-feature\`)
3. **Commit** i tuoi cambiamenti (\`git commit -m 'feat: aggiungi nuova funzionalità'\`)
4. **Push** sul branch (\`git push origin feat/nome-feature\`)
5. Apri una **Pull Request**

## Branch Strategy

| Prefixo | Scopo |
|---------|-------|
| \`feat/\` | Nuove funzionalità |
| \`fix/\` | Bug fix |
| \`docs/\` | Modifiche alla documentazione |
| \`refactor/\` | Refactoring del codice |
| \`test/\` | Aggiunta o modifica di test |
| \`chore/\` | Manutenzione, dipendenze, tooling |

## Convenzioni di stile

- Segui le regole ESLint/Prettier configurate nel progetto
- Scrivi test per le nuove funzionalità
- Mantieni la copertura dei test sopra l'80%
- Usa commit semantici (conventional commits)

## Pull Request Process

1. Assicurati che tutti i test passino
2. Aggiorna la documentazione se necessario
3. Aggiungi una entry in CHANGELOG.md
4. La PR deve essere approvata da almeno un maintainer

## Segnalazione Bug

Usa il tracker issue del repository. Includi:

- Descrizione del bug
- Passi per riprodurlo
- Comportamento atteso vs effettivo
- Ambiente (OS, versione Node.js, ecc.)

## Richiesta Feature

Apri un issue con il label \`enhancement\` descrivendo:

- Il problema che la feature risolve
- Come dovrebbe funzionare
- Alternative considerate
`;
}

/**
 * Genera il contenuto del template LICENSE.
 */
function generateLicense(type: LicenseType, author?: string): string {
  const year = new Date().getFullYear();
  const authorName = author || 'Copyright Holder';

  switch (type) {
    case 'MIT':
      return `MIT License

Copyright (c) ${year} ${authorName}

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`;

    case 'Apache-2.0':
      return `Apache License, Version 2.0

Copyright (c) ${year} ${authorName}

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
`;

    case 'GPL-3.0':
      return `GNU GENERAL PUBLIC LICENSE, Version 3, 29 June 2007

Copyright (c) ${year} ${authorName}

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with this program.  If not, see <https://www.gnu.org/licenses/>.
`;

    default:
      return generateLicense('MIT', author);
  }
}

/**
 * Genera il contenuto del template SECURITY.md.
 */
function generateSecurity(): string {
  return `# Security Policy

## Supported Versions

| Version | Supported          |
|---------|--------------------|
| 1.x     | :white_check_mark: |
| < 1.0   | :x:                |

## Reporting a Vulnerability

Se scopri una vulnerabilità di sicurezza, **per favore non aprire un issue pubblico**.

Invece, segnalala privatamente via email a: \`security@example.com\`

Ci impegniamo a:

1. **Confermare** la ricezione della segnalazione entro 48 ore
2. **Valutare** la gravità e l'impatto entro 5 giorni lavorativi
3. **Rilasciare** una patch nel più breve tempo possibile
4. **Attribuire** il credito della scoperta al reporter (se desiderato)

## Processo di divulgazione

1. La vulnerabilità viene segnalata privatamente
2. Il team di sicurezza valuta e riproduce il problema
3. Viene preparata una patch
4. La patch viene rilasciata in una versione aggiornata
5. La vulnerabilità viene divulgata pubblicamente dopo il rilascio della patch
`;
}

// ────────────────────────────────────────────────────────────
// Doc File Generators
// ────────────────────────────────────────────────────────────

interface DocFile {
  filename: string;
  content: string;
}

/**
 * Determina quali file di documentazione generare in base al tipo richiesto.
 */
function resolveDocFiles(type: DocType | 'all', name: string, description?: string, author?: string, license?: string): DocFile[] {
  const files: DocFile[] = [];

  const createIf = (matchType: DocType, docFile: DocFile) => {
    if (type === 'all' || type === matchType) {
      files.push(docFile);
    }
  };

  createIf('readme', {
    filename: 'README.md',
    content: generateReadme(name, description, author, normalizeLicenseName(license)),
  });

  createIf('changelog', {
    filename: 'CHANGELOG.md',
    content: generateChangelog(),
  });

  createIf('contributing', {
    filename: 'CONTRIBUTING.md',
    content: generateContributing(),
  });

  createIf('license', {
    filename: 'LICENSE',
    content: generateLicense(normalizeLicenseName(license) as LicenseType, author),
  });

  createIf('security', {
    filename: 'SECURITY.md',
    content: generateSecurity(),
  });

  return files;
}

/**
 * Normalizza il nome della licenza in uno dei tipi supportati.
 */
function normalizeLicenseName(license?: string): LicenseType {
  if (!license) return 'MIT';
  const upper = license.toUpperCase();
  if (upper === 'MIT') return 'MIT';
  if (upper.includes('APACHE')) return 'Apache-2.0';
  if (upper.includes('GPL') || upper.includes('GNU')) return 'GPL-3.0';
  return 'MIT';
}

/**
 * Verifica se un file esiste.
 */
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

// ────────────────────────────────────────────────────────────
// Tool Registration
// ────────────────────────────────────────────────────────────

export function registerDocScaffold(_server: Server, deps: ToolDeps): void {
  toolRegistry.register({
    name: 'fs_doc_scaffold',
    description:
      'Generate standard documentation scaffolding files: README.md, CHANGELOG.md, ' +
      'CONTRIBUTING.md, LICENSE (MIT/Apache-2.0/GPL-3.0), and SECURITY.md. ' +
      'Supports project name, description, author, and license type variables.',
    annotations: { destructiveHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: ['readme', 'changelog', 'contributing', 'license', 'security', 'all'],
          description: 'Type of documentation file to generate, or "all" for all types',
        },
        output: {
          type: 'string',
          description: 'Output directory path (required, relative to workspace)',
        },
        name: {
          type: 'string',
          description: 'Project name (required)',
        },
        description: {
          type: 'string',
          description: 'Project description (optional)',
        },
        author: {
          type: 'string',
          description: 'Author name (optional, used in LICENSE and README)',
        },
        license: {
          type: 'string',
          default: 'MIT',
          description: 'License type: MIT, Apache-2.0, GPL-3.0 (default: MIT)',
        },
        overwrite: {
          type: 'boolean',
          default: false,
          description: 'Overwrite existing files (default: false)',
        },
        agent: {
          type: 'string',
          description: 'Nome dell agente chiamante (opzionale, default: "ianus")',
        },
      },
      required: ['type', 'output', 'name'],
    },
    handler: async (args) => {
      const docType = args.type as DocType | 'all' | undefined;
      if (!docType) {
        return { content: [{ type: 'text', text: 'Missing required parameter: "type"' }], isError: true };
      }

      const output = args.output as string | undefined;
      if (!output) {
        return { content: [{ type: 'text', text: 'Missing required parameter: "output"' }], isError: true };
      }

      const name = args.name as string | undefined;
      if (!name) {
        return { content: [{ type: 'text', text: 'Missing required parameter: "name"' }], isError: true };
      }

      const description = args.description as string | undefined;
      const author = args.author as string | undefined;
      const license = args.license as string | undefined;
      const overwrite = (args.overwrite as boolean) ?? false;
      const callerAgent = (args.agent as string) || 'ianus';

      // Permission check
      const permCheck = await deps.permission.checkOperation(
        callerAgent,
        'write',
        output,
        deps.workspaceRoot,
      );
      if (!permCheck.allowed) {
        return {
          content: [{ type: 'text', text: `Permission denied: ${permCheck.reason}` }],
          isError: true,
        };
      }

      // Valida il tipo
      const validTypes: (DocType | 'all')[] = ['readme', 'changelog', 'contributing', 'license', 'security', 'all'];
      if (!validTypes.includes(docType)) {
        return {
          content: [{ type: 'text', text: `Invalid type "${docType}". Must be one of: ${validTypes.join(', ')}` }],
          isError: true,
        };
      }

      try {
        const safeOutputPath = resolveSafePath(output, deps.workspaceRoot);

        // Assicurati che la directory di output esista
        await mkdir(safeOutputPath, { recursive: true });

        // Risolvi i file da generare
        const docFiles = resolveDocFiles(docType, name, description, author, license);

        if (docFiles.length === 0) {
          return {
            content: [{ type: 'text', text: `No documentation files matched for type "${docType}".` }],
            isError: true,
          };
        }

        // Genera i file
        const createdFiles: string[] = [];
        const skippedFiles: string[] = [];

        for (const docFile of docFiles) {
          const filePath = join(safeOutputPath, docFile.filename);
          const relPath = join(output, docFile.filename).replace(/\\/g, '/');

          // Verifica se il file esiste già
          const exists = await fileExists(filePath);
          if (exists && !overwrite) {
            skippedFiles.push(relPath);
            continue;
          }

          // Crea la directory se necessario
          await mkdir(dirname(filePath), { recursive: true });

          // Scrivi il file
          await writeFile(filePath, docFile.content, 'utf-8');
          createdFiles.push(relPath);
        }

        // Log to journal
        await logToJournal(deps.workspaceRoot, {
          agent: 'ianus',
          operation: 'doc_scaffold',
          path: output,
          details: {
            type: docType,
            name,
            created: createdFiles.length,
            skipped: skippedFiles.length,
          },
        });

        serverStats.increment();

        const result: DocScaffoldResult = {
          type: docType === 'all'
            ? docFiles.map((f) => f.filename.replace(/\.(md|txt)$/, ''))
            : docType,
          files: createdFiles,
          baseDir: output,
        };

        const messages: string[] = [];
        messages.push(JSON.stringify(result));
        if (skippedFiles.length > 0) {
          messages.push(`Skipped (already exist, use overwrite=true to replace): ${skippedFiles.join(', ')}`);
        }

        return {
          content: messages.map((m) => ({ type: 'text', text: m })),
        };
      } catch (err) {
        return {
          content: [{ type: 'text', text: `Error generating documentation scaffold: ${(err as Error).message}` }],
          isError: true,
        };
      }
    },
  });
}
