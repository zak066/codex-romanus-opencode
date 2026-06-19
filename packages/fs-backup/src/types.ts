/**
 * Configurazione del BackupManager.
 */
export interface BackupConfig {
  /** Directory dove salvare i backup (es. .ianus-backups/) */
  backupDir: string;
  /** Giorni di retention per i backup (default: 5) */
  retentionDays: number;
}

/**
 * Entry di un backup.
 */
export interface BackupEntry {
  /** UUID v4 univoco per il backup */
  id: string;
  /** Path originale del file sottoposto a backup */
  filePath: string;
  /** Path assoluto dove risiede il file di backup */
  backupPath: string;
  /** Timestamp ISO 8601 del momento in cui il backup è stato creato */
  timestamp: string;
  /** Dimensione in bytes del file originale */
  size: number;
  /** Hash SHA-256 del contenuto del file */
  hash: string;
}
