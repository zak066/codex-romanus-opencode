/**
 * WorkflowManager — Caricamento, validazione, rendering e override
 * di workflow template per ComfyUI.
 *
 * Pattern: Facade + Template Method
 * - Carica template JSON da disco
 * - Espone metodi per ottenere, validare, renderizzare e sovrascrivere workflow
 * - I placeholder PARAM_* vengono scoperti automaticamente e sostituiti al rendering
 */

import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { WorkflowValidationError } from '../utils/errors.js';
import { debug as logDebug } from '../utils/logger.js';
import type { WorkflowNode } from '../comfyui/types.js';

// ─── Interfaces ──────────────────────────────────────────────────────────────

/** Definizione completa di un workflow template. */
export interface WorkflowDefinition {
  id: string;
  name: string;
  description: string;
  category: 'txt2img' | 'img2img' | 'upscale' | 'custom';
  json: Record<string, WorkflowNode>;
  parameters: WorkflowParameter[];
}

/** Descrizione di un parametro estraibile da un workflow. */
export interface WorkflowParameter {
  name: string;
  type: 'string' | 'integer' | 'float' | 'boolean' | 'prompt';
  required: boolean;
  defaultValue?: unknown;
  description?: string;
  min?: number;
  max?: number;
}

/** Risultato della validazione di un workflow. */
export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: string[];
}

/** Singolo errore o warning di validazione. */
export interface ValidationError {
  path: string;
  message: string;
  severity: 'error' | 'warning';
}

// ─── Constants ───────────────────────────────────────────────────────────────

/** Regex per riconoscere placeholder PARAM_* nel JSON del workflow. */
const PARAM_RE = /^PARAM_(?:(INT|FLOAT|BOOL|STRING|PROMPT)_)?(.+)$/;

/**
 * Valori di default per parametri noti.
 * Usati quando un parametro opzionale non viene fornito al render.
 */
const KNOWN_DEFAULTS: Record<string, unknown> = {
  steps: 20,
  cfg: 7,
  width: 1024,
  height: 1024,
  seed: -1,
  sampler: 'euler',
  scheduler: 'normal',
  model: 'sd_xl_base_1.0.safetensors',
  prefix: 'ComfyUI',
  negative_prompt: '',
  upscale_model: '4x_NMKD-Superscale-SP_178000_G.pth',
};

/** Nodi che possono essere terminali (non referenziati) senza generare warning. */
const TERMINAL_NODE_TYPES = new Set([
  'SaveImage',
  'PreviewImage',
]);

// ─── WorkflowManager ─────────────────────────────────────────────────────────

export class WorkflowManager {
  private readonly _templatesDir: string;
  private _workflows: WorkflowDefinition[] = [];

  /**
   * @param templatesDir Percorso opzionale alla directory dei template JSON.
   *                     Default: `workflows/` nella root del pacchetto.
   */
  constructor(templatesDir?: string) {
    const moduleDir = fileURLToPath(new URL('.', import.meta.url));
    this._templatesDir = templatesDir ?? resolve(moduleDir, '../../workflows');
  }

  // ─── Public Methods ────────────────────────────────────────────────────────

  /**
   * Carica tutti i file `.json` dalla directory dei template.
   * Per ognuno estrae i parametri con `parseParameters()` e costruisce
   * un `WorkflowDefinition`.
   *
   * Se la directory non esiste, restituisce un array vuoto (non lancia errore).
   */
  async loadWorkflows(): Promise<WorkflowDefinition[]> {
    let filenames: string[];

    try {
      filenames = await readdir(this._templatesDir);
    } catch {
      logDebug('WorkflowManager: templates directory not found', {
        path: this._templatesDir,
      });
      this._workflows = [];
      return [];
    }

    const jsonFiles = filenames
      .filter((f) => f.endsWith('.json'))
      .sort();

    const workflows: WorkflowDefinition[] = [];

    for (const file of jsonFiles) {
      try {
        const filePath = resolve(this._templatesDir, file);
        const content = await readFile(filePath, 'utf-8');
        const json = JSON.parse(content) as Record<string, WorkflowNode>;

        const id = file.replace(/\.json$/, '');
        const category = this._deriveCategory(id);
        const parameters = this.parseParameters(json);

        const definition: WorkflowDefinition = {
          id,
          name: this._deriveName(id),
          description: this._deriveDescription(id, category),
          category,
          json,
          parameters,
        };

        workflows.push(definition);
      } catch (err) {
        logDebug('WorkflowManager: failed to load template', {
          file,
          error: (err as Error).message,
        });
        // Salta il file corrotto e continua
      }
    }

    this._workflows = workflows;
    return workflows;
  }

