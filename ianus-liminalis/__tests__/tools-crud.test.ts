/**
 * Test di integrazione per i tool CRUD di Ianus Liminalis:
 *   fs_read, fs_write, fs_edit, fs_delete
 *
 * Crea un workspace temporaneo, registra i tool con deps reali,
 * e testa ogni handler via toolRegistry.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { existsSync } from 'node:fs';

// Core & tool imports
import { PermissionChecker } from '../src/core/permission.js';
import { BackupManager } from '@codex-romanus/fs-backup';
import { toolRegistry } from '../src/tools/registry.js';
import { registerReadFile } from '../src/tools/read-file.js';
import { registerWriteFile } from '../src/tools/write-file.js';
import { registerEditFile } from '../src/tools/edit-file.js';
import { registerDeleteFile } from '../src/tools/delete-file.js';
import type { ToolDeps } from '../src/tools/types.js';

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------
let workDir: string;
let backupDir: string;
let deps: ToolDeps;

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'ianus-crud-'));
  backupDir = await mkdtemp(join(tmpdir(), 'ianus-crud-backup-'));

  // Crea struttura di test
  await writeFile(join(workDir, 'hello.txt'), 'Hello World', 'utf-8');
  await mkdir(join(workDir, 'subdir'), { recursive: true });
  await writeFile(join(workDir, 'subdir', 'nested.txt'), 'Nested content', 'utf-8');

  // Crea un file multi-linea per i test di edit
  await writeFile(
    join(workDir, 'multiline.txt'),
    ['line one', 'line two', 'line three'].join('\n'),
    'utf-8',
  );

  // Crea PermissionChecker (default allow)
  const permission = new PermissionChecker({
    version: 1,
    defaultEffect: 'allow',
    rules: [],
  });

  // Crea BackupManager reale su directory temporanea
  const backup = new BackupManager({ backupDir, retentionDays: 1 });

  deps = { workspaceRoot: workDir, permission, backup };

  // Registra i tool — passando un oggetto server fittizio (l'underscore lo ignora)
  const mockServer = {} as never;
  registerReadFile(mockServer, deps);
  registerWriteFile(mockServer, deps);
  registerEditFile(mockServer, deps);
  registerDeleteFile(mockServer, deps);
});

afterAll(async () => {
  await rm(workDir, { recursive: true, force: true });
  await rm(backupDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Helper per chiamare un handler del tool
// ---------------------------------------------------------------------------
function callTool(name: string, args: Record<string, unknown>) {
  const tool = toolRegistry.get(name);
  if (!tool) throw new Error(`Tool "${name}" not registered`);
  return tool.handler(args);
}

// ===========================================================================
// fs_read
// ===========================================================================
describe('fs_read', () => {
  it('legge un file esistente in utf-8', async () => {
    const res = await callTool('fs_read', { path: 'hello.txt' });
    expect(res.isError).toBeFalsy();
    const data = JSON.parse(res.content[0].text);
    expect(data.content).toBe('Hello World');
    expect(data.size).toBeGreaterThan(0);
    expect(data.hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('restituisce errore per file inesistente', async () => {
    const res = await callTool('fs_read', { path: 'nope.txt' });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('Error reading file');
  });

  it('legge in base64', async () => {
    const res = await callTool('fs_read', { path: 'hello.txt', encoding: 'base64' });
    expect(res.isError).toBeFalsy();
    const data = JSON.parse(res.content[0].text);
    // "Hello World" in base64
    expect(data.content).toBe('SGVsbG8gV29ybGQ=');
  });

  it('legge in hex', async () => {
    const res = await callTool('fs_read', { path: 'hello.txt', encoding: 'hex' });
    expect(res.isError).toBeFalsy();
    const data = JSON.parse(res.content[0].text);
    expect(data.content).toMatch(/^[a-f0-9]+$/);
    expect(data.content.length).toBeGreaterThan(0);
  });

  it('restituisce errore per path mancante', async () => {
    const res = await callTool('fs_read', {} as never);
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('Missing');
  });
});

// ===========================================================================
// fs_write
// ===========================================================================
describe('fs_write', () => {
  it('scrive un nuovo file con contenuto corretto', async () => {
    const res = await callTool('fs_write', { path: 'newfile.txt', content: 'Fresh content' });
    expect(res.isError).toBeFalsy();
    const data = JSON.parse(res.content[0].text);
    expect(data.size).toBe('Fresh content'.length);
    // backupId deve essere undefined (file non esisteva prima)
    expect(data.backupId).toBeUndefined();

    // Verifica su filesystem
    const disk = await readFile(join(workDir, 'newfile.txt'), 'utf-8');
    expect(disk).toBe('Fresh content');
  });

  it('sovrascrive file esistente e crea backup', async () => {
    const res = await callTool('fs_write', { path: 'hello.txt', content: 'Overwritten' });
    expect(res.isError).toBeFalsy();
    const data = JSON.parse(res.content[0].text);
    // backupId deve essere presente perché il file esisteva
    expect(data.backupId).toBeDefined();
    expect(typeof data.backupId).toBe('string');

    // Verifica contenuto su disco
    const disk = await readFile(join(workDir, 'hello.txt'), 'utf-8');
    expect(disk).toBe('Overwritten');
  });

  it('scrive con encoding base64', async () => {
    const base64Content = Buffer.from('Decoded from base64').toString('base64');
    const res = await callTool('fs_write', {
      path: 'base64file.txt',
      content: base64Content,
      encoding: 'base64',
    });
    expect(res.isError).toBeFalsy();

    // Verifica su filesystem: deve essere decodificato
    const disk = await readFile(join(workDir, 'base64file.txt'), 'utf-8');
    expect(disk).toBe('Decoded from base64');
  });

  it('blocca path traversal', async () => {
    const res = await callTool('fs_write', {
      path: '../../outside.txt',
      content: 'evil',
    });
    expect(res.isError).toBe(true);
  });

  it('restituisce errore per content mancante', async () => {
    const res = await callTool('fs_write', { path: 'foo.txt' } as never);
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('Missing');
  });
});

// ===========================================================================
// fs_edit
// ===========================================================================
describe('fs_edit', () => {
  it('replace: sostituisce pattern regex', async () => {
    // Scrivi un file di test per edit
    await writeFile(join(workDir, 'edit_replace.txt'), 'foo bar baz', 'utf-8');

    const res = await callTool('fs_edit', {
      path: 'edit_replace.txt',
      operation: 'replace',
      pattern: 'bar',
      content: 'HELLO',
    });
    expect(res.isError).toBeFalsy();
    const data = JSON.parse(res.content[0].text);
    expect(data.modified).toBe(true);

    const disk = await readFile(join(workDir, 'edit_replace.txt'), 'utf-8');
    expect(disk).toBe('foo HELLO baz');
  });

  it('insert: inserisce dopo una linea specifica', async () => {
    await writeFile(join(workDir, 'edit_insert.txt'), ['a', 'b', 'c'].join('\n'), 'utf-8');

    const res = await callTool('fs_edit', {
      path: 'edit_insert.txt',
      operation: 'insert',
      line: 2,
      content: 'INSERTED',
    });
    expect(res.isError).toBeFalsy();
    const data = JSON.parse(res.content[0].text);
    expect(data.modified).toBe(true);

    const disk = await readFile(join(workDir, 'edit_insert.txt'), 'utf-8');
    expect(disk.split('\n')).toEqual(['a', 'INSERTED', 'b', 'c']);
  });

  it('delete: elimina una linea specifica', async () => {
    await writeFile(join(workDir, 'edit_delete.txt'), ['x', 'y', 'z'].join('\n'), 'utf-8');

    const res = await callTool('fs_edit', {
      path: 'edit_delete.txt',
      operation: 'delete',
      line: 2,
    });
    expect(res.isError).toBeFalsy();
    const data = JSON.parse(res.content[0].text);
    expect(data.modified).toBe(true);

    const disk = await readFile(join(workDir, 'edit_delete.txt'), 'utf-8');
    expect(disk.split('\n')).toEqual(['x', 'z']);
  });

  it('replace con pattern inesistente restituisce modified: false', async () => {
    await writeFile(join(workDir, 'edit_nomatch.txt'), 'keep this', 'utf-8');

    const res = await callTool('fs_edit', {
      path: 'edit_nomatch.txt',
      operation: 'replace',
      pattern: 'NONEXISTENT',
      content: 'replaced',
    });
    expect(res.isError).toBeFalsy();
    const data = JSON.parse(res.content[0].text);
    expect(data.modified).toBe(false);
    expect(data.linesChanged).toBe(0);
  });

  it('insert con line fuori range restituisce errore', async () => {
    await writeFile(join(workDir, 'edit_outofrange.txt'), ['one'].join('\n'), 'utf-8');

    const res = await callTool('fs_edit', {
      path: 'edit_outofrange.txt',
      operation: 'insert',
      line: 99,
      content: 'nope',
    });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('out of range');
  });

  it('delete con line fuori range restituisce errore', async () => {
    await writeFile(join(workDir, 'edit_delrange.txt'), ['one'].join('\n'), 'utf-8');

    const res = await callTool('fs_edit', {
      path: 'edit_delrange.txt',
      operation: 'delete',
      line: 99,
    });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('out of range');
  });
});

// ===========================================================================
// fs_delete
// ===========================================================================
describe('fs_delete', () => {
  it('elimina un file', async () => {
    await writeFile(join(workDir, 'todelete.txt'), 'bye', 'utf-8');

    const res = await callTool('fs_delete', { path: 'todelete.txt' });
    expect(res.isError).toBeFalsy();
    const data = JSON.parse(res.content[0].text);
    expect(data.deleted).toBe(true);

    expect(existsSync(join(workDir, 'todelete.txt'))).toBe(false);
  });

  it('elimina un file e produce backupId', async () => {
    await writeFile(join(workDir, 'todelete_withbackup.txt'), 'back me up', 'utf-8');

    const res = await callTool('fs_delete', { path: 'todelete_withbackup.txt' });
    const data = JSON.parse(res.content[0].text);
    expect(data.backupId).toBeDefined();
    expect(typeof data.backupId).toBe('string');
  });

  it('rifiuta eliminazione di directory non vuota senza recursive', async () => {
    await mkdir(join(workDir, 'nonempty'), { recursive: true });
    await writeFile(join(workDir, 'nonempty', 'file.txt'), 'content', 'utf-8');

    const res = await callTool('fs_delete', { path: 'nonempty' });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('not empty');

    // La directory deve ancora esistere
    expect(existsSync(join(workDir, 'nonempty'))).toBe(true);
  });

  it('elimina directory con recursive=true', async () => {
    await mkdir(join(workDir, 'emptyme'), { recursive: true });
    await writeFile(join(workDir, 'emptyme', 'a.txt'), 'a', 'utf-8');
    await writeFile(join(workDir, 'emptyme', 'b.txt'), 'b', 'utf-8');

    const res = await callTool('fs_delete', { path: 'emptyme', recursive: true });
    expect(res.isError).toBeFalsy();
    const data = JSON.parse(res.content[0].text);
    expect(data.deleted).toBe(true);

    expect(existsSync(join(workDir, 'emptyme'))).toBe(false);
  });

  it('blocca path traversal', async () => {
    const res = await callTool('fs_delete', { path: '../../etc/passwd' });
    expect(res.isError).toBe(true);
  });

  it('restituisce errore per path mancante', async () => {
    const res = await callTool('fs_delete', {} as never);
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('Missing');
  });
});
