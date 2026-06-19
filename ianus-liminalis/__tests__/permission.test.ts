import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PermissionChecker, type PermissionConfig } from '../src/core/permission.js';
import { mkdtempSync, writeFileSync, mkdirSync, symlinkSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { rm } from 'node:fs/promises';

// ---------------------------------------------------------------------------
// PermissionChecker.load
// ---------------------------------------------------------------------------
describe('PermissionChecker.load', () => {
  let tempDir: string;

  beforeAll(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'ianus-load-test-'));
  });

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('should load a valid config from file', async () => {
    const configPath = resolve(process.cwd(), '.ianus-permissions.json');
    const checker = await PermissionChecker.load(configPath);

    expect(checker).toBeInstanceOf(PermissionChecker);

    // Verifica che il config sia stato caricato correttamente controllando
    // il comportamento: il file .env non dev'essere scrivibile
    const result = await checker.checkOperation(
      'vulcanus',
      'write',
      'config/.env.local',
      process.cwd(),
    );
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('deny-sensitive-for-all');
  });

  it('should throw on malformed JSON', async () => {
    const badFile = join(tempDir, 'bad.json');
    writeFileSync(badFile, '{invalid json}', 'utf-8');

    await expect(PermissionChecker.load(badFile)).rejects.toThrow('Invalid JSON');
  });

  it('should throw when version is missing', async () => {
    const badFile = join(tempDir, 'no-version.json');
    writeFileSync(
      badFile,
      JSON.stringify({ defaultEffect: 'allow', rules: [] }),
      'utf-8',
    );

    await expect(PermissionChecker.load(badFile)).rejects.toThrow('"version"');
  });

  it('should throw when defaultEffect is invalid', async () => {
    const badFile = join(tempDir, 'bad-effect.json');
    writeFileSync(
      badFile,
      JSON.stringify({ version: 1, defaultEffect: 'maybe', rules: [] }),
      'utf-8',
    );

    await expect(PermissionChecker.load(badFile)).rejects.toThrow('defaultEffect');
  });

  it('should throw when rules is not an array', async () => {
    const badFile = join(tempDir, 'bad-rules.json');
    writeFileSync(
      badFile,
      JSON.stringify({ version: 1, defaultEffect: 'allow', rules: 'not-an-array' }),
      'utf-8',
    );

    await expect(PermissionChecker.load(badFile)).rejects.toThrow('"rules" array');
  });

  it('should throw when a rule is missing required fields', async () => {
    const badFile = join(tempDir, 'bad-rule.json');
    writeFileSync(
      badFile,
      JSON.stringify({
        version: 1,
        defaultEffect: 'deny',
        rules: [{ id: 'oops' }], // missing agentPattern, priority, effect, etc.
      }),
      'utf-8',
    );

    await expect(PermissionChecker.load(badFile)).rejects.toThrow('agentPattern');
  });
});

