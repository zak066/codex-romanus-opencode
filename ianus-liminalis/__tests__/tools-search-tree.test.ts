/**
 * Test di integrazione per i tool di ricerca e struttura:
 *   fs_search, fs_tree, fs_list
 *
 * Crea un workspace temporaneo con file di test e verifica
 * ogni handler direttamente via toolRegistry.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { PermissionChecker } from '../src/core/permission.js';
import { BackupManager } from '@codex-romanus/fs-backup';
import { toolRegistry } from '../src/tools/registry.js';
import { registerSearchFile } from '../src/tools/search-file.js';
import { registerTreeFile } from '../src/tools/tree-file.js';
import { registerListFile } from '../src/tools/list-file.js';
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
  workDir = await mkdtemp(join(tmpdir(), 'ianus-srch-'));
  backupDir = await mkdtemp(join(tmpdir(), 'ianus-srch-bak-'));

  // Struttura di test
  await writeFile(join(workDir, 'hello.txt'), 'Hello World\nHola Mundo\nCiao Mondo', 'utf-8');
  await writeFile(join(workDir, 'numbers.txt'), 'Line 123\nLine 456\nLine 789', 'utf-8');
  await writeFile(join(workDir, 'typescript.ts'), 'const x: number = 42;\nconsole.log(x);\n// EOF', 'utf-8');
  await mkdir(join(workDir, 'sub'), { recursive: true });
  await writeFile(join(workDir, 'sub', 'nested.ts'), '// nested file\nconst y: number = 100;', 'utf-8');
  await writeFile(join(workDir, 'sub', 'data.json'), '{"key": "value"}', 'utf-8');

  const permission = new PermissionChecker({
    version: 1,
    defaultEffect: 'allow',
    rules: [],
  });
  const backup = new BackupManager({ backupDir, retentionDays: 1 });
  deps = { workspaceRoot: workDir, permission, backup };

  const mockServer = {} as never;
  registerSearchFile(mockServer, deps);
  registerTreeFile(mockServer, deps);
  registerListFile(mockServer, deps);
});

afterAll(async () => {
  await rm(workDir, { recursive: true, force: true });
  await rm(backupDir, { recursive: true, force: true });
});

// ===========================================================================
// fs_search
// ===========================================================================
describe('fs_search', () => {
  it('trova corrispondenze per pattern testuale semplice', async () => {
    const res = await callTool('fs_search', { pattern: 'Hello' });
    expect(res.isError).toBeFalsy();
    const data = JSON.parse(res.content[0].text);
    expect(data.total).toBeGreaterThanOrEqual(1);
    expect(data.results.some((r: { file: string }) => r.file === 'hello.txt')).toBe(true);
  });

  it('supporta pattern regex (\\d+)', async () => {
    const res = await callTool('fs_search', { pattern: '\\d+' });
    expect(res.isError).toBeFalsy();
    const data = JSON.parse(res.content[0].text);
    expect(data.total).toBeGreaterThanOrEqual(1);
    // Almeno un risultato contiene digits
    expect(data.results.some((r: { match: string }) => /\d+/.test(r.match))).toBe(true);
  });

  it('filtra per include glob pattern (*.txt)', async () => {
    const res = await callTool('fs_search', { pattern: 'World', include: '*.txt' });
    expect(res.isError).toBeFalsy();
    const data = JSON.parse(res.content[0].text);
    expect(data.total).toBeGreaterThanOrEqual(1);
    // Tutti i risultati devono essere da file .txt
    for (const r of data.results as Array<{ file: string }>) {
      expect(r.file).toMatch(/\.txt$/);
    }
  });

  it('restituisce risultati vuoti per pattern senza match', async () => {
    const res = await callTool('fs_search', { pattern: 'ZZZZNOMATCH_12345' });
    expect(res.isError).toBeFalsy();
    const data = JSON.parse(res.content[0].text);
    expect(data.total).toBe(0);
    expect(data.results).toEqual([]);
  });

  it('errore per parametro pattern mancante', async () => {
    const res = await callTool('fs_search', {} as never);
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('Missing');
  });

  it('rispetta il limite maxResults', async () => {
    // 'Line' matcha tutte le righe di numbers.txt + eventualmente altri
    const res = await callTool('fs_search', { pattern: 'Line', maxResults: 2 });
    expect(res.isError).toBeFalsy();
    const data = JSON.parse(res.content[0].text);
    expect(data.total).toBeLessThanOrEqual(2);
  });
});

// ===========================================================================
// fs_tree
// ===========================================================================
describe('fs_tree', () => {
  it('costruisce albero con children per directory root', async () => {
    const res = await callTool('fs_tree', { path: '.' });
    expect(res.isError).toBeFalsy();
    const data = JSON.parse(res.content[0].text);
    expect(data.tree).toBeDefined();
    expect(Array.isArray(data.tree)).toBe(true);
    // Deve contenere i nostri file e directory
    const names = data.tree.map((n: { name: string }) => n.name);
    expect(names).toContain('hello.txt');
    expect(names).toContain('typescript.ts');
    expect(names).toContain('sub');
  });

  it('rispetta depth=0 (nessun child)', async () => {
    const res = await callTool('fs_tree', { path: '.', depth: 0 });
    expect(res.isError).toBeFalsy();
    const data = JSON.parse(res.content[0].text);
    expect(data.tree).toEqual([]);
  });

  it('filtra con include glob pattern (*.ts)', async () => {
    const res = await callTool('fs_tree', { path: '.', include: '*.ts' });
    expect(res.isError).toBeFalsy();
    const data = JSON.parse(res.content[0].text);
    const names = data.tree.map((n: { name: string }) => n.name);
    expect(names).toContain('typescript.ts');
    expect(names).not.toContain('hello.txt');
    expect(names).not.toContain('numbers.txt');
  });

  it('esclude con exclude glob pattern (*.txt)', async () => {
    const res = await callTool('fs_tree', { path: '.', exclude: '*.txt' });
    expect(res.isError).toBeFalsy();
    const data = JSON.parse(res.content[0].text);
    const names = data.tree.map((n: { name: string }) => n.name);
    expect(names).not.toContain('hello.txt');
    expect(names).toContain('typescript.ts');
    expect(names).toContain('sub');
  });
});

// ===========================================================================
// fs_list
// ===========================================================================
describe('fs_list', () => {
  it('elenca entry con metadati completi', async () => {
    const res = await callTool('fs_list', { path: '.' });
    expect(res.isError).toBeFalsy();
    const data = JSON.parse(res.content[0].text);
    expect(data.entries).toBeDefined();
    expect(data.total).toBeGreaterThanOrEqual(4);
    for (const e of data.entries as Array<Record<string, unknown>>) {
      expect(e).toHaveProperty('name');
      expect(e).toHaveProperty('path');
      expect(e).toHaveProperty('type');
      expect(e).toHaveProperty('size');
      expect(e).toHaveProperty('mtime');
    }
  });

  it('ordina per size desc (tra file non-directory)', async () => {
    const res = await callTool('fs_list', { path: '.', sortBy: 'size', order: 'desc' });
    expect(res.isError).toBeFalsy();
    const data = JSON.parse(res.content[0].text);
    // Filtra solo i file (non directory)
    const files = data.entries.filter((e: { type: string }) => e.type !== 'directory');
    for (let i = 1; i < files.length; i++) {
      expect(files[i].size).toBeLessThanOrEqual(files[i - 1].size);
    }
  });

  it('filtra con include pattern (*.ts)', async () => {
    const res = await callTool('fs_list', { path: '.', include: '*.ts' });
    expect(res.isError).toBeFalsy();
    const data = JSON.parse(res.content[0].text);
    expect(data.total).toBeGreaterThanOrEqual(1);
    for (const e of data.entries as Array<{ name: string }>) {
      expect(e.name).toMatch(/\.ts$/);
    }
  });

  it('errore per path inesistente', async () => {
    const res = await callTool('fs_list', { path: 'non_existent_dir' });
    expect(res.isError).toBe(true);
  });
});
