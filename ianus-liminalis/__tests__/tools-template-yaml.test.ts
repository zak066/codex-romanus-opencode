/**
 * Test per tool della Fase 3 — DevOps & Infrastruttura:
 *   fs_template_render, fs_yaml_merge
 *
 * Ogni tool viene registrato con deps reali su workspace temporaneo.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, writeFile, readFile, rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { PermissionChecker } from '../src/core/permission.js';
import { BackupManager } from '@codex-romanus/fs-backup';
import { toolRegistry } from '../src/tools/registry.js';
import { registerTemplateRender } from '../src/tools/template-render.js';
import { registerYamlMerge } from '../src/tools/yaml-merge.js';
import type { ToolDeps } from '../src/tools/types.js';

// ---------------------------------------------------------------------------
// Setup — condiviso tra tutti i describe
// ---------------------------------------------------------------------------
let workDir: string;
let backupDir: string;
let deps: ToolDeps;

function callTool(name: string, args: Record<string, unknown>) {
  const tool = toolRegistry.get(name);
  if (!tool) throw new Error(`Tool "${name}" not registered`);
  return tool.handler(args);
}

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'ianus-devops-'));
  backupDir = await mkdtemp(join(tmpdir(), 'ianus-devops-bak-'));

  const permission = new PermissionChecker({
    version: 1,
    defaultEffect: 'allow',
    rules: [],
  });
  const backup = new BackupManager({ backupDir, retentionDays: 1 });
  deps = { workspaceRoot: workDir, permission, backup };

  const mockServer = {} as never;
  registerTemplateRender(mockServer, deps);
  registerYamlMerge(mockServer, deps);
});

afterAll(async () => {
  await rm(workDir, { recursive: true, force: true });
  await rm(backupDir, { recursive: true, force: true });
});

// ===========================================================================
// Mini helper per preparare template file
// ===========================================================================
async function createTemplateFile(
  relativePath: string,
  content: string,
): Promise<void> {
  const fullPath = join(workDir, relativePath);
  await mkdir(join(fullPath, '..'), { recursive: true });
  await writeFile(fullPath, content, 'utf-8');
}

// ===========================================================================
// fs_template_render
// ===========================================================================
describe('fs_template_render', () => {
  it('sostituisce placeholder base da vars', async () => {
    await createTemplateFile('greeting.template', 'Hello {{NAME}}!');

    const res = await callTool('fs_template_render', {
      path: 'greeting.template',
      output: 'greeting-output.txt',
      vars: { NAME: 'World' },
      overwrite: true,
    });

    expect(res.isError).toBeFalsy();
    const data = JSON.parse(res.content[0].text);
    expect(data.path).toBe('greeting-output.txt');
    expect(data.resolved).toBe(1);
    expect(data.unresolved).toBe(0);
    expect(data.size).toBeGreaterThan(0);

    const output = await readFile(join(workDir, 'greeting-output.txt'), 'utf-8');
    expect(output).toBe('Hello World!');
  });

  it('usa default value se variabile non fornita', async () => {
    await createTemplateFile('greeting2.template', 'Hello {{NAME:World}}!');

    const res = await callTool('fs_template_render', {
      path: 'greeting2.template',
      output: 'greeting2-output.txt',
      overwrite: true,
    });

    expect(res.isError).toBeFalsy();
    const data = JSON.parse(res.content[0].text);
    expect(data.resolved).toBe(1);

    const output = await readFile(join(workDir, 'greeting2-output.txt'), 'utf-8');
    expect(output).toBe('Hello World!');
  });

  it('applica pipe |upper e |lower', async () => {
    await createTemplateFile('pipe.template', '{{NAME|upper}} {{NAME|lower}}');

    const res = await callTool('fs_template_render', {
      path: 'pipe.template',
      output: 'pipe-output.txt',
      vars: { NAME: 'DevOps' },
      overwrite: true,
    });

    expect(res.isError).toBeFalsy();
    const output = await readFile(join(workDir, 'pipe-output.txt'), 'utf-8');
    expect(output).toBe('DEVOPS devops');
  });

  it('carica variabili da file .env', async () => {
    await createTemplateFile('.env', 'MODE=production\nHOST=localhost');
    await createTemplateFile('config.template', 'Mode: {{MODE}} at {{HOST}}');

    const res = await callTool('fs_template_render', {
      path: 'config.template',
      env: '.env',
      output: 'config.yaml',
      overwrite: true,
    });

    expect(res.isError).toBeFalsy();
    const output = await readFile(join(workDir, 'config.yaml'), 'utf-8');
    expect(output).toBe('Mode: production at localhost');
  });

  it('priorità: vars > env > process.env', async () => {
    await createTemplateFile('.env', 'KEY=from_env');
    await createTemplateFile('priority.template', '{{KEY}}');

    const res = await callTool('fs_template_render', {
      path: 'priority.template',
      output: 'priority-output.txt',
      vars: { KEY: 'from_vars' },
      env: '.env',
      overwrite: true,
    });

    expect(res.isError).toBeFalsy();
    const output = await readFile(join(workDir, 'priority-output.txt'), 'utf-8');
    expect(output).toBe('from_vars');
  });

  it('output personalizzato con estensione .yaml', async () => {
    await createTemplateFile('app.template', 'name: {{NAME}}\nport: {{PORT}}');

    const res = await callTool('fs_template_render', {
      path: 'app.template',
      output: 'app.yaml',
      vars: { NAME: 'myapp', PORT: '8080' },
      overwrite: true,
    });

    expect(res.isError).toBeFalsy();
    const data = JSON.parse(res.content[0].text);
    expect(data.path).toBe('app.yaml');
    expect(data.resolved).toBe(2);

    const output = await readFile(join(workDir, 'app.yaml'), 'utf-8');
    expect(output).toBe('name: myapp\nport: 8080');
  });

  it('fallisce su placeholder non risolti con missingMode=fail (default)', async () => {
    await createTemplateFile('missing.template', 'Hello {{NAME}}, {{UNDEFINED}}!');

    const res = await callTool('fs_template_render', {
      path: 'missing.template',
      vars: { NAME: 'World' },
      overwrite: true,
    });

    // Default missingMode is "fail"
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('Unresolved');
  });

  it('warn mode lascia placeholder intatti e segnala missing', async () => {
    await createTemplateFile('warn.template', 'Hello {{NAME}}, {{UNDEFINED}}!');

    const res = await callTool('fs_template_render', {
      path: 'warn.template',
      output: 'warn-output.txt',
      vars: { NAME: 'World' },
      missingMode: 'warn',
      overwrite: true,
    });

    expect(res.isError).toBeFalsy();
    const data = JSON.parse(res.content[0].text);
    expect(data.resolved).toBe(1);
    expect(data.unresolved).toBe(1);
    expect(data.missing).toHaveLength(1);

    const output = await readFile(join(workDir, 'warn-output.txt'), 'utf-8');
    expect(output).toBe('Hello World, {{UNDEFINED}}!');
  });

  it('skip mode lascia placeholder intatti senza segnalarli', async () => {
    await createTemplateFile('skip.template', '{{NAME}} {{UNDEFINED}}');

    const res = await callTool('fs_template_render', {
      path: 'skip.template',
      output: 'skip-output.txt',
      vars: { NAME: 'Hello' },
      missingMode: 'skip',
      overwrite: true,
    });

    expect(res.isError).toBeFalsy();
    const data = JSON.parse(res.content[0].text);
    expect(data.resolved).toBe(1);
    expect(data.unresolved).toBe(0);
    expect(data.missing).toBeUndefined();

    const output = await readFile(join(workDir, 'skip-output.txt'), 'utf-8');
    expect(output).toBe('Hello {{UNDEFINED}}');
  });

  it('errore se output esiste e overwrite=false', async () => {
    await createTemplateFile('existing.template', 'content');
    // Create the output file in advance so it already exists
    await writeFile(join(workDir, 'existing-output.txt'), 'original', 'utf-8');

    const res = await callTool('fs_template_render', {
      path: 'existing.template',
      output: 'existing-output.txt',
      vars: { NAME: 'test' },
      overwrite: false,
    });

    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('already exists');
  });

  it('test case completo da specifica: Hello {{NAME:World}}! Config is {{MODE|upper}}', async () => {
    await createTemplateFile('.env', 'MODE=production');
    await createTemplateFile('spec.template', 'Hello {{NAME:World}}! Config is {{MODE|upper}}');

    const res = await callTool('fs_template_render', {
      path: 'spec.template',
      vars: { NAME: 'DevOps' },
      env: '.env',
      output: 'spec-output.txt',
      overwrite: true,
    });

    expect(res.isError).toBeFalsy();
    const data = JSON.parse(res.content[0].text);
    expect(data.resolved).toBe(2);
    expect(data.unresolved).toBe(0);

    const output = await readFile(join(workDir, 'spec-output.txt'), 'utf-8');
    expect(output).toBe('Hello DevOps! Config is PRODUCTION');
  });

  it('errore per parametro path mancante', async () => {
    const res = await callTool('fs_template_render', {} as never);
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('Missing');
  });
});

// ===========================================================================
// fs_yaml_merge
// ===========================================================================
describe('fs_yaml_merge', () => {
  it('merge due file YAML semplici', async () => {
    await createTemplateFile('base.yaml', 'server:\n  host: localhost\n  port: 3000');
    await createTemplateFile('override.yaml', 'server:\n  port: 8080\n  debug: true');

    const res = await callTool('fs_yaml_merge', {
      files: ['base.yaml', 'override.yaml'],
    });

    expect(res.isError).toBeFalsy();
    const data = JSON.parse(res.content[0].text);
    expect(data.files).toHaveLength(2);
    expect(data.format).toBe('yaml');

    // Verify deep merge: host from base, port from override, debug from override
    const parsed = parseYamlOutput(data.content as string);
    expect(parsed.server.host).toBe('localhost');
    expect(parsed.server.port).toBe(8080);
    expect(parsed.server.debug).toBe(true);
  });

  it('merge con arrayMode replace (default)', async () => {
    await createTemplateFile('arr-base.yaml', 'items:\n  - a\n  - b');
    await createTemplateFile('arr-override.yaml', 'items:\n  - c\n  - d');

    const res = await callTool('fs_yaml_merge', {
      files: ['arr-base.yaml', 'arr-override.yaml'],
    });

    expect(res.isError).toBeFalsy();
    const data = JSON.parse(res.content[0].text);
    const parsed = parseYamlOutput(data.content as string);
    expect(parsed.items).toEqual(['c', 'd']);
  });

  it('merge con arrayMode concat', async () => {
    await createTemplateFile('arr-concat-base.yaml', 'items:\n  - a\n  - b');
    await createTemplateFile('arr-concat-over.yaml', 'items:\n  - c');

    const res = await callTool('fs_yaml_merge', {
      files: ['arr-concat-base.yaml', 'arr-concat-over.yaml'],
      arrayMode: 'concat',
    });

    expect(res.isError).toBeFalsy();
    const data = JSON.parse(res.content[0].text);
    const parsed = parseYamlOutput(data.content as string);
    expect(parsed.items).toEqual(['a', 'b', 'c']);
  });

  it('merge con file JSON', async () => {
    await createTemplateFile('base.json', JSON.stringify({ app: { name: 'myapp', version: '1.0.0' } }));
    await createTemplateFile('override.json', JSON.stringify({ app: { version: '2.0.0', debug: true } }));

    const res = await callTool('fs_yaml_merge', {
      files: ['base.json', 'override.json'],
    });

    expect(res.isError).toBeFalsy();
    const data = JSON.parse(res.content[0].text);
    const parsed = JSON.parse(data.content as string);
    expect(parsed.app.name).toBe('myapp');
    expect(parsed.app.version).toBe('2.0.0');
    expect(parsed.app.debug).toBe(true);
  });

  it('output in formato JSON specificato', async () => {
    await createTemplateFile('cfg-base.yaml', 'key1: value1\nkey2: value2');
    await createTemplateFile('cfg-over.yaml', 'key2: over2\nkey3: value3');

    const res = await callTool('fs_yaml_merge', {
      files: ['cfg-base.yaml', 'cfg-over.yaml'],
      format: 'json',
    });

    expect(res.isError).toBeFalsy();
    const data = JSON.parse(res.content[0].text);
    expect(data.format).toBe('json');
    const parsed = JSON.parse(data.content as string);
    expect(parsed.key1).toBe('value1');
    expect(parsed.key2).toBe('over2');
    expect(parsed.key3).toBe('value3');
  });

  it('tracciamento source per ogni campo', async () => {
    await createTemplateFile('src-base.yaml', 'a: 1\nb: 2');
    await createTemplateFile('src-over.yaml', 'b: 3\nc: 4');

    const res = await callTool('fs_yaml_merge', {
      files: ['src-base.yaml', 'src-over.yaml'],
    });

    expect(res.isError).toBeFalsy();
    const data = JSON.parse(res.content[0].text);

    // a viene dal file 0 (base)
    expect(data.source).toContainEqual(
      expect.objectContaining({ field: 'a', fromFile: 0 }),
    );
    // b sovrascritto dal file 1 (override)
    expect(data.source).toContainEqual(
      expect.objectContaining({ field: 'b', fromFile: 1 }),
    );
    // c viene dal file 1
    expect(data.source).toContainEqual(
      expect.objectContaining({ field: 'c', fromFile: 1 }),
    );
  });

  it('scrittura su file output', async () => {
    await createTemplateFile('out-base.yaml', 'name: base\nenv: dev');
    await createTemplateFile('out-over.yaml', 'env: prod\nregion: eu');

    const res = await callTool('fs_yaml_merge', {
      files: ['out-base.yaml', 'out-over.yaml'],
      output: 'merged-output.yaml',
    });

    expect(res.isError).toBeFalsy();
    const data = JSON.parse(res.content[0].text);
    expect(data.output).toBe('merged-output.yaml');

    // Verify file was written
    const content = await readFile(join(workDir, 'merged-output.yaml'), 'utf-8');
    expect(content).toContain('name: base');
    expect(content).toContain('env: prod');
    expect(content).toContain('region: eu');
  });

  it('merge tre file con override a cascata', async () => {
    await createTemplateFile('a.yaml', 'level: 1\ncolor: red\nmode: silent');
    await createTemplateFile('b.yaml', 'color: blue\nsize: large');
    await createTemplateFile('c.yaml', 'mode: loud\ncolor: green');

    const res = await callTool('fs_yaml_merge', {
      files: ['a.yaml', 'b.yaml', 'c.yaml'],
    });

    expect(res.isError).toBeFalsy();
    const data = JSON.parse(res.content[0].text);
    const parsed = parseYamlOutput(data.content as string);
    expect(parsed.level).toBe(1);   // from a
    expect(parsed.color).toBe('green');  // from c (wins)
    expect(parsed.size).toBe('large');   // from b
    expect(parsed.mode).toBe('loud');    // from c (wins)
  });

  it('valori YAML scalari: numeri, booleani, null', async () => {
    await createTemplateFile('scalars-base.yaml', 'count: 42\nactive: false\ncomment: hello');
    await createTemplateFile('scalars-over.yaml', 'active: true\ncomment: null\nrate: 3.14');

    const res = await callTool('fs_yaml_merge', {
      files: ['scalars-base.yaml', 'scalars-over.yaml'],
    });

    expect(res.isError).toBeFalsy();
    const data = JSON.parse(res.content[0].text);
    const parsed = parseYamlOutput(data.content as string);
    expect(parsed.count).toBe(42);
    expect(parsed.active).toBe(true);
    expect(parsed.comment).toBeNull();
    expect(parsed.rate).toBe(3.14);
  });

  it('merge con array inline', async () => {
    await createTemplateFile('inline-base.yaml', 'tags: [a, b, c]');
    await createTemplateFile('inline-over.yaml', 'tags: [d, e]');

    const res = await callTool('fs_yaml_merge', {
      files: ['inline-base.yaml', 'inline-over.yaml'],
    });

    expect(res.isError).toBeFalsy();
    const data = JSON.parse(res.content[0].text);
    const parsed = parseYamlOutput(data.content as string);

    // replace mode: override wins
    expect(parsed.tags).toEqual(['d', 'e']);
  });

  it('errore per parametro files mancante', async () => {
    const res = await callTool('fs_yaml_merge', {} as never);
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('Missing');
  });

  it('errore per array files vuoto', async () => {
    const res = await callTool('fs_yaml_merge', { files: [] });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('Missing');
  });

  it('errore per file inesistente', async () => {
    const res = await callTool('fs_yaml_merge', {
      files: ['nonexistent.yaml'],
    });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('Error');
  });
});

// ===========================================================================
// Helper per parsare output YAML nei test
// ===========================================================================
/**
 * Mini-parser per output YAML nei test (struttura semplice).
 * Supporta oggetti annidati, array dash, array di oggetti, array inline.
 */
