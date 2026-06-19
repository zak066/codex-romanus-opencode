/**
 * WorkflowManager — Unit Tests
 *
 * Copre:
 * - loadWorkflows (3 template built-in)
 * - getWorkflow per ID
 * - listWorkflows per categoria
 * - parseParameters (scoperta placeholder)
 * - renderWorkflow (sostituzione, conversione tipi, required mancante)
 * - applyOverrides (override parziale nodi)
 * - validateWorkflow (struttura, riferimenti, orfani)
 * - addWorkflow (custom)
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { WorkflowManager } from '../../src/services/workflow-manager.js';
import { WorkflowValidationError } from '../../src/utils/errors.js';
import type { WorkflowNode } from '../../src/comfyui/types.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const workflowsDir = resolve(__dirname, '../../workflows');

/**
 * Crea un workflow minimale valido per i test che non richiedono file reali.
 */
function minimalValidWorkflow(): Record<string, WorkflowNode> {
  return {
    '1': {
      class_type: 'CheckpointLoaderSimple',
      inputs: { ckpt_name: 'model.safetensors' },
    },
    '2': {
      class_type: 'CLIPTextEncode',
      inputs: { text: 'hello', clip: ['1', 1] },
    },
    '3': {
      class_type: 'KSampler',
      inputs: {
        seed: 42,
        steps: 20,
        cfg: 7,
        model: ['1', 0],
        positive: ['2', 0],
        negative: ['2', 0],
        latent_image: ['4', 0],
      },
    },
    '4': {
      class_type: 'EmptyLatentImage',
      inputs: { width: 512, height: 512, batch_size: 1 },
    },
    '5': {
      class_type: 'VAEDecode',
      inputs: { samples: ['3', 0], vae: ['1', 2] },
    },
    '6': {
      class_type: 'SaveImage',
      inputs: { filename_prefix: 'test', images: ['5', 0] },
    },
  };
}

// ─── Suite ───────────────────────────────────────────────────────────────────

