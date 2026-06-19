/**
 * core/adr-content.ts
 * Mappa ADR ID → file markdown su disco.
 * Fornisce getAdrContentPath() per risolvere il percorso del file
 * contenente il testo completo di una Architecture Decision Record.
 *
 * @module core/adr-content
 */

// ---------------------------------------------------------------------------
// Mappa ADR ID → file path relativo al project root
// ---------------------------------------------------------------------------

const ADR_FILE_MAP: Record<string, string> = {
  'adr_005': 'docs/adr/adr-005-arae.md',
  'adr_006': 'docs/adr/adr-006-advisory.md',
  'adr_007': 'docs/adr/adr-007-memoria.md',
  'adr_008': 'docs/adr/adr-008-web-search.md',
  'adr_009': 'docs/adr/adr-009-filesystem-mcp.md',
  'adr_010': 'docs/adr/adr-010-metrics-engine.md',
  'adr_011': 'docs/adr/adr-011-automata.md',
  'adr_012': 'docs/adr/adr-012-adr-lifecycle.md',
  'adr_013': 'docs/adr/adr-013-design-tokens.md',
  'adr_014': 'docs/adr/adr-014-a11y-audit.md',
  'adr_015': 'docs/adr/adr-015-seo-builder.md',
  'adr_016': 'docs/adr/adr-016-secret-scanner.md',
  'adr_017': 'docs/adr/adr-017-sbom-tracker.md',
  'adr_018': 'docs/adr/adr-018-doc-freshness.md',
  'adr_019': 'docs/adr/adr-019-incident-manager.md',
  'adr_020': 'docs/archive/RIORGANIZZAZIONE-PIANO.md',
  'adr_021': 'docs/adr/adr-021-integration.md',
  'adr_022': 'docs/archive/comfyui-mcp-architecture.md',
  'adr_023': 'docs/archive/comfyui-mcp-architecture.md',
  'adr_024': 'docs/archive/comfyui-mcp-architecture.md',
  'adr_025': 'docs/archive/comfyui-mcp-architecture.md',
  'adr_026': 'docs/archive/comfyui-mcp-architecture.md',
  'adr_028': 'docs/archive/NUNTIUS-ARCHITETTURA.md',
  'adr_029': 'docs/archive/TABULARIUM-MESSAGING-DESIGN.md',
  'adr_030': 'docs/archive/TABULARIUM-KNOWLEDGE-GRAPH-DESIGN.md',
  'adr_031': 'docs/archive/TABULARIUM-DASHBOARD-DESIGN.md',
  'adr_032': 'docs/adr/adr-032-retention-policy.md',
  'adr_033': 'docs/adr/adr-033-deprecate-speculum.md',
  'adr_034': 'docs/adr/adr-034-deprecate-sevenmau.md',
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Restituisce il percorso del file markdown associato a un ADR ID,
 * oppure null se l'ADR non ha un file dedicato su disco.
 *
 * @param adrId - Identificativo ADR (es. "adr_005", "adr_012")
 * @returns Percorso relativo del file markdown, o null
 *
 * @example
 * ```ts
 * const path = getAdrContentPath('adr_005'); // "docs/adr/adr-005-arae.md"
 * const missing = getAdrContentPath('adr_001'); // null
 * ```
 */
export function getAdrContentPath(adrId: string): string | null {
  return ADR_FILE_MAP[adrId.toLowerCase()] ?? null;
}