// ---------------------------------------------------------------------------
// PermissionChecker.checkOperation
// ---------------------------------------------------------------------------
describe('PermissionChecker.checkOperation', () => {
  const workspaceRoot = resolve('/tmp/workspace');

  // --- Helper: produce un config con defaultEffect allow ---
  function allowConfig(rules?: PermissionConfig['rules']): PermissionConfig {
    return { version: 1, defaultEffect: 'allow', rules: rules ?? [] };
  }

  // --- Helper: produce un config con defaultEffect deny ---
  function denyConfig(rules?: PermissionConfig['rules']): PermissionConfig {
    return { version: 1, defaultEffect: 'deny', rules: rules ?? [] };
  }

  // -----------------------------------------------------------------------
  // Path allow — defaultEffect allow, nessuna regola matcha
  // -----------------------------------------------------------------------
  it('should allow when no rule matches and defaultEffect is allow', async () => {
    const checker = new PermissionChecker(allowConfig());
    const result = await checker.checkOperation(
      'vulcanus',
      'read',
      'src/app.ts',
      workspaceRoot,
    );

    expect(result.allowed).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  // -----------------------------------------------------------------------
  // Path deny — defaultEffect deny, nessuna regola matcha
  // -----------------------------------------------------------------------
  it('should deny when no rule matches and defaultEffect is deny', async () => {
    const checker = new PermissionChecker(denyConfig());
    const result = await checker.checkOperation(
      'vulcanus',
      'read',
      'src/app.ts',
      workspaceRoot,
    );

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('Default effect: deny');
  });

  // -----------------------------------------------------------------------
  // Path deny — regola deny matcha per file .env
  // -----------------------------------------------------------------------
  it('should deny write to .env files', async () => {
    const checker = new PermissionChecker(
      allowConfig([
        {
          id: 'deny-sensitive',
          agentPattern: '*',
          priority: 100,
          effect: 'deny',
          paths: ['**/.env*', '**/credentials*'],
          operations: ['write', 'edit', 'delete'],
        },
      ]),
    );

    const result = await checker.checkOperation(
      'vulcanus',
      'write',
      '.env.production',
      workspaceRoot,
    );

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('deny-sensitive');
  });

  // -----------------------------------------------------------------------
  // Path traversal — containment check fallisce
  // -----------------------------------------------------------------------
  it('should block path traversal attempts', async () => {
    const checker = new PermissionChecker(allowConfig());

    const result = await checker.checkOperation(
      'vulcanus',
      'read',
      '../../etc/passwd',
      resolve('/app'),
    );

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('Path traversal: outside workspace');
  });

  // -----------------------------------------------------------------------
  // Priorità — regola con priorità più alta vince
  // -----------------------------------------------------------------------
  it('should apply the highest priority matching rule', async () => {
    const checker = new PermissionChecker(
      allowConfig([
        {
          id: 'low-priority-deny',
          agentPattern: '*',
          priority: 100,
          effect: 'deny',
          paths: ['**/file.txt'],
          operations: ['read'],
        },
        {
          id: 'high-priority-allow',
          agentPattern: '*',
          priority: 10,
          effect: 'allow',
          paths: ['**/file.txt'],
          operations: ['read'],
        },
      ]),
    );

    const result = await checker.checkOperation(
      'vulcanus',
      'read',
      'docs/file.txt',
      workspaceRoot,
    );

    // Ascending sort: priority 10 (allow) checked first → allow wins
    expect(result.allowed).toBe(true);
  });

  it('should use highest priority deny to block', async () => {
    const checker = new PermissionChecker(
      allowConfig([
        {
          id: 'low-priority-allow',
          agentPattern: '*',
          priority: 100,
          effect: 'allow',
          paths: ['**/secret.txt'],
          operations: ['read'],
        },
        {
          id: 'high-priority-deny',
          agentPattern: '*',
          priority: 10,
          effect: 'deny',
          paths: ['**/secret.txt'],
          operations: ['read'],
        },
      ]),
    );

    const result = await checker.checkOperation(
      'vulcanus',
      'read',
      'data/secret.txt',
      workspaceRoot,
    );

    // Ascending sort: priority 10 (deny) checked first → deny wins
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('high-priority-deny');
  });

  // -----------------------------------------------------------------------
  // Agent matching — regola specifica per agente vs wildcard *
  // -----------------------------------------------------------------------
  it('should match agent-specific rules only for that agent', async () => {
    const checker = new PermissionChecker(
      denyConfig([
        {
          id: 'vulcanus-only',
          agentPattern: 'vulcanus',
          priority: 100,
          effect: 'allow',
          paths: ['**/restricted.md'],
          operations: ['read'],
        },
      ]),
    );

    // Vulcanus matcha la regola → allow
    const resultVulcanus = await checker.checkOperation(
      'vulcanus',
      'read',
      'docs/restricted.md',
      workspaceRoot,
    );
    expect(resultVulcanus.allowed).toBe(true);

    // Altri agenti non matchano → default deny
    const resultMinerva = await checker.checkOperation(
      'minerva',
      'read',
      'docs/restricted.md',
      workspaceRoot,
    );
    expect(resultMinerva.allowed).toBe(false);
    expect(resultMinerva.reason).toBe('Default effect: deny');
  });

  it('should match wildcard * for all agents', async () => {
    const checker = new PermissionChecker(
      allowConfig([
        {
          id: 'block-all',
          agentPattern: '*',
          priority: 100,
          effect: 'deny',
          paths: ['**/*.tmp'],
          operations: ['write', 'delete'],
        },
      ]),
    );

    const result = await checker.checkOperation(
      'janus',
      'delete',
      'cache/temp.tmp',
      workspaceRoot,
    );
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('block-all');
  });

  // -----------------------------------------------------------------------
  // Operation matching — solo le operation specificate
  // -----------------------------------------------------------------------
  it('should only block matching operations', async () => {
    const checker = new PermissionChecker(
      allowConfig([
        {
          id: 'block-write-only',
          agentPattern: '*',
          priority: 100,
          effect: 'deny',
          paths: ['**/config.yaml'],
          operations: ['write', 'edit'],
        },
      ]),
    );

    // Lettura non è bloccata
    const readResult = await checker.checkOperation(
      'vulcanus',
      'read',
      'config/config.yaml',
      workspaceRoot,
    );
    expect(readResult.allowed).toBe(true);

    // Scrittura è bloccata
    const writeResult = await checker.checkOperation(
      'vulcanus',
      'write',
      'config/config.yaml',
      workspaceRoot,
    );
    expect(writeResult.allowed).toBe(false);
    expect(writeResult.reason).toContain('block-write-only');
  });

  // -----------------------------------------------------------------------
  // Path glob matching con dot: true
  // -----------------------------------------------------------------------
  it('should match hidden files with dot patterns', async () => {
    const checker = new PermissionChecker(
      allowConfig([
        {
          id: 'deny-dotfiles',
          agentPattern: '*',
          priority: 100,
          effect: 'deny',
          paths: ['**/.*', '**/.*/**'],
          operations: ['write', 'edit', 'delete', 'read'],
        },
      ]),
    );

    const result = await checker.checkOperation(
      'scipione',
      'read',
      '.config/secret.yaml',
      workspaceRoot,
    );
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('deny-dotfiles');
  });

  // -----------------------------------------------------------------------
  // Symlink resolution
  // -----------------------------------------------------------------------
  describe('symlink resolution', () => {
    let symTmpDir: string;

    beforeAll(() => {
      symTmpDir = mkdtempSync(join(tmpdir(), 'ianus-symlink-'));
    });

    afterAll(async () => {
      await rm(symTmpDir, { recursive: true, force: true });
    });

    it('should allow path when symlink points inside workspace', async () => {
      // Setup: realDir dentro workspace, symlink -> realDir
      const realDir = join(symTmpDir, 'real');
      const linkDir = join(symTmpDir, 'link');
      mkdirSync(realDir, { recursive: true });

      try {
        // 'junction' su Windows, 'dir' su Unix — entrambi funzionano
        symlinkSync(realDir, linkDir, 'junction');
      } catch {
        // Symlink non supportato su questo sistema — skip
        return;
      }

      writeFileSync(join(realDir, 'target.txt'), 'content');

      const checker = new PermissionChecker(allowConfig());
      const result = await checker.checkOperation(
        'vulcanus',
        'read',
        'link/target.txt',
        symTmpDir,
      );

      expect(result.allowed).toBe(true);
    });

    it('should block symlink pointing outside workspace', async () => {
      // Setup: outsideDir FUORI dal workspace, symlink -> outsideDir
      const outsideDir = mkdtempSync(join(tmpdir(), 'ianus-outside-'));
      const linkDir = join(symTmpDir, 'evil-link');
      writeFileSync(join(outsideDir, 'leak.txt'), 'secrets');

      try {
        symlinkSync(outsideDir, linkDir, 'junction');
      } catch {
        // Symlink non supportato — skip
        return;
      }

      const checker = new PermissionChecker(allowConfig());
      const result = await checker.checkOperation(
        'vulcanus',
        'read',
        'evil-link/leak.txt',
        symTmpDir,
      );

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('symlink points outside');
    });
  });

  // -----------------------------------------------------------------------
  // Agent-based routing (version 2 features)
  // -----------------------------------------------------------------------

  it('should match each agent in a CSV pattern', async () => {
    const checker = new PermissionChecker(
      denyConfig([
        {
          id: 'csv-agents',
          agentPattern: 'vulcanus,catone,agrippa,iuppiter',
          priority: 50,
          effect: 'allow',
          paths: ['**'],
          operations: ['read'],
        },
      ]),
    );

    // Each agent in the CSV should be allowed
    const vulcanus = await checker.checkOperation(
      'vulcanus',
      'read',
      'src/app.ts',
      workspaceRoot,
    );
    expect(vulcanus.allowed).toBe(true);

    const catone = await checker.checkOperation(
      'catone',
      'read',
      'src/app.ts',
      workspaceRoot,
    );
    expect(catone.allowed).toBe(true);

    const agrippa = await checker.checkOperation(
      'agrippa',
      'read',
      'src/app.ts',
      workspaceRoot,
    );
    expect(agrippa.allowed).toBe(true);

    const iuppiter = await checker.checkOperation(
      'iuppiter',
      'read',
      'src/app.ts',
      workspaceRoot,
    );
    expect(iuppiter.allowed).toBe(true);

    // An agent NOT in the CSV should be denied (defaultEffect deny)
    const minerva = await checker.checkOperation(
      'minerva',
      'read',
      'src/app.ts',
      workspaceRoot,
    );
    expect(minerva.allowed).toBe(false);
  });

  it('should allow core agents write but deny non-core agents write', async () => {
    const checker = new PermissionChecker(
      denyConfig([
        {
          id: 'allow-core-write',
          agentPattern: 'vulcanus,catone,agrippa,iuppiter',
          priority: 50,
          effect: 'allow',
          paths: ['**'],
          operations: ['write'],
        },
      ]),
    );

    // Core agents can write
    const vulcanus = await checker.checkOperation(
      'vulcanus',
      'write',
      'src/app.ts',
      workspaceRoot,
    );
    expect(vulcanus.allowed).toBe(true);

    // Non-core agents (janus) cannot write
    const janus = await checker.checkOperation(
      'janus',
      'write',
      'src/app.ts',
      workspaceRoot,
    );
    expect(janus.allowed).toBe(false);
    expect(janus.reason).toBe('Default effect: deny');
  });

  it('should allow delete for tester tier but not for junior tier', async () => {
    const checker = new PermissionChecker(
      denyConfig([
        {
          id: 'allow-tester-delete',
          agentPattern: 'ovidio,plinio,diana',
          priority: 50,
          effect: 'allow',
          paths: ['**'],
          operations: ['read', 'write', 'edit', 'delete'],
        },
        {
          id: 'allow-junior',
          agentPattern: 'mercurius,tacito',
          priority: 60,
          effect: 'allow',
          paths: ['**'],
          operations: ['read', 'write', 'edit'],
        },
      ]),
    );

    // Tester can delete
    const ovidio = await checker.checkOperation(
      'ovidio',
      'delete',
      'docs/file.txt',
      workspaceRoot,
    );
    expect(ovidio.allowed).toBe(true);

    // Junior cannot delete (delete not in their allowed operations)
    const mercurius = await checker.checkOperation(
      'mercurius',
      'delete',
      'docs/file.txt',
      workspaceRoot,
    );
    expect(mercurius.allowed).toBe(false);
    expect(mercurius.reason).toBe('Default effect: deny');
  });

  it('should deny sensitive paths for all agents despite allow rules at lower priority', async () => {
    const checker = new PermissionChecker(
      allowConfig([
        {
          id: 'deny-sensitive',
          agentPattern: '*',
          priority: 10,
          effect: 'deny',
          paths: ['**/.env*', '**/credentials*'],
          operations: ['write', 'edit', 'delete'],
        },
        {
          id: 'allow-core-all',
          agentPattern: 'vulcanus,catone,agrippa,iuppiter',
          priority: 40,
          effect: 'allow',
          paths: ['**'],
          operations: ['write'],
        },
      ]),
    );

    // vulcanus should be denied write on .env because deny-sensitive (priority 10) wins
    const result = await checker.checkOperation(
      'vulcanus',
      'write',
      'config/.env.local',
      workspaceRoot,
    );
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('deny-sensitive');
  });

  it('should fall through to defaultEffect for unknown agents not in any rule', async () => {
    const checker = new PermissionChecker({
      version: 1,
      defaultEffect: 'allow',
      rules: [
        {
          id: 'only-known',
          agentPattern: 'vulcanus,catone',
          priority: 50,
          effect: 'deny',
          paths: ['**'],
          operations: ['write'],
        },
      ],
    });

    // Unknown agent (not in any rule) → falls to defaultEffect 'allow'
    const result = await checker.checkOperation(
      'unknown-agent',
      'write',
      'any/file.txt',
      workspaceRoot,
    );
    expect(result.allowed).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it('should handle CSV patterns with extra spaces around agent names', async () => {
    const checker = new PermissionChecker(
      denyConfig([
        {
          id: 'csv-with-spaces',
          agentPattern: 'vulcanus, catone,  agrippa',
          priority: 50,
          effect: 'allow',
          paths: ['**'],
          operations: ['read'],
        },
      ]),
    );

    // Each agent should match despite spaces in the CSV
    const vulcanus = await checker.checkOperation(
      'vulcanus',
      'read',
      'src/app.ts',
      workspaceRoot,
    );
    expect(vulcanus.allowed).toBe(true);

    const catone = await checker.checkOperation(
      'catone',
      'read',
      'src/app.ts',
      workspaceRoot,
    );
    expect(catone.allowed).toBe(true);

    const agrippa = await checker.checkOperation(
      'agrippa',
      'read',
      'src/app.ts',
      workspaceRoot,
    );
    expect(agrippa.allowed).toBe(true);
  });

  it('should prioritize high-priority (lower number) deny over low-priority allow', async () => {
    const checker = new PermissionChecker(
      allowConfig([
        {
          id: 'high-priority-deny',
          agentPattern: '*',
          priority: 10,
          effect: 'deny',
          paths: ['**/config.yaml'],
          operations: ['read'],
        },
        {
          id: 'low-priority-allow',
          agentPattern: '*',
          priority: 50,
          effect: 'allow',
          paths: ['**/config.yaml'],
          operations: ['read'],
        },
      ]),
    );

    // Priority 10 is checked first (ascending sort), so deny wins
    const result = await checker.checkOperation(
      'vulcanus',
      'read',
      'config/config.yaml',
      workspaceRoot,
    );
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('high-priority-deny');
  });

  it('should perform case-insensitive agent matching', async () => {
    const checker = new PermissionChecker(
      denyConfig([
        {
          id: 'case-insensitive',
          agentPattern: 'Vulcanus,CaToNe',
          priority: 50,
          effect: 'allow',
          paths: ['**'],
          operations: ['write'],
        },
      ]),
    );

    // Lowercase input matches uppercase pattern
    const vulcanus = await checker.checkOperation(
      'vulcanus',
      'write',
      'src/app.ts',
      workspaceRoot,
    );
    expect(vulcanus.allowed).toBe(true);

    // Uppercase input matches mixed-case pattern
    const catone = await checker.checkOperation(
      'CATONE',
      'write',
      'src/app.ts',
      workspaceRoot,
    );
    expect(catone.allowed).toBe(true);

    // Mixed case input matches mixed-case pattern
    const mixed = await checker.checkOperation(
      'CaToNe',
      'write',
      'src/app.ts',
      workspaceRoot,
    );
    expect(mixed.allowed).toBe(true);

    // Non-matching agent should be denied
    const minerva = await checker.checkOperation(
      'minerva',
      'write',
      'src/app.ts',
      workspaceRoot,
    );
    expect(minerva.allowed).toBe(false);
  });
});