  /**
   * Restituisce un workflow per ID.
   */
  getWorkflow(id: string): WorkflowDefinition | undefined {
    return this._workflows.find((w) => w.id === id);
  }

  /**
   * Restituisce tutti i workflow, opzionalmente filtrati per categoria.
   */
  listWorkflows(category?: string): WorkflowDefinition[] {
    if (category) {
      return this._workflows.filter((w) => w.category === category);
    }
    return [...this._workflows];
  }

  /**
   * Sostituisce i placeholder PARAM_* con i valori forniti.
   *
   * @param workflowId ID del template da renderizzare
   * @param params     Mappa nome-parametro → valore
   * @returns          Workflow con placeholders sostituiti
   * @throws {WorkflowValidationError} Se un parametro required non è fornito
   */
  async renderWorkflow(
    workflowId: string,
    params: Record<string, unknown>,
  ): Promise<Record<string, WorkflowNode>> {
    const definition = this.getWorkflow(workflowId);
    if (!definition) {
      throw new WorkflowValidationError(
        `Workflow not found: "${workflowId}"`,
      );
    }

    // Verifica parametri required
    for (const param of definition.parameters) {
      if (param.required && !this._hasParam(params, param.name)) {
        throw new WorkflowValidationError(
          `Missing required parameter: "${param.name}" (type: ${param.type})`,
        );
      }
    }

    // Deep clone del JSON template
    const rendered: Record<string, WorkflowNode> = JSON.parse(
      JSON.stringify(definition.json),
    );

    // Sostituzione placeholders
    for (const node of Object.values(rendered)) {
      if (!node.inputs) continue;
      for (const [key, value] of Object.entries(node.inputs)) {
        if (typeof value === 'string' && value.startsWith('PARAM_')) {
          node.inputs[key] = this._resolveParamValue(value, params);
        }
      }
    }

    return rendered;
  }

  /**
   * Applica override parziali ai nodi di un workflow.
   *
   * @param workflow  Workflow originale
   * @param overrides Mappa nodeId → { class_type?, inputs?, _meta? }
   * @returns         Nuovo workflow con override applicati (deep clone)
   */
  applyOverrides(
    workflow: Record<string, WorkflowNode>,
    overrides: Record<string, Partial<WorkflowNode>>,
  ): Record<string, WorkflowNode> {
    const cloned: Record<string, WorkflowNode> = JSON.parse(
      JSON.stringify(workflow),
    );

    for (const [nodeId, override] of Object.entries(overrides)) {
      const target = cloned[nodeId];
      if (!target) continue;

      if (override.class_type !== undefined) {
        target.class_type = override.class_type;
      }
      if (override.inputs !== undefined) {
        target.inputs = {
          ...target.inputs,
          ...override.inputs,
        };
      }
      if (override._meta !== undefined) {
        target._meta = {
          ...(target._meta ?? {}),
          ...override._meta,
        };
      }
    }

    return cloned;
  }

  /**
   * Valida la struttura di un workflow:
   * - Ogni nodo ha `class_type` e `inputs`
   * - I riferimenti tra nodi puntano a nodi esistenti
   * - Warning per nodi orfani (non SaveImage/PreviewImage)
   */
  validateWorkflow(workflow: Record<string, WorkflowNode>): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: string[] = [];
    const nodeIds = new Set(Object.keys(workflow));

