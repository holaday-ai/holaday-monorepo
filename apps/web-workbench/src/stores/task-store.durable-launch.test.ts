import { BROWSER_LAUNCH_JOURNAL_PREFIX } from '@holaday/shared-types';
// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useTaskStore } from './task-store';

const state = vi.hoisted(() => ({
  token: 'fixture-actor-a',
  profile: '82cf0bca-b78c-4f12-af23-035421ab959c',
  rows: [] as Array<{
    taskId: string;
    status: string;
    intent: string;
    createdAt: Date;
    result: unknown;
  }>,
  actors: [] as string[],
  loseResponse: false,
  holdReceipt: false,
  releaseReceipt: undefined as (() => void) | undefined,
}));
const api = vi.hoisted(() => ({
  auth: { me: { query: vi.fn() } },
  tasks: {
    localChromeLaunchOptions: { query: vi.fn() },
    localChromeTabs: { query: vi.fn() },
    localChromeTaskTab: { mutate: vi.fn() },
    localChromeLaunchReceipt: { query: vi.fn() },
    localChromeLaunchAcknowledge: { mutate: vi.fn() },
    create: { mutate: vi.fn() },
    list: { query: vi.fn() },
    detail: { query: vi.fn() },
  },
}));
vi.mock('@/lib/auth', () => ({ getAccessToken: () => state.token }));
vi.mock('@/lib/trpc', () => ({
  trpc: api,
  createPinnedTrpc: (token: string) => ({
    ...api,
    auth: {
      me: { query: async () => ({ userId: token === 'fixture-actor-a' ? 'owner-a' : 'owner-b' }) },
    },
    tasks: {
      ...api.tasks,
      create: {
        mutate: (body: unknown) => {
          state.actors.push(token);
          return api.tasks.create.mutate(body);
        },
      },
    },
  }),
}));
const profile = '82cf0bca-b78c-4f12-af23-035421ab959c';
const source = {
  extensionClientId: 'connection-first',
  tabId: 42,
  expectedUrl: 'https://work.example',
  selectionId: '4888c303-9880-44d9-885e-51e13755933b',
  title: 'PRIVATE page title',
  backgroundTaskTabs: true,
  taskTabStart: true,
  launchRecovery: true,
  launchRecoveryReady: true,
  launchBrowserSessionId: profile,
};
let previousLocks: PropertyDescriptor | undefined;
beforeEach(() => {
  useTaskStore.getState().reset();
  localStorage.clear();
  vi.resetAllMocks();
  state.token = 'fixture-actor-a';
  state.profile = profile;
  state.rows = [];
  state.actors = [];
  state.loseResponse = false;
  state.holdReceipt = false;
  state.releaseReceipt = undefined;
  let queue: Promise<unknown> = Promise.resolve();
  previousLocks = Object.getOwnPropertyDescriptor(navigator, 'locks');
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: {
      request: <T>(_key: string, run: () => Promise<T>) => {
        const next = queue.then(run);
        queue = next.catch(() => undefined);
        return next;
      },
    },
  });
  api.tasks.localChromeLaunchOptions.query.mockResolvedValue({
    backgroundTaskTabs: true,
    launchRecovery: true,
  });
  api.tasks.localChromeTabs.query.mockImplementation(async () => ({
    tabs: [{ ...source, launchBrowserSessionId: state.profile }],
  }));
  api.tasks.localChromeTaskTab.mutate.mockResolvedValue({
    ...source,
    tabId: 100,
    selectionId: 'bcc8c303-9880-44d9-885e-51e13755933b',
  });
  api.tasks.localChromeLaunchAcknowledge.mutate.mockResolvedValue({ acknowledged: true });
  api.tasks.create.mutate.mockImplementation(
    async (body: { intent: string; localChrome: object }) => {
      expect(Object.keys(body.localChrome).sort()).toEqual([
        'expectedUrl',
        'extensionClientId',
        'launchBrowserSessionId',
        'selectionId',
        'tabId',
      ]);
      const row = {
        taskId: `tsk_durable_${state.rows.length + 1}`,
        status: 'executing',
        intent: body.intent,
        createdAt: new Date(),
        result: { executionMode: 'browser', metadata: { browserSource: 'local-chrome' } },
      };
      state.rows.push(row);
      if (state.loseResponse) {
        state.loseResponse = false;
        throw new Error('network timeout');
      }
      return {
        taskId: row.taskId,
        status: row.status,
        executionMode: 'browser',
        browserSource: 'local-chrome',
      };
    },
  );
  api.tasks.localChromeLaunchReceipt.query.mockImplementation(async () => {
    if (state.holdReceipt) {
      state.holdReceipt = false;
      await new Promise<void>((done) => {
        state.releaseReceipt = done;
      });
    }
    const row = state.rows[0];
    return row ? { state: 'created', taskId: row.taskId, status: row.status } : { state: 'absent' };
  });
  api.tasks.list.query.mockImplementation(async () => ({
    tasks: [...state.rows],
    nextCursor: null,
  }));
  api.tasks.detail.query.mockImplementation(async () => ({ ...state.rows[0], steps: [] }));
  useTaskStore.setState({ localChromeSelection: { ...source } });
});
afterEach(() => {
  useTaskStore.getState().reset();
  state.releaseReceipt?.();
  localStorage.clear();
  if (previousLocks) Object.defineProperty(navigator, 'locks', previousLocks);
  else Reflect.deleteProperty(navigator, 'locks');
});
it('creates under the pinned actor, then acknowledges without retaining a duplicate launch record', async () => {
  expect(await useTaskStore.getState().createTask('整理后台报表')).toEqual({
    taskId: 'tsk_durable_1',
  });
  expect(state.actors).toEqual(['fixture-actor-a']);
  expect(api.tasks.localChromeTaskTab.mutate).toHaveBeenCalledWith(
    expect.objectContaining({ mode: 'independent', resumeOnly: false }),
  );
  expect(api.tasks.localChromeLaunchAcknowledge.mutate).toHaveBeenCalledWith(
    expect.objectContaining({ taskId: 'tsk_durable_1', launchBrowserSessionId: profile }),
  );
  expect(
    Object.keys(localStorage).filter((k) => k.startsWith(BROWSER_LAUNCH_JOURNAL_PREFIX)),
  ).toEqual([]);
});
it('recovers a lost creation receipt after the UI session resets without a second tab or task', async () => {
  state.loseResponse = true;
  state.holdReceipt = true;
  expect(await useTaskStore.getState().createTask('整理后台报表')).toHaveProperty('error');
  await vi.waitFor(() => expect(state.releaseReceipt).toBeTypeOf('function'));
  useTaskStore.getState().reset();
  const recovery = useTaskStore.getState().refreshTasks();
  state.releaseReceipt!();
  await recovery;
  await vi.waitFor(() => expect(useTaskStore.getState().selectedTaskId).toBe('tsk_durable_1'));
  expect(api.tasks.create.mutate).toHaveBeenCalledTimes(1);
  expect(api.tasks.localChromeTaskTab.mutate).toHaveBeenCalledTimes(1);
  expect(state.rows).toHaveLength(1);
  expect(useTaskStore.getState().tasks.filter((t) => t.taskId === 'tsk_durable_1')).toHaveLength(1);
});
it('does not dispatch under another account after a late preparation receipt', async () => {
  let release!: (value: unknown) => void;
  api.tasks.localChromeTaskTab.mutate.mockReturnValueOnce(
    new Promise((done) => {
      release = done;
    }),
  );
  const operation = useTaskStore.getState().createTask('整理后台报表');
  await vi.waitFor(() => expect(api.tasks.localChromeTaskTab.mutate).toHaveBeenCalledTimes(1));
  state.token = 'fixture-actor-b';
  useTaskStore.getState().reset();
  release({ ...source, tabId: 100 });
  expect(await operation).toHaveProperty('error');
  expect(state.rows).toEqual([]);
  expect(state.actors).toEqual([]);
  expect(useTaskStore.getState().tasks).toEqual([]);
});
it('refuses a different browser session before preparing or creating', async () => {
  state.profile = 'a924f85c-8070-4020-a30c-7226bd95b415';
  expect(await useTaskStore.getState().createTask('整理后台报表')).toHaveProperty('error');
  expect(api.tasks.localChromeTaskTab.mutate).not.toHaveBeenCalled();
  expect(state.rows).toEqual([]);
});
it('keeps an explicit current-page request on the original target through durable preparation', async () => {
  api.tasks.localChromeTaskTab.mutate.mockResolvedValueOnce({
    ...source,
    selectionId: 'bcc8c303-9880-44d9-885e-51e13755933b',
  });
  expect(await useTaskStore.getState().createTask('处理当前页')).toHaveProperty(
    'taskId',
    'tsk_durable_1',
  );
  expect(api.tasks.localChromeTaskTab.mutate).toHaveBeenCalledWith(
    expect.objectContaining({ mode: 'current' }),
  );
  expect(api.tasks.create.mutate).toHaveBeenCalledWith(
    expect.objectContaining({ localChrome: expect.objectContaining({ tabId: 42 }) }),
  );
});

