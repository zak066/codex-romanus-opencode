/**
 * Test per progress-parser.ts
 * Verifica il parsing del file .dev-team/progress.md.
 *
 * Mockiamo fs/promises per isolare da filesystem reale.
 * La cache viene resettata prima di ogni test.
 */

import { readFile, access } from 'node:fs/promises';
import { progressCache } from '../../src/core/cache';

// ---------------------------------------------------------------------------
// Mock completo di fs/promises
// ---------------------------------------------------------------------------
jest.mock('node:fs/promises', () => ({
  readFile: jest.fn(),
  access: jest.fn(),
}));

const mockReadFile = readFile as jest.MockedFunction<typeof readFile>;
const mockAccess = access as jest.MockedFunction<typeof access>;

// ---------------------------------------------------------------------------
// Module under test
// ---------------------------------------------------------------------------
import {
  parseProgress,
  getProgressSummary,
  getTasksByAgent,
  getTasksByStatus,
} from '../../src/core/progress-parser';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const STANDARD_MARKDOWN = `# Progress

## Completed
- [x] Implement login @iuppiter [high]
- [x] Write tests @minerva [medium]

## In Progress
- [>] Refactor cache @iuppiter [high]

## Pending
- [ ] Add logging @janus [low]
- [ ] Deploy to staging @minerva [medium]

## Blocked
- [!] Fix auth bug @iuppiter [high]

## Cancelled
- [-] Old feature @minerva [low]

Updated: 2026-05-24 12:00:00
`;

const ALL_STATES_MARKDOWN = `# Tasks
- [ ] pending task @agent1 [high]
- [x] completed task @agent2 [medium]
- [X] completed uppercase @agent1 [low]
- [!] blocked task @agent3 [high]
- [>] in progress task @agent1 [medium]
- [-] cancelled task @agent2 [low]
- [ ] unassigned task
Updated: 2026-05-24
`;

const EMPTY_MARKDOWN = ``;

const NO_TASKS_MARKDOWN = `# Progress

No tasks yet.
Updated: 2026-01-01
`;

const MARKDOWN_WITHOUT_UPDATED = `# Tasks
- [ ] task one @agent1 [high]
- [x] task two @agent2 [medium]
`;

