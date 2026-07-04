import { beforeEach, describe, expect, it, vi } from 'vitest';
import { trpc } from '@/lib/trpc';
import { showImageOption } from '@/lib/video-history-row';
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
      abort: { mutate: vi.fn() },
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
const abortMutate = vi.mocked(trpc.tasks.abort.mutate);
const deleteMutate = vi.mocked(trpc.tasks.delete.mutate);
const moveToProjectMutate = vi.mocked(trpc.tasks.moveToProject.mutate);
const starMutate = vi.mocked(trpc.tasks.star.mutate);

beforeEach(() => {
  listQuery.mockReset();
  detailQuery.mockReset();
  createMutate.mockReset();
  replyMutate.mockReset();
  abortMutate.mockReset();
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
  it('preserves persisted pre-execution statuses for the product state machine', () => {
    for (const status of ['pending', 'planning', 'queued'] as const) {
      const task = toUiTask({
        taskId: `tsk_${status}`,
        intent: '准备执行任务',
        title: null,
        status,
        result: null,
        errorMessage: null,
        createdAt: new Date('2026-06-04T00:00:00Z'),
        opusUsed: false,
        starred: false,
        starredAt: null,
        projectId: null,
        verificationPassed: null,
        failureLevel: null,
      } as never);

      expect(task.status).toBe(status);
    }
  });

  it('normalizes unrecognized persisted task statuses to unknown', () => {
    const task = toUiTask({
      taskId: 'tsk_mystery',
      intent: '未知状态任务',
      title: null,
      status: 'archived',
      result: null,
      errorMessage: null,
      createdAt: new Date('2026-06-04T00:00:00Z'),
      opusUsed: false,
      starred: false,
      starredAt: null,
      projectId: null,
      verificationPassed: null,
      failureLevel: null,
    } as never);

    expect(task.status).toBe('unknown');
  });

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

  it('hides internal terminal metadata JSON from persisted result summaries', () => {
    const task = toUiTask({
      taskId: 'tsk_metadata_tail',
      intent: '使用在线计算器',
      title: null,
      status: 'completed',
      result: {
        summary: [
          '结果已显示：',
          '',
          '页面上清楚呈现了 **(128 + 256) / 3 = 128**',
          JSON.stringify({
            model: 'claude-sonnet-4-6',
            finalUrl: 'https://web2.0calc.com/',
            elapsedMs: 35631,
            toolsUsed: ['navigate', 'computer'],
            expertMode: 'auto',
            iterations: 6,
            attachments: [{ kind: 'screenshot', fileId: 'file_123' }],
            selectedRole: null,
            executionMode: 'browser',
            fallbackChain: ['browser'],
            modelFinalText: '结果已显示：页面上清楚呈现了...',
            expertWorkflowId: null,
            awaitingUserCount: 0,
            finalExecutionMode: 'browser',
            hasFinalScreenshot: true,
          }),
        ].join('\n'),
      },
      errorMessage: null,
      createdAt: new Date('2026-06-04T00:00:00Z'),
      opusUsed: false,
      starred: false,
      starredAt: null,
      projectId: null,
      verificationPassed: true,
      failureLevel: null,
    } as never);

    expect(task.resultText).toBe(
      '结果已显示：\n\n页面上清楚呈现了 **(128 + 256) / 3 = 128**',
    );
    expect(task.resultText).not.toContain('"model"');
    expect(task.resultText).not.toContain('"finalUrl"');
  });

  it('hydrates final browser evidence from tasks.list result rows', () => {
    const task = toUiTask({
      taskId: 'tsk_browser_evidence',
      intent: '打开移动页面',
      title: null,
      status: 'completed',
      result: {
        summary: 'Done',
        finalScreenshot: 'base64-jpeg',
        finalUrl: 'https://example.com/',
        metadata: {
          finalViewport: { width: 390, height: 844 },
        },
      },
      errorMessage: null,
      createdAt: new Date('2026-06-05T00:00:00Z'),
      opusUsed: false,
      starred: false,
      starredAt: null,
      projectId: null,
      verificationPassed: true,
      failureLevel: null,
    } as never);

    expect(task).toMatchObject({
      finalScreenshot: 'base64-jpeg',
      finalUrl: 'https://example.com/',
      finalViewport: { width: 390, height: 844 },
    });
  });

  // B2 regression guard — the REAL chain, not the showImageOption pure unit.
  // A quote task (awaiting video_quote) carries metadata.videoOptions.tab and
  // NO top-level metadata.videoType (videoType is only stamped on the
  // generation task). This proves toUiTask's `videoType ?? videoOptions.tab`
  // fallback maps the tab literal → videoType → 图片版 gate end-to-end. If the
  // fallback or the tab token ever drifts, the direct-feed showImageOption
  // tests stay green but THIS one breaks.
  it.each([
    { tab: 'ip_person', expectVideoType: 'ip_person', expectImageOption: false },
    { tab: 'normal', expectVideoType: 'normal', expectImageOption: true },
    { tab: 'pet', expectVideoType: 'pet', expectImageOption: true },
  ])(
    'quote task with only videoOptions.tab=$tab → toUiTask videoType=$expectVideoType → 图片版 shown=$expectImageOption',
    ({ tab, expectVideoType, expectImageOption }) => {
      const task = toUiTask({
        taskId: `tsk_quote_${tab}`,
        intent: '夏天防晒文案',
        title: null,
        status: 'awaiting_user',
        result: {
          metadata: {
            lane: 'video_creation_confirm',
            // NB: no top-level videoType — only the tab, like the real quote task.
            videoOptions: { tab },
          },
        },
        errorMessage: null,
        createdAt: new Date('2026-06-21T00:00:00Z'),
        opusUsed: false,
        starred: false,
        starredAt: null,
        projectId: null,
        verificationPassed: null,
        failureLevel: null,
      } as never);

      expect(task.videoType).toBe(expectVideoType);
      expect(showImageOption(task.videoType)).toBe(expectImageOption);
    },
  );

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
        status: 'unknown',
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
        thinkingByTask: {
          tsk_done: { summary: 'still thinking', at: 1 },
          tsk_live: { summary: 'keep thinking', at: 1 },
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
    expect(patch.thinkingByTask).toEqual({
      tsk_live: { summary: 'keep thinking', at: 1 },
    });
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
        thinkingByTask: {},
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

  it('keeps local terminal rows when pagination returns stale active duplicates', () => {
    const terminal = task({
      taskId: 'tsk_dup',
      status: 'completed',
      resultText: 'live result',
    });
    const stale = task({
      taskId: 'tsk_dup',
      status: 'executing',
      resultText: 'stale result',
    });
    const appended = task({ taskId: 'tsk_new', status: 'completed' });

    expect(mergeTaskPagesReplacingDuplicates([terminal], [stale, appended])).toEqual([
      terminal,
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
  it('does not let stale active first-page rows overwrite live terminal tasks', async () => {
    listQuery.mockResolvedValueOnce({
      tasks: [
        taskRow({
          taskId: 'tsk_list_race',
          status: 'executing',
          result: { summary: '旧列表内容' },
        }),
      ],
      nextCursor: null,
    } as never);
    useTaskStore.setState({
      tasks: [
        task({
          taskId: 'tsk_list_race',
          status: 'completed',
          resultText: '实时终态',
        }),
      ],
      terminalTaskIds: new Set(['tsk_list_race']),
    });

    await useTaskStore.getState().refreshTaskList();

    const state = useTaskStore.getState();
    expect(state.tasks[0]).toMatchObject({
      taskId: 'tsk_list_race',
      status: 'completed',
      resultText: '实时终态',
    });
    expect(state.terminalTaskIds.has('tsk_list_race')).toBe(true);
  });

  it('clears stale live buffers when a refreshed list row is awaiting_user', async () => {
    listQuery.mockResolvedValueOnce({
      tasks: [
        taskRow({
          taskId: 'tsk_wait_refresh',
          status: 'awaiting_user',
          result: { summary: '等待用户操作' },
        }),
      ],
      nextCursor: null,
    } as never);
    detailQuery.mockReturnValueOnce(new Promise(() => {}) as never);
    useTaskStore.setState({
      selectedTaskId: 'tsk_wait_refresh',
      composerMode: 'task',
      tasks: [task({ taskId: 'tsk_wait_refresh', status: 'executing' })],
      progressByTask: { tsk_wait_refresh: '旧进度' },
      streamingByTask: { tsk_wait_refresh: '旧流式内容' },
      subStatusByTask: {
        tsk_wait_refresh: { subStatus: 'browsing', since: 1 },
      },
      thinkingByTask: {
        tsk_wait_refresh: { summary: '旧思考', at: 1 },
      },
      captchaWaitByTask: {
        tsk_wait_refresh: {
          antiBotType: 'captcha',
          message: '旧验证码',
          startedAt: 1,
          deadlineMs: 2,
        },
      },
    });

    await useTaskStore.getState().refreshTaskList();

    const state = useTaskStore.getState();
    expect(state.tasks[0]).toMatchObject({
      taskId: 'tsk_wait_refresh',
      status: 'awaiting_user',
    });
    expect(state.progressByTask.tsk_wait_refresh).toBeUndefined();
    expect(state.streamingByTask.tsk_wait_refresh).toBeUndefined();
    expect(state.subStatusByTask.tsk_wait_refresh).toBeUndefined();
    expect(state.thinkingByTask.tsk_wait_refresh).toBeUndefined();
    expect(state.captchaWaitByTask.tsk_wait_refresh).toBeUndefined();
  });

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
      status: 'unknown',
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

  it('shows a local pending task row while createTask is in flight', async () => {
    let resolveCreate!: (value: unknown) => void;
    const createPromise = new Promise((resolve) => {
      resolveCreate = resolve;
    });
    createMutate.mockReturnValueOnce(createPromise as never);
    listQuery.mockResolvedValueOnce({ tasks: [], nextCursor: null } as never);

    const resultPromise = useTaskStore.getState().createTask('打开 https://example.com', []);
    const pending = useTaskStore.getState().tasks[0];

    expect(pending).toMatchObject({
      intent: '打开 https://example.com',
      title: '正在创建任务',
      status: 'executing',
      tickCount: 0,
    });
    expect(pending?.taskId).toMatch(/^local_pending_/);
    expect(useTaskStore.getState().selectedTaskId).toBeNull();

    useTaskStore.getState().selectTask(pending!.taskId, 'ui');
    expect(useTaskStore.getState().selectedTaskId).toBeNull();

    resolveCreate({
      taskId: 'tsk_new',
      status: 'executing',
      executionMode: 'browser',
    });

    await expect(resultPromise).resolves.toEqual({ taskId: 'tsk_new' });
    expect(useTaskStore.getState().tasks.some((t) => t.taskId.startsWith('local_pending_'))).toBe(false);
    expect(useTaskStore.getState().tasks[0]).toMatchObject({
      taskId: 'tsk_new',
      title: null,
    });
    expect(['executing', 'queued']).toContain(useTaskStore.getState().tasks[0]?.status);
  });

  it('removes the local pending task row when createTask fails', async () => {
    createMutate.mockRejectedValueOnce(new Error('offline') as never);

    const resultPromise = useTaskStore.getState().createTask('打开 https://example.com', []);
    expect(useTaskStore.getState().tasks[0]?.taskId).toMatch(/^local_pending_/);

    await expect(resultPromise).resolves.toMatchObject({ error: expect.any(String) });
    expect(useTaskStore.getState().tasks.some((t) => t.taskId.startsWith('local_pending_'))).toBe(false);
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

  it('uses the current workbench viewport profile for direct retry entry points', async () => {
    createMutate.mockResolvedValueOnce({
      taskId: 'tsk_new',
      status: 'executing',
      executionMode: 'browser',
    } as never);
    listQuery.mockResolvedValueOnce({ tasks: [], nextCursor: null } as never);
    useTaskStore.getState().setDefaultViewportProfile('mobile');

    await useTaskStore.getState().createTask('打开 https://example.com', []);

    expect(createMutate).toHaveBeenCalledWith({
      intent: '打开 https://example.com',
      viewportProfile: 'mobile',
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
      status: 'unknown',
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

  it('clears stale live buffers when hydrated detail parks in awaiting_user', async () => {
    detailQuery.mockResolvedValueOnce({
      intent: '打开网页',
      title: null,
      status: 'awaiting_user',
      awaitingQuestion: '请先登录后继续',
      awaitingKind: 'login',
      createdAt: '2026-05-22T00:00:00.000Z',
      steps: [],
      result: { summary: '旧等待说明' },
      verificationPassed: null,
      failureLevel: null,
    } as never);
    useTaskStore.setState({
      tasks: [task({ taskId: 'tsk_detail_wait', status: 'executing' })],
      progressByTask: { tsk_detail_wait: '旧进度' },
      streamingByTask: { tsk_detail_wait: '旧流式内容' },
      subStatusByTask: {
        tsk_detail_wait: { subStatus: 'browsing', since: 1 },
      },
      thinkingByTask: {
        tsk_detail_wait: { summary: '旧思考', at: 1 },
      },
    });

    useTaskStore.getState().selectTask('tsk_detail_wait', 'ui');
    await flushPromises();

    const state = useTaskStore.getState();
    expect(state.tasks[0]).toMatchObject({
      taskId: 'tsk_detail_wait',
      status: 'awaiting_user',
      awaitingKind: 'login',
    });
    expect(state.awaitingUserByTask.tsk_detail_wait).toMatchObject({
      question: '请先登录后继续',
      awaitingKind: 'login',
    });
    expect(state.progressByTask.tsk_detail_wait).toBeUndefined();
    expect(state.streamingByTask.tsk_detail_wait).toBeUndefined();
    expect(state.subStatusByTask.tsk_detail_wait).toBeUndefined();
    expect(state.thinkingByTask.tsk_detail_wait).toBeUndefined();
  });

  it('normalizes terminal attachment download URLs from detail rows', async () => {
    detailQuery.mockResolvedValueOnce({
      intent: '生成图片',
      title: null,
      status: 'completed',
      createdAt: '2026-07-01T00:00:00.000Z',
      steps: [],
      result: {
        summary: '已生成图片',
        metadata: {
          attachments: [
            {
              fileId: 'file_img',
              downloadUrl: '/files/file_img/download',
              filename: 'holaday-image-1.jpg',
              mimetype: 'image/jpeg',
              sizeBytes: 418_513,
              expiresAt: '2026-07-02T00:00:00.000Z',
              kind: 'output',
            },
          ],
        },
      },
    } as never);

    useTaskStore.getState().selectTask('tsk_img_detail', 'ui');
    await flushPromises();

    expect(useTaskStore.getState().tasks[0]?.attachments?.[0]?.downloadUrl).toBe(
      '/api/files/file_img/download',
    );
  });

  it('hydrates final screenshot viewport dimensions from task detail', async () => {
    detailQuery.mockResolvedValueOnce({
      intent: '打开移动页面',
      title: null,
      status: 'completed',
      createdAt: '2026-06-05T00:00:00.000Z',
      steps: [],
      result: {
        summary: 'Done',
        finalScreenshot: 'base64-jpeg',
        finalUrl: 'https://example.com/',
        finalViewport: { width: 430.8, height: 760.2 },
      },
      verificationPassed: true,
      failureLevel: null,
    } as never);

    useTaskStore.getState().selectTask('tsk_viewport_detail', 'ui');
    await flushPromises();

    expect(useTaskStore.getState().tasks[0]).toMatchObject({
      taskId: 'tsk_viewport_detail',
      finalScreenshot: 'base64-jpeg',
      finalUrl: 'https://example.com/',
      finalViewport: { width: 430, height: 760 },
    });
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

  it('does not let stale active detail overwrite a live terminal frame', async () => {
    let resolveDetail!: (value: unknown) => void;
    const detailPromise = new Promise((resolve) => {
      resolveDetail = resolve;
    });
    detailQuery.mockReturnValueOnce(detailPromise as never);
    useTaskStore.setState({
      tasks: [task({ taskId: 'tsk_detail_race', status: 'executing' })],
    });

    useTaskStore.getState().selectTask('tsk_detail_race', 'ui');
    useTaskStore.getState().applyServerMessage({
      type: 'server.task.terminal',
      taskId: 'tsk_detail_race',
      status: 'completed',
      summary: '实时终态',
    });

    resolveDetail({
      intent: '打开网页',
      title: null,
      status: 'executing',
      createdAt: '2026-05-22T00:00:00.000Z',
      steps: [],
      result: { summary: '旧详情内容' },
      verificationPassed: null,
      failureLevel: null,
    });
    await flushPromises();

    const state = useTaskStore.getState();
    expect(state.tasks[0]).toMatchObject({
      taskId: 'tsk_detail_race',
      status: 'completed',
      resultText: '实时终态',
    });
    expect(state.terminalTaskIds.has('tsk_detail_race')).toBe(true);
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
      status: 'unknown',
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
      executorFallbackByTask: { tsk_wait: { available: false, at: 1 } },
      degradeByTask: {
        tsk_wait: {
          level: 1,
          strategy: 'extension',
          ok: false,
          message: '旧降级提示',
          at: 1,
        },
      },
      thinkingByTask: {
        tsk_wait: { summary: '旧思考提示', at: 1 },
      },
      progressByTask: { tsk_wait: '旧进度提示' },
      streamingByTask: { tsk_wait: '旧流式内容' },
      subStatusByTask: {
        tsk_wait: { subStatus: 'verifying', since: 1 },
      },
    });

    await expect(
      useTaskStore.getState().replyToTask('tsk_wait', '登录好了', []),
    ).resolves.toEqual({ ok: true });

    const state = useTaskStore.getState();
    expect(state.awaitingUserByTask.tsk_wait).toBeUndefined();
    expect(state.captchaWaitByTask.tsk_wait).toBeUndefined();
    expect(state.executorFallbackByTask.tsk_wait).toBeUndefined();
    expect(state.degradeByTask.tsk_wait).toBeUndefined();
    expect(state.thinkingByTask.tsk_wait).toBeUndefined();
    expect(state.progressByTask.tsk_wait).toBeUndefined();
    expect(state.streamingByTask.tsk_wait).toBeUndefined();
    expect(state.subStatusByTask.tsk_wait).toBeUndefined();
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

describe('abortTask', () => {
  it('marks optimistic cancellation as runtime-terminal so stale live frames cannot revive it', async () => {
    abortMutate.mockResolvedValueOnce({ ok: true } as never);
    useTaskStore.setState({
      tasks: [task({ taskId: 'tsk_abort', status: 'executing' })],
      awaitingUserByTask: {
        tsk_abort: {
          question: '请确认',
          at: 1,
          awaitingKind: 'clarification',
        },
      },
      progressByTask: { tsk_abort: '正在执行' },
      streamingByTask: { tsk_abort: 'partial answer' },
      subStatusByTask: {
        tsk_abort: { subStatus: 'browsing', since: 1 },
      },
      captchaWaitByTask: {
        tsk_abort: {
          antiBotType: 'captcha',
          message: '需要验证',
          startedAt: 1,
          deadlineMs: 1000,
        },
      },
      executorFallbackByTask: { tsk_abort: { available: false, at: 1 } },
      degradeByTask: {
        tsk_abort: {
          level: 1,
          strategy: 'extension',
          ok: false,
          message: '切换执行器',
          at: 1,
        },
      },
      thinkingByTask: {
        tsk_abort: { summary: '仍在分析', at: 1 },
      },
    });

    await expect(useTaskStore.getState().abortTask('tsk_abort')).resolves.toEqual({
      ok: true,
    });
    useTaskStore.getState().applyServerMessage({
      type: 'server.task.progress',
      taskId: 'tsk_abort',
      message: '迟到进度',
      subStatus: 'browsing',
    });
    useTaskStore.getState().applyServerMessage({
      type: 'server.task.stream',
      taskId: 'tsk_abort',
      delta: ' stale text',
    });

    const state = useTaskStore.getState();
    expect(abortMutate).toHaveBeenCalledWith({ taskId: 'tsk_abort' });
    expect(state.tasks[0]?.status).toBe('cancelled');
    expect(state.terminalTaskIds.has('tsk_abort')).toBe(true);
    expect(state.awaitingUserByTask.tsk_abort).toBeUndefined();
    expect(state.subStatusByTask.tsk_abort).toBeUndefined();
    expect(state.captchaWaitByTask.tsk_abort).toBeUndefined();
    expect(state.executorFallbackByTask.tsk_abort).toBeUndefined();
    expect(state.degradeByTask.tsk_abort).toBeUndefined();
    expect(state.thinkingByTask.tsk_abort).toBeUndefined();
    expect(state.progressByTask.tsk_abort).toBe('正在执行');
    expect(state.streamingByTask.tsk_abort).toBe('partial answer');
  });
});

describe('applyServerMessage awaiting_user', () => {
  it('mirrors awaiting_user onto the task row immediately', () => {
    useTaskStore.setState({
      tasks: [task({ taskId: 'tsk_wait', status: 'executing', executionMode: 'browser' })],
      subStatusByTask: {
        tsk_wait: { subStatus: 'browsing', since: 1 },
      },
      captchaWaitByTask: {
        tsk_wait: {
          antiBotType: 'captcha',
          message: '验证中',
          startedAt: 1,
          deadlineMs: 1000,
        },
      },
      executorFallbackByTask: { tsk_wait: { available: false, at: 1 } },
      degradeByTask: {
        tsk_wait: {
          level: 1,
          strategy: 'extension',
          ok: false,
          message: '执行器降级',
          at: 1,
        },
      },
      thinkingByTask: {
        tsk_wait: { summary: '正在推理', at: 1 },
      },
      progressByTask: { tsk_wait: '旧执行进度' },
      streamingByTask: { tsk_wait: '旧流式内容' },
    });

    useTaskStore.getState().applyServerMessage({
      type: 'server.supercar.awaiting_user',
      taskId: 'tsk_wait',
      question: '请先完成登录',
      awaitingKind: 'login',
    });

    const state = useTaskStore.getState();
    expect(state.awaitingUserByTask.tsk_wait).toMatchObject({
      question: '请先完成登录',
      awaitingKind: 'login',
    });
    expect(state.tasks[0]).toMatchObject({
      status: 'awaiting_user',
      awaitingKind: 'login',
    });
    expect(state.subStatusByTask.tsk_wait).toBeUndefined();
    expect(state.captchaWaitByTask.tsk_wait).toBeUndefined();
    expect(state.executorFallbackByTask.tsk_wait).toBeUndefined();
    expect(state.degradeByTask.tsk_wait).toBeUndefined();
    expect(state.thinkingByTask.tsk_wait).toBeUndefined();
    expect(state.progressByTask.tsk_wait).toBeUndefined();
    expect(state.streamingByTask.tsk_wait).toBeUndefined();
  });

  it('allows a paused runtime marker to become a recoverable awaiting-user state', async () => {
    replyMutate.mockResolvedValueOnce({ ok: true, state: 'resumed' });
    useTaskStore.setState({
      tasks: [
        task({
          taskId: 'tsk_paused_wait',
          status: 'paused',
          resultText: '达到最大步骤数，请确认下一步。',
        }),
      ],
      terminalTaskIds: new Set(['tsk_paused_wait']),
    });

    useTaskStore.getState().applyServerMessage({
      type: 'server.supercar.awaiting_user',
      taskId: 'tsk_paused_wait',
      question: '还需要补充哪个平台？',
      awaitingKind: 'clarification',
    });

    let state = useTaskStore.getState();
    expect(state.tasks[0]).toMatchObject({
      status: 'awaiting_user',
      awaitingKind: 'clarification',
    });
    expect(state.tasks[0]?.resultText).toBeUndefined();
    expect(state.awaitingUserByTask.tsk_paused_wait).toMatchObject({
      question: '还需要补充哪个平台？',
      awaitingKind: 'clarification',
    });
    expect(state.terminalTaskIds.has('tsk_paused_wait')).toBe(false);

    await useTaskStore.getState().replyToTask('tsk_paused_wait', '继续比较京东', []);
    useTaskStore.getState().applyServerMessage({
      type: 'server.task.progress',
      taskId: 'tsk_paused_wait',
      message: '继续执行中',
      subStatus: 'browsing',
    });

    state = useTaskStore.getState();
    expect(state.tasks[0]).toMatchObject({
      status: 'executing',
    });
    expect(state.tasks[0]?.resultText).toBeUndefined();
    expect(state.progressByTask.tsk_paused_wait).toBe('继续执行中');
  });
});

describe('applyServerMessage task.control', () => {
  it('pauses and resumes a task from control frames', () => {
    useTaskStore.setState({
      tasks: [task({ taskId: 'tsk_control', status: 'executing' })],
      subStatusByTask: {
        tsk_control: { subStatus: 'browsing', since: 1 },
      },
    });

    useTaskStore.getState().applyServerMessage({
      type: 'server.task.control',
      taskId: 'tsk_control',
      command: 'pause',
      reason: 'retries_exhausted',
    });

    expect(useTaskStore.getState().tasks[0]?.status).toBe('paused');
    expect(useTaskStore.getState().subStatusByTask.tsk_control).toBeUndefined();

    useTaskStore.getState().applyServerMessage({
      type: 'server.task.control',
      taskId: 'tsk_control',
      command: 'resume',
    });

    expect(useTaskStore.getState().tasks[0]?.status).toBe('executing');
  });

  it('does not let stale live frames revive a control-paused task', () => {
    useTaskStore.setState({
      tasks: [task({ taskId: 'tsk_control_pause_stale', status: 'executing' })],
      progressByTask: { tsk_control_pause_stale: '等待用户确认' },
    });

    useTaskStore.getState().applyServerMessage({
      type: 'server.task.control',
      taskId: 'tsk_control_pause_stale',
      command: 'pause',
      reason: 'user',
    });
    useTaskStore.getState().applyServerMessage({
      type: 'server.task.progress',
      taskId: 'tsk_control_pause_stale',
      message: '迟到的执行进度',
      subStatus: 'browsing',
    });
    useTaskStore.getState().applyServerMessage({
      type: 'server.task.stream',
      taskId: 'tsk_control_pause_stale',
      delta: ' stale answer',
    });

    const state = useTaskStore.getState();
    expect(state.tasks[0]).toMatchObject({ status: 'paused' });
    expect(state.terminalTaskIds.has('tsk_control_pause_stale')).toBe(true);
    expect(state.progressByTask.tsk_control_pause_stale).toBe('等待用户确认');
    expect(state.subStatusByTask.tsk_control_pause_stale).toBeUndefined();
    expect(state.streamingByTask.tsk_control_pause_stale).toBeUndefined();
  });

  it('resumes a paused terminal task instead of treating pause as final', () => {
    useTaskStore.setState({
      tasks: [
        task({
          taskId: 'tsk_paused_then_resume',
          status: 'paused',
          resultText: '达到最大步骤数，请确认下一步。',
        }),
      ],
      terminalTaskIds: new Set(['tsk_paused_then_resume']),
    });

    useTaskStore.getState().applyServerMessage({
      type: 'server.task.control',
      taskId: 'tsk_paused_then_resume',
      command: 'resume',
    });
    useTaskStore.getState().applyServerMessage({
      type: 'server.task.progress',
      taskId: 'tsk_paused_then_resume',
      message: '继续执行中',
      subStatus: 'browsing',
    });

    const state = useTaskStore.getState();
    expect(state.tasks[0]).toMatchObject({
      status: 'executing',
      resultText: undefined,
    });
    expect(state.terminalTaskIds.has('tsk_paused_then_resume')).toBe(false);
    expect(state.progressByTask.tsk_paused_then_resume).toBe('继续执行中');
    expect(state.subStatusByTask.tsk_paused_then_resume).toMatchObject({
      subStatus: 'browsing',
    });
  });

  it('clears stale live buffers when resuming a paused task', () => {
    useTaskStore.setState({
      tasks: [
        task({
          taskId: 'tsk_resume_cleanup',
          status: 'paused',
          resultText: '达到最大步骤数，请确认下一步。',
        }),
      ],
      terminalTaskIds: new Set(['tsk_resume_cleanup']),
      progressByTask: { tsk_resume_cleanup: '暂停前进度' },
      streamingByTask: { tsk_resume_cleanup: '暂停前输出' },
    });

    useTaskStore.getState().applyServerMessage({
      type: 'server.task.control',
      taskId: 'tsk_resume_cleanup',
      command: 'resume',
    });

    const state = useTaskStore.getState();
    expect(state.tasks[0]).toMatchObject({
      status: 'executing',
      resultText: undefined,
    });
    expect(state.terminalTaskIds.has('tsk_resume_cleanup')).toBe(false);
    expect(state.progressByTask.tsk_resume_cleanup).toBeUndefined();
    expect(state.streamingByTask.tsk_resume_cleanup).toBeUndefined();
  });

  it('cancels a task immediately and gates stale stream/progress frames', () => {
    useTaskStore.setState({
      tasks: [task({ taskId: 'tsk_cancel', status: 'executing' })],
      streamingByTask: { tsk_cancel: 'partial answer' },
      progressByTask: { tsk_cancel: '正在执行' },
      subStatusByTask: {
        tsk_cancel: { subStatus: 'generating', since: 1 },
      },
      captchaWaitByTask: {
        tsk_cancel: {
          antiBotType: 'verify',
          message: '验证中',
          startedAt: 1,
          deadlineMs: 1000,
        },
      },
      executorFallbackByTask: { tsk_cancel: { available: false, at: 1 } },
      degradeByTask: {
        tsk_cancel: {
          level: 1,
          strategy: 'extension',
          ok: false,
          message: '正在降级',
          at: 1,
        },
      },
      thinkingByTask: {
        tsk_cancel: { summary: '正在思考', at: 1 },
      },
    });

    useTaskStore.getState().applyServerMessage({
      type: 'server.task.control',
      taskId: 'tsk_cancel',
      command: 'cancel',
    });
    useTaskStore.getState().applyServerMessage({
      type: 'server.task.stream',
      taskId: 'tsk_cancel',
      delta: ' stale',
    });
    useTaskStore.getState().applyServerMessage({
      type: 'server.task.progress',
      taskId: 'tsk_cancel',
      message: 'stale progress',
      subStatus: 'generating',
    });

    const state = useTaskStore.getState();
    expect(state.tasks[0]?.status).toBe('cancelled');
    expect(state.terminalTaskIds.has('tsk_cancel')).toBe(true);
    expect(state.streamingByTask.tsk_cancel).toBe('partial answer');
    expect(state.progressByTask.tsk_cancel).toBe('正在执行');
    expect(state.subStatusByTask.tsk_cancel).toBeUndefined();
    expect(state.captchaWaitByTask.tsk_cancel).toBeUndefined();
    expect(state.executorFallbackByTask.tsk_cancel).toBeUndefined();
    expect(state.degradeByTask.tsk_cancel).toBeUndefined();
    expect(state.thinkingByTask.tsk_cancel).toBeUndefined();
  });

  it('does not let late control frames overwrite completed terminal tasks', () => {
    useTaskStore.setState({
      tasks: [
        task({
          taskId: 'tsk_done_control',
          status: 'completed',
          resultText: '已完成',
        }),
      ],
      terminalTaskIds: new Set(['tsk_done_control']),
    });

    useTaskStore.getState().applyServerMessage({
      type: 'server.task.control',
      taskId: 'tsk_done_control',
      command: 'resume',
    });
    useTaskStore.getState().applyServerMessage({
      type: 'server.task.control',
      taskId: 'tsk_done_control',
      command: 'cancel',
    });

    const state = useTaskStore.getState();
    expect(state.tasks[0]).toMatchObject({
      status: 'completed',
      resultText: '已完成',
    });
    expect(state.terminalTaskIds.has('tsk_done_control')).toBe(true);
  });

  it('does not apply late control frames after terminal marker arrives first', () => {
    useTaskStore.setState({
      tasks: [task({ taskId: 'tsk_terminal_marker_first', status: 'executing' })],
      terminalTaskIds: new Set(['tsk_terminal_marker_first']),
    });

    useTaskStore.getState().applyServerMessage({
      type: 'server.task.control',
      taskId: 'tsk_terminal_marker_first',
      command: 'cancel',
    });

    const state = useTaskStore.getState();
    expect(state.tasks[0]).toMatchObject({ status: 'executing' });
    expect(state.terminalTaskIds.has('tsk_terminal_marker_first')).toBe(true);
  });
});

describe('applyServerMessage stale live frames after terminal', () => {
  it('does not revive cancelled tasks from queued, tick, or awaiting-user frames', () => {
    useTaskStore.setState({
      tasks: [task({ taskId: 'tsk_final_cancel', status: 'cancelled' })],
      terminalTaskIds: new Set(['tsk_final_cancel']),
    });

    useTaskStore.getState().applyServerMessage({
      type: 'server.task.queued',
      taskId: 'tsk_final_cancel',
      position: 2,
    });
    useTaskStore.getState().applyServerMessage({
      type: 'server.vision.tick.start',
      taskId: 'tsk_final_cancel',
      tickIndex: 0,
      mode: 'screenshot',
    });
    useTaskStore.getState().applyServerMessage({
      type: 'server.vision.tick.end',
      taskId: 'tsk_final_cancel',
      tickIndex: 0,
      mode: 'screenshot',
      ok: true,
      durationMs: 1200,
      actionKind: 'browse',
      actionSummary: '迟到步骤',
    });
    useTaskStore.getState().applyServerMessage({
      type: 'server.supercar.awaiting_user',
      taskId: 'tsk_final_cancel',
      question: '请补充信息',
      awaitingKind: 'clarification',
    });

    const state = useTaskStore.getState();
    expect(state.tasks[0]).toMatchObject({ status: 'cancelled' });
    expect(state.tasks[0]?.tickCount).toBe(0);
    expect(state.tasks[0]?.queuePosition).toBeUndefined();
    expect(state.stepsByTask.tsk_final_cancel).toBeUndefined();
    expect(state.awaitingUserByTask.tsk_final_cancel).toBeUndefined();
  });

  it('keeps partial_success terminal when late stream and progress arrive', () => {
    useTaskStore.setState({
      tasks: [
        task({
          taskId: 'tsk_partial_final',
          status: 'partial_success',
          resultText: '部分完成',
        }),
      ],
      terminalTaskIds: new Set(['tsk_partial_final']),
    });

    useTaskStore.getState().applyServerMessage({
      type: 'server.task.stream',
      taskId: 'tsk_partial_final',
      delta: ' stale stream',
    });
    useTaskStore.getState().applyServerMessage({
      type: 'server.task.progress',
      taskId: 'tsk_partial_final',
      message: 'stale progress',
      subStatus: 'generating',
    });

    const state = useTaskStore.getState();
    expect(state.tasks[0]).toMatchObject({
      status: 'partial_success',
      resultText: '部分完成',
    });
    expect(state.streamingByTask.tsk_partial_final).toBeUndefined();
    expect(state.progressByTask.tsk_partial_final).toBeUndefined();
    expect(state.subStatusByTask.tsk_partial_final).toBeUndefined();
  });

  it('does not attach late plan frames to terminal tasks', () => {
    useTaskStore.setState({
      tasks: [
        task({
          taskId: 'tsk_done_plan',
          status: 'completed',
          resultText: '已完成',
          planText: '原计划',
          planStatus: [{ idx: 1, note: '完成前计划', status: 'done' }],
        }),
      ],
      terminalTaskIds: new Set(['tsk_done_plan']),
    });

    useTaskStore.getState().applyServerMessage({
      type: 'server.task.plan',
      taskId: 'tsk_done_plan',
      planText: '迟到计划',
      planStatus: [{ idx: 2, note: '迟到计划', status: 'pending' }],
    });
    useTaskStore.getState().applyServerMessage({
      type: 'server.task.plan_step',
      taskId: 'tsk_done_plan',
      planStatus: [{ idx: 3, note: '迟到步骤', status: 'running' }],
    });

    const state = useTaskStore.getState();
    expect(state.tasks[0]).toMatchObject({
      status: 'completed',
      resultText: '已完成',
      planText: '原计划',
      planStatus: [{ idx: 1, note: '完成前计划', status: 'done' }],
    });
  });

  it('does not attach late vision auxiliary frames to terminal tasks', () => {
    useTaskStore.setState({
      tasks: [task({ taskId: 'tsk_done_aux', status: 'completed' })],
      terminalTaskIds: new Set(['tsk_done_aux']),
    });

    useTaskStore.getState().applyServerMessage({
      type: 'server.vision.captcha_detected',
      taskId: 'tsk_done_aux',
      antiBotType: 'captcha',
      message: '迟到验证码',
      waitTimeoutMs: 30_000,
    });
    useTaskStore.getState().applyServerMessage({
      type: 'server.vision.degrade',
      taskId: 'tsk_done_aux',
      level: 1,
      strategy: 'profile_rotation',
      ok: false,
      message: '迟到降级',
    });
    useTaskStore.getState().applyServerMessage({
      type: 'server.vision.executor_fallback',
      taskId: 'tsk_done_aux',
      reason: 'anti-bot',
      available: false,
    });
    useTaskStore.getState().applyServerMessage({
      type: 'server.vision.screencast',
      taskId: 'tsk_done_aux',
      tickIndex: 9,
      imageBase64: 'late',
      url: 'https://example.com/late',
      viewport: { width: 1280, height: 720 },
      timestamp: '2026-07-03T00:00:00.000Z',
    });

    const state = useTaskStore.getState();
    expect(state.captchaWaitByTask.tsk_done_aux).toBeUndefined();
    expect(state.degradeByTask.tsk_done_aux).toBeUndefined();
    expect(state.executorFallbackByTask.tsk_done_aux).toBeUndefined();
    expect(state.screencastByTask.tsk_done_aux).toBeUndefined();
  });

  it('does not attach late supercar live auxiliary frames to terminal tasks', () => {
    useTaskStore.setState({
      tasks: [task({ taskId: 'tsk_done_supercar_aux', status: 'completed' })],
      terminalTaskIds: new Set(['tsk_done_supercar_aux']),
    });

    useTaskStore.getState().applyServerMessage({
      type: 'server.supercar.web_search',
      taskId: 'tsk_done_supercar_aux',
      iteration: 4,
      query: '迟到搜索',
      sources: [
        {
          title: '迟到来源',
          url: 'https://example.com/late',
          snippet: '不应挂到已结束任务上',
        },
      ],
    });
    useTaskStore.getState().applyServerMessage({
      type: 'server.supercar.thinking',
      taskId: 'tsk_done_supercar_aux',
      summary: '迟到思考',
    });
    useTaskStore.getState().applyServerMessage({
      type: 'server.supercar.suggestions',
      taskId: 'tsk_done_supercar_aux',
      suggestions: ['完成后建议仍应允许到达'],
    });

    const state = useTaskStore.getState();
    expect(state.webSearchByTask.tsk_done_supercar_aux).toBeUndefined();
    expect(state.thinkingByTask.tsk_done_supercar_aux).toBeUndefined();
    expect(state.suggestionsByTask.tsk_done_supercar_aux).toEqual([
      '完成后建议仍应允许到达',
    ]);
  });
});

describe('applyServerMessage paused terminal frame', () => {
  it('does not let a late different terminal frame overwrite an existing final task', () => {
    useTaskStore.setState({
      tasks: [
        task({
          taskId: 'tsk_done_terminal',
          status: 'completed',
          resultText: '最终答案',
        }),
      ],
      terminalTaskIds: new Set(['tsk_done_terminal']),
    });

    useTaskStore.getState().applyServerMessage({
      type: 'server.task.terminal',
      taskId: 'tsk_done_terminal',
      status: 'failed',
      reason: 'late failure',
    });

    const state = useTaskStore.getState();
    expect(state.tasks[0]).toMatchObject({
      status: 'completed',
      resultText: '最终答案',
    });
  });

  it('clears live-only blockers when a terminal frame arrives', () => {
    useTaskStore.setState({
      tasks: [task({ taskId: 'tsk_terminal_cleanup', status: 'executing' })],
      captchaWaitByTask: {
        tsk_terminal_cleanup: {
          antiBotType: 'captcha',
          message: '验证中',
          startedAt: 1,
          deadlineMs: 2,
        },
      },
      executorFallbackByTask: {
        tsk_terminal_cleanup: { available: false, at: 1 },
      },
      degradeByTask: {
        tsk_terminal_cleanup: {
          level: 2,
          strategy: 'extension',
          ok: false,
          message: '降级中',
          at: 1,
        },
      },
      thinkingByTask: {
        tsk_terminal_cleanup: { summary: '仍在思考', at: 1 },
      },
      webSearchByTask: {
        tsk_terminal_cleanup: { iteration: 1, query: 'holaday', at: 1 },
      },
    });

    useTaskStore.getState().applyServerMessage({
      type: 'server.task.terminal',
      taskId: 'tsk_terminal_cleanup',
      status: 'completed',
      summary: '完成',
    });

    const state = useTaskStore.getState();
    expect(state.tasks[0]).toMatchObject({
      status: 'completed',
      resultText: '完成',
    });
    expect(state.captchaWaitByTask.tsk_terminal_cleanup).toBeUndefined();
    expect(state.executorFallbackByTask.tsk_terminal_cleanup).toBeUndefined();
    expect(state.degradeByTask.tsk_terminal_cleanup).toBeUndefined();
    expect(state.thinkingByTask.tsk_terminal_cleanup).toBeUndefined();
    expect(state.webSearchByTask.tsk_terminal_cleanup).toMatchObject({
      query: 'holaday',
    });
  });

  it('keeps paused recoverable and clears stale live blockers without terminal reveal animation', () => {
    useTaskStore.setState({
      tasks: [task({ taskId: 'tsk_paused_terminal', status: 'executing' })],
      awaitingUserByTask: {
        tsk_paused_terminal: {
          question: '需要继续吗？',
          at: 1,
          awaitingKind: 'clarification',
        },
      },
      subStatusByTask: {
        tsk_paused_terminal: { subStatus: 'browsing', since: 1 },
      },
    });

    useTaskStore.getState().applyServerMessage({
      type: 'server.task.terminal',
      taskId: 'tsk_paused_terminal',
      status: 'paused',
      reason: '达到最大步骤数，请确认下一步。',
    });

    const state = useTaskStore.getState();
    expect(state.tasks[0]).toMatchObject({
      status: 'paused',
      resultText: '达到最大步骤数，请确认下一步。',
    });
    expect(state.awaitingUserByTask.tsk_paused_terminal).toBeUndefined();
    expect(state.subStatusByTask.tsk_paused_terminal).toBeUndefined();
    expect(state.terminalTaskIds.has('tsk_paused_terminal')).toBe(true);
    expect(state.animatedTaskIds.has('tsk_paused_terminal')).toBe(false);
  });
});

describe('applyServerMessage queued lifecycle', () => {
  it('marks queued tasks explicitly and flips them to executing on first tick', () => {
    useTaskStore.setState({
      tasks: [task({ taskId: 'tsk_queue', status: 'executing' })],
    });

    useTaskStore.getState().applyServerMessage({
      type: 'server.task.queued',
      taskId: 'tsk_queue',
      position: 3,
    });

    expect(useTaskStore.getState().tasks[0]).toMatchObject({
      status: 'queued',
      queuePosition: 3,
    });

    useTaskStore.getState().applyServerMessage({
      type: 'server.vision.tick.start',
      taskId: 'tsk_queue',
      tickIndex: 0,
      mode: 'screenshot',
    });

    expect(useTaskStore.getState().tasks[0]).toMatchObject({
      status: 'executing',
      tickCount: 1,
    });
    expect(useTaskStore.getState().tasks[0]?.queuePosition).toBeUndefined();
  });

  it('flips queued tasks to executing on first progress frame', () => {
    useTaskStore.setState({
      tasks: [task({ taskId: 'tsk_progress_queue', status: 'queued', queuePosition: 2 })],
    });

    useTaskStore.getState().applyServerMessage({
      type: 'server.task.progress',
      taskId: 'tsk_progress_queue',
      message: '正在准备执行',
      subStatus: 'planning',
    });

    expect(useTaskStore.getState().tasks[0]).toMatchObject({
      status: 'executing',
    });
    expect(useTaskStore.getState().tasks[0]?.queuePosition).toBeUndefined();
  });

  it('flips queued tasks to executing on first stream frame', () => {
    useTaskStore.setState({
      tasks: [task({ taskId: 'tsk_stream_queue', status: 'queued', queuePosition: 1 })],
    });

    useTaskStore.getState().applyServerMessage({
      type: 'server.task.stream',
      taskId: 'tsk_stream_queue',
      delta: '开始生成',
    });

    expect(useTaskStore.getState().tasks[0]).toMatchObject({
      status: 'executing',
      executionMode: 'generate',
    });
    expect(useTaskStore.getState().tasks[0]?.queuePosition).toBeUndefined();
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
