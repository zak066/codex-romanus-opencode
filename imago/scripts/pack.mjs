#!/usr/bin/env node

/**
 * scripts/pack.mjs — Imago Portable Build & Pack
 *
 * Crea una copia pronta all'uso di Imago (imago-portable/) per essere
 * copiata e utilizzata in altri progetti.
 *
 * Uso:
 *   node scripts/pack.mjs
 *
 * Requisiti:
 *   - Node.js >= 22
 *   - TypeScript compilatore (tsc) disponibile (npm install già eseguito)
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'imago-portable');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function countFiles(dir) {
  let count = 0;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      count += countFiles(fullPath);
    } else {
      count += 1;
    }
  }
  return count;
}

function getDirSize(dir) {
  let size = 0;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      size += getDirSize(fullPath);
    } else {
      size += fs.statSync(fullPath).size;
    }
  }
  return size;
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Recursively copy a directory, excluding specific file/directory names.
 */
function copyRecursive(src, dest, exclude = []) {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    if (exclude.includes(entry.name)) continue;
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyRecursive(s, d, exclude);
    } else {
      fs.copyFileSync(s, d);
    }
  }
}

// ---------------------------------------------------------------------------
// ANSI styler (falls back to plain text if not a TTY)
// ---------------------------------------------------------------------------

const isTTY = process.stdout.isTTY;
function style(code) {
  return (s) => (isTTY ? `\x1b[${code}m${s}\x1b[0m` : s);
}

const colors = {
  green: style('32'),
  red: style('31'),
  yellow: style('33'),
  cyan: style('36'),
  bold: style('1'),
};

function error(msg) {
  console.error(`\n${colors.red('✖')} ${msg}\n`);
  process.exit(1);
}

function info(msg) {
  console.log(`  ${colors.cyan('→')} ${msg}`);
}

function ok(msg) {
  console.log(`  ${colors.green('✔')} ${msg}`);
}

function step(msg) {
  console.log(`\n${colors.bold(msg)}`);
}

// ===========================================================================
// Main
// ===========================================================================

