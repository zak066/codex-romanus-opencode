/**
 * Test di integrazione per i tool extra di Ianus Liminalis:
 *   fs_backup, fs_rollback, fs_journal, fs_watch
 *
 * Ogni tool viene registrato con deps reali su workspace temporaneo
 * e testato singolarmente via toolRegistry.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { existsSync } from 'node:fs';

import { PermissionChecker } from '../src/core/permission.js';
import { BackupManager } from '@codex-romanus/fs-backup';
import { toolRegistry } from '../src/tools/registry.js';
import { registerBackupFile } from '../src/tools/backup-file.js';
import { registerRollbackFile } from '../src/tools/rollback-file.js';
import { registerJournalQuery } from '../src/tools/journal-query.js';
import { registerWatchFile } from '../src/tools/watch-file.js';
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
  workDir = await mkdtemp(join(tmpdir(), 'ianus-extra-'));
  backupDir = await mkdtemp(join(tmpdir(), 'ianus-extra-bak-'));

  // File di base per i test
  await writeFile(join(workDir, 'original.txt'), 'Versione originale', 'utf-8');
  await writeFile(join(workDir, 'v1.txt'), 'contenuto v1', 'utf-8');

  const permission = new PermissionChecker({
    version: 1,
    defaultEffect: 'allow',
    rules: [],
  });
  const backup = new BackupManager({ backupDir, retentionDays: 1 });
  deps = { workspaceRoot: workDir, permission, backup };

  const mockServer = {} as never;
  registerBackupFile(mockServer, deps);
  registerRollbackFile(mockServer, deps);
  registerJournalQuery(mockServer, deps);
  registerWatchFile(mockServer, deps);
});

afterAll(async () => {
  await rm(workDir, { recursive: true, force: true });
  await rm(backupDir, { recursive: true, force: true });
});

// ===========================================================================
// fs_backup
// ===========================================================================
describe('fs_backup', () => {
  it('crea backup e restituisce metadati completi', async () => {
    const res = await callTool('fs_backup', { path: 'original.txt' });
    expect(res.isError).toBeFalsy();
    const data = JSON.parse(res.content[0].text);
    expect(data.backupId).toBeDefined();
    expect(typeof data.backupId).toBe('string');
    expect(data.filePath).toContain('original.txt');
    expect(data.timestamp).toBeDefined();
    expect(typeof data.size).toBe('number');
    expect(data.size).toBeGreaterThan(0);
  });

  it('è idempotente: backup successivi generano ID diversi', async () => {
    const res1 = await callTool('fs_backup', { path: 'original.txt' });
    const res2 = await callTool('fs_backup', { path: 'original.txt' });
    const data1 = JSON.parse(res1.content[0].text);
    const data2 = JSON.parse(res2.content[0].text);
    // ID diversi = backup distinti nel tempo
    expect(data1.backupId).not.toBe(data2.backupId);
    expect(typeof data1.backupId).toBe('string');
    expect(typeof data2.backupId).toBe('string');
  });

  it('errore per parametro path mancante', async () => {
    const res = await callTool('fs_backup', {} as never);
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('Missing');
  });

  it('errore per file inesistente', async () => {
    const res = await callTool('fs_backup', { path: 'non_existent.txt' });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('Error backing up');
  });
});

// ===========================================================================
// fs_rollback
// ===========================================================================
describe('fs_rollback', () => {
  it('ripristina file dall\'ultimo backup', async () => {
    // Crea file, backup, modifica, rollback
    await writeFile(join(workDir, 'rollback_me.txt'), 'before backup', 'utf-8');

    // Backup del contenuto originale
    await callTool('fs_backup', { path: 'rollback_me.txt' });

    // Modifica il file
    await writeFile(join(workDir, 'rollback_me.txt'), 'after modification', 'utf-8');
    const afterMod = await readFile(join(workDir, 'rollback_me.txt'), 'utf-8');
    expect(afterMod).toBe('after modification');

    // Rollback all'ultimo backup
    const res = await callTool('fs_rollback', { path: 'rollback_me.txt' });
    expect(res.isError).toBeFalsy();
    const data = JSON.parse(res.content[0].text);
    expect(data.restored).toBe(true);
    expect(data.backupId).toBe('latest');

    // Verifica che il contenuto sia tornato all'originale
    const afterRollback = await readFile(join(workDir, 'rollback_me.txt'), 'utf-8');
    expect(afterRollback).toBe('before backup');
  });

  it('ripristina usando un backupId specifico', async () => {
    // Crea file con v1
    await writeFile(join(workDir, 'specific.txt'), 'v1', 'utf-8');
    const backup1 = await callTool('fs_backup', { path: 'specific.txt' });
    const { backupId: v1Id } = JSON.parse(backup1.content[0].text);

    // Modifica in v2
    await writeFile(join(workDir, 'specific.txt'), 'v2', 'utf-8');
    // Non facciamo backup di v2

    // Modifica in v3 e backup
    await writeFile(join(workDir, 'specific.txt'), 'v3', 'utf-8');
    await callTool('fs_backup', { path: 'specific.txt' });

    // Rollback specifico a v1
    const res = await callTool('fs_rollback', { path: 'specific.txt', backupId: v1Id });
    expect(res.isError).toBeFalsy();
    const data = JSON.parse(res.content[0].text);
    expect(data.restored).toBe(true);
    expect(data.backupId).toBe(v1Id);

    const content = await readFile(join(workDir, 'specific.txt'), 'utf-8');
    expect(content).toBe('v1');
  });

  it('errore per file senza backup', async () => {
    const res = await callTool('fs_rollback', { path: 'no_backup_file.txt' });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('Error rolling back');
  });

  it('errore per parametro path mancante', async () => {
    const res = await callTool('fs_rollback', {} as never);
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('Missing');
  });
});

// ===========================================================================
// fs_journal
// ===========================================================================
describe('fs_journal', () => {
  // Nota: i test precedenti (fs_backup) hanno già creato entry nel journal.

  it('filtra per agente', async () => {
    const res = await callTool('fs_journal', { agent: 'ianus' });
    expect(res.isError).toBeFalsy();
    const data = JSON.parse(res.content[0].text);
    expect(data.entries).toBeDefined();
    expect(Array.isArray(data.entries)).toBe(true);
    expect(data.total).toBeGreaterThanOrEqual(1);
    for (const e of data.entries as Array<{ agent: string }>) {
      expect(e.agent).toBe('ianus');
    }
  });

  it('filtra per tipo operazione', async () => {
    const res = await callTool('fs_journal', { operation: 'backup' });
    expect(res.isError).toBeFalsy();
    const data = JSON.parse(res.content[0].text);
    expect(data.total).toBeGreaterThanOrEqual(1);
    for (const e of data.entries as Array<{ operation: string }>) {
      expect(e.operation).toBe('backup');
    }
  });

  it('filtra per path (substring match)', async () => {
    const res = await callTool('fs_journal', { path: 'original.txt' });
    expect(res.isError).toBeFalsy();
    const data = JSON.parse(res.content[0].text);
    expect(data.total).toBeGreaterThanOrEqual(1);
    for (const e of data.entries as Array<{ path: string }>) {
      expect(e.path).toContain('original.txt');
    }
  });

  it('rispetta il parametro limit', async () => {
    const res = await callTool('fs_journal', { limit: 1 });
    expect(res.isError).toBeFalsy();
    const data = JSON.parse(res.content[0].text);
    expect(data.entries.length).toBeLessThanOrEqual(1);
    expect(data.total).toBe(data.entries.length);
  });
});

// ===========================================================================
// fs_watch
// ===========================================================================
describe('fs_watch', () => {
  it(
    'osserva una directory per la durata specificata',
    { timeout: 10000 },
    async () => {
      const res = await callTool('fs_watch', { path: '.', duration: 200 });
      expect(res.isError).toBeFalsy();
      const data = JSON.parse(res.content[0].text);
      expect(data.watched).toBe(true);
      expect(Array.isArray(data.events)).toBe(true);
    },
  );

  it('errore per parametro path mancante', async () => {
    const res = await callTool('fs_watch', {} as never);
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('Missing');
  });
});
