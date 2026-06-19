/**
 * Test suite for file-lock.ts — Core locking layer of Ianus Liminalis
 *
 * Tests: acquireLock, releaseLock, getLock, listLocks, isLocked
 *
 * Pattern: temp directory per suite, inline file creation, no mocking of fs.
 * Stale lock simulation via manual .lock file creation with old timestamps.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, readFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { existsSync } from 'node:fs';

import {
  acquireLock,
  releaseLock,
  getLock,
  listLocks,
  isLocked,
} from '../src/core/file-lock.js';

// ═══════════════════════════════════════════════════════════════════════════
// acquireLock
// ═══════════════════════════════════════════════════════════════════════════
describe('acquireLock', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'ianus-flock-'));
    await writeFile(join(testDir, 'test.txt'), 'hello', 'utf-8');
    await writeFile(join(testDir, 'data.json'), '{"key":"val"}', 'utf-8');
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  // ── Happy path ──────────────────────────────────────────────────────────

  it('should acquire lock on unlocked file', async () => {
    const result = await acquireLock(join(testDir, 'test.txt'), 'diana');

    expect(result.success).toBe(true);
    expect(result.lock).toBeDefined();
    expect(result.lock!.owner).toBe('diana');
    expect(result.lock!.path).toBe(join(testDir, 'test.txt'));
    expect(result.lock!.isStale).toBe(false);
    expect(result.forcedAcquire).toBeUndefined();
  });

  it('should create .lock file with valid JSON metadata', async () => {
    await acquireLock(join(testDir, 'test.txt'), 'vulcanus');

    // Read the .lock file directly from disk
    const lockContent = await readFile(join(testDir, 'test.txt.lock'), 'utf-8');
    const data = JSON.parse(lockContent);

    expect(data).toHaveProperty('owner', 'vulcanus');
    expect(data).toHaveProperty('acquiredAt');
    expect(() => new Date(data.acquiredAt)).not.toThrow();
    expect(new Date(data.acquiredAt).getTime()).not.toBeNaN();
    expect(data).toHaveProperty('ttlMinutes', 15);
    expect(data).toHaveProperty('path', join(testDir, 'test.txt'));
    // isStale non è serializzata nel file
    expect(data).not.toHaveProperty('isStale');
  });

  it('should return LockInfo with all required fields on success', async () => {
    const result = await acquireLock(join(testDir, 'test.txt'), 'diana');

    expect(result.success).toBe(true);
    expect(result.lock).toMatchObject({
      owner: 'diana',
      path: join(testDir, 'test.txt'),
      ttlMinutes: 15,
      isStale: false,
    });
    // acquiredAt è un ISO timestamp valido
    expect(typeof result.lock!.acquiredAt).toBe('string');
    expect(new Date(result.lock!.acquiredAt).toISOString()).toBe(result.lock!.acquiredAt);
  });

  // ── Lock conflicts ──────────────────────────────────────────────────────

  it('should fail when file is already locked by another owner', async () => {
    await acquireLock(join(testDir, 'test.txt'), 'vulcanus');

    const result = await acquireLock(join(testDir, 'test.txt'), 'minerva');

    expect(result.success).toBe(false);
    expect(result.error).toContain('locked by vulcanus');
    expect(result.lock).toBeDefined();
    expect(result.lock!.owner).toBe('vulcanus');
  });

  it('should fail when same owner tries to re-acquire', async () => {
    await acquireLock(join(testDir, 'test.txt'), 'diana');

    const result = await acquireLock(join(testDir, 'test.txt'), 'diana');

    expect(result.success).toBe(false);
    expect(result.error).toContain('locked by diana');
  });

  // ── Custom TTL ──────────────────────────────────────────────────────────

  it('should acquire lock with custom TTL', async () => {
    const result = await acquireLock(join(testDir, 'test.txt'), 'vulcanus', { ttlMinutes: 60 });

    expect(result.success).toBe(true);
    expect(result.lock!.ttlMinutes).toBe(60);

    // Verify serialized in the .lock file
    const lockContent = await readFile(join(testDir, 'test.txt.lock'), 'utf-8');
    const data = JSON.parse(lockContent);
    expect(data.ttlMinutes).toBe(60);
  });

  it('should acquire lock with TTL 0 (uses threshold default)', async () => {
    const result = await acquireLock(join(testDir, 'test.txt'), 'diana', { ttlMinutes: 0 });

    expect(result.success).toBe(true);
    // TTL 0 → in staleness check viene usato thresholdMinutes (30)
    expect(result.lock!.ttlMinutes).toBe(0);
  });

  // ── Stale lock handling ─────────────────────────────────────────────────

  it('should force-acquire over stale lock', async () => {
    // Crea un lock file manuale con timestamp vecchio (stale)
    const staleLock = {
      owner: 'old-owner',
      acquiredAt: '2020-01-01T00:00:00.000Z',
      ttlMinutes: 1,
      path: join(testDir, 'test.txt'),
    };
    await writeFile(join(testDir, 'test.txt.lock'), JSON.stringify(staleLock), 'utf-8');

    const result = await acquireLock(join(testDir, 'test.txt'), 'diana');

    expect(result.success).toBe(true);
    expect(result.forcedAcquire).toBe(true);
    expect(result.lock!.owner).toBe('diana');

    // Il file .lock deve essere stato sovrascritto
    const lockContent = await readFile(join(testDir, 'test.txt.lock'), 'utf-8');
    const data = JSON.parse(lockContent);
    expect(data.owner).toBe('diana');
  });

  it('should force-acquire over corrupted (illegible) lock file', async () => {
    // Lock file corrotto JSON
    await writeFile(join(testDir, 'test.txt.lock'), 'not valid json', 'utf-8');

    const result = await acquireLock(join(testDir, 'test.txt'), 'diana');

    expect(result.success).toBe(true);
    expect(result.forcedAcquire).toBe(true);
    expect(result.lock!.owner).toBe('diana');
  });

  // ── Error conditions ────────────────────────────────────────────────────

  it('should fail when parent directory of lock path does not exist', async () => {
    const result = await acquireLock(
      join(testDir, 'nonexistent-dir', 'file.txt'),
      'diana',
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('Failed to acquire lock');
  });

  it('should fail with EEXIST when .lock already exists (wx flag race prevention)', async () => {
    // Crea manualmente un lock file recente
    const freshLock = {
      owner: 'someone',
      acquiredAt: new Date().toISOString(),
      ttlMinutes: 15,
      path: join(testDir, 'test.txt'),
    };
    await writeFile(join(testDir, 'test.txt.lock'), JSON.stringify(freshLock), 'utf-8');

    const result = await acquireLock(join(testDir, 'test.txt'), 'diana');

    expect(result.success).toBe(false);
    expect(result.error).toContain('locked by someone');
  });

  it('should work for files in subdirectories', async () => {
    await mkdir(join(testDir, 'sub', 'deep'), { recursive: true });
    const subFile = join(testDir, 'sub', 'deep', 'nested.txt');
    await writeFile(subFile, 'nested content', 'utf-8');

    const result = await acquireLock(subFile, 'diana');

    expect(result.success).toBe(true);
    expect(existsSync(subFile + '.lock')).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// releaseLock
// ═══════════════════════════════════════════════════════════════════════════
describe('releaseLock', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'ianus-frelease-'));
    await writeFile(join(testDir, 'test.txt'), 'hello', 'utf-8');
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it('should release existing lock and return success', async () => {
    await acquireLock(join(testDir, 'test.txt'), 'diana');

    const result = await releaseLock(join(testDir, 'test.txt'), 'diana');

    expect(result.success).toBe(true);
    expect(result.lock).toBeDefined();
    expect(result.lock!.owner).toBe('diana');
  });

  it('should remove the .lock file after release', async () => {
    await acquireLock(join(testDir, 'test.txt'), 'diana');

    await releaseLock(join(testDir, 'test.txt'), 'diana');

    expect(existsSync(join(testDir, 'test.txt.lock'))).toBe(false);
  });

  it('should return success (no-op) when lock does not exist', async () => {
    const result = await releaseLock(join(testDir, 'test.txt'), 'diana');

    expect(result.success).toBe(true);
    // Nessun lock → nessun lock restituito
    expect(result.lock).toBeUndefined();
  });

  it('should fail when caller is not the lock owner', async () => {
    await acquireLock(join(testDir, 'test.txt'), 'vulcanus');

    const result = await releaseLock(join(testDir, 'test.txt'), 'diana');

    expect(result.success).toBe(false);
    expect(result.error).toContain('owned by vulcanus');
    expect(result.lock).toBeDefined();
    expect(result.lock!.owner).toBe('vulcanus');
  });

  it('should succeed on double release (second is no-op)', async () => {
    await acquireLock(join(testDir, 'test.txt'), 'diana');

    const first = await releaseLock(join(testDir, 'test.txt'), 'diana');
    expect(first.success).toBe(true);

    const second = await releaseLock(join(testDir, 'test.txt'), 'diana');
    expect(second.success).toBe(true);
    // Second release: lock non esiste più, nessun lock object
    expect(second.lock).toBeUndefined();
  });

  it('should complete full acquire-release cycle cleanly', async () => {
    const acquire = await acquireLock(join(testDir, 'test.txt'), 'diana');
    expect(acquire.success).toBe(true);

    const release = await releaseLock(join(testDir, 'test.txt'), 'diana');
    expect(release.success).toBe(true);

    // Dopo il ciclo, possiamo ri-acquisire
    const reacquire = await acquireLock(join(testDir, 'test.txt'), 'minerva');
    expect(reacquire.success).toBe(true);
    expect(reacquire.lock!.owner).toBe('minerva');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// getLock
// ═══════════════════════════════════════════════════════════════════════════
describe('getLock', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'ianus-fgetlock-'));
    await writeFile(join(testDir, 'test.txt'), 'hello', 'utf-8');
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it('should return LockInfo for a locked file', async () => {
    await acquireLock(join(testDir, 'test.txt'), 'diana', { ttlMinutes: 30 });

    const lock = await getLock(join(testDir, 'test.txt'));

    expect(lock).not.toBeNull();
    expect(lock!.owner).toBe('diana');
    expect(lock!.ttlMinutes).toBe(30);
    expect(lock!.path).toBe(join(testDir, 'test.txt'));
    expect(lock!.isStale).toBe(false);
    expect(typeof lock!.acquiredAt).toBe('string');
  });

  it('should return null for unlocked file', async () => {
    const lock = await getLock(join(testDir, 'test.txt'));

    expect(lock).toBeNull();
  });

  it('should return isStale: true for stale lock', async () => {
    // Crea lock file con timestamp vecchio
    const staleLock = {
      owner: 'vulcanus',
      acquiredAt: '2020-06-01T00:00:00.000Z',
      ttlMinutes: 1,
      path: join(testDir, 'test.txt'),
    };
    await writeFile(join(testDir, 'test.txt.lock'), JSON.stringify(staleLock), 'utf-8');

    const lock = await getLock(join(testDir, 'test.txt'));

    expect(lock).not.toBeNull();
    expect(lock!.isStale).toBe(true);
    expect(lock!.owner).toBe('vulcanus');
  });

  it('should return null for corrupted lock file', async () => {
    // JSON invalido
    await writeFile(join(testDir, 'test.txt.lock'), '{{invalid json!!', 'utf-8');

    const lock = await getLock(join(testDir, 'test.txt'));

    expect(lock).toBeNull();
  });

  it('should return null for lock file with missing required fields', async () => {
    // JSON valido ma senza owner
    await writeFile(
      join(testDir, 'test.txt.lock'),
      JSON.stringify({ acquiredAt: new Date().toISOString(), ttlMinutes: 15, path: '/tmp/test.txt' }),
      'utf-8',
    );

    const lock = await getLock(join(testDir, 'test.txt'));

    expect(lock).toBeNull();
  });

  it('should return null for lock file with invalid acquiredAt', async () => {
    await writeFile(
      join(testDir, 'test.txt.lock'),
      JSON.stringify({
        owner: 'vulcanus',
        acquiredAt: 'not-a-date',
        ttlMinutes: 15,
        path: join(testDir, 'test.txt'),
      }),
      'utf-8',
    );

    const lock = await getLock(join(testDir, 'test.txt'));

    // isStaleLockData con acquiredAt invalido ritorna true (safety first)
    // quindi isStale = true, ma il lock viene comunque ritornato
    expect(lock).not.toBeNull();
    expect(lock!.isStale).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// listLocks
// ═══════════════════════════════════════════════════════════════════════════
describe('listLocks', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'ianus-flist-'));
    await writeFile(join(testDir, 'a.txt'), 'a', 'utf-8');
    await writeFile(join(testDir, 'b.txt'), 'b', 'utf-8');
    await writeFile(join(testDir, 'c.txt'), 'c', 'utf-8');
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it('should return all locks in a directory', async () => {
    await acquireLock(join(testDir, 'a.txt'), 'diana');
    await acquireLock(join(testDir, 'b.txt'), 'vulcanus');
    await acquireLock(join(testDir, 'c.txt'), 'minerva');

    const locks = await listLocks(testDir);

    expect(locks).toHaveLength(3);
    const owners = locks.map((l) => l.owner).sort();
    expect(owners).toEqual(['diana', 'minerva', 'vulcanus']);
  });

  it('should return empty array for directory with no locks', async () => {
    const locks = await listLocks(testDir);

    expect(locks).toEqual([]);
  });

  it('should exclude stale locks by default (includeStale: false)', async () => {
    // Acquire 2 fresh locks
    await acquireLock(join(testDir, 'a.txt'), 'diana');

    // Crea un lock stale manualmente per b.txt
    const staleLock = {
      owner: 'vulcanus',
      acquiredAt: '2020-01-01T00:00:00.000Z',
      ttlMinutes: 1,
      path: join(testDir, 'b.txt'),
    };
    await writeFile(join(testDir, 'b.txt.lock'), JSON.stringify(staleLock), 'utf-8');

    const locks = await listLocks(testDir);
    // Default: includeStale = false → solo a.txt (non stale)
    expect(locks).toHaveLength(1);
    expect(locks[0].owner).toBe('diana');
  });

  it('should include stale locks when includeStale: true', async () => {
    // 1 fresh + 1 stale
    await acquireLock(join(testDir, 'a.txt'), 'diana');

    const staleLock = {
      owner: 'vulcanus',
      acquiredAt: '2020-01-01T00:00:00.000Z',
      ttlMinutes: 1,
      path: join(testDir, 'b.txt'),
    };
    await writeFile(join(testDir, 'b.txt.lock'), JSON.stringify(staleLock), 'utf-8');

    const locks = await listLocks(testDir, { includeStale: true });

    expect(locks).toHaveLength(2);
  });

  it('should scan recursively and find locks in subdirectories', async () => {
    // Crea subdirectory e file
    await mkdir(join(testDir, 'sub'), { recursive: true });
    await writeFile(join(testDir, 'sub', 'nested.txt'), 'nested', 'utf-8');

    // Lock su file in root e in subdir
    await acquireLock(join(testDir, 'a.txt'), 'diana');
    await acquireLock(join(testDir, 'sub', 'nested.txt'), 'minerva');

    const locks = await listLocks(testDir);

    expect(locks).toHaveLength(2);
    const paths = locks.map((l) => l.path).sort();
    // listLocks setta path come relative al searchDir
    expect(paths).toContain('a.txt');
    expect(paths).toContain(join('sub', 'nested.txt'));
  });

  it('should return empty array for non-existent directory', async () => {
    const locks = await listLocks(join(testDir, 'nope'));

    // listLocks cattura l'errore e ritorna []
    expect(locks).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// isLocked
// ═══════════════════════════════════════════════════════════════════════════
describe('isLocked', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'ianus-fislocked-'));
    await writeFile(join(testDir, 'test.txt'), 'hello', 'utf-8');
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it('should return true for a locked (non-stale) file', async () => {
    await acquireLock(join(testDir, 'test.txt'), 'diana');

    const locked = await isLocked(join(testDir, 'test.txt'));

    expect(locked).toBe(true);
  });

  it('should return false for an unlocked file', async () => {
    const locked = await isLocked(join(testDir, 'test.txt'));

    expect(locked).toBe(false);
  });

  it('should return false for a file with stale lock', async () => {
    const staleLock = {
      owner: 'vulcanus',
      acquiredAt: '2020-01-01T00:00:00.000Z',
      ttlMinutes: 1,
      path: join(testDir, 'test.txt'),
    };
    await writeFile(join(testDir, 'test.txt.lock'), JSON.stringify(staleLock), 'utf-8');

    const locked = await isLocked(join(testDir, 'test.txt'));

    expect(locked).toBe(false);
  });

  it('should return false for a file with corrupted lock file', async () => {
    await writeFile(join(testDir, 'test.txt.lock'), '{{{not json', 'utf-8');

    const locked = await isLocked(join(testDir, 'test.txt'));

    // getLock → null → isLocked → false
    expect(locked).toBe(false);
  });

  it('should return false when .lock file has missing required fields', async () => {
    // owner mancante
    await writeFile(
      join(testDir, 'test.txt.lock'),
      JSON.stringify({ acquiredAt: new Date().toISOString(), ttlMinutes: 15, path: '/tmp/x' }),
      'utf-8',
    );

    const locked = await isLocked(join(testDir, 'test.txt'));

    expect(locked).toBe(false);
  });
});
