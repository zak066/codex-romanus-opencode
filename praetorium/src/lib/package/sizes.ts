/**
 * Stima delle dimensioni dei server per il pacchetto Codex Romanus.
 */

import type { PackageOptions, SizeEstimate } from './types';
import { DEFAULT_OPTIONS } from './types';

/** Dimensioni stimate per ogni server (in bytes) */
const SERVER_SIZES: Record<string, number> = {
  tabularium: 13_000_000,
  ianus: 3_500_000,
  speculum: 2_000_000,
  praetorium: 8_000_000,
  imago: 4_800_000,
  nuntius: 2_300_000,
};

const DIST_EXTRA = 19_000_000;
const DOCS_SIZE = 2_500_000;
const TEMPLATES_SIZE = 50_000;
const SETUP_SIZE = 100_000;
const FS_BACKUP_SIZE = 500_000;
const AGENTS_SIZE = 150_000;
const SKILLS_SIZE = 350_000;

/**
 * Calcola una stima della dimensione del pacchetto in base alle opzioni.
 */
export function getSizeEstimate(options: PackageOptions = DEFAULT_OPTIONS): SizeEstimate {
  const servers: Record<string, number> = {};
  let total = 0;

  for (const [key, enabled] of Object.entries(options.servers)) {
    if (enabled && SERVER_SIZES[key] !== undefined) {
      servers[key] = SERVER_SIZES[key];
      total += SERVER_SIZES[key];
    } else {
      servers[key] = 0;
    }
  }

  if (options.includeDist) total += DIST_EXTRA;
  if (options.includeDocs) total += DOCS_SIZE;
  if (options.includeTemplates) total += TEMPLATES_SIZE;
  if (options.includeSetup) total += SETUP_SIZE;
  if (options.includeFsBackup) total += FS_BACKUP_SIZE;
  if (options.includeAgents) total += AGENTS_SIZE;
  if (options.includeSkills) total += SKILLS_SIZE;

  return { servers, total };
}
