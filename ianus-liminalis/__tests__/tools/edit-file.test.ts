/**
 * Test unitari per i bug fix di edit-file.ts
 *
 * Copre 4 regression fix:
 *   Test 1 — $ pattern non deve espandere il contenuto  (arrow function in replace)
 *   Test 2 — CRLF normalizzazione                        (replace(/\r\n/g, '\n') pre-split)
 *   Test 3 — insert multilinea                           (split insertContent in righe)
 *   Test 4 — bytesChanged                                (aggiunta metrica byte nell'output)
 *
 * Setup: workspace temporaneo con PermissionChecker (default allow) + BackupManager.
 * I tool vengono registrati via toolRegistry con deps reali.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { PermissionChecker } from '../../src/core/permission.js';
import { BackupManager } from '@codex-romanus/fs-backup';
import { toolRegistry } from '../../src/tools/registry.js';
import { registerEditFile } from '../../src/tools/edit-file.js';
import type { ToolDeps } from '../../src/tools/types.js';

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------
let workDir: string;
let backupDir: string;
let deps: ToolDeps;

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'ianus-edit-bugfix-'));
  backupDir = await mkdtemp(join(tmpdir(), 'ianus-edit-bugfix-backup-'));

  // PermissionChecker — default allow per non interferire
  const permission = new PermissionChecker({
    version: 1,
    defaultEffect: 'allow',
    rules: [],
  });

  // BackupManager reale
  const backup = new BackupManager({ backupDir, retentionDays: 1 });

  deps = { workspaceRoot: workDir, permission, backup };

  // Registra SOLO fs_edit (il modulo sotto test)
  const mockServer = {} as never;
  registerEditFile(mockServer, deps);
});

afterAll(async () => {
  await rm(workDir, { recursive: true, force: true });
  await rm(backupDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------
function callTool(name: string, args: Record<string, unknown>) {
  const tool = toolRegistry.get(name);
  if (!tool) throw new Error(`Tool "${name}" not registered`);
  return tool.handler(args);
}

/** Crea un file nel workspace di test e ne restituisce il path assoluto */
async function seedFile(relativePath: string, content: string): Promise<string> {
  const fullPath = join(workDir, relativePath);
  await writeFile(fullPath, content, 'utf-8');
  return fullPath;
}

/** Legge il contenuto testuale di un file nel workspace */
async function readResult(relativePath: string): Promise<string> {
  return await readFile(join(workDir, relativePath), 'utf-8');
}

// ===========================================================================
// Test 1 — $ pattern non deve espandere il contenuto
// ===========================================================================
describe('Bug 1 — $ pattern non deve espandere il contenuto (arrow function)', () => {
  it('$& rimane letterale, non viene espanso al match', async () => {
    await seedFile('dollar_ampersand.txt', 'foo bar baz');

    const res = await callTool('fs_edit', {
      path: 'dollar_ampersand.txt',
      operation: 'replace',
      pattern: 'bar',
      content: '$&',
    });

    expect(res.isError).toBeFalsy();
    const data = JSON.parse(res.content[0].text);
    expect(data.modified).toBe(true);

    const disk = await readResult('dollar_ampersand.txt');
    // Con arrow function: $& rimane $& letterale
    // Con stringa in replace(): $& si espande in "bar"
    expect(disk).toBe('foo $& baz');
  });

  it('$` (backtick) rimane letterale, non viene espanso al pre-match', async () => {
    await seedFile('dollar_backtick.txt', 'abc def ghi');

    const res = await callTool('fs_edit', {
      path: 'dollar_backtick.txt',
      operation: 'replace',
      pattern: 'def',
      content: '$`',
    });

    expect(res.isError).toBeFalsy();
    const data = JSON.parse(res.content[0].text);
    expect(data.modified).toBe(true);

    const disk = await readResult('dollar_backtick.txt');
    // $` rappresenta la parte prima del match. Con arrow function rimane $` letterale.
    expect(disk).toBe('abc $` ghi');
  });

  it("$' (apostrofo) rimane letterale, non viene espanso al post-match", async () => {
    await seedFile('dollar_apos.txt', 'abc def ghi');

    const res = await callTool('fs_edit', {
      path: 'dollar_apos.txt',
      operation: 'replace',
      pattern: 'def',
      content: "$'",
    });

    expect(res.isError).toBeFalsy();
    const data = JSON.parse(res.content[0].text);
    expect(data.modified).toBe(true);

    const disk = await readResult('dollar_apos.txt');
    // $' rappresenta la parte dopo il match. Con arrow function rimane $' letterale.
    expect(disk).toBe("abc $' ghi");
  });

  it('riferimenti a gruppi di cattura ($1, $2) rimangono letterali', async () => {
    await seedFile('dollar_group.txt', 'abc 123 xyz');

    const res = await callTool('fs_edit', {
      path: 'dollar_group.txt',
      operation: 'replace',
      pattern: '(\\d+)',
      content: '$1',
    });

    expect(res.isError).toBeFalsy();
    const data = JSON.parse(res.content[0].text);
    expect(data.modified).toBe(true);

    const disk = await readResult('dollar_group.txt');
    // $1 rimane $1 letterale, non viene espanso al gruppo catturato "123"
    expect(disk).toBe('abc $1 xyz');
  });

  it('pattern misti con $ vengono preservati letteralmente', async () => {
    await seedFile('dollar_mixed.txt', 'replace:target');

    const res = await callTool('fs_edit', {
      path: 'dollar_mixed.txt',
      operation: 'replace',
      pattern: 'target',
      content: '$& e $` e $\'',
    });

    expect(res.isError).toBeFalsy();
    const data = JSON.parse(res.content[0].text);
    expect(data.modified).toBe(true);

    const disk = await readResult('dollar_mixed.txt');
    expect(disk).toBe("replace:$& e $` e $'");
  });
});

