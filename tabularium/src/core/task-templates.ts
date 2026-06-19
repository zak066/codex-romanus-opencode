/**
 * core/task-templates.ts
 * Libreria di template per scaffolding di task.
 * I template JSON sono letti da templates/ all'avvio (sync).
 * Supporta sostituzione {{param}} nei path per generazione dinamica.
 *
 * @module core/task-templates
 */

import * as fs from 'fs';
import * as path from 'path';

// ---------------------------------------------------------------------------
// Tipi pubblici
// ---------------------------------------------------------------------------

export interface TemplateFile {
  path: string;
  template: boolean;
}

export interface TaskTemplate {
  name: string;
  description: string;
  files: TemplateFile[];
  steps: string[];
}

export interface ScaffoldResult {
  template: TaskTemplate;
  files: string[];
  steps: string[];
  instructions: string;
}

// ---------------------------------------------------------------------------
// Caricamento template (all'avvio)
// ---------------------------------------------------------------------------

/**
 * Directory dei template.
 * Relativa a process.cwd() — si assume che il server parta dalla root del progetto.
 */
const TEMPLATES_DIR = path.resolve(process.cwd(), 'templates');

/** Cache interna dei template caricati all'avvio. */
let loadedTemplates: TaskTemplate[] | null = null;

/**
 * Carica (o ricarica) tutti i template JSON dalla directory templates/.
 * Usa fs.readdirSync + fs.readFileSync per lettura sincrona all'avvio.
 * Salta file non JSON o file che non parsano correttamente.
 *
 * @returns Array di TaskTemplate
 */
function loadTemplates(): TaskTemplate[] {
  const dir = TEMPLATES_DIR;

  if (!fs.existsSync(dir)) {
    console.error(`[task-templates] Templates directory not found: ${dir}`);
    return [];
  }

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const templates: TaskTemplate[] = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) {
      continue;
    }

    const filePath = path.join(dir, entry.name);

    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const parsed = JSON.parse(content) as TaskTemplate;

      // Validazione base: name e description obbligatori, files e steps array
      if (!parsed.name || typeof parsed.name !== 'string') {
        console.error(`[task-templates] Invalid template (missing name): ${entry.name}`);
        continue;
      }
      if (!Array.isArray(parsed.files)) {
        console.error(`[task-templates] Invalid template (files not array): ${entry.name}`);
        continue;
      }
      if (!Array.isArray(parsed.steps)) {
        console.error(`[task-templates] Invalid template (steps not array): ${entry.name}`);
        continue;
      }

      templates.push(parsed);
    } catch (err) {
      console.error(
        `[task-templates] Failed to load template ${entry.name}:`,
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  return templates;
}

/**
 * Assicura che i template siano caricati.
 * Usa cache lazy: primo call carica, successivi riusano.
 */
function ensureTemplatesLoaded(): TaskTemplate[] {
  if (loadedTemplates === null) {
    loadedTemplates = loadTemplates();
    console.error(
      `[task-templates] Loaded ${loadedTemplates.length} templates from ${TEMPLATES_DIR}`
    );
  }
  return loadedTemplates;
}

// ---------------------------------------------------------------------------
// API pubbliche
// ---------------------------------------------------------------------------

/**
 * Restituisce l'elenco completo dei template disponibili.
 * I template vengono letti da templates/ al primo call e cachetizzati.
 *
 * @returns Array di TaskTemplate
 */
export function listTemplates(): TaskTemplate[] {
  return ensureTemplatesLoaded();
}

/**
 * Cerca un template per nome (case-sensitive).
 *
 * @param name - Nome del template da cercare
 * @returns TaskTemplate | undefined se non trovato
 */
export function getTemplate(name: string): TaskTemplate | undefined {
  if (!name) return undefined;
  const templates = ensureTemplatesLoaded();
  return templates.find((t) => t.name === name);
}

/**
 * Genera scaffolding da un template, sostituendo i placeholder {{param}}
 * nei path dei file e nelle istruzioni steps.
 *
 * @param name - Nome del template
 * @param params - Mappa chiave-valore per sostituzione {{param}}
 * @returns ScaffoldResult con file generati, steps e istruzioni testuali
 * @throws Se il template non esiste
 */
export function scaffoldFromTemplate(
  name: string,
  params: Record<string, string>
): ScaffoldResult {
  const template = getTemplate(name);

  if (!template) {
    throw new Error(`Template not found: '${name}'. Available: ${listTemplates().map((t) => t.name).join(', ') || '(none)'}`);
  }

  // Sostituisci placeholder nei path dei file
  const files: string[] = template.files.map((f) => {
    let resolvedPath = f.path;
    for (const [key, value] of Object.entries(params)) {
      resolvedPath = resolvedPath.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
    }
    return resolvedPath;
  });

  // Sostituisci placeholder negli steps
  const steps: string[] = template.steps.map((step) => {
    let resolvedStep = step;
    for (const [key, value] of Object.entries(params)) {
      resolvedStep = resolvedStep.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
    }
    return resolvedStep;
  });

  // Istruzioni testuali per l'operatore
  const instructions = [
    `Template: ${template.name}`,
    `Description: ${template.description}`,
    '',
    'Files to create:',
    ...files.map((f) => `  - ${f}`),
    '',
    'Steps:',
    ...steps.map((s, i) => `  ${i + 1}. ${s}`),
  ].join('\n');

  return {
    template,
    files,
    steps,
    instructions,
  };
}
