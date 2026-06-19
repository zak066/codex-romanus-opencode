import { readFile, realpath } from 'node:fs/promises';
import { resolve, normalize, relative, sep } from 'node:path';
import { minimatch } from 'minimatch';

export interface PermissionRule {
  id: string;
  agentPattern: string;
  priority: number;
  effect: 'allow' | 'deny';
  paths: string[];
  operations: string[];
}

export interface PermissionConfig {
  version: number;
  defaultEffect: 'allow' | 'deny';
  rules: PermissionRule[];
}

export class PermissionChecker {
  private config: PermissionConfig;

  constructor(config: PermissionConfig) {
    this.config = config;
  }

  /**
   * Carica una configurazione di permessi da un file JSON.
   * Valida la struttura completa del file prima di restituire un'istanza.
   */
  static async load(configPath: string): Promise<PermissionChecker> {
    let content: string;
    try {
      content = await readFile(configPath, 'utf-8');
    } catch (err) {
      throw new Error(
        `Failed to read permissions config at "${configPath}": ${(err as Error).message}`,
        { cause: err },
      );
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(content) as Record<string, unknown>;
    } catch (err) {
      throw new Error(
        `Invalid JSON in permissions config: ${(err as Error).message}`,
        { cause: err },
      );
    }

    // --- Validazione top-level ---
    if (parsed.version === undefined) {
      throw new Error('Permissions config is missing required field: "version"');
    }
    if (typeof parsed.version !== 'number') {
      throw new Error('Permissions config "version" must be a number');
    }

    if (!parsed.defaultEffect || !['allow', 'deny'].includes(parsed.defaultEffect as string)) {
      throw new Error(
        'Permissions config must have "defaultEffect" set to "allow" or "deny"',
      );
    }

    if (!Array.isArray(parsed.rules)) {
      throw new Error('Permissions config must have a "rules" array');
    }

    // --- Validazione ogni regola ---
    const rules = parsed.rules as Record<string, unknown>[];
    for (const rule of rules) {
      if (typeof rule.id !== 'string' || !rule.id) {
        throw new Error('Each rule must have a non-empty string "id"');
      }
      if (typeof rule.agentPattern !== 'string') {
        throw new Error(`Rule "${rule.id}" must have a string "agentPattern"`);
      }
      if (typeof rule.priority !== 'number') {
        throw new Error(`Rule "${rule.id}" must have a numeric "priority"`);
      }
      if (!['allow', 'deny'].includes(rule.effect as string)) {
        throw new Error(`Rule "${rule.id}" must have "effect" set to "allow" or "deny"`);
      }
      if (!Array.isArray(rule.paths)) {
        throw new Error(`Rule "${rule.id}" must have a "paths" array`);
      }
      if (!Array.isArray(rule.operations)) {
        throw new Error(`Rule "${rule.id}" must have an "operations" array`);
      }
    }

    return new PermissionChecker(parsed as unknown as PermissionConfig);
  }

  /**
   * 5-step path sanitization + permission check:
   * 1. resolve — path assoluto dal workspaceRoot
   * 2. normalize — rimuove `.` e `..`
   * 3. containment check — il path deve stare dentro workspaceRoot
   * 4. symlink resolution — risolve eventuali symlink + re-check containment
   * 5. permission check — applica le regole in ordine di priorità
   */
  async checkOperation(
    agent: string,
    operation: string,
    filePath: string,
    workspaceRoot: string,
  ): Promise<{ allowed: boolean; reason?: string }> {
    // Step 1: Resolve
    const root = resolve(workspaceRoot);
    let resolvedPath = resolve(root, filePath);

    // Step 2: Normalize
    resolvedPath = normalize(resolvedPath);

    // Step 3: Containment check (prima della risoluzione symlink)
    if (!isContained(resolvedPath, root)) {
      return { allowed: false, reason: 'Path traversal: outside workspace' };
    }

    // Step 4: Symlink resolution
    try {
      const realPath = await realpath(resolvedPath);
      // Re-do containment check sul path reale
      if (!isContained(realPath, root)) {
        return {
          allowed: false,
          reason: 'Path traversal: symlink points outside workspace',
        };
      }
      // Utilizza il path reale per il resto della valutazione
      resolvedPath = realPath;
    } catch {
      // Se realpath fallisce (file non esiste ancora, permessi, ecc.),
      // procediamo con il path risolto normalmente
    }

    // Step 5: Permission check
    const relativePath = relative(root, resolvedPath);

    // Ordina le regole per priorità crescente (numero più basso = valutato prima)
    const sortedRules = [...this.config.rules].sort(
      (a, b) => a.priority - b.priority,
    );

    for (const rule of sortedRules) {
      // 5a. Agent matching
      if (!matchesAgent(rule.agentPattern, agent)) continue;

      // 5b. Operation matching
      if (!rule.operations.includes(operation)) continue;

      // 5c. Path glob matching (matcha sia su path relativo che assoluto)
      const pathMatches = rule.paths.some(
        (pattern) =>
          minimatch(relativePath, pattern, { dot: true }) ||
          minimatch(resolvedPath, pattern, { dot: true }),
      );
      if (!pathMatches) continue;

      // Regola matchata! Applica l'effetto
      if (rule.effect === 'deny') {
        return { allowed: false, reason: `Operation blocked by rule: ${rule.id}` };
      }
      // effect === 'allow'
      return { allowed: true };
    }

    // Nessuna regola matchata — usa defaultEffect
    if (this.config.defaultEffect === 'deny') {
      return { allowed: false, reason: 'Default effect: deny' };
    }
    return { allowed: true };
  }
}

/**
 * Verifica se un agent pattern matcha un nome agente.
 * Supporta:
 *  - `*` per matchare tutti
 *  - CSV patterns (es. "vulcanus,catone,agrippa") con case-insensitive
 */
function matchesAgent(pattern: string, agent: string): boolean {
  if (pattern === '*') return true;
  return pattern.split(',').some(
    (p) => p.trim().toLowerCase() === agent.toLowerCase(),
  );
}

/**
 * Verifica che `targetPath` sia contenuto all'interno di `rootPath`.
 * Su Windows il confronto è case-insensitive.
 */
function isContained(targetPath: string, rootPath: string): boolean {
  const normalizedRoot = normalize(rootPath);
  const normalizedTarget = normalize(targetPath);

  const rootNorm = process.platform === 'win32'
    ? normalizedRoot.toLowerCase()
    : normalizedRoot;
  const targetNorm = process.platform === 'win32'
    ? normalizedTarget.toLowerCase()
    : normalizedTarget;

  // Deve essere esattamente rootPath o iniziare con rootPath + separatore
  return targetNorm === rootNorm || targetNorm.startsWith(rootNorm + sep);
}