    // —— Struttura dei nodi ——
    for (const [nodeId, node] of Object.entries(workflow)) {
      if (!node.class_type || typeof node.class_type !== 'string') {
        errors.push({
          path: `/${nodeId}`,
          message: `Node "${nodeId}" is missing class_type`,
          severity: 'error',
        });
      }

      if (!node.inputs || typeof node.inputs !== 'object' || Array.isArray(node.inputs)) {
        errors.push({
          path: `/${nodeId}`,
          message: `Node "${nodeId}" is missing inputs`,
          severity: 'error',
        });
      }
    }

    // —— Riferimenti tra nodi ——
    const referencedBy = new Map<string, string[]>();

    for (const [nodeId, node] of Object.entries(workflow)) {
      if (!node.inputs) continue;

      for (const [inputKey, inputValue] of Object.entries(node.inputs)) {
        if (Array.isArray(inputValue) && inputValue.length >= 2) {
          const [refNodeId] = inputValue;
          if (typeof refNodeId === 'string') {
            if (!nodeIds.has(refNodeId)) {
              errors.push({
                path: `/${nodeId}/inputs/${inputKey}`,
                message: `Node "${nodeId}" references non-existent node "${refNodeId}" in input "${inputKey}"`,
                severity: 'error',
              });
            } else {
              if (!referencedBy.has(refNodeId)) {
                referencedBy.set(refNodeId, []);
              }
              referencedBy.get(refNodeId)!.push(nodeId);
            }
          }
        }
      }
    }

