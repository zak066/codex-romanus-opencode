/**
 * Test di integrazione per i 4 nuovi tool di Ianus Liminalis:
 *   fs_move  (move-file.ts)
 *   fs_copy  (copy-file.ts)
 *   fs_find  (find-file.ts)
 *   fs_append (append-file.ts)
 *
 * Ordine di esecuzione:
 *   1. fs_find   — sola lettura, non modifica
 *   2. fs_copy   — copia, non distrugge l'originale
 *   3. fs_append — modifica ma non sposta
 *   4. fs_move   — modifica e sposta (last per non interferire)
 *
 * Ogni describe usa file dedicati per evitare contaminazioni tra test.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { existsSync } from 'node:fs';

import { PermissionChecker } from '../src/core/permission.js';
import { BackupManager } from '@codex-romanus/fs-backup';
import { toolRegistry } from '../src/tools/registry.js';
import { registerMoveFile } from '../src/tools/move-file.js';
import { registerCopyFile } from '../src/tools/copy-file.js';
import { registerFindFile } from '../src/tools/find-file.js';
import { registerAppendFile } from '../src/tools/append-file.js';
import type { ToolDeps } from '../src/tools/types.js';

// ---------------------------------------------------------------------------
// Setup — condiviso tra tutti i describe
// ---------------------------------------------------------------------------
let workDir: string;
let backupDir: string;
let deps: ToolDeps;

function callTool(name: string, args: Record<string, unknown>) {
  const tool = toolRegistry.get(name);
  if (!tool) throw new Error(`Tool "${name}" not registered`);
  return tool.handler(args);
}

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'ianus-mcfa-'));
  backupDir = await mkdtemp(join(tmpdir(), 'ianus-mcfa-bak-'));

  // ── Struttura di test condivisa ──────────────────────────────────────
  // Tutte le operazioni di scrittura usano file dedicati per describe
  // diversi, quindi non c'è contaminazione.

  // File per fs_move
  await writeFile(join(workDir, 'move_me.txt'), 'contenuto da spostare', 'utf-8');
  await mkdir(join(workDir, 'subdir'), { recursive: true });
  await writeFile(join(workDir, 'subdir', 'nested.txt'), 'nested content', 'utf-8');

  // File per fs_copy
  await writeFile(join(workDir, 'copy_me.txt'), 'contenuto da copiare', 'utf-8');
  await writeFile(join(workDir, 'existing_dest.txt'), 'destinazione esistente', 'utf-8');

  // File per fs_append
  await writeFile(join(workDir, 'append_to_me.txt'), 'contenuto iniziale\n', 'utf-8');
  await writeFile(join(workDir, 'notes.txt'), 'una nota', 'utf-8');

  // Struttura annidata per fs_find
  await mkdir(join(workDir, 'deep', 'nested', 'dir'), { recursive: true });
  await writeFile(join(workDir, 'deep', 'nested', 'dir', 'deep_file.txt'), 'deep', 'utf-8');

  // ── Deps e registrazione ─────────────────────────────────────────────
  const permission = new PermissionChecker({
    version: 1,
    defaultEffect: 'allow',
    rules: [],
  });
  const backup = new BackupManager({ backupDir, retentionDays: 1 });
  deps = { workspaceRoot: workDir, permission, backup };

  const mockServer = {} as never;
  registerMoveFile(mockServer, deps);
  registerCopyFile(mockServer, deps);
  registerFindFile(mockServer, deps);
  registerAppendFile(mockServer, deps);
});

afterAll(async () => {
  await rm(workDir, { recursive: true, force: true });
  await rm(backupDir, { recursive: true, force: true });
});

// ===========================================================================
// fs_find  — ricerca file per pattern glob (sola lettura)
// ===========================================================================
describe('fs_find', () => {
  it('trova tutti i file .txt con pattern **/*.txt', async () => {
    const res = await callTool('fs_find', { pattern: '**/*.txt' });
    expect(res.isError).toBeFalsy();
    const results = JSON.parse(res.content[0].text);
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThanOrEqual(3);
    for (const r of results) {
      expect(r).toHaveProperty('path');
      expect(r).toHaveProperty('size');
      expect(r).toHaveProperty('mtime');
      expect(r.path).toMatch(/\.txt$/);
    }
  });

  it('trova file specifico con pattern **/move_me.*', async () => {
    const res = await callTool('fs_find', { pattern: '**/move_me.*' });
    expect(res.isError).toBeFalsy();
    const results = JSON.parse(res.content[0].text);
    expect(results.length).toBe(1);
    expect(results[0].path).toBe('move_me.txt');
  });

  it('restituisce array vuoto per pattern senza match (**/*.xyz)', async () => {
    const res = await callTool('fs_find', { pattern: '**/*.xyz' });
    expect(res.isError).toBeFalsy();
    const results = JSON.parse(res.content[0].text);
    expect(results).toEqual([]);
  });

  it('errore per parametro pattern mancante', async () => {
    const res = await callTool('fs_find', {} as never);
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('Missing required parameter: "pattern"');
  });

  it('trova file annidato con pattern **/deep_file.txt', async () => {
    const res = await callTool('fs_find', { pattern: '**/deep_file.txt' });
    expect(res.isError).toBeFalsy();
    const results = JSON.parse(res.content[0].text);
    expect(results.length).toBe(1);
    expect(results[0].path).toBe('deep/nested/dir/deep_file.txt');
  });

  it('i risultati sono ordinati per mtime (più recenti prima)', async () => {
    const res = await callTool('fs_find', { pattern: '**/*.txt' });
    expect(res.isError).toBeFalsy();
    const results = JSON.parse(res.content[0].text);
    expect(results.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < results.length; i++) {
      const prev = new Date(results[i - 1].mtime).getTime();
      const curr = new Date(results[i].mtime).getTime();
      expect(prev).toBeGreaterThanOrEqual(curr);
    }
  });
});

