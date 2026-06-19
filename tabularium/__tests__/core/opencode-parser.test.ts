/**
 * Test per opencode-parser.ts
 * Verifica la lettura e il parsing dinamico di opencode.json.
 *
 * Per isolare i test da filesystem reale, mockiamo fs/promises.
 * La cache viene resettata prima di ogni test.
 */

import { readFile, access } from 'node:fs/promises';
import { openCodeCache } from '../../src/core/cache';

// ---------------------------------------------------------------------------
// Mock completo di fs/promises
// ---------------------------------------------------------------------------
jest.mock('node:fs/promises', () => ({
  readFile: jest.fn(),
  access: jest.fn(),
}));

// Tipi per i mock
const mockReadFile = readFile as jest.MockedFunction<typeof readFile>;
const mockAccess = access as jest.MockedFunction<typeof access>;

// ---------------------------------------------------------------------------
// Module under test
// ---------------------------------------------------------------------------
import { parseOpenCode, reloadOpenCode, getAgentManifest, getModelRegistry } from '../../src/core/opencode-parser';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const VALID_OPENCODE_JSON = JSON.stringify({
  agents: {
    iuppiter: {
      role: 'Orchestrator and coordinator',
      latinName: 'Iuppiter',
      emoji: '👑',
      color: '#FFD700',
      model: 'gpt-4o',
      mode: 'primary',
      temperature: 0.7,
      permissions: { bash: 'allow', edit: 'ask', task: 'allow' },
      hasSkill: true,
    },
    minerva: {
      role: 'Guardian of quality',
      latinName: 'Minerva',
      emoji: '🦉',
      color: '#C0C0C0',
      model: 'gpt-4o',
      mode: 'subagent',
      temperature: 0.3,
      permissions: { bash: 'deny', edit: 'allow', task: 'allow' },
      hasSkill: true,
    },
    janus: {
      role: 'Security sentinel',
      latinName: 'Ianvs',
      emoji: '🔒',
      color: '#8B0000',
      model: 'gpt-4o-mini',
      mode: 'subagent',
      temperature: 0.5,
      steps: 3,
      permissions: { bash: 'allow', edit: 'deny', task: 'ask', webfetch: 'allow' },
      hasSkill: true,
    },
  },
  models: {
    'gpt-4o': { provider: 'openai', context: '128k', cost: '5$' },
    'gpt-4o-mini': { provider: 'openai', context: '128k', cost: '0.15$' },
  },
});

const VALID_OPENCODE_JSON_SINGLE = JSON.stringify({
  agents: {
    solo: {
      role: 'Single agent',
      latinName: 'Solo',
      emoji: '🤖',
      color: '#000',
      model: 'gpt-4o',
      mode: 'primary',
      temperature: 0.7,
      permissions: { bash: 'allow', edit: 'allow', task: 'allow' },
      hasSkill: false,
    },
  },
  models: {
    'gpt-4o': { provider: 'openai' },
  },
});

const DISABLED_AGENTS_JSON = JSON.stringify({
  agents: {
    iuppiter: {
      role: 'Orchestrator',
      latinName: 'Iuppiter',
      emoji: '👑',
      color: '#FFD700',
      model: 'gpt-4o',
      mode: 'primary',
      temperature: 0.7,
      permissions: { bash: 'allow', edit: 'ask', task: 'allow' },
      hasSkill: true,
    },
    disabled_agent: {
      role: 'Disabled',
      latinName: 'Dis',
      emoji: '💤',
      color: '#ccc',
      model: 'gpt-4o',
      mode: 'subagent',
      disable: true,
      temperature: 0.5,
      permissions: { bash: 'deny', edit: 'deny', task: 'deny' },
      hasSkill: false,
    },
  },
  models: {},
});

