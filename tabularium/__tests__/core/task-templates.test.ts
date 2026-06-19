/**
 * Test per core/task-templates.ts — Template per scaffolding task (Fase 7 FABRICA)
 *
 * Copertura:
 * - listTemplates: restituisce almeno 4 template con nomi attesi
 * - getTemplate: template esistente, inesistente, name vuoto
 * - scaffoldFromTemplate: sostituisce {{param}}, genera path, steps
 * - scaffoldFromTemplate: errore per template inesistente
 *
 * I template sono letti da templates/ all'avvio (file JSON reali).
 *
 * @module tests/core/task-templates
 */

import {
  listTemplates,
  getTemplate,
  scaffoldFromTemplate,
} from '../../src/core/task-templates.js';

// ---------------------------------------------------------------------------
// Suite: task-templates
// ---------------------------------------------------------------------------

describe('task-templates', () => {
  // ── listTemplates ─────────────────────────────────────────────────────

  describe('listTemplates', () => {
    it('restituisce almeno 4 template', () => {
      const templates = listTemplates();
      expect(templates.length).toBeGreaterThanOrEqual(4);
    });

    it('restituisce template con nomi attesi', () => {
      const templates = listTemplates();
      const names = templates.map((t) => t.name);

      expect(names).toContain('new-core-module');
      expect(names).toContain('new-migration');
      expect(names).toContain('fix-typescript-error');
      expect(names).toContain('refactor-extract');
    });

    it('ogni template ha name, description, files (array) e steps (array)', () => {
      const templates = listTemplates();

      for (const t of templates) {
        expect(t.name).toBeTruthy();
        expect(typeof t.name).toBe('string');
        expect(t.description).toBeTruthy();
        expect(typeof t.description).toBe('string');
        expect(Array.isArray(t.files)).toBe(true);
        expect(Array.isArray(t.steps)).toBe(true);
      }
    });

    it('i file di template hanno path e flag template', () => {
      const templates = listTemplates();

      for (const t of templates) {
        for (const f of t.files) {
          expect(f.path).toBeTruthy();
          expect(typeof f.path).toBe('string');
          expect(typeof f.template).toBe('boolean');
        }
      }
    });

    it('restituisce sempre la stessa lista (caching)', () => {
      const t1 = listTemplates();
      const t2 = listTemplates();
      expect(t1).toEqual(t2);
    });
  });

  // ── getTemplate ───────────────────────────────────────────────────────

  describe('getTemplate', () => {
    it('restituisce il template "new-core-module" con struttura valida', () => {
      const tmpl = getTemplate('new-core-module');

      expect(tmpl).toBeDefined();
      expect(tmpl!.name).toBe('new-core-module');
      expect(tmpl!.description).toContain('nuovo modulo core');
      expect(tmpl!.files.length).toBeGreaterThanOrEqual(3);
      expect(tmpl!.steps.length).toBeGreaterThanOrEqual(4);
    });

    it('restituisce il template "new-migration"', () => {
      const tmpl = getTemplate('new-migration');

      expect(tmpl).toBeDefined();
      expect(tmpl!.name).toBe('new-migration');
      expect(tmpl!.files).toHaveLength(1);
    });

    it('restituisce undefined per nome inesistente', () => {
      const tmpl = getTemplate('nonexistent-template');
      expect(tmpl).toBeUndefined();
    });

    it('restituisce undefined per nome vuoto', () => {
      const tmpl = getTemplate('');
      expect(tmpl).toBeUndefined();
    });
  });

  // ── scaffoldFromTemplate ──────────────────────────────────────────────

  describe('scaffoldFromTemplate', () => {
    it('sostituisce {{name}} con il valore fornito (new-core-module)', () => {
      const result = scaffoldFromTemplate('new-core-module', { name: 'foo' });

      expect(result.template.name).toBe('new-core-module');
      expect(result.files).toHaveLength(3);

      // Verifica che {{name}} sia sostituito
      for (const filePath of result.files) {
        expect(filePath).not.toContain('{{name}}');
        expect(filePath).toContain('foo');
      }

      // Path attesi
      expect(result.files[0]).toBe('src/core/foo.ts');
      expect(result.files[1]).toBe('src/tools/foo.tool.ts');
      expect(result.files[2]).toBe('__tests__/core/foo.test.ts');
    });

    it('sostituisce {{number}} e {{name}} in new-migration', () => {
      const result = scaffoldFromTemplate('new-migration', {
        number: '008',
        name: 'add_index',
      });

      expect(result.files).toHaveLength(1);
      expect(result.files[0]).toBe('migrations/008_add_index.sql');
      expect(result.files[0]).not.toContain('{{number}}');
      expect(result.files[0]).not.toContain('{{name}}');
    });

    it('sostituisce placeholder anche negli steps', () => {
      const result = scaffoldFromTemplate('new-core-module', { name: 'bar' });

      for (const step of result.steps) {
        expect(step).not.toContain('{{name}}');
      }

      // Almeno uno step contiene 'bar'
      const hasSubstituted = result.steps.some((s) => s.includes('bar'));
      expect(hasSubstituted).toBe(true);
    });

    it('restituisce instructions testuali formattate', () => {
      const result = scaffoldFromTemplate('new-core-module', { name: 'test' });

      expect(result.instructions).toContain('Template: new-core-module');
      expect(result.instructions).toContain('Files to create:');
      expect(result.instructions).toContain('src/core/test.ts');
      expect(result.instructions).toContain('Steps:');
    });

    it('lancia errore per template inesistente', () => {
      expect(() =>
        scaffoldFromTemplate('nonexistent', { name: 'test' })
      ).toThrow(/Template not found/);
    });

    it('sostituisce {{param}} quando il placeholder appare più volte', () => {
      // refactor-extract ha solo 1 file, ma testiamo con multipli
      const result = scaffoldFromTemplate('new-core-module', { name: 'multi' });

      expect(result.files).toHaveLength(3);
      for (const f of result.files) {
        expect(f).toContain('multi');
      }
    });
  });
});
