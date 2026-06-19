import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, readFile, unlink, rmdir, stat } from 'node:fs/promises';
import { existsSync, mkdtempSync, utimesSync, rmSync } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { BackupManager } from '../src/backup-manager.js';
import type { BackupEntry } from '../src/types.js';

/**
 * Crea una directory temporanea univoca per i test.
 */
function createTempDir(): string {
  return mkdtempSync(path.join(os.tmpdir(), 'fs-backup-test-'));
}

/**
 * Crea un file con contenuto testuale.
 */
async function createFile(filePath: string, content: string = 'test content'): Promise<void> {
  const dir = path.dirname(filePath);
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
  await writeFile(filePath, content, 'utf-8');
}

/**
 * Imposta mtime di un file a un timestamp specifico (per test retention).
 */
function setFileTime(filePath: string, daysAgo: number): void {
  const now = Date.now();
  const past = now - daysAgo * 24 * 60 * 60 * 1000;
  utimesSync(filePath, past / 1000, past / 1000);
}

describe('BackupManager', () => {
  let tempDir: string;
  let backupDir: string;
  let manager: BackupManager;

  beforeEach(() => {
    tempDir = createTempDir();
    backupDir = path.join(tempDir, '.backups');
    manager = new BackupManager({ backupDir, retentionDays: 5 });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  // ─────────────────────────────────────────────────────
  //  Backup
  // ─────────────────────────────────────────────────────

  describe('backup()', () => {
    it('dovrebbe creare un backup atomico di un file nuovo', async () => {
      const filePath = path.join(tempDir, 'test.txt');
      await createFile(filePath, 'hello world');

      const entry = await manager.backup(filePath);

      expect(entry).toBeDefined();
      expect(entry.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
      expect(entry.filePath).toBe(path.resolve(filePath));
      expect(entry.timestamp).toBeDefined();
      expect(entry.size).toBe('hello world'.length);
      expect(entry.hash).toBeDefined();
      expect(entry.hash.length).toBe(64); // SHA-256 hex

      // Verifica che il file di backup esista
      await expect(stat(entry.backupPath)).resolves.toBeDefined();
    });

    it('dovrebbe creare backup multipli dello stesso file', async () => {
      const filePath = path.join(tempDir, 'multi.txt');
      await createFile(filePath, 'v1');

      const entry1 = await manager.backup(filePath);
      await writeFile(filePath, 'v2', 'utf-8');
      const entry2 = await manager.backup(filePath);
      await writeFile(filePath, 'v3', 'utf-8');
      const entry3 = await manager.backup(filePath);

      expect(entry1.id).not.toBe(entry2.id);
      expect(entry2.id).not.toBe(entry3.id);

      const backups = await manager.listBackups(filePath);
      expect(backups).toHaveLength(3);
    });

    it('dovrebbe lanciare errore se il file non esiste', async () => {
      const filePath = path.join(tempDir, 'nonexistent.txt');

      await expect(manager.backup(filePath)).rejects.toThrow();
    });

    it('dovrebbe gestire path con spazi e caratteri speciali', async () => {
      const filePath = path.join(tempDir, 'my folder', 'my file (copy).txt');
      await createFile(filePath, 'special path test');

      const entry = await manager.backup(filePath);

      expect(entry).toBeDefined();
      expect(entry.filePath).toBe(path.resolve(filePath));

      // Verifica che il backup sia recuperabile
      const backups = await manager.listBackups(filePath);
      expect(backups).toHaveLength(1);
    });
  });

  // ─────────────────────────────────────────────────────
  //  Rollback
  // ─────────────────────────────────────────────────────

  describe('rollback()', () => {
    it('dovrebbe ripristinare il contenuto originale all\'ultimo backup', async () => {
      const filePath = path.join(tempDir, 'rollback-test.txt');
      await createFile(filePath, 'originale');

      await manager.backup(filePath);

      // Modifica il file
      await writeFile(filePath, 'modificato', 'utf-8');
      expect(await readFile(filePath, 'utf-8')).toBe('modificato');

      // Rollback all'ultimo backup
      await manager.rollback(filePath);

      expect(await readFile(filePath, 'utf-8')).toBe('originale');
    });

    it('dovrebbe ripristinare a un backup specifico tramite backupId', async () => {
      const filePath = path.join(tempDir, 'specific-rollback.txt');
      await createFile(filePath, 'v1');

      const entry1 = await manager.backup(filePath);
      await writeFile(filePath, 'v2', 'utf-8');
      const entry2 = await manager.backup(filePath);
      await writeFile(filePath, 'v3', 'utf-8');
      await manager.backup(filePath);

      // Rollback a v1 (primo backup)
      await manager.rollback(filePath, entry1.id);
      expect(await readFile(filePath, 'utf-8')).toBe('v1');

      // Rollback a v2
      await manager.rollback(filePath, entry2.id);
      expect(await readFile(filePath, 'utf-8')).toBe('v2');
    });

    it('dovrebbe lanciare errore se non ci sono backup', async () => {
      const filePath = path.join(tempDir, 'nobackup.txt');
      await createFile(filePath, 'data');

      await expect(manager.rollback(filePath)).rejects.toThrow(
        /No backups found/,
      );
    });

    it('dovrebbe lanciare errore se backupId non esiste', async () => {
      const filePath = path.join(tempDir, 'bad-id.txt');
      await createFile(filePath, 'data');
      await manager.backup(filePath);

      await expect(
        manager.rollback(filePath, '00000000-0000-0000-0000-000000000000'),
      ).rejects.toThrow(/not found/);
    });
  });

  // ─────────────────────────────────────────────────────
  //  listBackups
  // ─────────────────────────────────────────────────────

  describe('listBackups()', () => {
    it('dovrebbe restituire backup ordinati per data (decrescente)', async () => {
      const filePath = path.join(tempDir, 'ordered.txt');
      await createFile(filePath, 'a');

      const e1 = await manager.backup(filePath);
      // Piccola pausa per garantire timestamp diversi
      await new Promise((r) => setTimeout(r, 100));
      await writeFile(filePath, 'b', 'utf-8');
      const e2 = await manager.backup(filePath);
      await new Promise((r) => setTimeout(r, 100));
      await writeFile(filePath, 'c', 'utf-8');
      const e3 = await manager.backup(filePath);

      const backups = await manager.listBackups(filePath);

      expect(backups).toHaveLength(3);
      // Più recente primo
      expect(backups[0].id).toBe(e3.id);
      expect(backups[1].id).toBe(e2.id);
      expect(backups[2].id).toBe(e1.id);

      // Timestamp decrescenti
      const timestamps = backups.map((b) => new Date(b.timestamp).getTime());
      for (let i = 1; i < timestamps.length; i++) {
        expect(timestamps[i - 1]).toBeGreaterThanOrEqual(timestamps[i]);
      }
    });

    it('dovrebbe restituire array vuoto se non ci sono backup', async () => {
      const filePath = path.join(tempDir, 'nobackups.txt');
      await createFile(filePath, 'data');

      const backups = await manager.listBackups(filePath);
      expect(backups).toEqual([]);
    });
  });

  // ─────────────────────────────────────────────────────
  //  Prune
  // ─────────────────────────────────────────────────────

  describe('prune()', () => {
    it('dovrebbe eliminare backup più vecchi di retentionDays', async () => {
      const filePath = path.join(tempDir, 'prune-test.txt');
      await createFile(filePath, 'data');

      // Crea un backup recente
      const recentEntry = await manager.backup(filePath);

      // Crea un backup "vecchio" manipolando il mtime del file
      // Dobbiamo creare un altro backup, poi modificare il suo mtime
      // Per farlo, creiamo un backup aggiuntivo con manager diverso
      // o manipoliamo direttamente i file
      const oldBackupDir = manager['getBackupDirForFile'](filePath);
      const oldTimestamp = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString().replace(/:/g, '-');
      // Crea backup "vecchio" scrivendo direttamente
      const { randomUUID, createHash } = await import('node:crypto');
      const oldId = randomUUID();
      const oldContent = 'old data';
      const oldHash = createHash('sha256').update(oldContent).digest('hex');
      const oldBakName = `${oldTimestamp}_${oldId}.bak`;
      const oldBakPath = path.join(oldBackupDir, oldBakName);
      await writeFile(oldBakPath, oldContent, 'utf-8');
      const oldMeta: BackupEntry = {
        id: oldId,
        filePath: path.resolve(filePath),
        backupPath: oldBakPath,
        timestamp: oldTimestamp,
        size: oldContent.length,
        hash: oldHash,
      };
      await writeFile(oldBakPath + '.meta.json', JSON.stringify(oldMeta, null, 2), 'utf-8');

      // Imposta mtime del file vecchio a 10 giorni fa
      setFileTime(oldBakPath, 10);
      setFileTime(oldBakPath + '.meta.json', 10);

      // Il recente ha mtime "adesso" (da backup())
      // RetentionDays = 5, il vecchio ha 10 giorni → dovrebbe essere eliminato
      const deleted = await manager.prune();

      expect(deleted).toBe(1);

      const backups = await manager.listBackups(filePath);
      expect(backups).toHaveLength(1);
      expect(backups[0].id).toBe(recentEntry.id);
    });

    it('non dovrebbe eliminare backup recenti', async () => {
      const filePath = path.join(tempDir, 'recent.txt');
      await createFile(filePath, 'data');

      await manager.backup(filePath);
      await manager.backup(filePath);

      const deleted = await manager.prune();
      expect(deleted).toBe(0);

      const backups = await manager.listBackups(filePath);
      expect(backups).toHaveLength(2);
    });

    it('dovrebbe eliminare tutti i backup con force=true', async () => {
      const filePath = path.join(tempDir, 'force.txt');
      await createFile(filePath, 'data');

      await manager.backup(filePath);
      await manager.backup(filePath);

      const deleted = await manager.prune(true);

      // 2 backup files + 2 meta files = tolgo i pair, quindi 2 backup
      expect(deleted).toBe(2);

      const backups = await manager.listBackups(filePath);
      expect(backups).toHaveLength(0);
    });
  });

  // ─────────────────────────────────────────────────────
  //  getBackupPath
  // ─────────────────────────────────────────────────────

  describe('getBackupPath()', () => {
    it('dovrebbe restituire il path per un backupId esistente', async () => {
      const filePath = path.join(tempDir, 'find-me.txt');
      await createFile(filePath, 'data');

      const entry = await manager.backup(filePath);
      const found = await manager.getBackupPath(entry.id);

      expect(found).toBe(entry.backupPath);
    });

    it('dovrebbe restituire null per un backupId inesistente', async () => {
      const found = await manager.getBackupPath('00000000-0000-0000-0000-000000000000');
      expect(found).toBeNull();
    });
  });

  // ─────────────────────────────────────────────────────
  //  Configurazione
  // ─────────────────────────────────────────────────────

  describe('configurazione', () => {
    it('dovrebbe usare retentionDays di default = 5', () => {
      const m = new BackupManager({ backupDir: backupDir });
      expect(m['config'].retentionDays).toBe(5);
    });

    it('dovrebbe accettare retentionDays personalizzato', () => {
      const m = new BackupManager({ backupDir: backupDir, retentionDays: 30 });
      expect(m['config'].retentionDays).toBe(30);
    });
  });
});
