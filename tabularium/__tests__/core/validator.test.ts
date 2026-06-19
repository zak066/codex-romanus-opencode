/**
 * Test per validator.ts
 * Verifica la validazione della configurazione opencode.json.
 *
 * Mockiamo parseOpenCode per controllare i dati di input senza filesystem.
 * La cache di validazione viene resettata prima di ogni test.
 */

import { validationCache } from '../../src/core/cache';
import type { OpenCodeConfig } from '../../src/core/opencode-parser';
import type { ValidationError } from '../../src/core/validator';

// ---------------------------------------------------------------------------
// Mock di opencode-parser
// ---------------------------------------------------------------------------
const mockParseOpenCode = jest.fn();

jest.mock('../../src/core/opencode-parser', () => ({
  parseOpenCode: (...args: any[]) => mockParseOpenCode(...args),
}));

// Tipi
import type { Agent } from '../../src/types/agent';
import type { Model } from '../../src/types/model';


// ---------------------------------------------------------------------------
// Module under test
// ---------------------------------------------------------------------------
import { validateConfig, isValid, getErrorsOnly, getWarningsOnly } from '../../src/core/validator';

// ---------------------------------------------------------------------------
// Helpers per costruire configurazioni di test
// ---------------------------------------------------------------------------

function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    name: 'test-agent',
    role: 'Test role',
    latinName: 'Testis',
    emoji: '🧪',
    color: '#abcdef',
    model: 'gpt-4o',
    mode: 'primary',
    temperature: 0.7,
    permissions: { bash: 'allow', edit: 'ask', task: 'allow' },
    hasSkill: false,
    ...overrides,
  };
}

function makeModel(overrides: Partial<Model> = {}): Model {
  return {
    id: 'gpt-4o',
    provider: 'openai',
    context: '128k',
    cost: '5$',
    ...overrides,
  };
}

function makeConfig(overrides: Partial<OpenCodeConfig> = {}): OpenCodeConfig {
  return {
    agents: { 'test-agent': makeAgent() },
    models: { 'gpt-4o': makeModel() },
    primaryAgent: 'test-agent',
    raw: {},
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------
beforeEach(() => {
  jest.clearAllMocks();
  validationCache.clear();
});

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------
describe('validateConfig', () => {
  it('restituisce array vuoto per configurazione valida', async () => {
    mockParseOpenCode.mockResolvedValue(makeConfig());

    const errors = await validateConfig();
    expect(errors).toHaveLength(0);
  });

  it('segnala errore se non ci sono agenti', async () => {
    mockParseOpenCode.mockResolvedValue(makeConfig({ agents: {} }));

    const errors = await validateConfig();
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.field === 'agents' && e.severity === 'error')).toBe(true);
  });

  it('segnala errore per agente senza campo role', async () => {
    const agent = makeAgent({ role: '' as any });
    mockParseOpenCode.mockResolvedValue(
      makeConfig({ agents: { 'test-agent': agent } })
    );

    const errors = await validateConfig();
    expect(errors.some((e) => e.field.includes('role'))).toBe(true);
  });

  it('segnala errore per mode non valido', async () => {
    const agent = makeAgent({ mode: 'invalid' as any });
    mockParseOpenCode.mockResolvedValue(
      makeConfig({ agents: { 'test-agent': agent } })
    );

    const errors = await validateConfig();
    expect(errors.some((e) => e.field.includes('mode'))).toBe(true);
  });

  it('segnala warning per temperatura fuori range [0, 2]', async () => {
    const agent = makeAgent({ temperature: 3.5 });
    mockParseOpenCode.mockResolvedValue(
      makeConfig({ agents: { 'test-agent': agent } })
    );

    const errors = await validateConfig();
    const tempErrors = errors.filter((e) => e.field.includes('temperature'));
    expect(tempErrors.length).toBeGreaterThan(0);
    expect(tempErrors[0].severity).toBe('warning');
  });

  it('non segnala warning per temperatura nel range [0, 2]', async () => {
    const agent = makeAgent({ temperature: 0 });
    mockParseOpenCode.mockResolvedValue(
      makeConfig({ agents: { 'test-agent': agent } })
    );

    const errors = await validateConfig();
    expect(errors.some((e) => e.field.includes('temperature'))).toBe(false);
  });

  it('segnala errore se nessun agente è primario', async () => {
    const agent = makeAgent({ mode: 'subagent' });
    mockParseOpenCode.mockResolvedValue(
      makeConfig({ agents: { 'test-agent': agent } })
    );

    const errors = await validateConfig();
    expect(errors.some((e) => e.message.includes('No primary agent'))).toBe(true);
  });

  it('segnala warning se ci sono più agenti primari', async () => {
    const agent1 = makeAgent({ name: 'primary1', mode: 'primary' });
    const agent2 = makeAgent({ name: 'primary2', mode: 'primary' });
    mockParseOpenCode.mockResolvedValue(
      makeConfig({
        agents: { primary1: agent1, primary2: agent2 },
        primaryAgent: 'primary1',
      })
    );

    const errors = await validateConfig();
    expect(errors.some((e) => e.message.includes('Multiple primary agents'))).toBe(true);
  });

  it('segnala warning se un modello referenziato non esiste', async () => {
    const agent = makeAgent({ model: 'nonexistent-model' });
    mockParseOpenCode.mockResolvedValue(
      makeConfig({
        agents: { 'test-agent': agent },
        models: { 'gpt-4o': makeModel() },
      })
    );

    const errors = await validateConfig();
    expect(errors.some((e) => e.field.includes('model'))).toBe(true);
  });

  it('segnala warning per modello inutilizzato', async () => {
    mockParseOpenCode.mockResolvedValue(
      makeConfig({
        models: {
          'gpt-4o': makeModel(),
          'unused-model': makeModel({ id: 'unused-model' }),
        },
      })
    );

    const errors = await validateConfig();
    expect(errors.some((e) => e.field.includes('unused-model'))).toBe(true);
  });

  it('segnala errore se il parsing della config fallisce', async () => {
    mockParseOpenCode.mockRejectedValue(new Error('File not found'));

    const errors = await validateConfig();
    expect(errors.some((e) => e.field === 'root')).toBe(true);
  });

  it('ordina errori prima dei warning', async () => {
    // Crea config con sia errori che warning
    const agent = makeAgent({
      mode: 'subagent',
      temperature: 3.5,
      model: 'nonexistent',
    });
    mockParseOpenCode.mockResolvedValue(
      makeConfig({
        agents: { 'test-agent': agent },
        models: {},
      })
    );

    const errors = await validateConfig();
    const severities = errors.map((e) => e.severity);

    // Trova il punto di transizione error → warning
    const firstWarning = severities.indexOf('warning');
    const lastError = severities.lastIndexOf('error');

    if (firstWarning >= 0 && lastError >= 0) {
      expect(lastError).toBeLessThan(firstWarning);
    }
  });
});