function parseYamlOutput(yaml: string): Record<string, any> {
  const result: Record<string, any> = {};

  // Pre-process lines: strip comments, skip empty
  const lines: Array<{ indent: number; text: string }> = [];
  for (const rawLine of yaml.split(/\r?\n/)) {
    const trimmed = rawLine.trimEnd();
    const text = trimmed.trim();
    if (!text || text.startsWith('#')) continue;
    const indent = rawLine.length - rawLine.trimStart().length;
    const clean = removeInlineCommentTest(text);
    if (clean) lines.push({ indent, text: clean });
  }

  // Stack tracks nesting context (objects and arrays)
  const stack: Array<{
    indent: number;
    container: Record<string, any> | any[];
    isArray: boolean;
  }> = [{ indent: -1, container: result, isArray: false }];

  let i = 0;
  while (i < lines.length) {
    const { indent, text } = lines[i];

    // Pop stack entries with indent >= current
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) {
      stack.pop();
    }

    const current = stack[stack.length - 1];
    const container = current.container;

    // Dash array item
    const dashMatch = text.match(/^-\s+(.*)$/);
    if (dashMatch) {
      const itemContent = dashMatch[1].trim();

      if (!current.isArray) {
        i++;
        continue;
      }

      const arr = container as any[];

      // Check if it's a "key: value" pair
      const kvMatch = itemContent.match(/^([a-zA-Z_][a-zA-Z0-9_]*):\s*(.*)$/);
      if (kvMatch) {
        const key = kvMatch[1];
        const valuePart = kvMatch[2].trim();

        if (valuePart === '') {
          // Object with empty value → lookahead
          const inner: Record<string, any> = {};
          arr.push({ [key]: inner } as Record<string, any>);
          stack.push({ indent, container: inner, isArray: false });
        } else {
          const obj = { [key]: parseScalarTest(valuePart) } as Record<string, any>;
          arr.push(obj);
          stack.push({ indent, container: obj, isArray: false });
        }
      } else {
        // Simple scalar item
        arr.push(parseScalarTest(itemContent));
      }

      i++;
      continue;
    }

    // Key: value pair
    const kvMatch = text.match(/^([a-zA-Z_][a-zA-Z0-9_]*):\s*(.*)$/);
    if (!kvMatch) { i++; continue; }

    const key = kvMatch[1];
    const valuePart = kvMatch[2].trim();

    // In array context — add to last item's object
    if (current.isArray) {
      const arr = container as any[];
      if (arr.length > 0) {
        const lastItem = arr[arr.length - 1];
        if (typeof lastItem === 'object' && lastItem !== null && !Array.isArray(lastItem)) {
          lastItem[key] = parseScalarTest(valuePart);
        }
      }
      i++;
      continue;
    }

    const obj = container as Record<string, any>;

    // Inline array
    if (valuePart.startsWith('[') && valuePart.endsWith(']')) {
      const items = valuePart.slice(1, -1).split(',').map((s: string) => parseScalarTest(s.trim()));
      obj[key] = items;
      i++;
      continue;
    }

    // Empty value — look ahead
    if (valuePart === '') {
      let nextIdx = -1;
      for (let j = i + 1; j < lines.length; j++) {
        if (lines[j].indent > indent) { nextIdx = j; break; }
        if (lines[j].indent <= indent) break;
      }
      if (nextIdx >= 0 && lines[nextIdx].text.startsWith('- ')) {
        // Array
        const arr: any[] = [];
        obj[key] = arr;
        stack.push({ indent, container: arr, isArray: true });
      } else if (nextIdx >= 0) {
        // Object
        const newObj: Record<string, any> = {};
        obj[key] = newObj;
        stack.push({ indent, container: newObj, isArray: false });
      } else {
        obj[key] = {};
      }
      i++;
      continue;
    }

    // Inline scalar
    obj[key] = parseScalarTest(valuePart);
    i++;
  }

  return result;
}

/** Strip inline comments from a line. */
function removeInlineCommentTest(line: string): string {
  let result = '';
  let inSingle = false;
  let inDouble = false;
  for (const ch of line) {
    if (ch === "'" && !inDouble) { inSingle = !inSingle; result += ch; }
    else if (ch === '"' && !inSingle) { inDouble = !inDouble; result += ch; }
    else if (ch === '#' && !inSingle && !inDouble) { break; }
    else { result += ch; }
  }
  return result.trim();
}

function parseScalarTest(value: string): any {
  if (value === 'null' || value === '~') return null;
  if (value === 'true' || value === 'yes') return true;
  if (value === 'false' || value === 'no') return false;
  if (/^-?\d+$/.test(value)) return parseInt(value, 10);
  if (/^-?\d+\.\d+$/.test(value)) return parseFloat(value);
  if ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}
