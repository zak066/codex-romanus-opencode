// ============================================================
// Praetorium — Packager Module
// Crea archivi .zip del progetto Codex Romanus usando archiver.
// ============================================================

import { ZipArchive } from 'archiver';
import { createWriteStream, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { PackageOptions, PackageResult } from './types';

// Server → directory name nel progetto
const SERVER_DIRS: Record<string, string> = {
  tabularium: 'tabularium',
  ianus: 'ianus-liminalis',
  speculum: 'speculum',
  praetorium: 'praetorium',
  imago: 'imago',
  nuntius: 'nuntius',
};

// File di root da includere sempre
const ROOT_FILES = [
  'package.json',
  'eslint.config.js',
  '.gitignore',
  '.gitattributes',
  'AGENTS.md',
  'README.md',
];

// File di setup
const SETUP_FILES = [
  'setup-codex.ps1',
  'reset-codex.ps1',
  'switch-team.ps1',
  '.codex-romanus.rc',
];

/**
 * Crea un archivio .zip del progetto Codex Romanus.
 */
export async function createPackage(
  options: PackageOptions,
  projectRoot: string,
  outputDir: string,
): Promise<PackageResult> {
  const now = new Date();
  const yyyymmdd = now.toISOString().slice(0, 10).replace(/-/g, '');
  const fileName = `codex-romanum-${yyyymmdd}.zip`;
  const outputPath = join(outputDir, fileName);

  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  const output = createWriteStream(outputPath);
  const archive = new ZipArchive();

  archive.pipe(output);

  const closePromise = new Promise<void>((resolve, reject) => {
    output.once('close', () => resolve());
    output.once('error', (err) => reject(err));
  });

  let fileCount = 0;
  archive.on('entry', (entry: { type: string }) => {
    if (entry.type === 'file') fileCount++;
  });

  try {
    // === 1. Server selezionati ===
    for (const [key, dirName] of Object.entries(SERVER_DIRS)) {
      const servers = options.servers as Record<string, boolean>;
      if (!servers[key]) continue;
      const dirPath = join(projectRoot, dirName);
      if (existsSync(dirPath)) {
        archive.directory(dirPath, dirName);
      }
    }

    // === 2. Documentazione ===
    if (options.includeDocs) {
      const docsPath = join(projectRoot, 'docs');
      if (existsSync(docsPath)) {
        archive.directory(docsPath, 'docs');
      }
    }

    // === 3. Template integrazione ===
    if (options.includeTemplates) {
      const templatesPath = join(projectRoot, 'templates');
      if (existsSync(templatesPath)) {
        archive.directory(templatesPath, 'templates');
      }
    }

    // === 4. Setup scripts ===
    if (options.includeSetup) {
      for (const file of SETUP_FILES) {
        const filePath = join(projectRoot, file);
        if (existsSync(filePath)) {
          archive.file(filePath, { name: file });
        }
      }
    }

    // === 5. fs-backup ===
    if (options.includeFsBackup) {
      const backupPath = join(projectRoot, 'packages', 'fs-backup');
      if (existsSync(backupPath)) {
        archive.directory(backupPath, 'packages/fs-backup');
      }
    }

    // === 6. Agenti ===
    if (options.includeAgents) {
      const agentsPath = join(projectRoot, '.opencode', 'agents');
      if (existsSync(agentsPath)) {
        archive.directory(agentsPath, '.opencode/agents');
      }
    }

    // === 7. Skill ===
    if (options.includeSkills) {
      const skillsPath = join(projectRoot, '.opencode', 'skills');
      if (existsSync(skillsPath)) {
        archive.directory(skillsPath, '.opencode/skills');
      }
    }

    // === 8. File di root ===
    for (const file of ROOT_FILES) {
      const filePath = join(projectRoot, file);
      if (existsSync(filePath)) {
        archive.file(filePath, { name: file });
      }
    }

    // === 9. Finalizza ===
    await archive.finalize();
    await closePromise;

    return {
      success: true,
      fileName,
      sizeBytes: archive.pointer(),
      fileCount,
      generatedAt: now.toISOString(),
      options,
    };
  } catch (err) {
    archive.destroy();
    throw err;
  }
}