// ===========================================================================
// fs_copy  — copia file (non distrugge l'originale)
// ===========================================================================
describe('fs_copy', () => {
  it('copia file e verifica contenuto identico su disco', async () => {
    const res = await callTool('fs_copy', {
      source: 'copy_me.txt',
      destination: 'copied_output.txt',
    });
    expect(res.isError).toBeFalsy();
    const data = JSON.parse(res.content[0].text);
    expect(data.copied).toBe(true);
    expect(typeof data.size).toBe('number');
    expect(data.size).toBeGreaterThan(0);
    // backupId assente perché la destinazione non esisteva
    expect(data.backupId).toBeUndefined();

    // Source deve ancora esistere
    expect(existsSync(join(workDir, 'copy_me.txt'))).toBe(true);
    // Dest deve avere stesso contenuto
    const srcContent = await readFile(join(workDir, 'copy_me.txt'), 'utf-8');
    const dstContent = await readFile(join(workDir, 'copied_output.txt'), 'utf-8');
    expect(dstContent).toBe(srcContent);
  });

  it('errore se destination esiste e overwrite=false', async () => {
    const res = await callTool('fs_copy', {
      source: 'copy_me.txt',
      destination: 'existing_dest.txt',
      overwrite: false,
    });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/^Destination ".*" already exists/);
  });

  it('sovrascrive destination con overwrite=true e produce backupId', async () => {
    const res = await callTool('fs_copy', {
      source: 'copy_me.txt',
      destination: 'existing_dest.txt',
      overwrite: true,
    });
    expect(res.isError).toBeFalsy();
    const data = JSON.parse(res.content[0].text);
    expect(data.copied).toBe(true);
    // backupId deve essere presente perché la destinazione esisteva
    expect(data.backupId).toBeDefined();
    expect(typeof data.backupId).toBe('string');

    // Contenuto sovrascritto
    const dstContent = await readFile(join(workDir, 'existing_dest.txt'), 'utf-8');
    expect(dstContent).toBe('contenuto da copiare');
  });

  it('errore per parametro source mancante', async () => {
    const res = await callTool('fs_copy', { destination: 'foo.txt' } as never);
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('Missing required parameter: "source"');
  });

  it('errore per parametro destination mancante', async () => {
    const res = await callTool('fs_copy', { source: 'foo.txt' } as never);
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('Missing required parameter: "destination"');
  });
});

// ===========================================================================
// fs_append  — aggiunge testo a fine file (crea se non esiste)
// ===========================================================================
describe('fs_append', () => {
  const APPENDED_TEXT = 'contenuto aggiunto';

  it('appende a file esistente e verifica su disco', async () => {
    const res = await callTool('fs_append', {
      path: 'append_to_me.txt',
      content: APPENDED_TEXT,
    });
    expect(res.isError).toBeFalsy();
    const data = JSON.parse(res.content[0].text);
    expect(data.appended).toBe(true);
    expect(data.path).toBe('append_to_me.txt');
    expect(data.size).toBe(Buffer.byteLength(APPENDED_TEXT, 'utf-8'));

    // Contenuto su disco: iniziale + appeso
    const disk = await readFile(join(workDir, 'append_to_me.txt'), 'utf-8');
    expect(disk).toBe('contenuto iniziale\n' + APPENDED_TEXT);
  });

  it('appende a file inesistente (lo crea)', async () => {
    const newFilePath = 'brand_new_file.txt';
    const newContent = 'creato via append';

    // Verifica che non esista
    expect(existsSync(join(workDir, newFilePath))).toBe(false);

    const res = await callTool('fs_append', {
      path: newFilePath,
      content: newContent,
    });
    expect(res.isError).toBeFalsy();
    const data = JSON.parse(res.content[0].text);
    expect(data.appended).toBe(true);
    expect(data.path).toBe(newFilePath);
    expect(data.size).toBe(Buffer.byteLength(newContent, 'utf-8'));

    // Verifica su disco
    const disk = await readFile(join(workDir, newFilePath), 'utf-8');
    expect(disk).toBe(newContent);
  });

  it('appendi multipli concatenano correttamente', async () => {
    const multiFile = 'multi_append.txt';

    await callTool('fs_append', { path: multiFile, content: 'primo\n' });
    await callTool('fs_append', { path: multiFile, content: 'secondo\n' });
    const res = await callTool('fs_append', { path: multiFile, content: 'terzo' });

    expect(res.isError).toBeFalsy();
    const data = JSON.parse(res.content[0].text);
    expect(data.appended).toBe(true);
    expect(data.path).toBe(multiFile);

    const disk = await readFile(join(workDir, multiFile), 'utf-8');
    expect(disk).toBe('primo\nsecondo\nterzo');
  });

  it('errore per parametro path mancante', async () => {
    const res = await callTool('fs_append', { content: 'test' } as never);
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('Missing required parameter: "path"');
  });

  it('errore per parametro content mancante', async () => {
    const res = await callTool('fs_append', { path: 'foo.txt' } as never);
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('Missing required parameter: "content"');
  });
});