const MARKDOWN_WITH_WEIRD_SPACING = `# Tasks
-    [x]    spaced task    @agent1    [high]
- [ ]no space @agent1
`;

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------
beforeEach(() => {
  jest.clearAllMocks();
  progressCache.clear();
});

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------
describe('parseProgress', () => {
  it('parsa correttamente un file markdown standard con tutti i task', async () => {
    mockAccess.mockResolvedValue(undefined);
    mockReadFile.mockResolvedValue(STANDARD_MARKDOWN);

    const taskList = await parseProgress();

    expect(taskList.tasks).toHaveLength(7);
    expect(taskList.summary.total).toBe(7);
    expect(taskList.summary.completed).toBe(2);
    expect(taskList.summary.in_progress).toBe(1);
    expect(taskList.summary.pending).toBe(2);
    expect(taskList.summary.blocked).toBe(1);
    expect(taskList.summary.cancelled).toBe(1);
  });

  it('estrae task in tutti gli stati possibili', async () => {
    mockAccess.mockResolvedValue(undefined);
    mockReadFile.mockResolvedValue(ALL_STATES_MARKDOWN);

    const taskList = await parseProgress();

    expect(taskList.tasks).toHaveLength(7);

    const pending = taskList.tasks.find((t) => t.status === 'pending');
    expect(pending).toBeDefined();
    expect(pending!.task).toBe('pending task');
    expect(pending!.agent).toBe('agent1');
    expect(pending!.priority).toBe('high');

    const completed = taskList.tasks.filter((t) => t.status === 'completed');
    expect(completed).toHaveLength(2);

    const blocked = taskList.tasks.find((t) => t.status === 'blocked');
    expect(blocked).toBeDefined();
    expect(blocked!.agent).toBe('agent3');

    const inProgress = taskList.tasks.find((t) => t.status === 'in_progress');
    expect(inProgress).toBeDefined();

    const cancelled = taskList.tasks.find((t) => t.status === 'cancelled');
    expect(cancelled).toBeDefined();

    // Unassigned task
    const unassigned = taskList.tasks.find((t) => t.task === 'unassigned task');
    expect(unassigned).toBeDefined();
    expect(unassigned!.agent).toBe('unassigned');
  });

  it('restituisce una TaskList vuota per file vuoto', async () => {
    mockAccess.mockResolvedValue(undefined);
    mockReadFile.mockResolvedValue(EMPTY_MARKDOWN);

    const taskList = await parseProgress();

    expect(taskList.tasks).toHaveLength(0);
    expect(taskList.summary.total).toBe(0);
    expect(taskList.summary.pending).toBe(0);
    expect(taskList.summary.completed).toBe(0);
    expect(taskList.updatedAt).toBeDefined();
  });

  it('restituisce una TaskList vuota per file senza righe task', async () => {
    mockAccess.mockResolvedValue(undefined);
    mockReadFile.mockResolvedValue(NO_TASKS_MARKDOWN);

    const taskList = await parseProgress();

    expect(taskList.tasks).toHaveLength(0);
    expect(taskList.summary.total).toBe(0);
  });

  it('restituisce una TaskList vuota se il file non esiste (non lancia errore)', async () => {
    mockAccess.mockRejectedValue(new Error('ENOENT'));

    const taskList = await parseProgress();

    expect(taskList.tasks).toHaveLength(0);
    expect(taskList.summary.total).toBe(0);
  });

  it('estrae la data updatedAt dal file', async () => {
    mockAccess.mockResolvedValue(undefined);
    mockReadFile.mockResolvedValue(STANDARD_MARKDOWN);

    const taskList = await parseProgress();
    // Updated: 2026-05-24 12:00:00 → "2026-05-24T12:00:00"
    expect(taskList.updatedAt).toContain('2026-05-24T');
  });

  it('usa la data corrente se manca la riga Updated', async () => {
    mockAccess.mockResolvedValue(undefined);
    mockReadFile.mockResolvedValue(MARKDOWN_WITHOUT_UPDATED);

    const before = new Date();
    const taskList = await parseProgress();
    const after = new Date();

    const updated = new Date(taskList.updatedAt);
    expect(updated.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(updated.getTime()).toBeLessThanOrEqual(after.getTime());
  });
});

describe('getProgressSummary', () => {
  it('restituisce solo summary e updatedAt', async () => {
    mockAccess.mockResolvedValue(undefined);
    mockReadFile.mockResolvedValue(STANDARD_MARKDOWN);

    const { summary, updatedAt } = await getProgressSummary();

    expect(summary.total).toBe(7);
    expect(updatedAt).toBeDefined();
    // Non deve avere la lista tasks
    expect(Object.keys({ summary, updatedAt })).not.toContain('tasks');
  });
});

describe('getTasksByAgent', () => {
  it('filtra i task per agente specifico', async () => {
    mockAccess.mockResolvedValue(undefined);
    mockReadFile.mockResolvedValue(STANDARD_MARKDOWN);

    const iuppiterTasks = await getTasksByAgent('iuppiter');
    expect(iuppiterTasks).toHaveLength(3);
    iuppiterTasks.forEach((t) => expect(t.agent).toBe('iuppiter'));
  });

  it('restituisce array vuoto per agente inesistente', async () => {
    mockAccess.mockResolvedValue(undefined);
    mockReadFile.mockResolvedValue(STANDARD_MARKDOWN);

    const tasks = await getTasksByAgent('nonexistent');
    expect(tasks).toHaveLength(0);
  });
});

describe('getTasksByStatus', () => {
  it('filtra i task per stato specifico', async () => {
    mockAccess.mockResolvedValue(undefined);
    mockReadFile.mockResolvedValue(STANDARD_MARKDOWN);

    const completed = await getTasksByStatus('completed');
    expect(completed).toHaveLength(2);
    completed.forEach((t) => expect(t.status).toBe('completed'));
  });

  it('restituisce array vuoto per stato inesistente', async () => {
    mockAccess.mockResolvedValue(undefined);
    mockReadFile.mockResolvedValue(STANDARD_MARKDOWN);

    const tasks = await getTasksByStatus('completed' as any);
    // Tutti i completed sono due
    expect(tasks).toHaveLength(2);
  });
});

describe('cache behavior', () => {
  it('usa la cache dopo la prima lettura', async () => {
    mockAccess.mockResolvedValue(undefined);
    mockReadFile.mockResolvedValue(STANDARD_MARKDOWN);

    // Prima lettura — va su disco
    const first = await parseProgress();
    expect(mockReadFile).toHaveBeenCalledTimes(1);

    // Seconda lettura — dalla cache
    const second = await parseProgress();
    expect(mockReadFile).toHaveBeenCalledTimes(1);

    expect(second).toEqual(first);
  });
});