it('retains the durable preparation during loading and creates once after readiness', async () => {
  vi.useFakeTimers();
  try {
    api.tasks.localChromeTabs.query.mockResolvedValue({
      tabs: [{ ...source, preparationReadiness: true }],
    });
    api.tasks.localChromeTaskTab.mutate.mockImplementationOnce(async ({ preparationId }) => ({
      preparationState: 'loading',
      extensionClientId: source.extensionClientId,
      taskTabCreated: true,
      preparationId,
      sourceTabId: 42,
      sourceOrigin: source.expectedUrl,
      tabId: 100,
      launchBrowserSessionId: profile,
    }));
    useTaskStore.setState({
      localChromeSelection: { ...source, preparationReadiness: true },
    } as never);
    const operation = useTaskStore.getState().createTask('整理报表');
    await vi.waitFor(() => expect(api.tasks.localChromeTaskTab.mutate).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(1100);
    expect(await operation).toHaveProperty('taskId');
    expect(api.tasks.create.mutate).toHaveBeenCalledOnce();
    expect(api.tasks.localChromeTaskTab.mutate).toHaveBeenCalledTimes(2);
    const [first, second] = api.tasks.localChromeTaskTab.mutate.mock.calls;
    expect(first).toEqual(second);
    expect(first?.[0]).toHaveProperty('reportReadiness', true);
    expect(first?.[0].selection).not.toHaveProperty('preparationReadiness');
  } finally {
    vi.useRealTimers();
  }
});

it('stops automatic recovery after bounded loading checks while preserving the durable record', async () => {
  vi.useFakeTimers();
  try {
    api.tasks.localChromeTabs.query.mockResolvedValue({
      tabs: [{ ...source, preparationReadiness: true }],
    });
    api.tasks.localChromeTaskTab.mutate.mockImplementation(async ({ preparationId }) => ({
      preparationState: 'loading',
      extensionClientId: source.extensionClientId,
      taskTabCreated: true,
      preparationId,
      sourceTabId: 42,
      sourceOrigin: source.expectedUrl,
      tabId: 100,
      launchBrowserSessionId: profile,
    }));
    const operation = useTaskStore.getState().createTask('整理后台报表');
    await vi.waitFor(() => expect(api.tasks.localChromeTaskTab.mutate).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(2100);
    expect(await operation).toHaveProperty('error', expect.stringContaining('仍在加载'));
    expect(api.tasks.create.mutate).not.toHaveBeenCalled();
    const records = Object.keys(localStorage).filter((key) =>
      key.startsWith(BROWSER_LAUNCH_JOURNAL_PREFIX),
    );
    expect(records).toHaveLength(1);
    expect(JSON.parse(localStorage.getItem(records[0]!)!).phase).toBe('preparing');
    useTaskStore.getState().reset();
    const recovery = useTaskStore.getState().refreshTasks();
    await vi.waitFor(() => expect(api.tasks.localChromeTaskTab.mutate).toHaveBeenCalledTimes(4));
    await vi.advanceTimersByTimeAsync(2100);
    await recovery;
    expect(api.tasks.localChromeTaskTab.mutate).toHaveBeenCalledTimes(6);
    await vi.advanceTimersByTimeAsync(60000);
    expect(api.tasks.localChromeTaskTab.mutate).toHaveBeenCalledTimes(6);
    expect(api.tasks.create.mutate).not.toHaveBeenCalled();
    expect(api.tasks.localChromeTaskTab.mutate.mock.calls[3]?.[0].resumeOnly).toBe(true);
  } finally {
    vi.useRealTimers();
  }
});