// ===========================================================================
// Test 2 — CRLF normalizzazione
// ===========================================================================
describe('Bug 2 — CRLF normalizzazione prima dello split', () => {
  it('replace funziona su file con terminazioni CRLF', async () => {
    await seedFile('crlf_replace.txt', 'foo\r\nbar\r\nbaz');

    const res = await callTool('fs_edit', {
      path: 'crlf_replace.txt',
      operation: 'replace',
      pattern: 'bar',
      content: 'HELLO',
    });

    expect(res.isError).toBeFalsy();
    const data = JSON.parse(res.content[0].text);
    expect(data.modified).toBe(true);

    // Il contenuto viene normalizzato: le \r\n diventano \n nell'elaborazione
    // ma il file salvato userà \n (la join usa \n)
    const disk = await readResult('crlf_replace.txt');
    expect(disk).toBe('foo\nHELLO\nbaz');
  });

  it('insert funziona su file con terminazioni CRLF', async () => {
    await seedFile('crlf_insert.txt', 'line1\r\nline2\r\nline3');

    const res = await callTool('fs_edit', {
      path: 'crlf_insert.txt',
      operation: 'insert',
      line: 2,
      content: 'INSERTED',
    });

    expect(res.isError).toBeFalsy();
    const data = JSON.parse(res.content[0].text);
    expect(data.modified).toBe(true);

    const disk = await readResult('crlf_insert.txt');
    expect(disk.split('\n')).toEqual(['line1', 'INSERTED', 'line2', 'line3']);
  });

  it('delete funziona su file con terminazioni CRLF', async () => {
    await seedFile('crlf_delete.txt', 'keep\r\ndeleteme\r\nkeep2');

    const res = await callTool('fs_edit', {
      path: 'crlf_delete.txt',
      operation: 'delete',
      line: 2, // "deleteme"
    });

    expect(res.isError).toBeFalsy();
    const data = JSON.parse(res.content[0].text);
    expect(data.modified).toBe(true);

    const disk = await readResult('crlf_delete.txt');
    expect(disk.split('\n')).toEqual(['keep', 'keep2']);
  });

  it('line number insert su CRLF usa linee normalizzate (non confuse da \\r)', async () => {
    await seedFile('crlf_linecount.txt', 'a\r\nb\r\nc\r\nd\r\ne');

    // Inserisci dopo l'ultima linea (linea 5)
    const res = await callTool('fs_edit', {
      path: 'crlf_linecount.txt',
      operation: 'insert',
      line: 5,
      content: 'INSERTED',
    });

    expect(res.isError).toBeFalsy();
    const data = JSON.parse(res.content[0].text);
    expect(data.modified).toBe(true);

    const disk = await readResult('crlf_linecount.txt');
    expect(disk.split('\n')).toEqual(['a', 'b', 'c', 'd', 'INSERTED', 'e']);
  });

  it('delete con line number corretto su CRLF', async () => {
    await seedFile('crlf_del_linecount.txt', 'x\r\ny\r\nz');

    // Elimina linea 2 ("y")
    const res = await callTool('fs_edit', {
      path: 'crlf_del_linecount.txt',
      operation: 'delete',
      line: 2,
    });

    expect(res.isError).toBeFalsy();
    const data = JSON.parse(res.content[0].text);
    expect(data.modified).toBe(true);

    const disk = await readResult('crlf_del_linecount.txt');
    expect(disk.split('\n')).toEqual(['x', 'z']);
  });
});

