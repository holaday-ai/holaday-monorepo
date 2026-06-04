import { beforeEach, describe, expect, it, vi } from 'vitest';
import { trpc } from '@/lib/trpc';
import type { UiTask } from '@/types/task';
import {
  mergeFirstPageWithPreservedSelection,
  mergeTaskPagesReplacingDuplicates,
  normalizeTaskDetailSteps,
  normalizeTaskListCursor,
  normalizeTaskListRows,
  normaliseDetailStepStatus,
  pruneRuntimeStateForTerminalTasks,
  setStoreNavigate,
  toUiTask,
  useTaskStore,
} from './task-store';

vi.mock('@/lib/trpc', () => ({
  trpc: {
    tasks: {
      list: { query: vi.fn() },
      detail: { query: vi.fn() },
      create: { mutate: vi.fn() },
      reply: { mutate: vi.fn() },
      delete: { mutate: vi.fn() },
      moveToProject: { mutate: vi.fn() },
      star: { mutate: vi.fn() },
    },
  },
}));

const listQuery = vi.mocked(trpc.tasks.list.query);
const detailQuery = vi.mocked(trpc.tasks.detail.query);
const createMutate = vi.mocked(trpc.tasks.create.mutate);
const replyMutate = vi.mocked(trpc.tasks.reply.mutate);
const deleteMutate = vi.mocked(trpc.tasks.delete.mutate);
const moveToProjectMutate = vi.mocked(trpc.tasks.moveToProject.mutate);
const starMutate = vi.mocked(trpc.tasks.star.mutate);