// ===========================================================================
// fs_move  — sposta/rinomina file (modifica lo stato del filesystem)
// ===========================================================================
describe('fs_move', () => {
  // Ricrea move_me.txt prima di ogni test perché lo spostiamo via
  beforeEach(async () => {
    await writeFile(join(workDir, 'move_me.txt'), 'contenuto da spostare', 'utf-8');
    // Assicura che subdir esista
    await mkdir(join(workDir, 'subdir'), { recursive: true });
    // Rimuovi eventuali residui da test precedenti
    const residues = ['moved_dest.txt', 'subdir/moved_inside_dir/moved.txt',
      join(workDir, 'renamed.txt'), join(workDir, 'subdir', 'moved_inside.txt')];
    for (const r of residues) {
      if (existsSync(r)) {
        await rm(r, { force: true });
      }
    }
  });

  it('sposta file da move_me.txt a moved_dest.txt', async () => {
    const res = await callTool('fs_move', {
      source: 'move_me.txt',
      destination: 'moved_dest.txt',
    });
    expect(res.isError).toBeFalsy();
    const data = JSON.parse(res.content[0].text);
    expect(data.moved).toBe(true);
    expect(data.destination).toBe('moved_dest.txt');
    expect(data.backupId).toBeDefined();
    expect(typeof data.backupId).toBe('string');

    // Source non deve più esistere
    expect(existsSync(join(workDir, 'move_me.txt'))).toBe(false);
    // Dest deve esistere con contenuto originale
    const disk = await readFile(join(workDir, 'moved_dest.txt'), 'utf-8');
    expect(disk).toBe('contenuto da spostare');
  });

  it('rinomina file (stessa directory, nome diverso)', async () => {
    const res = await callTool('fs_move', {
      source: 'move_me.txt',
      destination: 'renamed.txt',
    });
    expect(res.isError).toBeFalsy();
    const data = JSON.parse(res.content[0].text);
    expect(data.moved).toBe(true);
    expect(data.destination).toBe('renamed.txt');

    expect(existsSync(join(workDir, 'move_me.txt'))).toBe(false);
    expect(existsSync(join(workDir, 'renamed.txt'))).toBe(true);
  });

  it('sposta in sottodirectory (con creazione automatica path)', async () => {
    const res = await callTool('fs_move', {
      source: 'move_me.txt',
      destination: 'subdir/moved_inside_dir/moved.txt',
    });
    expect(res.isError).toBeFalsy();
    const data = JSON.parse(res.content[0].text);
    expect(data.moved).toBe(true);
    expect(data.destination).toBe('subdir/moved_inside_dir/moved.txt');

    // Source non deve più esistere
    expect(existsSync(join(workDir, 'move_me.txt'))).toBe(false);
    // Dest deve esistere
    const disk = await readFile(
      join(workDir, 'subdir', 'moved_inside_dir', 'moved.txt'),
      'utf-8',
    );
    expect(disk).toBe('contenuto da spostare');
  });

  it('errore per parametro source mancante', async () => {
    const res = await callTool('fs_move', { destination: 'x.txt' } as never);
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('Missing required parameter: "source"');
  });

  it('errore per parametro destination mancante', async () => {
    const res = await callTool('fs_move', { source: 'x.txt' } as never);
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('Missing required parameter: "destination"');
  });

  it('blocca path traversal (source fuori workspace)', async () => {
    // Il tool chiama resolveSafePath che lancia errore per path traversal
    const res = await callTool('fs_move', {
      source: '../../outside.txt',
      destination: 'safe.txt',
    });
    expect(res.isError).toBe(true);
        expect(res.content[0].text).toContain('Permission denied');
  });
});