// ===========================================================================
// Test 3 — insert multilinea
// ===========================================================================
describe('Bug 3 — insert multilinea (split insertContent in righe)', () => {
  it('inserisce 2 righe in un file di 1 riga', async () => {
    await seedFile('insert_multiline_2.txt', 'start');

    const res = await callTool('fs_edit', {
      path: 'insert_multiline_2.txt',
      operation: 'insert',
      line: 1,
      content: 'line A\nline B',
    });

    expect(res.isError).toBeFalsy();
    const data = JSON.parse(res.content[0].text);
    expect(data.modified).toBe(true);
    // 3 righe totali: "line A", "line B", "start". Originale: 1.
    expect(data.linesChanged).toBe(2);

    const disk = await readResult('insert_multiline_2.txt');
    expect(disk.split('\n')).toEqual(['line A', 'line B', 'start']);
  });

  it('inserisce 3 righe in mezzo al file', async () => {
    await seedFile('insert_multiline_3.txt', 'first\nlast');

    const res = await callTool('fs_edit', {
      path: 'insert_multiline_3.txt',
      operation: 'insert',
      line: 2,
      content: 'middle A\nmiddle B\nmiddle C',
    });

    expect(res.isError).toBeFalsy();
    const data = JSON.parse(res.content[0].text);
    expect(data.modified).toBe(true);
    // 5 righe totali - 2 originali = 3
    expect(data.linesChanged).toBe(3);

    const disk = await readResult('insert_multiline_3.txt');
    expect(disk.split('\n')).toEqual([
      'first',
      'middle A',
      'middle B',
      'middle C',
      'last',
    ]);
  });

  it('inserisce riga singola (caso non multilinea resta funzionante)', async () => {
    await seedFile('insert_single_still.txt', 'a\nb\nc');

    const res = await callTool('fs_edit', {
      path: 'insert_single_still.txt',
      operation: 'insert',
      line: 3,
      content: 'INSERTED',
    });

    expect(res.isError).toBeFalsy();
    const data = JSON.parse(res.content[0].text);
    expect(data.modified).toBe(true);
    expect(data.linesChanged).toBe(1);

    const disk = await readResult('insert_single_still.txt');
    expect(disk.split('\n')).toEqual(['a', 'b', 'INSERTED', 'c']);
  });

  it('linesChanged è corretto dopo insert multilinea', async () => {
    await seedFile('insert_multiline_lineschanged.txt', 'alpha\nomega');

    const insertedLines = ['step 1', 'step 2', 'step 3', 'step 4'];
    const content = insertedLines.join('\n');

    const res = await callTool('fs_edit', {
      path: 'insert_multiline_lineschanged.txt',
      operation: 'insert',
      line: 2,
      content,
    });

    expect(res.isError).toBeFalsy();
    const data = JSON.parse(res.content[0].text);
    // 2 originali → 6 totali → diff = 4
    expect(data.linesChanged).toBe(4);
  });

  it('funziona anche con insertContent vuota (stringa vuota)', async () => {
    await seedFile('insert_multiline_empty.txt', 'a\nb');

    const res = await callTool('fs_edit', {
      path: 'insert_multiline_empty.txt',
      operation: 'insert',
      line: 2,
      content: '',
    });

    expect(res.isError).toBeFalsy();
    const data = JSON.parse(res.content[0].text);
    expect(data.modified).toBe(true);
    // insertContent.split('\n') → [''], una riga vuota aggiunta
    expect(data.linesChanged).toBe(1);

    const disk = await readResult('insert_multiline_empty.txt');
    expect(disk.split('\n')).toEqual(['a', '', 'b']);
  });
});

