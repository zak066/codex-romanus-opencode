/**
 * Test di integrazione per i tool:
 *   fs_read_multiple — lettura multipla di file
 *   fs_mkdir        — creazione directory
 *
 * Struttura:
 *   1. fs_read_multiple — lettura di 1+ file con encoding e gestione errori
 *   2. fs_mkdir         — creazione directory singola/ricorsiva con force
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';

import { PermissionChecker } from '../src/core/permission.js';
import { BackupManager } from '@codex-romanus/fs-backup';
import { toolRegistry } from '../src/tools/registry.js';
import { registerReadMultipleFile } from '../src/tools/read-multiple-file.js';
import { registerMkdirFile } from '../src/tools/mkdir-file.js';
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
  workDir = await mkdtemp(join(tmpdir(), 'ianus-rm-'));
  backupDir = await mkdtemp(join(tmpdir(), 'ianus-rm-bak-'));

  // ── File per fs_read_multiple ──────────────────────────────────────────
  await writeFile(join(workDir, 'alpha.txt'), 'Contenuto di Alpha', 'utf-8');
  await writeFile(join(workDir, 'beta.txt'), 'Beta content here', 'utf-8');
  await writeFile(join(workDir, 'unicode.txt'), 'Caffè Müller — 日本語', 'utf-8');

  // ── Directory per fs_mkdir ────────────────────────────────────────────
  await mkdir(join(workDir, 'existing_dir'), { recursive: true });

  // ── Deps e registrazione ──────────────────────────────────────────────
  const permission = new PermissionChecker({
    version: 1,
    defaultEffect: 'allow',
    rules: [],
  });
  const backup = new BackupManager({ backupDir, retentionDays: 1 });
  deps = { workspaceRoot: workDir, permission, backup };

  const mockServer = {} as never;
  registerReadMultipleFile(mockServer, deps);
  registerMkdirFile(mockServer, deps);
});

afterAll(async () => {
  await rm(workDir, { recursive: true, force: true });
  await rm(backupDir, { recursive: true, force: true });
});

// ===========================================================================
// fs_read_multiple  —  lettura multipla di file
// ===========================================================================
describe('fs_read_multiple', () => {
  it('legge 2 file esistenti con encoding utf-8 predefinito', async () => {
    const res = await callTool('fs_read_multiple', {
      paths: ['alpha.txt', 'beta.txt'],
    });
    expect(res.isError).toBeFalsy();
    const data = JSON.parse(res.content[0].text);
    expect(data.total).toBe(2);
    expect(data.errors).toEqual([]);
    expect(data.files).toHaveLength(2);

    const alpha = data.files.find((f: { path: string }) => f.path === 'alpha.txt');
    expect(alpha).toBeDefined();
    expect(alpha.content).toBe('Contenuto di Alpha');
    expect(alpha.size).toBe(18);
    expect(alpha.hash).toBe(
      createHash('sha256').update('Contenuto di Alpha').digest('hex'),
    );
    expect(alpha.mtime).toBeDefined();
    expect(typeof alpha.mtime).toBe('string');

    const beta = data.files.find((f: { path: string }) => f.path === 'beta.txt');
    expect(beta).toBeDefined();
    expect(beta.content).toBe('Beta content here');
    expect(beta.hash).toBe(
      createHash('sha256').update('Beta content here').digest('hex'),
    );
  });

  it('legge file con encoding base64', async () => {
    const res = await callTool('fs_read_multiple', {
      paths: ['alpha.txt'],
      encoding: 'base64',
    });
    expect(res.isError).toBeFalsy();
    const data = JSON.parse(res.content[0].text);
    expect(data.total).toBe(1);
    expect(data.errors).toEqual([]);
    const file = data.files[0];
    expect(file.content).toBe(
      Buffer.from('Contenuto di Alpha', 'utf-8').toString('base64'),
    );
    expect(file.hash).toBe(
      createHash('sha256').update('Contenuto di Alpha').digest('hex'),
    );
    // size deve essere la dimensione RAW del file, non della stringa base64
    expect(file.size).toBe(18);
  });

  it('path inesistente → array errors popolato, non crash', async () => {
    const res = await callTool('fs_read_multiple', {
      paths: ['alpha.txt', 'notfound.txt', 'alsonotfound.md'],
    });
    expect(res.isError).toBeFalsy();
    const data = JSON.parse(res.content[0].text);
    expect(data.total).toBe(1);
    expect(data.errors).toHaveLength(2);
    expect(data.errors[0].path).toBe('notfound.txt');
    expect(data.errors[0].error).toBeDefined();
    expect(typeof data.errors[0].error).toBe('string');
    expect(data.errors[1].path).toBe('alsonotfound.md');
    // Il file letto con successo deve essere presente e corretto
    expect(data.files).toHaveLength(1);
    expect(data.files[0].path).toBe('alpha.txt');
    expect(data.files[0].content).toBe('Contenuto di Alpha');
  });

  it('paths vuoto → errore', async () => {
    const res = await callTool('fs_read_multiple', { paths: [] });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('Missing required parameter');
  });

  it('11 file → errore per limite superato (max 10)', async () => {
    const paths = Array.from({ length: 11 }, (_, i) => `file${i}.txt`);
    const res = await callTool('fs_read_multiple', { paths });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('Too many paths');
    expect(res.content[0].text).toContain('11');
    expect(res.content[0].text).toContain('10');
  });

  it('encoding non valido → errore', async () => {
    const res = await callTool('fs_read_multiple', {
      paths: ['alpha.txt'],
      encoding: 'invalid',
    });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('Invalid encoding');
    expect(res.content[0].text).toContain('utf-8, base64, hex');
  });

  it('legge file con encoding hex', async () => {
    const res = await callTool('fs_read_multiple', {
      paths: ['beta.txt'],
      encoding: 'hex',
    });
    expect(res.isError).toBeFalsy();
    const data = JSON.parse(res.content[0].text);
    expect(data.total).toBe(1);
    expect(data.errors).toEqual([]);
    const file = data.files[0];
    expect(file.content).toBe(
      Buffer.from('Beta content here', 'utf-8').toString('hex'),
    );
    expect(file.size).toBe(17);
  });

  it('paths mancante (undefined) → errore', async () => {
    const res = await callTool('fs_read_multiple', {} as never);
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('Missing required parameter');
  });
});

// ===========================================================================
// fs_mkdir  —  creazione directory
// ===========================================================================
describe('fs_mkdir', () => {
  it('crea directory singola → esiste su filesystem', async () => {
    const res = await callTool('fs_mkdir', { path: 'my_new_dir' });
    expect(res.isError).toBeFalsy();
    const data = JSON.parse(res.content[0].text);
    expect(data.created).toBe(true);
    expect(data.path).toBe('my_new_dir');
    expect(data.recursive).toBe(true);
    expect(data.existed).toBe(false);

    // Verifica su filesystem
    const statResult = await stat(join(workDir, 'my_new_dir'));
    expect(statResult.isDirectory()).toBe(true);
  });

  it('crea directory ricorsiva → albero creato', async () => {
    const res = await callTool('fs_mkdir', {
      path: 'a/b/c/d',
      recursive: true,
    });
    expect(res.isError).toBeFalsy();
    const data = JSON.parse(res.content[0].text);
    expect(data.created).toBe(true);
    expect(data.path).toBe('a/b/c/d');
    expect(data.existed).toBe(false);

    // Verifica che l'intero albero sia stato creato
    const statResult = await stat(join(workDir, 'a', 'b', 'c', 'd'));
    expect(statResult.isDirectory()).toBe(true);
  });

  it('directory già esistente senza force → errore', async () => {
    const res = await callTool('fs_mkdir', { path: 'existing_dir' });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('already exists');
  });

  it('directory già esistente con force=true → created: false, existed: true', async () => {
    const res = await callTool('fs_mkdir', {
      path: 'existing_dir',
      force: true,
    });
    expect(res.isError).toBeFalsy();
    const data = JSON.parse(res.content[0].text);
    expect(data.created).toBe(false);
    expect(data.path).toBe('existing_dir');
    expect(data.existed).toBe(true);
  });

  it('path vuoto → errore', async () => {
    const res = await callTool('fs_mkdir', {} as never);
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('Missing required parameter');
  });

  it('path traversal → Permission denied', async () => {
    const res = await callTool('fs_mkdir', { path: '../../outside_dir' });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('Permission denied');
  });
});
