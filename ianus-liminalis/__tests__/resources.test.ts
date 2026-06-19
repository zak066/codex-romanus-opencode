/**
 * Test per le 4 Resource MCP di Ianus Liminalis:
 *   ianus://files/{path}
 *   ianus://tree/{path}
 *   ianus://journal
 *   ianus://stats
 *
 * I resource handler sono oggetti puri esportati dai moduli.
 * Testiamo match() e read() con un workspace temporaneo.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { PermissionChecker } from '../src/core/permission.js';
import { BackupManager } from '@codex-romanus/fs-backup';
import type { ToolDeps } from '../src/tools/types.js';

import { fileResourceHandler } from '../src/resources/ianus-files.js';
import { treeResourceHandler } from '../src/resources/ianus-tree.js';
import { journalResourceHandler } from '../src/resources/ianus-journal.js';
import { statsResourceHandler } from '../src/resources/ianus-stats.js';

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------
let workDir: string;
let deps: ToolDeps;

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'ianus-res-'));

  // Crea qualche file di test
  await writeFile(join(workDir, 'readme.txt'), 'Contenuto di readme', 'utf-8');
  await mkdir(join(workDir, 'lib'), { recursive: true });
  await writeFile(join(workDir, 'lib', 'util.js'), 'module.exports = {};', 'utf-8');

  const permission = new PermissionChecker({
    version: 1,
    defaultEffect: 'allow',
    rules: [],
  });
  const backup = new BackupManager({ backupDir: join(workDir, '.backups'), retentionDays: 1 });
  deps = { workspaceRoot: workDir, permission, backup };
});

afterAll(async () => {
  await rm(workDir, { recursive: true, force: true });
});

// ===========================================================================
// ianus://files/{path}
// ===========================================================================
describe('ianus://files/{path}', () => {
  it('match() estrae il path dall\'URI', () => {
    expect(fileResourceHandler.match('ianus://files/readme.txt')).toBe('readme.txt');
    expect(fileResourceHandler.match('ianus://files/lib/util.js')).toBe('lib/util.js');
    // URI non corrispondente
    expect(fileResourceHandler.match('ianus://tree/readme.txt')).toBeNull();
    expect(fileResourceHandler.match('')).toBeNull();
  });

  it('read() restituisce il contenuto testuale del file', async () => {
    const result = await fileResourceHandler.read('ianus://files/readme.txt', deps);
    expect(result.uri).toBe('ianus://files/readme.txt');
    expect(result.mimeType).toBe('text/plain');
    expect(result.text).toBe('Contenuto di readme');
  });

  it('read() lancia errore per path traversal', async () => {
    await expect(
      fileResourceHandler.read('ianus://files/../../outside.txt', deps),
    ).rejects.toThrow('Path traversal');
  });
});

// ===========================================================================
// ianus://tree/{path}
// ===========================================================================
describe('ianus://tree/{path}', () => {
  it('match() restituisce "." per path vuoto o root', () => {
    expect(treeResourceHandler.match('ianus://tree/')).toBe('.');
    expect(treeResourceHandler.match('ianus://tree/.')).toBe('.');
    expect(treeResourceHandler.match('ianus://tree/lib')).toBe('lib');
    expect(treeResourceHandler.match('ianus://tree/')).toBe('.');
  });

  it('read() restituisce albero JSON con children', async () => {
    const result = await treeResourceHandler.read('ianus://tree/.', deps);
    expect(result.uri).toBe('ianus://tree/.');
    expect(result.mimeType).toBe('application/json');

    const data = JSON.parse(result.text);
    expect(data.tree).toBeDefined();
    expect(Array.isArray(data.tree)).toBe(true);
    const names = data.tree.map((n: { name: string }) => n.name);
    expect(names).toContain('readme.txt');
    expect(names).toContain('lib');
  });
});

// ===========================================================================
// ianus://journal
// ===========================================================================
describe('ianus://journal', () => {
  it('match() matcha solo URI esatto', () => {
    expect(journalResourceHandler.match('ianus://journal')).toBe('');
    expect(journalResourceHandler.match('ianus://journal/')).toBeNull();
    expect(journalResourceHandler.match('ianus://files/journal')).toBeNull();
  });

  it('read() restituisce journal vuoto quando non ci sono entry', async () => {
    const result = await journalResourceHandler.read('ianus://journal', deps);
    expect(result.uri).toBe('ianus://journal');
    expect(result.mimeType).toBe('application/json');

    const data = JSON.parse(result.text);
    expect(data.entries).toEqual([]);
    expect(data.total).toBe(0);
  });
});

// ===========================================================================
// ianus://stats
// ===========================================================================
describe('ianus://stats', () => {
  it('match() matcha solo URI esatto', () => {
    expect(statsResourceHandler.match('ianus://stats')).toBe('');
    expect(statsResourceHandler.match('ianus://stats/')).toBeNull();
    expect(statsResourceHandler.match('ianus://files/stats')).toBeNull();
  });

  it('read() restituisce statistiche del server', async () => {
    const result = await statsResourceHandler.read('ianus://stats', deps);
    expect(result.uri).toBe('ianus://stats');
    expect(result.mimeType).toBe('application/json');

    const data = JSON.parse(result.text);
    expect(data).toHaveProperty('uptime');
    expect(data).toHaveProperty('totalOperations');
    expect(data).toHaveProperty('toolsRegistered');
    expect(data).toHaveProperty('workspaceRoot');
    expect(data.workspaceRoot).toBe(workDir);
    expect(typeof data.totalOperations).toBe('number');
    expect(typeof data.uptime).toBe('string');
    // toolsRegistered è hardcodato a 12 nel source
    expect(data.toolsRegistered).toBe(12);
  });
});
