/**
 * Tipi per il modulo Packaging — Codex Romanus.
 */

export interface PackageOptions {
  servers: {
    tabularium: boolean;
    ianus: boolean;
    speculum: boolean;
    praetorium: boolean;
    imago: boolean;
    nuntius: boolean;
  };
  presets: {
    large: boolean;
    medium: boolean;
    small: boolean;
  };
  includeDocs: boolean;
  includeTemplates: boolean;
  includeSetup: boolean;
  includeDist: boolean;
  includeFsBackup: boolean;
  includeAgents: boolean;
  includeSkills: boolean;
}

export interface PackageProfile {
  id: string;
  name: string;
  options: PackageOptions;
}

export interface PackageResult {
  success: boolean;
  fileName: string;
  sizeBytes: number;
  fileCount: number;
  generatedAt: string;
  options: PackageOptions;
  error?: string;
}


export interface PackageHistoryEntry {
  date: string;
  servers: string[];
  size: string;
  fileName: string;
  sizeBytes: number;
  generatedAt: string;
}

export interface SizeEstimate {
  servers: Record<string, number>;
  total: number;
}

export const DEFAULT_OPTIONS: PackageOptions = {
  servers: {
    tabularium: true,
    ianus: true,
    speculum: true,
    praetorium: true,
    imago: false,
    nuntius: false,
  },
  presets: {
    large: true,
    medium: false,
    small: false,
  },
  includeDocs: true,
  includeTemplates: true,
  includeSetup: true,
  includeDist: true,
  includeFsBackup: true,
  includeAgents: true,
  includeSkills: true,
};