(function main() {
  // ----- Header -----
  console.log();
  console.log(colors.bold('══════════════════════════════════════'));
  console.log(colors.bold('  Imago — Portable Build & Pack'));
  console.log(colors.bold('══════════════════════════════════════'));
  console.log();

  // -----------------------------------------------------------------------
  // Step 1 — Check prerequisites
  // -----------------------------------------------------------------------
  step('📋 Verifica prerequisiti...');

  // Node.js version
  const nodeVersion = process.versions.node;
  const major = parseInt(nodeVersion.split('.')[0], 10);
  if (major < 22) {
    error(`Node.js >= 22 richiesta, trovata ${nodeVersion}`);
  }
  ok(`Node.js ${nodeVersion}`);

  // tsc availability
  try {
    execSync('npx tsc --version', { cwd: ROOT, stdio: 'pipe' });
  } catch {
    error(
      'Compilatore TypeScript (tsc) non trovato.\n' +
        '  Esegui "npm install" prima di lanciare questo script.'
    );
  }
  ok('TypeScript compiler (tsc)');

  // -----------------------------------------------------------------------
  // Step 2 — Build (only if dist/ missing or empty)
  // -----------------------------------------------------------------------
  step('🔧 Build...');

  const distPath = path.join(ROOT, 'dist');
  const distExists = fs.existsSync(distPath);
  const distEmpty =
    distExists && fs.readdirSync(distPath).length === 0;

  if (!distExists || distEmpty) {
    info('dist/ mancante o vuoto — eseguo build...');
    execSync('npm run build', { cwd: ROOT, stdio: 'inherit' });
    ok('Build completato');
  } else {
    ok('dist/ già presente, salto build');
  }

  // Double-check dist/ after build
  if (!fs.existsSync(distPath) || fs.readdirSync(distPath).length === 0) {
    error('dist/ ancora vuoto dopo la build. Verifica errori di compilazione.');
  }

  // -----------------------------------------------------------------------
  // Step 3 — Prepare output directory
  // -----------------------------------------------------------------------
  step('📦 Preparazione output...');

  if (fs.existsSync(OUT)) {
    fs.rmSync(OUT, { recursive: true });
    info('Pulito imago-portable/ esistente');
  }
  fs.mkdirSync(OUT, { recursive: true });
  ok('Directory imago-portable/ creata');

  // -----------------------------------------------------------------------
  // Step 4 — Copy files
  // -----------------------------------------------------------------------
  step('📄 Copia file...');

  // dist/
  copyRecursive(distPath, path.join(OUT, 'dist'));
  const distFileCount = countFiles(path.join(OUT, 'dist'));
  ok(`dist/  (${distFileCount} file)`);

  // workflows/ (skip .gitkeep)
  copyRecursive(path.join(ROOT, 'workflows'), path.join(OUT, 'workflows'), [
    '.gitkeep',
  ]);
  const wfCount = countFiles(path.join(OUT, 'workflows'));
  ok(`workflows/  (${wfCount} file)`);

  // package.json
  fs.copyFileSync(
    path.join(ROOT, 'package.json'),
    path.join(OUT, 'package.json')
  );
  ok('package.json');

  // package-lock.json (optional)
  const pkgLockSrc = path.join(ROOT, 'package-lock.json');
  if (fs.existsSync(pkgLockSrc)) {
    fs.copyFileSync(pkgLockSrc, path.join(OUT, 'package-lock.json'));
    ok('package-lock.json');
  } else {
    info('package-lock.json non trovato, saltato');
  }

  // .env.example
  fs.copyFileSync(
    path.join(ROOT, '.env.example'),
    path.join(OUT, '.env.example')
  );
  ok('.env.example');

  // README.md
  fs.copyFileSync(path.join(ROOT, 'README.md'), path.join(OUT, 'README.md'));
  ok('README.md');

  // -----------------------------------------------------------------------
  // Step 5 — Generate install scripts
  // -----------------------------------------------------------------------
  step('📝 Generazione script installazione...');

  // install.bat (Windows)
  const batContent = `@echo off
echo Installing Imago dependencies...
call npm install
echo.
echo ========================================
echo  Imago pronto!
echo.
echo  Per avviare:
echo    copy .env.example .env
echo    npm start
echo ========================================
`;
  fs.writeFileSync(path.join(OUT, 'install.bat'), batContent, 'utf-8');
  ok('install.bat  (Windows)');

  // install.sh (Unix/macOS)
  const shContent = `#!/bin/bash
echo "Installing Imago dependencies..."
npm install
echo ""
echo "========================================"
echo " Imago ready!"
echo ""
echo " To start:"
echo "   cp .env.example .env"
echo "   npm start"
echo "========================================"
`;
  fs.writeFileSync(path.join(OUT, 'install.sh'), shContent, 'utf-8');
  // Make executable on Unix-likes (best-effort on Windows)
  try {
    fs.chmodSync(path.join(OUT, 'install.sh'), 0o755);
  } catch {
    // Windows does not support chmod — ignore
  }
  ok('install.sh  (Unix/macOS)');

  // -----------------------------------------------------------------------
  // Step 6 — Summary
  // -----------------------------------------------------------------------
  step('📊 Riepilogo');

  const totalFiles = countFiles(OUT);
  const totalSize = getDirSize(OUT);

  console.log(`  ${colors.cyan('Directory output:')}  ${colors.bold('imago-portable/')}`);
  console.log(`  ${colors.cyan('Percorso assoluto:')}  ${OUT}`);
  console.log(`  ${colors.cyan('File copiati:')}      ${totalFiles}`);
  console.log(`  ${colors.cyan('Dimensione:')}         ${formatSize(totalSize)}`);
  console.log();
  console.log(colors.bold('  Per utilizzare Imago in un altro progetto:'));
  console.log(`   1. Copia la cartella ${colors.yellow('imago-portable/')} nella destinazione`);
  console.log(`   2. ${colors.yellow('cd imago-portable')}`);
  console.log(`   3. ${colors.yellow('install.bat')} (Windows) o ${colors.yellow('chmod +x install.sh && ./install.sh')} (Unix)`);
  console.log(`   4. ${colors.yellow('copy .env.example .env')} (Windows) o ${colors.yellow('cp .env.example .env')} (Unix)`);
  console.log(`   5. ${colors.yellow('npm start')}`);
  console.log();
  console.log(colors.green('✅  Pack completato con successo!'));
  console.log();
})();