    // —— Nodi orfani (non referenziati) ——
    for (const nodeId of nodeIds) {
      if (!referencedBy.has(nodeId)) {
        const node = workflow[nodeId];
        const classType = node?.class_type ?? 'unknown';
        if (!TERMINAL_NODE_TYPES.has(classType)) {
          warnings.push(
            `Node "${nodeId}" (${classType}) is not referenced by any other node and is not a terminal node`,
          );
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Analizza ricorsivamente il JSON di un workflow e restituisce
   * l'elenco dei parametri scoperti (placeholder PARAM_*).
   *
   * @param workflow Workflow JSON da analizzare
   * @returns        Array di WorkflowParameter ordinati per nome
   */
  parseParameters(workflow: Record<string, WorkflowNode>): WorkflowParameter[] {
    const paramMap = new Map<string, WorkflowParameter>();

    for (const node of Object.values(workflow)) {
      this._scanNodeForParams(node, paramMap);
    }

    return Array.from(paramMap.values()).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  }

  /**
   * Aggiunge (o sostituisce) un workflow al catalogo.
   */
  addWorkflow(id: string, definition: WorkflowDefinition): void {
    const idx = this._workflows.findIndex((w) => w.id === id);
    if (idx >= 0) {
      this._workflows[idx] = definition;
    } else {
      this._workflows.push(definition);
    }
  }

  // ─── Private Helpers ───────────────────────────────────────────────────────

  /** Deriva la categoria dal nome del file. */
  private _deriveCategory(id: string): WorkflowDefinition['category'] {
    const prefix = id.split('.')[0];
    if (prefix === 'txt2img' || prefix === 'img2img' || prefix === 'upscale') {
      return prefix;
    }
    return 'custom';
  }

  /** Deriva il nome leggibile dal nome del file. */
  private _deriveName(id: string): string {
    const parts = id.split('.');
    const main = parts[0]
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/2/g, '2')
      .replace(/-/g, ' ')
      .split(' ')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ')
      .replace(/ To /g, '-to-');

    const variant = parts.slice(1).length > 0
      ? ` (${parts.slice(1).map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join(' ')})`
      : '';

    return main + variant;
  }

  /** Deriva la descrizione dalla categoria. */
  private _deriveDescription(id: string, category: WorkflowDefinition['category']): string {
    const descriptions: Record<string, string> = {
      txt2img: 'Generate images from text prompts',
      img2img: 'Generate images from an input image and text prompts',
      upscale: 'Upscale an input image using a upscale model',
    };
    return descriptions[category] ?? `Custom workflow: ${id}`;
  }

  /**
   * Scansiona ricorsivamente gli input di un nodo alla ricerca
   * di placeholder PARAM_* e li registra nella mappa.
   */
  private _scanNodeForParams(
    node: WorkflowNode,
    paramMap: Map<string, WorkflowParameter>,
  ): void {
    if (!node.inputs) return;

    for (const value of Object.values(node.inputs)) {
      if (typeof value === 'string') {
        this._tryRegisterParam(value, paramMap);
      }
    }
  }

  /**
   * Tenta di registrare un placeholder PARAM_* come WorkflowParameter.
   */
  private _tryRegisterParam(
    value: string,
    paramMap: Map<string, WorkflowParameter>,
  ): void {
    const match = value.match(PARAM_RE);
    if (!match) return;

    const typePrefix = match[1] as string | undefined;
    const rawName = match[2];

    // Determina tipo e nome
    const { paramType, name, required } = this._classifyParam(typePrefix, rawName);

    if (!paramMap.has(name)) {
      paramMap.set(name, {
        name,
        type: paramType,
        required,
        defaultValue: KNOWN_DEFAULTS[name] ?? undefined,
      });
    }
  }

  /**
   * Classifica un placeholder PARAM_* in tipo, nome e obbligatorietà.
   */
  private _classifyParam(
    typePrefix: string | undefined,
    rawName: string,
  ): { paramType: WorkflowParameter['type']; name: string; required: boolean } {
    const name = rawName.toLowerCase();

    switch (typePrefix) {
      case 'INT':
        return { paramType: 'integer', name, required: true };
      case 'FLOAT':
        return { paramType: 'float', name, required: true };
      case 'BOOL':
        return { paramType: 'boolean', name, required: true };
      case 'STRING':
        return {
          paramType: 'string',
          name,
          // negative_prompt può essere vuoto
          required: name !== 'negative_prompt',
        };
      case 'PROMPT':
        return { paramType: 'prompt', name, required: true };
      default:
        // PARAM_PROMPT (senza prefisso) → type: prompt
        if (typePrefix === undefined && rawName === 'PROMPT') {
          return { paramType: 'prompt', name: 'prompt', required: true };
        }
        return { paramType: 'string', name, required: true };
    }
  }

  /**
   * Risolve un placeholder PARAM_* usando i valori forniti o i default.
   */
  private _resolveParamValue(
    placeholder: string,
    params: Record<string, unknown>,
  ): unknown {
    const match = placeholder.match(PARAM_RE);
    if (!match) return placeholder;

    const typePrefix = match[1] as string | undefined;
    const rawName = match[2].toLowerCase();

    // 1. Valore fornito dall'utente
    if (rawName in params && params[rawName] !== undefined) {
      return this._convertType(params[rawName], typePrefix);
    }

    // 2. Valore di default noto
    if (rawName in KNOWN_DEFAULTS) {
      return KNOWN_DEFAULTS[rawName];
    }

    // 3. Fallback: mantieni il placeholder (non dovrebbe succedere)
    return placeholder;
  }

  /**
   * Converte un valore al tipo atteso in base al prefisso del placeholder.
   */
  private _convertType(value: unknown, typePrefix: string | undefined): unknown {
    switch (typePrefix) {
      case 'INT':
        return typeof value === 'number' ? Math.floor(value) : parseInt(String(value), 10);
      case 'FLOAT':
        return typeof value === 'number' ? value : parseFloat(String(value));
      case 'BOOL':
        return value === true || value === 'true' || value === 1 || value === '1';
      default:
        // string / prompt / nessun prefisso — restituisci il valore così com'è
        return value;
    }
  }

  /**
   * Verifica se un parametro è presente (non undefined).
   * Separa il caso "esiste con valore 0/false" da "non esiste".
   */
  private _hasParam(params: Record<string, unknown>, name: string): boolean {
    return name in params && params[name] !== undefined && params[name] !== null;
  }
}