describe('WorkflowManager', () => {
  let manager: WorkflowManager;

  beforeAll(async () => {
    manager = new WorkflowManager(workflowsDir);
    await manager.loadWorkflows();
  });

  // ─── loadWorkflows ──────────────────────────────────────────

  describe('loadWorkflows', () => {
    it('should load 3 built-in workflow templates', () => {
      const workflows = manager.listWorkflows();
      expect(workflows).toHaveLength(3);
    });

    it('should load txt2img.default, img2img.default, upscale.default', () => {
      const ids = manager.listWorkflows().map((w) => w.id).sort();
      expect(ids).toEqual([
        'img2img.default',
        'txt2img.default',
        'upscale.default',
      ]);
    });

    it('should have correct category for each template', () => {
      const txt2img = manager.getWorkflow('txt2img.default')!;
      const img2img = manager.getWorkflow('img2img.default')!;
      const upscale = manager.getWorkflow('upscale.default')!;

      expect(txt2img.category).toBe('txt2img');
      expect(img2img.category).toBe('img2img');
      expect(upscale.category).toBe('upscale');
    });
  });

  // ─── getWorkflow ────────────────────────────────────────────

  describe('getWorkflow', () => {
    it('should return workflow by ID', () => {
      const wf = manager.getWorkflow('txt2img.default');
      expect(wf).toBeDefined();
      expect(wf!.id).toBe('txt2img.default');
    });

    it('should return undefined for unknown ID', () => {
      const wf = manager.getWorkflow('nonexistent');
      expect(wf).toBeUndefined();
    });
  });

  // ─── listWorkflows ──────────────────────────────────────────

  describe('listWorkflows', () => {
    it('should return all workflows when no category given', () => {
      expect(manager.listWorkflows()).toHaveLength(3);
    });

    it('should filter by category: txt2img', () => {
      const list = manager.listWorkflows('txt2img');
      expect(list).toHaveLength(1);
      expect(list[0].category).toBe('txt2img');
    });

    it('should filter by category: img2img', () => {
      const list = manager.listWorkflows('img2img');
      expect(list).toHaveLength(1);
      expect(list[0].category).toBe('img2img');
    });

    it('should filter by category: upscale', () => {
      const list = manager.listWorkflows('upscale');
      expect(list).toHaveLength(1);
      expect(list[0].category).toBe('upscale');
    });

    it('should return empty array for unknown category', () => {
      expect(manager.listWorkflows('custom')).toHaveLength(0);
    });
  });

  // ─── parseParameters ────────────────────────────────────────

  describe('parseParameters', () => {
    it('should find PARAM_PROMPT, PARAM_INT_SEED, PARAM_FLOAT_CFG', () => {
      const wf = manager.getWorkflow('txt2img.default')!;
      const params = manager.parseParameters(wf.json);
      const names = params.map((p) => p.name);

      expect(names).toContain('prompt');
      expect(names).toContain('seed');
      expect(names).toContain('cfg');
    });

    it('should assign correct types', () => {
      const wf = manager.getWorkflow('txt2img.default')!;
      const params = manager.parseParameters(wf.json);

      const prompt = params.find((p) => p.name === 'prompt')!;
      const seed = params.find((p) => p.name === 'seed')!;
      const cfg = params.find((p) => p.name === 'cfg')!;
      const steps = params.find((p) => p.name === 'steps')!;
      const sampler = params.find((p) => p.name === 'sampler')!;
      const model = params.find((p) => p.name === 'model')!;

      expect(prompt.type).toBe('prompt');
      expect(seed.type).toBe('integer');
      expect(cfg.type).toBe('float');
      expect(steps.type).toBe('integer');
      expect(sampler.type).toBe('string');
      expect(model.type).toBe('string');
    });

    it('should assign default values for known parameters', () => {
      const wf = manager.getWorkflow('txt2img.default')!;
      const params = manager.parseParameters(wf.json);

      expect(params.find((p) => p.name === 'steps')!.defaultValue).toBe(20);
      expect(params.find((p) => p.name === 'cfg')!.defaultValue).toBe(7);
      expect(params.find((p) => p.name === 'width')!.defaultValue).toBe(1024);
      expect(params.find((p) => p.name === 'height')!.defaultValue).toBe(1024);
      expect(params.find((p) => p.name === 'seed')!.defaultValue).toBe(-1);
      expect(params.find((p) => p.name === 'sampler')!.defaultValue).toBe('euler');
      expect(params.find((p) => p.name === 'scheduler')!.defaultValue).toBe('normal');
      expect(params.find((p) => p.name === 'model')!.defaultValue).toBe('sd_xl_base_1.0.safetensors');
      expect(params.find((p) => p.name === 'prefix')!.defaultValue).toBe('ComfyUI');
    });

    it('should detect additional params in img2img template', () => {
      const wf = manager.getWorkflow('img2img.default')!;
      const params = manager.parseParameters(wf.json);
      const names = params.map((p) => p.name);

      // img2img ha un parametro image aggiuntivo
      expect(names).toContain('image');
    });

    it('should return correct params for upscale template', () => {
      const wf = manager.getWorkflow('upscale.default')!;
      const params = manager.parseParameters(wf.json);
      const names = params.map((p) => p.name);

      expect(names).toContain('image');
      expect(names).toContain('upscale_model');
      expect(names).toContain('prefix');
    });
  });

  // ─── renderWorkflow ─────────────────────────────────────────

  describe('renderWorkflow', () => {
    it('should replace placeholders correctly', async () => {
      const rendered = await manager.renderWorkflow('txt2img.default', {
        prompt: 'a cat',
        seed: 42,
        steps: 30,
        cfg: 7.5,
        width: 512,
        height: 512,
        sampler: 'ddim',
        scheduler: 'karras',
        model: 'model.safetensors',
        prefix: 'test',
        negative_prompt: 'bad quality',
      });

      expect(rendered['6'].inputs.text).toBe('a cat');
      expect(rendered['3'].inputs.seed).toBe(42);
      expect(rendered['3'].inputs.steps).toBe(30);
      expect(rendered['3'].inputs.cfg).toBe(7.5);
      expect(rendered['3'].inputs.sampler_name).toBe('ddim');
      expect(rendered['3'].inputs.scheduler).toBe('karras');
      expect(rendered['4'].inputs.ckpt_name).toBe('model.safetensors');
      expect(rendered['5'].inputs.width).toBe(512);
      expect(rendered['5'].inputs.height).toBe(512);
      expect(rendered['7'].inputs.text).toBe('bad quality');
      expect(rendered['9'].inputs.filename_prefix).toBe('test');
    });

    it('should convert types correctly (int, float)', async () => {
      const rendered = await manager.renderWorkflow('txt2img.default', {
        prompt: 'test',
        seed: '42',
        steps: '30',
        cfg: '7.5',
        width: '1024',
        height: '1024',
        sampler: 'euler',
        scheduler: 'normal',
        model: 'model.safetensors',
        prefix: 'test',
        negative_prompt: '',
      });

      expect(rendered['3'].inputs.seed).toBe(42);
      expect(typeof rendered['3'].inputs.seed).toBe('number');
      expect(rendered['3'].inputs.cfg).toBe(7.5);
      expect(typeof rendered['3'].inputs.cfg).toBe('number');
      expect(rendered['3'].inputs.steps).toBe(30);
      expect(typeof rendered['3'].inputs.steps).toBe('number');
      expect(rendered['5'].inputs.width).toBe(1024);
      expect(typeof rendered['5'].inputs.width).toBe('number');
    });

    it('should throw WorkflowValidationError for missing required parameter', async () => {
      // prompt is missing
      const promise = manager.renderWorkflow('txt2img.default', {
        seed: 42,
        steps: 30,
        cfg: 7.5,
        width: 512,
        height: 512,
        sampler: 'euler',
        scheduler: 'normal',
        model: 'model.safetensors',
        prefix: 'test',
        negative_prompt: '',
      });

      await expect(promise).rejects.toThrow(WorkflowValidationError);
      await expect(promise).rejects.toThrow(/prompt/);
    });

    it('should use default values for optional parameters', async () => {
      // negative_prompt non fornito → dovrebbe usare default ''
      const rendered = await manager.renderWorkflow('txt2img.default', {
        prompt: 'test',
        seed: 42,
        steps: 20,
        cfg: 7,
        width: 1024,
        height: 1024,
        sampler: 'euler',
        scheduler: 'normal',
        model: 'model.safetensors',
        prefix: 'test',
      });

      expect(rendered['7'].inputs.text).toBe('');
    });

    it('should throw WorkflowValidationError for unknown workflow ID', async () => {
      const promise = manager.renderWorkflow('nonexistent', {});
      await expect(promise).rejects.toThrow(WorkflowValidationError);
      await expect(promise).rejects.toThrow(/not found/i);
    });
  });

  // ─── applyOverrides ─────────────────────────────────────────

  describe('applyOverrides', () => {
    it('should modify inputs of a specific node', () => {
      const workflow = minimalValidWorkflow();
      const overridden = manager.applyOverrides(workflow, {
        '1': { inputs: { ckpt_name: 'other_model.safetensors' } },
      });

      expect(overridden['1'].inputs.ckpt_name).toBe('other_model.safetensors');
      // Altri nodi rimangono invariati
      expect(overridden['2'].inputs.text).toBe('hello');
    });

    it('should allow overriding class_type', () => {
      const workflow = minimalValidWorkflow();
      const overridden = manager.applyOverrides(workflow, {
        '1': { class_type: 'CustomModelLoader' },
      });

      expect(overridden['1'].class_type).toBe('CustomModelLoader');
    });

    it('should not mutate the original workflow', () => {
      const workflow = minimalValidWorkflow();
      manager.applyOverrides(workflow, {
        '1': { inputs: { ckpt_name: 'other.safetensors' } },
      });

      // Originale non modificato
      expect(workflow['1'].inputs.ckpt_name).toBe('model.safetensors');
    });

    it('should ignore overrides for non-existent nodes', () => {
      const workflow = minimalValidWorkflow();
      const overridden = manager.applyOverrides(workflow, {
        '999': { inputs: { test: 'value' } },
      });

      // Nessun cambiamento
      expect(Object.keys(overridden)).toEqual(Object.keys(workflow));
    });
  });

  // ─── validateWorkflow ───────────────────────────────────────

  describe('validateWorkflow', () => {
    it('should validate a valid workflow', () => {
      const workflow = minimalValidWorkflow();
      const result = manager.validateWorkflow(workflow);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should report error for node without class_type', () => {
      const invalid: Record<string, WorkflowNode> = {
        '1': { class_type: '', inputs: {} },
      };
      const result = manager.validateWorkflow(invalid);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.message.includes('class_type'))).toBe(true);
    });

    it('should report error for node missing inputs', () => {
      const invalid = {
        '1': { class_type: 'KSampler', inputs: {} as Record<string, unknown> },
        '2': { class_type: 'Test', inputs: null! },
      };
      const result = manager.validateWorkflow(invalid);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.message.includes('inputs'))).toBe(true);
    });

    it('should report error for reference to non-existent node', () => {
      const invalid: Record<string, WorkflowNode> = {
        '1': { class_type: 'KSampler', inputs: { model: ['999', 0] } },
        '2': { class_type: 'SaveImage', inputs: { images: ['1', 0] } },
      };
      const result = manager.validateWorkflow(invalid);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.message.includes('999'))).toBe(true);
    });

    it('should warn about orphan nodes (not referenced, not terminal)', () => {
      const workflow: Record<string, WorkflowNode> = {
        '1': { class_type: 'LoadImage', inputs: { image: 'test.png' } },
        '2': { class_type: 'SomeNode', inputs: { data: ['1', 0] } },
        '3': { class_type: 'OrphanNode', inputs: { value: 42 } }, // non referenziato
        '4': { class_type: 'SaveImage', inputs: { images: ['2', 0] } },
      };

      const result = manager.validateWorkflow(workflow);

      // OrphanNode dovrebbe generare un warning
      expect(result.warnings.some((w) => w.includes('OrphanNode'))).toBe(true);
      // SaveImage non dovrebbe generare warning
      expect(result.warnings.some((w) => w.includes('SaveImage'))).toBe(false);
    });

    it('should not warn about SaveImage as orphan', () => {
      const workflow = minimalValidWorkflow();
      const result = manager.validateWorkflow(workflow);

      // SaveImage è terminale, nessun warning
      const saveImageWarnings = result.warnings.filter((w) => w.includes('SaveImage'));
      expect(saveImageWarnings).toHaveLength(0);
    });
  });

  // ─── addWorkflow ────────────────────────────────────────────

  describe('addWorkflow', () => {
    it('should add a custom workflow', () => {
      const custom: Record<string, WorkflowNode> = {
        '1': {
          class_type: 'SaveImage',
          inputs: { filename_prefix: 'PARAM_STRING_PREFIX', images: [] },
        },
      };

      manager.addWorkflow('custom.test', {
        id: 'custom.test',
        name: 'Custom Test',
        description: 'A custom test workflow',
        category: 'custom',
        json: custom,
        parameters: [
          {
            name: 'prefix',
            type: 'string',
            required: true,
            defaultValue: 'imago',
          },
        ],
      });

      const wf = manager.getWorkflow('custom.test');
      expect(wf).toBeDefined();
      expect(wf!.name).toBe('Custom Test');
      expect(wf!.category).toBe('custom');
      expect(wf!.parameters).toHaveLength(1);
      expect(wf!.parameters[0].name).toBe('prefix');
    });

    it('should replace existing workflow with same ID', () => {
      const wf = manager.getWorkflow('txt2img.default')!;
      const originalParamCount = wf.parameters.length;

      manager.addWorkflow('txt2img.default', {
        ...wf,
        parameters: [
          { name: 'override_param', type: 'string', required: false },
        ],
      });

      const updated = manager.getWorkflow('txt2img.default')!;
      // I parametri dovrebbero essere stati sostituiti
      expect(updated.parameters).toHaveLength(1);
      expect(updated.parameters[0].name).toBe('override_param');

      // Ripristina lo stato originale per gli altri test
      manager.addWorkflow('txt2img.default', wf);
      const restored = manager.getWorkflow('txt2img.default')!;
      expect(restored.parameters).toHaveLength(originalParamCount);
    });
  });

  // ─── render img2img / upscale ───────────────────────────────

  describe('renderWorkflow (all templates)', () => {
    it('should render img2img.default with all params', async () => {
      const rendered = await manager.renderWorkflow('img2img.default', {
        prompt: 'a dog',
        seed: 1,
        steps: 25,
        cfg: 8,
        width: 768,
        height: 768,
        sampler: 'euler',
        scheduler: 'normal',
        model: 'sd_xl_base.safetensors',
        prefix: 'img',
        image: 'input.png',
        negative_prompt: '',
      });

      expect(rendered['6'].inputs.text).toBe('a dog');
      expect(rendered['1'].inputs.image).toBe('input.png');
      expect(rendered['11'].inputs.width).toBe(768);
      expect(rendered['11'].inputs.height).toBe(768);
    });

    it('should render upscale.default with all params', async () => {
      const rendered = await manager.renderWorkflow('upscale.default', {
        image: 'input.png',
        upscale_model: '4x_foo.pth',
        prefix: 'upscaled',
      });

      expect(rendered['1'].inputs.image).toBe('input.png');
      expect(rendered['11'].inputs.model_name).toBe('4x_foo.pth');
      expect(rendered['9'].inputs.filename_prefix).toBe('upscaled');
    });
  });
});