beforeEach(() => {
  listQuery.mockReset();
  detailQuery.mockReset();
  createMutate.mockReset();
  replyMutate.mockReset();
  deleteMutate.mockReset();
  moveToProjectMutate.mockReset();
  starMutate.mockReset();
  setStoreNavigate(null);
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

  it('normalizes malformed detail steps defensively', () => {
    expect(
      normalizeTaskDetailSteps(
        [
          null,
          {
            seq: 3,
            status: 'completed',
            kind: ' browse ',
            input: { summary: ' Open page ' },
            output: {
              durationMs: 1200,
              message: ' ok ',
              antiBot: {
                type: 'captcha',
                confidence: 'high',
                message: ' captcha seen ',
                rawMatch: 'should not leak',
              },
            },
            startedAt: '2026-05-25T00:00:00.000Z',
          },
          {
            seq: Number.POSITIVE_INFINITY,
            status: { unsafe: true },
            kind: { unsafe: true },
            input: { summary: { unsafe: true } },
            output: { durationMs: Number.POSITIVE_INFINITY },
            startedAt: 'not-a-date',
          },
        ],
        123,
      ),
    ).toEqual([
      {
        tickIndex: 3,
        status: 'done',
        actionKind: 'browse',
        actionSummary: 'Open page',
        durationMs: 1200,
        message: 'ok',
        antiBot: {
          type: 'captcha',
          confidence: 'high',
          message: 'captcha seen',
        },
        startedAt: Date.parse('2026-05-25T00:00:00.000Z'),
      },
      {
        tickIndex: 2,
        status: 'running',
        actionKind: 'step',
        actionSummary: 'step',
        durationMs: 0,
        startedAt: 123,
      },
    ]);
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

  it('humanises failed task result reasons from tasks.list rows', () => {
    const task = toUiTask({
      taskId: 'tsk_failed_reason',
      intent: '打开网页',
      title: null,
      status: 'failed',
      result: {
        reason: 'Protocol error (Page.navigate): Target closed',
      },
      errorMessage: null,
      createdAt: new Date('2026-05-22T00:00:00Z'),
      opusUsed: false,
      starred: false,
      starredAt: null,
      projectId: null,
      verificationPassed: null,
      failureLevel: null,
    } as never);

    expect(task.resultText).toBe('浏览器连接中断，请重新执行任务。');
  });

  it('normalizes malformed task list rows safely', () => {
    expect(
      normalizeTaskListRows([
        null,
        { taskId: '', intent: 'missing id' },
        {
          taskId: ' tsk_valid ',
          intent: '  Build launch report  ',
          title: '  Launch report  ',
          status: 'completed',
          createdAt: ' 2026-05-25T00:00:00.000Z ',
          starred: true,
          starredAt: ' 2026-05-25T00:01:00.000Z ',
          projectId: ' prj_1 ',
        },
        {
          taskId: 'tsk_fallback',
          intent: { unsafe: true },
          title: { unsafe: true },
          status: { unsafe: true },
          createdAt: { unsafe: true },
          starredAt: 'not-a-date',
          projectId: { unsafe: true },
        },
      ]),
    ).toMatchObject([
      {
        taskId: 'tsk_valid',
        intent: 'Build launch report',
        title: 'Launch report',
        status: 'completed',
        starred: true,
        projectId: 'prj_1',
      },
      {
        taskId: 'tsk_fallback',
        intent: '未命名任务',
        title: null,
        status: 'queued',
        starredAt: null,
        projectId: null,
      },
    ]);
  });

  it('treats malformed task lists and cursors as empty', () => {
    expect(normalizeTaskListRows({ tasks: [] })).toEqual([]);
    expect(normalizeTaskListCursor(51)).toBe(51);
    expect(normalizeTaskListCursor(0)).toBeNull();
    expect(normalizeTaskListCursor('51')).toBeNull();
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

describe('refreshTaskList', () => {
  it('survives malformed first-page rows and cursor values', async () => {
    listQuery.mockResolvedValueOnce({
      tasks: [
        { taskId: '', intent: 'missing id' },
        {
          taskId: 'tsk_boot',
          intent: { unsafe: true },
          title: { unsafe: true },
          status: { unsafe: true },
          createdAt: { unsafe: true },
        },
      ],
      nextCursor: 'bad-cursor',
    } as never);

    await useTaskStore.getState().refreshTaskList();

    const state = useTaskStore.getState();
    expect(state.loading).toBe(false);
    expect(state.error).toBeNull();
    expect(state.tasksHasMore).toBe(false);
    expect(state.tasksCursor).toBeNull();
    expect(state.tasks).toHaveLength(1);
    expect(state.tasks[0]).toMatchObject({
      taskId: 'tsk_boot',
      intent: '未命名任务',
      title: null,
      status: 'queued',
    });
  });
});

describe('selectTask detail hydration', () => {
  it('clears browser takeover state when switching tasks', () => {
    detailQuery.mockResolvedValueOnce({
      intent: '打开 https://example.com',
      title: null,
      status: 'executing',
      createdAt: '2026-05-29T00:00:00.000Z',
      steps: [],
    } as never);
    useTaskStore.setState({
      tasks: [
        task({ taskId: 'tsk_old', status: 'executing' }),
        task({ taskId: 'tsk_new', status: 'executing' }),
      ],
      selectedTaskId: 'tsk_old',
      composerMode: 'task',
      browserInteractive: true,
    });

    useTaskStore.getState().selectTask('tsk_new', 'ui');

    expect(useTaskStore.getState()).toMatchObject({
      selectedTaskId: 'tsk_new',
      composerMode: 'task',
      browserInteractive: false,
    });
  });

  it('clears browser takeover state when entering new-task mode', () => {
    useTaskStore.setState({
      selectedTaskId: 'tsk_old',
      composerMode: 'task',
      browserInteractive: true,
    });

    useTaskStore.getState().enterNewTaskMode();

    expect(useTaskStore.getState()).toMatchObject({
      selectedTaskId: null,
      composerMode: 'new',
      browserInteractive: false,
    });
  });

  it('clears browser takeover state when creating a fresh task', async () => {
    createMutate.mockResolvedValueOnce({
      taskId: 'tsk_new',
      status: 'executing',
      executionMode: 'browser',
    } as never);
    listQuery.mockResolvedValueOnce({ tasks: [], nextCursor: null } as never);
    useTaskStore.setState({
      selectedTaskId: 'tsk_old',
      composerMode: 'task',
      browserInteractive: true,
    });

    await expect(
      useTaskStore.getState().createTask('打开 https://example.com', []),
    ).resolves.toEqual({ taskId: 'tsk_new' });

    expect(useTaskStore.getState()).toMatchObject({
      selectedTaskId: 'tsk_new',
      composerMode: 'task',
      browserInteractive: false,
    });
  });

  it('sends a default viewport profile for non-workbench create entry points', async () => {
    createMutate.mockResolvedValueOnce({
      taskId: 'tsk_new',
      status: 'executing',
      executionMode: 'browser',
    } as never);
    listQuery.mockResolvedValueOnce({ tasks: [], nextCursor: null } as never);

    await useTaskStore.getState().createTask('打开 https://example.com', []);

    expect(createMutate).toHaveBeenCalledWith({
      intent: '打开 https://example.com',
      viewportProfile: 'desktop',
    });
  });

  it('keeps an explicit viewport profile from the workbench panel wrapper', async () => {
    createMutate.mockResolvedValueOnce({
      taskId: 'tsk_new',
      status: 'executing',
      executionMode: 'browser',
    } as never);
    listQuery.mockResolvedValueOnce({ tasks: [], nextCursor: null } as never);

    await useTaskStore
      .getState()
      .createTask('打开 https://example.com', [], undefined, undefined, undefined, 'sidepanel');

    expect(createMutate).toHaveBeenCalledWith({
      intent: '打开 https://example.com',
      viewportProfile: 'sidepanel',
    });
  });

  it('survives malformed detail rows and synthesizes a safe selected task', async () => {
    detailQuery.mockResolvedValueOnce({
      intent: { unsafe: true },
      title: { unsafe: true },
      status: { unsafe: true },
      createdAt: { unsafe: true },
      steps: { unsafe: true },
      planText: { unsafe: true },
      planStatus: [{ idx: 'bad', status: 'done' }],
      awaitingQuestion: { unsafe: true },
      result: {
        summary: '  Done summary  ',
        finalScreenshot: { unsafe: true },
        finalUrl: { unsafe: true },
        metadata: {
          attachments: [{ fileId: 'bad' }],
          expertWorkflowId: { unsafe: true },
          expertMode: 'bad',
        },
      },
      verificationPassed: 'bad',
      failureLevel: 'bad',
    } as never);

    useTaskStore.getState().selectTask('tsk_detail', 'ui');
    await flushPromises();

    const state = useTaskStore.getState();
    expect(state.error).toBeNull();
    expect(state.stepsByTask.tsk_detail).toEqual([]);
    expect(state.tasks[0]).toMatchObject({
      taskId: 'tsk_detail',
      intent: '未命名任务',
      title: null,
      status: 'queued',
      resultText: 'Done summary',
      createdAt: new Date(0),
      starredAt: null,
      projectId: null,
      verificationPassed: null,
      failureLevel: null,
    });
    expect(state.tasks[0]?.attachments).toBeUndefined();
    expect(state.tasks[0]?.planStatus).toBeUndefined();
    expect(state.awaitingUserByTask.tsk_detail).toBeUndefined();
  });

  it('uses humanised detail errorMessage when failed detail has no result reason', async () => {
    detailQuery.mockResolvedValueOnce({
      intent: '打开网页',
      title: null,
      status: 'failed',
      createdAt: '2026-05-22T00:00:00.000Z',
      steps: [],
      result: null,
      errorMessage: 'Protocol error (Page.navigate): Target closed',
      verificationPassed: null,
      failureLevel: null,
    } as never);

    useTaskStore.getState().selectTask('tsk_failed_detail', 'ui');
    await flushPromises();

    expect(useTaskStore.getState().tasks[0]).toMatchObject({
      taskId: 'tsk_failed_detail',
      status: 'failed',
      resultText: '浏览器连接中断，请重新执行任务。',
    });
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

  it('ignores malformed pagination rows and cursors without failing the sidebar', async () => {
    listQuery.mockResolvedValueOnce({
      tasks: [
        null,
        { taskId: '', intent: 'missing id' },
        {
          taskId: 'tsk_next',
          intent: { unsafe: true },
          status: { unsafe: true },
          createdAt: { unsafe: true },
        },
      ],
      nextCursor: 'bad-cursor',
    } as never);

    useTaskStore.setState({
      tasks: [task({ taskId: 'tsk_existing', status: 'completed' })],
      tasksCursor: 51,
      tasksHasMore: true,
      loadingMore: false,
    });

    await useTaskStore.getState().loadMoreTasks();

    const state = useTaskStore.getState();
    expect(state.loadingMore).toBe(false);
    expect(state.tasksHasMore).toBe(false);
    expect(state.tasksCursor).toBeNull();
    expect(state.tasks.map((item) => item.taskId)).toEqual([
      'tsk_existing',
      'tsk_next',
    ]);
    expect(state.tasks[1]).toMatchObject({
      intent: '未命名任务',
      status: 'queued',
    });
  });
});

describe('moveTaskToProject', () => {
  it('returns an error and rolls back when the project move fails', async () => {
    const original = task({
      taskId: 'tsk_move',
      status: 'completed',
      projectId: 'proj_a',
    });
    moveToProjectMutate.mockRejectedValueOnce(new Error('offline'));
    useTaskStore.setState({ tasks: [original], error: null });

    await expect(
      useTaskStore.getState().moveTaskToProject('tsk_move', 'proj_b'),
    ).resolves.toEqual({ error: '任务执行出错，请重试。如果反复出现请联系 support@holaday.ai。' });

    expect(moveToProjectMutate).toHaveBeenCalledWith({
      taskId: 'tsk_move',
      projectId: 'proj_b',
    });
    expect(useTaskStore.getState().tasks[0]?.projectId).toBe('proj_a');
    expect(useTaskStore.getState().error).toBe(
      '任务执行出错，请重试。如果反复出现请联系 support@holaday.ai。',
    );
  });

  it('keeps the optimistic project move when the server accepts it', async () => {
    moveToProjectMutate.mockResolvedValueOnce({ ok: true } as never);
    useTaskStore.setState({
      tasks: [
        task({ taskId: 'tsk_move', status: 'completed', projectId: 'proj_a' }),
      ],
    });

    await expect(
      useTaskStore.getState().moveTaskToProject('tsk_move', null),
    ).resolves.toEqual({ ok: true });

    expect(useTaskStore.getState().tasks[0]?.projectId).toBeNull();
  });
});

describe('deleteTask', () => {
  it('removes the active task and clears the task URL', async () => {
    const navigate = vi.fn();
    setStoreNavigate(navigate);
    deleteMutate.mockResolvedValueOnce({ ok: true } as never);
    useTaskStore.setState({
      tasks: [
        task({ taskId: 'tsk_active', status: 'completed' }),
        task({ taskId: 'tsk_other', status: 'completed' }),
      ],
      selectedTaskId: 'tsk_active',
      composerMode: 'task',
    });

    await expect(useTaskStore.getState().deleteTask('tsk_active')).resolves.toEqual({
      ok: true,
    });

    expect(deleteMutate).toHaveBeenCalledWith({ taskId: 'tsk_active' });
    expect(useTaskStore.getState().tasks.map((item) => item.taskId)).toEqual([
      'tsk_other',
    ]);
    expect(useTaskStore.getState().selectedTaskId).toBeNull();
    expect(useTaskStore.getState().composerMode).toBe('new');
    expect(navigate).toHaveBeenCalledWith(null);
  });

  it('keeps the current selection when deleting another task', async () => {
    const navigate = vi.fn();
    setStoreNavigate(navigate);
    deleteMutate.mockResolvedValueOnce({ ok: true } as never);
    useTaskStore.setState({
      tasks: [
        task({ taskId: 'tsk_active', status: 'completed' }),
        task({ taskId: 'tsk_other', status: 'completed' }),
      ],
      selectedTaskId: 'tsk_active',
      composerMode: 'task',
    });

    await expect(useTaskStore.getState().deleteTask('tsk_other')).resolves.toEqual({
      ok: true,
    });

    expect(useTaskStore.getState().selectedTaskId).toBe('tsk_active');
    expect(useTaskStore.getState().composerMode).toBe('task');
    expect(navigate).not.toHaveBeenCalled();
  });

  it('clears every per-task runtime cache when deleting the active task', async () => {
    deleteMutate.mockResolvedValueOnce({ ok: true } as never);
    useTaskStore.setState({
      tasks: [task({ taskId: 'tsk_active', status: 'executing' })],
      selectedTaskId: 'tsk_active',
      composerMode: 'task',
      browserInteractive: true,
      stepsByTask: {
        tsk_active: [{ tickIndex: 1, status: 'running', startedAt: 1 }],
      },
      screencastByTask: {
        tsk_active: {
          tickIndex: 1,
          imageBase64: 'frame',
          url: 'https://example.com',
          viewport: { width: 100, height: 100 },
          timestamp: '2026-05-25T00:00:00.000Z',
        },
      },
      captchaWaitByTask: {
        tsk_active: {
          antiBotType: 'captcha',
          message: 'captcha',
          deadlineMs: 1000,
          startedAt: 1,
        },
      },
      executorFallbackByTask: { tsk_active: { available: false, at: 1 } },
      degradeByTask: {
        tsk_active: {
          level: 2,
          strategy: 'extension',
          ok: false,
          message: 'fallback',
          at: 1,
        },
      },
      awaitingUserByTask: {
        tsk_active: { question: 'Continue?', at: 1, awaitingKind: 'clarification' },
      },
      userRepliesByTask: { tsk_active: [{ at: 1, text: 'yes' }] },
      webSearchByTask: {
        tsk_active: { iteration: 1, query: 'holaday', at: 1 },
      },
      thinkingByTask: { tsk_active: { summary: 'thinking', at: 1 } },
      suggestionsByTask: { tsk_active: ['follow up'] },
      streamingByTask: { tsk_active: 'stream' },
      progressByTask: { tsk_active: 'working' },
      subStatusByTask: {
        tsk_active: { subStatus: 'planning', since: 1 },
      },
      terminalTaskIds: new Set(['tsk_active', 'tsk_keep']),
      animatedTaskIds: new Set(['tsk_active', 'tsk_keep']),
    });

    await expect(useTaskStore.getState().deleteTask('tsk_active')).resolves.toEqual({
      ok: true,
    });

    const state = useTaskStore.getState();
    expect(state.selectedTaskId).toBeNull();
    expect(state.composerMode).toBe('new');
    expect(state.browserInteractive).toBe(false);
    expect(state.stepsByTask.tsk_active).toBeUndefined();
    expect(state.screencastByTask.tsk_active).toBeUndefined();
    expect(state.captchaWaitByTask.tsk_active).toBeUndefined();
    expect(state.executorFallbackByTask.tsk_active).toBeUndefined();
    expect(state.degradeByTask.tsk_active).toBeUndefined();
    expect(state.awaitingUserByTask.tsk_active).toBeUndefined();
    expect(state.userRepliesByTask.tsk_active).toBeUndefined();
    expect(state.webSearchByTask.tsk_active).toBeUndefined();
    expect(state.thinkingByTask.tsk_active).toBeUndefined();
    expect(state.suggestionsByTask.tsk_active).toBeUndefined();
    expect(state.streamingByTask.tsk_active).toBeUndefined();
    expect(state.progressByTask.tsk_active).toBeUndefined();
    expect(state.subStatusByTask.tsk_active).toBeUndefined();
    expect([...state.terminalTaskIds]).toEqual(['tsk_keep']);
    expect([...state.animatedTaskIds]).toEqual(['tsk_keep']);
  });
});

describe('replyToTask', () => {
  it('optimistically clears awaiting browser handoff state when a reply resumes execution', async () => {
    replyMutate.mockResolvedValueOnce({ ok: true, state: 'resumed' });
    useTaskStore.setState({
      tasks: [
        task({
          taskId: 'tsk_wait',
          status: 'awaiting_user',
          awaitingKind: 'login',
          executionMode: 'browser',
        }),
      ],
      awaitingUserByTask: {
        tsk_wait: {
          question: '登录完成后告诉我',
          at: 1,
          awaitingKind: 'login',
        },
      },
      captchaWaitByTask: {
        tsk_wait: {
          antiBotType: 'captcha',
          message: '验证',
          startedAt: 1,
          deadlineMs: 2,
        },
      },
    });

    await expect(
      useTaskStore.getState().replyToTask('tsk_wait', '登录好了', []),
    ).resolves.toEqual({ ok: true });

    const state = useTaskStore.getState();
    expect(state.awaitingUserByTask.tsk_wait).toBeUndefined();
    expect(state.captchaWaitByTask.tsk_wait).toBeUndefined();
    expect(state.tasks[0]?.status).toBe('executing');
    expect(state.tasks[0]?.awaitingKind).toBeUndefined();
    expect(state.userRepliesByTask.tsk_wait?.[0]?.text).toBe('登录好了');
  });

  it('preserves awaiting state when the reply says to keep waiting', async () => {
    replyMutate.mockResolvedValueOnce({ ok: true, state: 'stillAwaiting' });
    useTaskStore.setState({
      tasks: [
        task({
          taskId: 'tsk_wait',
          status: 'awaiting_user',
          awaitingKind: 'browser_action',
          executionMode: 'browser',
        }),
      ],
      awaitingUserByTask: {
        tsk_wait: {
          question: '完成操作后告诉我',
          at: 1,
          awaitingKind: 'browser_action',
        },
      },
    });

    await expect(
      useTaskStore.getState().replyToTask('tsk_wait', '等一下', []),
    ).resolves.toEqual({ ok: true });

    const state = useTaskStore.getState();
    expect(state.awaitingUserByTask.tsk_wait?.awaitingKind).toBe('browser_action');
    expect(state.tasks[0]?.status).toBe('awaiting_user');
    expect(state.tasks[0]?.awaitingKind).toBe('browser_action');
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

async function flushPromises(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
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
