import { beforeEach, describe, expect, it, vi } from 'vitest';
import { trpc } from '@/lib/trpc';
import type { UiTask } from '@/types/task';
import {
  mergeFirstPageWithPreservedSelection,
  mergeTaskPagesReplacingDuplicates,
  normaliseDetailStepStatus,
  pruneRuntimeStateForTerminalTasks,
  toUiTask,
  useTaskStore,
} from './task-store';

vi.mock('@/lib/trpc', () => ({
  trpc: {
    tasks: {
      list: { query: vi.fn() },
      star: { mutate: vi.fn() },
    },
  },
}));

const listQuery = vi.mocked(trpc.tasks.list.query);
const starMutate = vi.mocked(trpc.tasks.star.mutate);

beforeEach(() => {
  listQuery.mockReset();
  starMutate.mockReset();
  useTaskStore.getState().reset();
});

describe('normaliseDetailStepStatus', () => {
  it('maps DB completed steps to done instead of failed', () => {
    expect(normaliseDetailStepStatus('completed')).toBe('done');
    expect(normaliseDetailStepStatus('done')).toBe('done');
    expect(normaliseDetailStepStatus('ok')).toBe('done');
  });

  it('keeps active DB step states running in the hydrated detail view', () => {
    expect(normaliseDetailStepStatus('pending')).toBe('running');
    expect(normaliseDetailStepStatus('executing')).toBe('running');
    expect(normaliseDetailStepStatus('awaiting_user')).toBe('running');
  });

  it('maps error-like states to failed', () => {
    expect(normaliseDetailStepStatus('failed')).toBe('failed');
    expect(normaliseDetailStepStatus('error')).toBe('failed');
  });

  it('keeps cancelled detail steps distinct from failures', () => {
    expect(normaliseDetailStepStatus('cancelled')).toBe('cancelled');
  });
});

describe('toUiTask', () => {
  it('hydrates persisted verifier failedChecks from tasks.list result JSON', () => {
    const task = toUiTask({
      taskId: 'tsk_partial',
      intent: '查价格并给来源',
      title: null,
      status: 'partial_success',
      result: {
        summary: '已找到部分结果',
        failedChecks: [
          { type: 'source_count', detail: '缺少来源链接' },
          { type: ' ', detail: 'ignored' },
          { type: 'price_sort' },
        ],
      },
      errorMessage: null,
      createdAt: new Date('2026-05-22T00:00:00Z'),
      opusUsed: false,
      starred: false,
      starredAt: null,
      projectId: null,
      verificationPassed: false,
      failureLevel: 'fixable',
    } as never);

    expect(task.failedChecks).toEqual([
      { type: 'source_count', detail: '缺少来源链接' },
    ]);
  });
});

describe('pruneRuntimeStateForTerminalTasks', () => {
  it('clears live-only status for terminal tasks from API refreshes', () => {
    const patch = pruneRuntimeStateForTerminalTasks(
      {
        terminalTaskIds: new Set<string>(),
        captchaWaitByTask: {
          tsk_done: {
            antiBotType: 'captcha',
            message: 'captcha',
            startedAt: 1,
            deadlineMs: 10,
          },
        },
        executorFallbackByTask: {
          tsk_done: { available: true, at: 1 },
        },
        degradeByTask: {
          tsk_done: {
            level: 1,
            strategy: 'profile_rotation',
            ok: true,
            message: 'rotated',
            handoffToExtension: false,
            at: 1,
          },
        },
        awaitingUserByTask: {
          tsk_done: { question: 'still there?', at: 1 },
        },
        streamingByTask: { tsk_done: 'old stream', tsk_live: 'keep stream' },
        progressByTask: { tsk_done: '正在验证结果…', tsk_live: 'keep progress' },
        subStatusByTask: {
          tsk_done: { subStatus: 'verifying', since: 1 },
          tsk_live: { subStatus: 'browsing', since: 1 },
        },
      },
      [
        {
          taskId: 'tsk_done',
          intent: 'done',
          title: null,
          status: 'completed',
          tickCount: 1,
          resultText: '完成',
          createdAt: new Date('2026-05-25T00:00:00.000Z'),
        },
        {
          taskId: 'tsk_live',
          intent: 'live',
          title: null,
          status: 'executing',
          tickCount: 1,
          createdAt: new Date('2026-05-25T00:00:00.000Z'),
        },
      ],
    );

    expect(patch.terminalTaskIds?.has('tsk_done')).toBe(true);
    expect(patch.subStatusByTask).toEqual({
      tsk_live: { subStatus: 'browsing', since: 1 },
    });
    expect(patch.streamingByTask).toEqual({ tsk_live: 'keep stream' });
    expect(patch.progressByTask).toEqual({ tsk_live: 'keep progress' });
    expect(patch.awaitingUserByTask).toEqual({});
    expect(patch.captchaWaitByTask).toEqual({});
    expect(patch.executorFallbackByTask).toEqual({});
    expect(patch.degradeByTask).toEqual({});
  });

  it('keeps streaming and progress as a bridge until result text is present', () => {
    const patch = pruneRuntimeStateForTerminalTasks(
      {
        terminalTaskIds: new Set<string>(),
        captchaWaitByTask: {},
        executorFallbackByTask: {},
        degradeByTask: {},
        awaitingUserByTask: {},
        streamingByTask: { tsk_done: 'bridge stream' },
        progressByTask: { tsk_done: 'bridge progress' },
        subStatusByTask: { tsk_done: { subStatus: 'verifying', since: 1 } },
      },
      [
        {
          taskId: 'tsk_done',
          intent: 'done',
          title: null,
          status: 'completed',
          tickCount: 1,
          createdAt: new Date('2026-05-25T00:00:00.000Z'),
        },
      ],
    );

    expect(patch.terminalTaskIds?.has('tsk_done')).toBe(true);
    expect(patch.subStatusByTask).toEqual({});
    expect(patch.streamingByTask).toBeUndefined();
    expect(patch.progressByTask).toBeUndefined();
  });
});

