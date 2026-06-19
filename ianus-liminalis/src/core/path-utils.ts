import { resolve, normalize, relative, sep } from 'node:path';

/**
 * Risolve un path relativo al workspace root.
 * Previene path traversal controllando che il risultato sia dentro il workspace.
 */
export function resolveSafePath(inputPath: string, workspaceRoot: string): string {
  const resolved = resolve(workspaceRoot, normalize(inputPath));
  // Containment check con supporto Windows (case-insensitive) e trailing separator
  const rootNorm = process.platform === 'win32'
    ? normalize(resolve(workspaceRoot)).toLowerCase()
    : normalize(resolve(workspaceRoot));
  const targetNorm = process.platform === 'win32'
    ? resolved.toLowerCase()
    : resolved;

  if (targetNorm !== rootNorm && !targetNorm.startsWith(rootNorm + sep)) {
    throw new Error(`Path traversal detected: ${inputPath} resolves outside workspace`);
  }
  return resolved;
}

/**
 * Calcola il path relativo rispetto al workspace root
 */
export function toRelativePath(absolutePath: string, workspaceRoot: string): string {
  return relative(workspaceRoot, absolutePath);
}
