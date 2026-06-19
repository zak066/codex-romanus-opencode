/**
 * Test di integrazione per i tool di file locking di Ianus Liminalis:
 *   fs_lock, fs_unlock, fs_get_locks
 *
 * Crea un workspace temporaneo, registra i tool con deps reali,
 * e testa ogni handler via toolRegistry.
 *
 * Pattern: segue tools-crud.test.ts e tools-extra.test.ts
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, readFile, readdir, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { existsSync } from 'node:fs';

import { PermissionChecker } from '../src/core/permission.js';
import { BackupManager } from '@codex-romanus/fs-backup';
import { toolRegistry } from '../src/tools/registry.js';
import { registerLockFile, registerUnlockFile, registerGetLocks } from '../src/tools/lock-file.js';
import type { ToolDeps } from '../src/tools/types.js';

// ═══════════════════════════════════════════════════════════════════════════
// Setup — condiviso tra tutti i describe
// ═══════════════════════════════════════════════════════════════════════════
let workDir: string;
let backupDir: string;
let deps: ToolDeps;

function callTool(name: string, args: Record<string, unknown>) {
  const tool = toolRegistry.get(name);
  if (!tool) throw new Error(`Tool "${name}" not registered`);
  return tool.handler(args);
}

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'ianus-lock-tools-'));
  backupDir = await mkdtemp(join(tmpdir(), 'ianus-lock-tools-bak-'));

  // Crea struttura di test
  await writeFile(join(workDir, 'readme.md'), '# Test workspace', 'utf-8');
  await writeFile(join(workDir, 'config.json'), '{"debug": true}', 'utf-8');
  await mkdir(join(workDir, 'sub'), { recursive: true });
  await writeFile(join(workDir, 'sub', 'notes.txt'), 'nested file', 'utf-8');

  // PermissionChecker: default allow per la maggior parte dei test
  const permission = new PermissionChecker({
    version: 1,
    defaultEffect: 'allow',
    rules: [],
  });

  // BackupManager reale su directory temporanea
  const backup = new BackupManager({ backupDir, retentionDays: 1 });

  deps = { workspaceRoot: workDir, permission, backup };

  // Registra i tool — mockServer fittizio (underscore lo ignora)
  const mockServer = {} as never;
  registerLockFile(mockServer, deps);
  registerUnlockFile(mockServer, deps);
  registerGetLocks(mockServer, deps);
});

afterAll(async () => {
  await rm(workDir, { recursive: true, force: true });
  await rm(backupDir, { recursive: true, force: true });
});

// ═══════════════════════════════════════════════════════════════════════════
// fs_lock
// ═══════════════════════════════════════════════════════════════════════════
describe('fs_lock', () => {
  afterEach(async () => {
    // Rimuovi tutti i .lock files
    const files = await readdir(workDir);
    for (const f of files) {
      if (f.endsWith('.lock')) {
        await unlink(join(workDir, f)).catch(() => {});
      }
    }
  });

  it('should lock a file successfully', async () => {
    const res = await callTool('fs_lock', { path: 'readme.md', owner: 'vulcanus' });

    expect(res.isError).toBeFalsy();
    const data = JSON.parse(res.content[0].text);
    expect(data.success).toBe(true);
    expect(data.lock).toBeDefined();
    expect(data.lock.owner).toBe('vulcanus');
    expect(data.lock.ttlMinutes).toBe(15);
    expect(data.forcedAcquire).toBeUndefined();

    // Verifica che il .lock file esista su disco
    expect(existsSync(join(workDir, 'readme.md.lock'))).toBe(true);
  });

  it('should fail when file is already locked by another owner', async () => {
    await callTool('fs_lock', { path: 'config.json', owner: 'vulcanus' });

    const res = await callTool('fs_lock', { path: 'config.json', owner: 'minerva' });

    expect(res.isError).toBe(true);
    const data = JSON.parse(res.content[0].text);
    expect(data.success).toBe(false);
    expect(data.error).toContain('locked by vulcanus');
  });

  it('should fail when same owner tries to re-acquire', async () => {
    await callTool('fs_lock', { path: 'config.json', owner: 'vulcanus' });

    const res = await callTool('fs_lock', { path: 'config.json', owner: 'vulcanus' });

    expect(res.isError).toBe(true);
    const data = JSON.parse(res.content[0].text);
    expect(data.success).toBe(false);
  });

  it('should force-acquire over stale lock', async () => {
    // Crea un file con lock stale manualmente
    const staleLock = {
      owner: 'old-owner',
      acquiredAt: '2020-01-01T00:00:00.000Z',
      ttlMinutes: 1,
      path: join(workDir, 'readme.md'),
    };
    await writeFile(join(workDir, 'readme.md.lock'), JSON.stringify(staleLock), 'utf-8');

    const res = await callTool('fs_lock', { path: 'readme.md', owner: 'diana' });

    expect(res.isError).toBeFalsy();
    const data = JSON.parse(res.content[0].text);
    expect(data.success).toBe(true);
    expect(data.forcedAcquire).toBe(true);
    expect(data.lock.owner).toBe('diana');
  });

  it('should accept custom ttl_minutes', async () => {
    const res = await callTool('fs_lock', {
      path: 'readme.md',
      owner: 'vulcanus',
      ttl_minutes: 120,
    });

    expect(res.isError).toBeFalsy();
    const data = JSON.parse(res.content[0].text);
    expect(data.success).toBe(true);
    expect(data.lock.ttlMinutes).toBe(120);
  });

  it('should return error when path parameter is missing', async () => {
    const res = await callTool('fs_lock', { owner: 'vulcanus' } as never);

    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('Missing required parameter: "path"');
  });

  it('should return error when owner parameter is missing', async () => {
    const res = await callTool('fs_lock', { path: 'readme.md' } as never);

    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('Missing required parameter: "owner"');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// fs_unlock
// ═══════════════════════════════════════════════════════════════════════════
describe('fs_unlock', () => {
  afterEach(async () => {
    // Rimuovi tutti i .lock files
    const files = await readdir(workDir);
    for (const f of files) {
      if (f.endsWith('.lock')) {
        await unlink(join(workDir, f)).catch(() => {});
      }
    }
  });

  it('should release a lock successfully', async () => {
    // Prima locka
    await callTool('fs_lock', { path: 'readme.md', owner: 'diana' });
    expect(existsSync(join(workDir, 'readme.md.lock'))).toBe(true);

    // Poi unlocka
    const res = await callTool('fs_unlock', { path: 'readme.md', owner: 'diana' });

    expect(res.isError).toBeFalsy();
    const data = JSON.parse(res.content[0].text);
    expect(data.success).toBe(true);

    // Verifica che il .lock file sia stato rimosso
    expect(existsSync(join(workDir, 'readme.md.lock'))).toBe(false);
  });

  it('should fail when caller is not the lock owner', async () => {
    await callTool('fs_lock', { path: 'readme.md', owner: 'vulcanus' });

    const res = await callTool('fs_unlock', { path: 'readme.md', owner: 'diana' });

    expect(res.isError).toBe(true);
    const data = JSON.parse(res.content[0].text);
    expect(data.success).toBe(false);
    expect(data.error).toContain('owned by vulcanus');
  });

  it('should succeed (no-op) when no lock exists', async () => {
    const res = await callTool('fs_unlock', { path: 'readme.md', owner: 'diana' });

    expect(res.isError).toBeFalsy();
    const data = JSON.parse(res.content[0].text);
    expect(data.success).toBe(true);
  });

  it('should return error when path parameter is missing', async () => {
    const res = await callTool('fs_unlock', { owner: 'diana' } as never);

    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('Missing required parameter: "path"');
  });

  it('should return error when owner parameter is missing', async () => {
    const res = await callTool('fs_unlock', { path: 'readme.md' } as never);

    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('Missing required parameter: "owner"');
  });

  it('should handle acquire → release → re-acquire cycle', async () => {
    // Lock
    const lockRes = await callTool('fs_lock', { path: 'config.json', owner: 'diana' });
    expect(JSON.parse(lockRes.content[0].text).success).toBe(true);

    // Unlock
    const unlockRes = await callTool('fs_unlock', { path: 'config.json', owner: 'diana' });
    expect(JSON.parse(unlockRes.content[0].text).success).toBe(true);

    // Re-lock by different owner
    const relockRes = await callTool('fs_lock', { path: 'config.json', owner: 'minerva' });
    expect(JSON.parse(relockRes.content[0].text).success).toBe(true);
    expect(JSON.parse(relockRes.content[0].text).lock.owner).toBe('minerva');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// fs_get_locks
// ═══════════════════════════════════════════════════════════════════════════
describe('fs_get_locks', () => {
  afterEach(async () => {
    // Rimuovi tutti i .lock files
    const files = await readdir(workDir);
    for (const f of files) {
      if (f.endsWith('.lock')) {
        await unlink(join(workDir, f)).catch(() => {});
      }
    }
  });

  it('should return empty array when no locks exist', async () => {
    const res = await callTool('fs_get_locks', {});

    expect(res.isError).toBeFalsy();
    const data = JSON.parse(res.content[0].text);
    expect(data.locks).toEqual([]);
    expect(data.count).toBe(0);
  });

  it('should list all active locks in the workspace', async () => {
    // Crea due lock
    await callTool('fs_lock', { path: 'readme.md', owner: 'vulcanus' });
    await callTool('fs_lock', { path: 'config.json', owner: 'diana' });

    const res = await callTool('fs_get_locks', {});

    expect(res.isError).toBeFalsy();
    const data = JSON.parse(res.content[0].text);
    expect(data.count).toBe(2);
    const paths = data.locks.map((l: { path: string }) => l.path).sort();
    expect(paths).toEqual(['config.json', 'readme.md']);
  });

  it('should exclude stale locks by default', async () => {
    // Crea un lock fresco
    await callTool('fs_lock', { path: 'readme.md', owner: 'vulcanus' });

    // Crea un file .lock stale manualmente per config.json
    const staleLock = {
      owner: 'old-owner',
      acquiredAt: '2020-01-01T00:00:00.000Z',
      ttlMinutes: 1,
      path: join(workDir, 'config.json'),
    };
    await writeFile(join(workDir, 'config.json.lock'), JSON.stringify(staleLock), 'utf-8');

    const res = await callTool('fs_get_locks', {});
    expect(res.isError).toBeFalsy();
    const data = JSON.parse(res.content[0].text);
    // Solo 1 attivo (readme.md)
    expect(data.count).toBe(1);
    expect(data.locks[0].owner).toBe('vulcanus');
  });

  it('should include stale locks when include_stale: true', async () => {
    // Stale lock
    const staleLock = {
      owner: 'old-owner',
      acquiredAt: '2020-01-01T00:00:00.000Z',
      ttlMinutes: 1,
      path: join(workDir, 'readme.md'),
    };
    await writeFile(join(workDir, 'readme.md.lock'), JSON.stringify(staleLock), 'utf-8');

    const res = await callTool('fs_get_locks', { include_stale: true });
    expect(res.isError).toBeFalsy();
    const data = JSON.parse(res.content[0].text);
    expect(data.count).toBeGreaterThanOrEqual(1);
  });

  it('should scan a specific directory and find recursive locks', async () => {
    // Creiamo un lock nella subdirectory
    await callTool('fs_lock', { path: 'sub/notes.txt', owner: 'diana' });

    const res = await callTool('fs_get_locks', { directory: 'sub' });
    expect(res.isError).toBeFalsy();
    const data = JSON.parse(res.content[0].text);
    expect(data.count).toBe(1);
    expect(data.locks[0].path).toContain('notes.txt');
  });

  it('should return error for path traversal directory', async () => {
    const res = await callTool('fs_get_locks', { directory: '../../etc' });

    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('Path traversal');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Permission layer (usato internamente dai tool)
// ═══════════════════════════════════════════════════════════════════════════
describe('fs_lock permission check', () => {
  it('should deny lock when permission check fails (deny defaultEffect)', async () => {
    const denyPermission = new PermissionChecker({
      version: 1,
      defaultEffect: 'deny',
      rules: [],
    });

    // Simula ciò che fs_lock fa internamente
    const result = await denyPermission.checkOperation('diana', 'write', 'secret.txt', workDir);

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('Default effect: deny');
  });
});