describe('task page merging', () => {
  it('replaces duplicate pagination rows in place with fresher server data', () => {
    const older = task({ taskId: 'tsk_dup', status: 'executing' });
    const stable = task({ taskId: 'tsk_stable', status: 'completed' });
    const fresh = task({
      taskId: 'tsk_dup',
      status: 'completed',
      resultText: 'fresh result',
    });
    const appended = task({ taskId: 'tsk_new', status: 'completed' });

    expect(mergeTaskPagesReplacingDuplicates([older, stable], [fresh, appended])).toEqual([
      fresh,
      stable,
      appended,
    ]);
  });

  it('keeps a preserved deep-link selection ahead of the first page once', () => {
    const selected = task({ taskId: 'tsk_selected', status: 'completed' });
    const first = task({ taskId: 'tsk_first', status: 'executing' });

    expect(mergeFirstPageWithPreservedSelection([first], selected)).toEqual([
      selected,
      first,
    ]);
    expect(mergeFirstPageWithPreservedSelection([selected, first], selected)).toEqual([
      selected,
      first,
    ]);
  });
});

describe('loadMoreTasks', () => {
  it('uses fresh duplicate rows and clears terminal live state from paginated API rows', async () => {
    listQuery.mockResolvedValueOnce({
      tasks: [
        taskRow({
          taskId: 'tsk_dup',
          status: 'completed',
          result: { summary: 'fresh result' },
        }),
        taskRow({ taskId: 'tsk_new', status: 'completed' }),
      ],
      nextCursor: null,
    });

    useTaskStore.setState({
      tasks: [
        task({ taskId: 'tsk_dup', status: 'executing' }),
        task({ taskId: 'tsk_stable', status: 'completed' }),
      ],
      tasksCursor: 51,
      tasksHasMore: true,
      loadingMore: false,
      terminalTaskIds: new Set<string>(),
      streamingByTask: { tsk_dup: 'old stream' },
      progressByTask: { tsk_dup: '正在验证结果…' },
      subStatusByTask: { tsk_dup: { subStatus: 'verifying', since: 1 } },
    });

    await useTaskStore.getState().loadMoreTasks();

    expect(listQuery).toHaveBeenCalledWith({ limit: 50, cursor: 51 });
    const state = useTaskStore.getState();
    expect(state.loadingMore).toBe(false);
    expect(state.tasksHasMore).toBe(false);
    expect(state.tasks.map((item) => item.taskId)).toEqual([
      'tsk_dup',
      'tsk_stable',
      'tsk_new',
    ]);
    expect(state.tasks[0]).toMatchObject({
      taskId: 'tsk_dup',
      status: 'completed',
      resultText: 'fresh result',
    });
    expect(state.terminalTaskIds.has('tsk_dup')).toBe(true);
    expect(state.streamingByTask.tsk_dup).toBeUndefined();
    expect(state.progressByTask.tsk_dup).toBeUndefined();
    expect(state.subStatusByTask.tsk_dup).toBeUndefined();
  });
});

describe('togglePin', () => {
  it('rethrows pin RPC failures after reverting local optimistic state', async () => {
    const task: UiTask = {
      taskId: 'tsk_pinned',
      intent: '查一下明天东京天气',
      title: null,
      status: 'completed',
      tickCount: 0,
      createdAt: new Date('2026-05-24T00:00:00.000Z'),
      starred: true,
      starredAt: new Date('2026-05-24T00:00:00.000Z'),
    };
    starMutate.mockRejectedValueOnce(new Error('offline'));
    useTaskStore.setState({ tasks: [task] });

    await expect(useTaskStore.getState().togglePin('tsk_pinned', false)).rejects.toThrow(
      'offline',
    );

    expect(useTaskStore.getState().tasks[0]?.starred).toBe(true);
    expect(starMutate).toHaveBeenCalledWith({ taskId: 'tsk_pinned', starred: false });
  });

  it('rethrows missing-row pin failures so callers can roll back their own lists', async () => {
    starMutate.mockRejectedValueOnce(new Error('offline'));

    await expect(useTaskStore.getState().togglePin('older_pin', false)).rejects.toThrow(
      'offline',
    );

    expect(starMutate).toHaveBeenCalledWith({ taskId: 'older_pin', starred: false });
  });
});

function task(overrides: Partial<UiTask> & { taskId: string }): UiTask {
  return {
    intent: 'test task',
    title: null,
    status: 'executing',
    tickCount: 0,
    createdAt: new Date('2026-05-25T00:00:00.000Z'),
    ...overrides,
  };
}

function taskRow(overrides: Record<string, unknown> & { taskId: string }): never {
  return {
    intent: 'test task',
    title: null,
    status: 'executing',
    result: null,
    errorMessage: null,
    createdAt: new Date('2026-05-25T00:00:00.000Z'),
    opusUsed: false,
    starred: false,
    starredAt: null,
    projectId: null,
    verificationPassed: null,
    failureLevel: null,
    ...overrides,
  } as never;
}
