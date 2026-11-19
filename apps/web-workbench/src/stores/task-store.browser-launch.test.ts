import { trpc } from '@/lib/trpc';
import { beforeEach, expect, it, vi } from 'vitest';
import { useTaskStore } from './task-store';
vi.mock('@/lib/trpc', () => ({
  trpc: {
    tasks: {
      create: { mutate: vi.fn() },
      localChromeTaskTab: { mutate: vi.fn() },
      list: { query: vi.fn(async () => ({ tasks: [] })) },
    },
  },
}));
const source = {
  extensionClientId: 'connection',
  tabId: 42,
  expectedUrl: 'https://work.example',
  selectionId: 'e2215e8d-7b6c-4711-ab15-460f51e558a4',
  title: 'Work',
  backgroundTaskTabs: true,
  taskTabStart: true,
};
const prepared = {
  extensionClientId: 'connection',
  tabId: 91,
  expectedUrl: 'https://work.example',
  selectionId: '4488c303-9880-44d9-885e-51e13755933b',
  title: 'Work',
};
beforeEach(() => {
  vi.resetAllMocks();
  useTaskStore.getState().reset();
  useTaskStore.setState({ localChromeSelection: source });
  vi.mocked(trpc.tasks.localChromeTaskTab.mutate).mockResolvedValue(prepared);
  vi.mocked(trpc.tasks.create.mutate).mockResolvedValue({
    taskId: 'tsk_task',
    status: 'executing',
    browserSource: 'local-chrome',
  } as never);
});
it('prepares an independent tab before creating and strips UI metadata from the target', async () => {
  await useTaskStore.getState().createTask('整理报表');
  expect(trpc.tasks.localChromeTaskTab.mutate).toHaveBeenCalledWith({
    selection: {
      extensionClientId: 'connection',
      tabId: 42,
      expectedUrl: 'https://work.example',
      selectionId: 'e2215e8d-7b6c-4711-ab15-460f51e558a4',
    },
    preparationId: expect.any(String),
  });
  expect(trpc.tasks.create.mutate).toHaveBeenCalledWith(
    expect.objectContaining({
      localChrome: {
        extensionClientId: 'connection',
        tabId: 91,
        expectedUrl: 'https://work.example',
        selectionId: '4488c303-9880-44d9-885e-51e13755933b',
      },
    }),
  );
});
it('retains task and tab identity across an ambiguous create retry', async () => {
  vi.mocked(trpc.tasks.create.mutate).mockRejectedValueOnce(new Error('network timeout'));
  await useTaskStore.getState().createTask('整理报表');
  await useTaskStore.getState().createTask('整理报表');
  expect(trpc.tasks.localChromeTaskTab.mutate).toHaveBeenCalledTimes(1);
  const calls = vi.mocked(trpc.tasks.create.mutate).mock.calls;
  expect(calls).toHaveLength(2);
  expect(calls[0]?.[0]).toEqual(calls[1]?.[0]);
});
it('binds current-page wording without preparing another tab', async () => {
  await useTaskStore.getState().createTask('处理当前页');
  expect(trpc.tasks.localChromeTaskTab.mutate).not.toHaveBeenCalled();
  expect(trpc.tasks.create.mutate).toHaveBeenCalledWith(
    expect.objectContaining({ localChrome: expect.objectContaining({ tabId: 42 }) }),
  );
});
it('never falls back or marks a task unknown when preparation failed before create', async () => {
  vi.mocked(trpc.tasks.localChromeTaskTab.mutate).mockRejectedValue(new Error('请重新连接 Chrome'));
  expect(await useTaskStore.getState().createTask('整理报表')).toEqual({
    error: expect.stringMatching(/重新连接/),
  });
  expect(trpc.tasks.create.mutate).not.toHaveBeenCalled();
  expect(useTaskStore.getState().tasks).toHaveLength(0);
});
it('does not create under a new account after preparation finishes late', async () => {
  let resolve!: (target: typeof prepared) => void;
  vi.mocked(trpc.tasks.localChromeTaskTab.mutate).mockReturnValueOnce(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const operation = useTaskStore.getState().createTask('整理报表');
  await vi.waitFor(() => expect(trpc.tasks.localChromeTaskTab.mutate).toHaveBeenCalledTimes(1));
  useTaskStore.getState().reset();
  resolve(prepared);
  expect(await operation).toHaveProperty('error');
  expect(trpc.tasks.create.mutate).not.toHaveBeenCalled();
  expect(useTaskStore.getState().tasks).toHaveLength(0);
});

it('observes acknowledged loading with the original preparation before creating exactly once', async () => {
  vi.useFakeTimers();
  try {
    useTaskStore.setState({
      localChromeSelection: { ...source, preparationReadiness: true },
    } as never);
    vi.mocked(trpc.tasks.localChromeTaskTab.mutate).mockImplementationOnce(
      async ({ preparationId }) =>
        ({
          preparationState: 'loading',
          extensionClientId: source.extensionClientId,
          taskTabCreated: true,
          preparationId,
          sourceTabId: 42,
          sourceOrigin: source.expectedUrl,
          tabId: 91,
        }) as never,
    );
    const operation = useTaskStore.getState().createTask('整理报表');
    await vi.advanceTimersByTimeAsync(1100);
    expect(await operation).toHaveProperty('taskId', 'tsk_task');
    expect(trpc.tasks.localChromeTaskTab.mutate).toHaveBeenCalledTimes(2);
    const calls = vi.mocked(trpc.tasks.localChromeTaskTab.mutate).mock.calls;
    expect(calls[0]).toEqual(calls[1]);
    expect(calls[0]?.[0]).toHaveProperty('reportReadiness', true);
    expect(calls[0]?.[0].selection).not.toHaveProperty('preparationReadiness');
    expect(trpc.tasks.create.mutate).toHaveBeenCalledOnce();
  } finally {
    vi.useRealTimers();
  }
});
it('never creates after the bounded loading checks and retains the original preparation for later', async () => {
  vi.useFakeTimers();
  try {
    useTaskStore.setState({
      localChromeSelection: { ...source, preparationReadiness: true },
    } as never);
    vi.mocked(trpc.tasks.localChromeTaskTab.mutate).mockImplementation(
      async ({ preparationId }) =>
        ({
          preparationState: 'loading',
          extensionClientId: source.extensionClientId,
          taskTabCreated: true,
          preparationId,
          sourceTabId: 42,
          sourceOrigin: source.expectedUrl,
          tabId: 91,
        }) as never,
    );
    const operation = useTaskStore.getState().createTask('整理报表');
    await vi.advanceTimersByTimeAsync(2100);
    expect(await operation).toHaveProperty('error', expect.stringContaining('仍在加载'));
    expect(trpc.tasks.create.mutate).not.toHaveBeenCalled();
    expect(trpc.tasks.localChromeTaskTab.mutate).toHaveBeenCalledTimes(3);
    const firstId = vi.mocked(trpc.tasks.localChromeTaskTab.mutate).mock.calls[0]?.[0]
      .preparationId;
    vi.mocked(trpc.tasks.localChromeTaskTab.mutate).mockResolvedValue(prepared);
    expect(await useTaskStore.getState().createTask('整理报表')).toHaveProperty(
      'taskId',
      'tsk_task',
    );
    expect(vi.mocked(trpc.tasks.localChromeTaskTab.mutate).mock.calls[3]?.[0].preparationId).toBe(
      firstId,
    );
    expect(trpc.tasks.create.mutate).toHaveBeenCalledOnce();
  } finally {
    vi.useRealTimers();
  }
});

it('labels a genuinely unknown task creation as awaiting verification', async () => {
  vi.mocked(trpc.tasks.create.mutate).mockRejectedValueOnce(new Error('network timeout'));
  expect(await useTaskStore.getState().createTask('整理报表')).toHaveProperty('error');
  expect(useTaskStore.getState().tasks).toEqual([
    expect.objectContaining({ title: '任务创建待核实', status: 'unknown' }),
  ]);
  expect(trpc.tasks.create.mutate).toHaveBeenCalledOnce();
  expect(useTaskStore.getState().browserPreparationStatus).toBeNull();
});