const MALFORMED_JSON = '{ "agents": "broken" ';
const EMPTY_AGENTS_JSON = JSON.stringify({ agents: {}, models: {} });

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------
beforeEach(() => {
  jest.clearAllMocks();
  openCodeCache.clear();
});

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------
describe('parseOpenCode', () => {
  it('restituisce la configurazione completa per un opencode.json valido', async () => {
    mockAccess.mockResolvedValue(undefined);
    mockReadFile.mockResolvedValue(VALID_OPENCODE_JSON);

    const config = await parseOpenCode();

    expect(config).toBeDefined();
    expect(config.agents).toBeDefined();
    expect(config.models).toBeDefined();
    expect(config.raw).toBeDefined();
    expect(config.primaryAgent).toBe('iuppiter');
  });

  it('estrae tutti gli agenti dalla configurazione (dinamico)', async () => {
    mockAccess.mockResolvedValue(undefined);
    mockReadFile.mockResolvedValue(VALID_OPENCODE_JSON);

    const config = await parseOpenCode();
    const agentNames = Object.keys(config.agents);

    expect(agentNames).toContain('iuppiter');
    expect(agentNames).toContain('minerva');
    expect(agentNames).toContain('janus');
    expect(agentNames).toHaveLength(3);
  });

  it('estrae correttamente l\'agente primario', async () => {
    mockAccess.mockResolvedValue(undefined);
    mockReadFile.mockResolvedValue(VALID_OPENCODE_JSON);

    const config = await parseOpenCode();
    expect(config.primaryAgent).toBe('iuppiter');
    expect(config.agents['iuppiter'].mode).toBe('primary');
    expect(config.agents['minerva'].mode).toBe('subagent');
  });

  it('estrae correttamente tutti i modelli', async () => {
    mockAccess.mockResolvedValue(undefined);
    mockReadFile.mockResolvedValue(VALID_OPENCODE_JSON);

    const config = await parseOpenCode();
    expect(config.models['gpt-4o']).toBeDefined();
    expect(config.models['gpt-4o-mini']).toBeDefined();
    expect(config.models['gpt-4o'].provider).toBe('openai');
  });

  it('lancia errore se il file non esiste', async () => {
    mockAccess.mockRejectedValue(new Error('ENOENT'));

    await expect(parseOpenCode('/nonexistent/path.json')).rejects.toThrow(
      /opencode\.json not found/
    );
  });

  it('lancia errore se il JSON è malformato', async () => {
    mockAccess.mockResolvedValue(undefined);
    mockReadFile.mockResolvedValue(MALFORMED_JSON);

    await expect(parseOpenCode()).rejects.toThrow(/Invalid JSON/);
  });

  it('gestisce agenti senza modello valido come unknown', async () => {
    mockAccess.mockResolvedValue(undefined);
    mockReadFile.mockResolvedValue(JSON.stringify({
      agents: {
        test: {
          role: 'Test',
          latinName: 'Test',
          emoji: '🧪',
          color: '#fff',
          mode: 'primary',
          temperature: 0.5,
          permissions: {},
          hasSkill: false,
        },
      },
      models: {},
    }));

    const config = await parseOpenCode();
    expect(config.agents['test'].model).toBe('unknown');
  });

  it('usa il fallback per i campi opzionali mancanti', async () => {
    mockAccess.mockResolvedValue(undefined);
    mockReadFile.mockResolvedValue(JSON.stringify({
      agents: {
        minimal: { mode: 'primary' },
      },
      models: {},
    }));

    const config = await parseOpenCode();
    const agent = config.agents['minimal'];
    expect(agent.role).toBe('');
    expect(agent.emoji).toBe('🤖');
    expect(agent.color).toBe('#666666');
    expect(agent.model).toBe('unknown');
    expect(agent.temperature).toBe(0.7);
    expect(agent.permissions.bash).toBe('ask');
  });
});

describe('reloadOpenCode', () => {
  it('bypassa la cache e ricarica da disco', async () => {
    mockAccess.mockResolvedValue(undefined);
    mockReadFile.mockResolvedValue(VALID_OPENCODE_JSON);

    // Prima chiamata — popola la cache
    const first = await parseOpenCode();
    expect(first.primaryAgent).toBe('iuppiter');

    // Cambiamo il contenuto su disco
    mockReadFile.mockResolvedValue(VALID_OPENCODE_JSON_SINGLE);

    // reloadOpenCode deve ignorare la cache e leggere il nuovo contenuto
    const reloaded = await reloadOpenCode();
    expect(reloaded.primaryAgent).toBe('solo');
    expect(Object.keys(reloaded.agents)).toHaveLength(1);
  });
});

describe('getAgentManifest', () => {
  it('restituisce agent manifest con agenti e primario', async () => {
    mockAccess.mockResolvedValue(undefined);
    mockReadFile.mockResolvedValue(VALID_OPENCODE_JSON);

    const manifest = await getAgentManifest();
    expect(manifest.agents).toBeDefined();
    expect(manifest.primaryAgent).toBe('iuppiter');
    expect(Object.keys(manifest.agents)).toContain('minerva');
  });
});

describe('getModelRegistry', () => {
  it('restituisce model registry con modelli e timestamp', async () => {
    mockAccess.mockResolvedValue(undefined);
    mockReadFile.mockResolvedValue(VALID_OPENCODE_JSON);

    const registry = await getModelRegistry();
    expect(registry.models).toBeDefined();
    expect(registry.models['gpt-4o']).toBeDefined();
    expect(registry.updatedAt).toBeDefined();
    // updatedAt should be a valid ISO string
    expect(() => new Date(registry.updatedAt)).not.toThrow();
  });
});

describe('cache behavior', () => {
  it('restituisce il valore cached se presente', async () => {
    mockAccess.mockResolvedValue(undefined);
    mockReadFile.mockResolvedValue(VALID_OPENCODE_JSON);

    // Prima chiamata — va su disco
    const first = await parseOpenCode();
    expect(mockReadFile).toHaveBeenCalledTimes(1);

    // Seconda chiamata — deve usare la cache
    const second = await parseOpenCode();
    expect(mockReadFile).toHaveBeenCalledTimes(1); // Non incrementato

    expect(second).toEqual(first);
  });
});
