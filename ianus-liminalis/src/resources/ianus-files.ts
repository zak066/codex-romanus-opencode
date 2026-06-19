/**
 * Resource: ianus://files/{path}
 *
 * Espone il contenuto testuale di un file del workspace.
 * Esegue containment check per prevenire path traversal.
 */

import type { ToolDeps } from '../tools/types.js';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export interface ResourceHandler {
  uriTemplate: string;
  name: string;
  description: string;
  match(uri: string): string | null;
  read(uri: string, deps: ToolDeps): Promise<{ uri: string; mimeType: string; text: string }>;
}

export const fileResourceHandler: ResourceHandler = {
  uriTemplate: 'ianus://files/{path}',
  name: 'File content',
  description: 'Contenuto di un file nel workspace',

  match(uri: string): string | null {
    const match = uri.match(/^ianus:\/\/files\/(.+)$/);
    return match ? match[1] : null;
  },

  async read(uri: string, deps: ToolDeps) {
    const filePath = this.match(uri)!;
    const resolved = resolve(deps.workspaceRoot, filePath);

    if (!resolved.startsWith(deps.workspaceRoot)) {
      throw new Error('Path traversal');
    }

    const content = await readFile(resolved, 'utf-8');
    return { uri, mimeType: 'text/plain', text: content };
  },
};
