/**
 * Type definitions for Ianus Liminalis journal ingestion.
 */

/**
 * Raw entry from Ianus journal JSONL file.
 */
export interface IanusJournalEntry {
  id: string;
  timestamp: string;
  agent: string;
  operation: string;
  path: string;
  details?: Record<string, unknown>;
}

/**
 * Tabularium file change type for the file_changes table.
 */
export type IanusChangeType = 'created' | 'modified' | 'deleted' | 'renamed';

/**
 * Result of mapping an Ianus operation to a Tabularium change type.
 */
export interface IanusOperationMapping {
  operation: string;
  changeType: IanusChangeType | null;
  skip: boolean;
}

/**
 * Result entry for the response to the client.
 */
export interface IanusIngestResultEntry {
  id: string;
  operation: string;
  path: string;
  timestamp: string;
  mappedChangeType: IanusChangeType | null;
  status: 'imported' | 'skipped' | 'duplicate' | 'error';
  error?: string;
}

/**
 * Final result for the ianus_ingest tool.
 */
export interface IanusIngestResult {
  imported: number;
  skipped: number;
  duplicates: number;
  errors: number;
  totalIanusEntries: number;
  entries: IanusIngestResultEntry[];
}

/**
 * Options for the ianus_ingest tool call.
 */
export interface IanusIngestOptions {
  limit?: number;
  since?: string;
  dryRun?: boolean;
}

/**
 * Mapping from Ianus operation string to Tabularium change type.
 * See ADR-021 for mapping table.
 */
export const IANUS_OPERATION_MAPPING: Record<string, { changeType: IanusChangeType | null; skip: boolean }> = {
  read: { changeType: null, skip: true },
  write: { changeType: 'modified', skip: false },
  edit: { changeType: 'modified', skip: false },
  delete: { changeType: 'deleted', skip: false },
  backup: { changeType: 'modified', skip: false },
  rollback: { changeType: 'modified', skip: false },
  search: { changeType: null, skip: true },
  tree: { changeType: null, skip: true },
  stat: { changeType: null, skip: true },
  list: { changeType: null, skip: true },
  journal: { changeType: null, skip: true },
  watch: { changeType: null, skip: true },
};