describe('isValid', () => {
  it('restituisce true per configurazione valida', async () => {
    mockParseOpenCode.mockResolvedValue(makeConfig());

    const valid = await isValid();
    expect(valid).toBe(true);
  });

  it('restituisce false per configurazione con errori', async () => {
    mockParseOpenCode.mockResolvedValue(makeConfig({ agents: {} }));

    const valid = await isValid();
    expect(valid).toBe(false);
  });

  it('restituisce true se ci sono solo warning (nessun errore)', async () => {
    const agent = makeAgent({ temperature: 2.5, mode: 'primary' });
    mockParseOpenCode.mockResolvedValue(
      makeConfig({ agents: { 'test-agent': agent } })
    );

    const valid = await isValid();
    expect(valid).toBe(true);
  });
});

describe('getErrorsOnly', () => {
  it('restituisce solo errori, escludendo i warning', async () => {
    const agent = makeAgent({ mode: 'subagent', temperature: 3.5 });
    mockParseOpenCode.mockResolvedValue(
      makeConfig({ agents: { 'test-agent': agent } })
    );

    const errors = await getErrorsOnly();
    expect(errors.length).toBeGreaterThan(0);
    errors.forEach((e) => expect(e.severity).toBe('error'));
  });
});

describe('getWarningsOnly', () => {
  it('restituisce solo warning, escludendo gli errori', async () => {
    const agent = makeAgent({ mode: 'subagent', temperature: 3.5 });
    mockParseOpenCode.mockResolvedValue(
      makeConfig({ agents: { 'test-agent': agent } })
    );

    const warnings = await getWarningsOnly();
    expect(warnings.length).toBeGreaterThan(0);
    warnings.forEach((e) => expect(e.severity).toBe('warning'));
  });
});

describe('cache behavior', () => {
  it('usa la cache dopo la prima validazione', async () => {
    mockParseOpenCode.mockResolvedValue(makeConfig());

    // Prima chiamata
    const first = await validateConfig();
    expect(mockParseOpenCode).toHaveBeenCalledTimes(1);

    // Seconda chiamata — dalla cache
    const second = await validateConfig();
    expect(mockParseOpenCode).toHaveBeenCalledTimes(1);

    expect(second).toEqual(first);
  });
});
