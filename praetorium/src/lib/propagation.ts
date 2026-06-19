import { readFile, writeFile } from 'fs/promises';
import path from 'path';

export interface PropagationResult {
  success: boolean;
  opencodeJsonUpdated: boolean;
  agentMdUpdated: boolean;
  mdPath: string;
  error?: string;
}

/**
 * Propaga il cambio modello a entrambi i file:
 * - opencode.json (gia' gestito dalla route API)
 * - .opencode/agents/{agentName}.md (frontmatter YAML)
 *
 * @param agentName - Nome agente (es. "vulcanus-senior-dev")
 * @param newModel - Nuovo modello (es. "opencode/big-pickle")
 * @returns PropagationResult
 */
export async function propagateModelChange(
  agentName: string,
  newModel: string,
): Promise<PropagationResult> {
  const mdPath = path.resolve(
    process.cwd(),
    '..',
    '.opencode',
    'agents',
    `${agentName}.md`,
  );

  try {
    const content = await readFile(mdPath, 'utf-8');
    const lines = content.split('\n');

    // Trova i delimitatori del frontmatter YAML (primo e secondo '---')
    let firstDelimiter = -1;
    let secondDelimiter = -1;

    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim() === '---') {
        if (firstDelimiter === -1) {
          firstDelimiter = i;
        } else {
          secondDelimiter = i;
          break;
        }
      }
    }

    if (firstDelimiter === -1 || secondDelimiter === -1) {
      return {
        success: false,
        opencodeJsonUpdated: true,
        agentMdUpdated: false,
        mdPath,
        error: `Frontmatter delimiters (---) non trovati in ${agentName}.md`,
      };
    }

    // Cerca la riga `model:` SOLO all'interno del frontmatter
    let modelLineIndex = -1;
    for (let i = firstDelimiter + 1; i < secondDelimiter; i++) {
      if (/^model\s*:/.test(lines[i])) {
        modelLineIndex = i;
        break;
      }
    }

    if (modelLineIndex === -1) {
      return {
        success: false,
        opencodeJsonUpdated: true,
        agentMdUpdated: false,
        mdPath,
        error: `model: non trovato nel frontmatter di ${agentName}.md`,
      };
    }

    // Preserva l'indentazione originale
    const indent = lines[modelLineIndex].match(/^\s*/)?.[0] || '';
    lines[modelLineIndex] = `${indent}model: ${newModel}`;

    await writeFile(mdPath, lines.join('\n'), 'utf-8');

    return {
      success: true,
      opencodeJsonUpdated: true,
      agentMdUpdated: true,
      mdPath,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Errore sconosciuto';
    return {
      success: false,
      opencodeJsonUpdated: true,
      agentMdUpdated: false,
      mdPath,
      error: message,
    };
  }
}