// ===========================================================================
// Test 4 — bytesChanged
// ===========================================================================
describe('Bug 5 — bytesChanged nell\'output', () => {
  it('bytesChanged è presente nell\'output JSON dopo replace', async () => {
    await seedFile('bc_replace.txt', 'aaaa');

    const res = await callTool('fs_edit', {
      path: 'bc_replace.txt',
      operation: 'replace',
      pattern: 'a',
      content: 'bb',
    });

    expect(res.isError).toBeFalsy();
    const data = JSON.parse(res.content[0].text);
    expect(data).toHaveProperty('bytesChanged');
    // 'aaaa' (4 byte) → 'bbbbbbbb' (8 byte): +4
    expect(typeof data.bytesChanged).toBe('number');
    expect(data.bytesChanged).toBe(4);
  });

  it('bytesChanged è presente nell\'output JSON dopo insert', async () => {
    await seedFile('bc_insert.txt', 'a\nc');

    const res = await callTool('fs_edit', {
      path: 'bc_insert.txt',
      operation: 'insert',
      line: 2,
      content: 'b',
    });

    expect(res.isError).toBeFalsy();
    const data = JSON.parse(res.content[0].text);
    expect(data).toHaveProperty('bytesChanged');
    // 'a\nc' (3 byte) → 'a\nb\nc' (5 byte): +2 (b + newline = 1 + 1)
    expect(data.bytesChanged).toBe(2);
  });

  it('bytesChanged è presente nell\'output JSON dopo delete', async () => {
    await seedFile('bc_delete.txt', 'keep\ndeleteme\nkeep2');

    const res = await callTool('fs_edit', {
      path: 'bc_delete.txt',
      operation: 'delete',
      line: 2,
    });

    expect(res.isError).toBeFalsy();
    const data = JSON.parse(res.content[0].text);
    expect(data).toHaveProperty('bytesChanged');
    // 'keep\ndeleteme\nkeep2' (19 byte, 3 linee) → 'keep\nkeep2' (9 byte, 2 linee): -10
    expect(data.bytesChanged).toBe(-10);
  });

  it('bytesChanged è 0 se modified = false (nessuna modifica)', async () => {
    await seedFile('bc_nomatch.txt', 'unchanged');

    const res = await callTool('fs_edit', {
      path: 'bc_nomatch.txt',
      operation: 'replace',
      pattern: 'NONEXISTENT',
      content: 'anything',
    });

    expect(res.isError).toBeFalsy();
    const data = JSON.parse(res.content[0].text);
    expect(data.modified).toBe(false);
    expect(data.linesChanged).toBe(0);
    // Anche bytesChanged dovrebbe essere 0 quando non c'è modifica
    expect(data).toHaveProperty('bytesChanged');
    expect(data.bytesChanged).toBe(0);
  });

  it('bytesChanged riflette correttamente riduzioni di byte (sostituzione più corta)', async () => {
    await seedFile('bc_shorter.txt', 'longword');

    const res = await callTool('fs_edit', {
      path: 'bc_shorter.txt',
      operation: 'replace',
      pattern: 'longword',
      content: 'x',
    });

    expect(res.isError).toBeFalsy();
    const data = JSON.parse(res.content[0].text);
    expect(data).toHaveProperty('bytesChanged');
    // 'longword' (8 byte) → 'x' (1 byte): -7
    expect(data.bytesChanged).toBe(-7);
  });

  it('bytesChanged riflette insert multilinea', async () => {
    await seedFile('bc_multiline_insert.txt', 'a\nz');

    const res = await callTool('fs_edit', {
      path: 'bc_multiline_insert.txt',
      operation: 'insert',
      line: 2,
      content: 'b\nc\nd',
    });

    expect(res.isError).toBeFalsy();
    const data = JSON.parse(res.content[0].text);
    expect(data).toHaveProperty('bytesChanged');
    // 'a\nz' (3 byte) → 'a\nb\nc\nd\nz' (9 byte): +6
    // b(1) + \n(1) + c(1) + \n(1) + d(1) = 5 ... wait let me count:
    // a\nz = 3 bytes
    // a\nb\nc\nd\nz = 9 bytes
    // diff = +6
    expect(data.bytesChanged).toBe(6);
  });
});
