import { describe, expect, it } from 'vitest';
import {
  shouldShowStepCard,
  stepDurationLabel,
  stepDisplaySummary,
  stepDisplayStepsForTask,
  stepDisplayTitle,
  stepDetailSummary,
  stepFailureMessage,
  stepStatusLabel,
  stepStatusText,
} from './step-card-state';

describe('step-card-state', () => {
  it('summarizes mixed detail steps for the collapsed detail toggle', () => {
    expect(
      stepDetailSummary([
        { status: 'done' },
        { status: 'running' },
        { status: 'failed' },
        { status: 'cancelled' },
      ]),
    ).toEqual({
      total: 4,
      done: 1,
      failed: 1,
      running: 1,
      cancelled: 1,
      label: '1/4 步完成 · 1 执行中 · 1 失败 · 1 已取消',
      tone: 'failed',
    });
  });

  it('counts selected Chrome actions separately from evidence and non-action records', () => {
    expect(
      stepDetailSummary([
        { actionKind: 'selected_chrome_action', status: 'done' },
        { actionKind: 'selected_chrome_action', status: 'failed' },
        { actionKind: 'selected_chrome_observe', status: 'done' },
        { actionKind: 'selected_chrome_finish', status: 'done' },
        { actionKind: 'selected_chrome_plan_discarded', status: 'done' },
        { actionKind: 'selected_chrome_handoff', status: 'done' },
        { actionKind: 'browser_act', status: 'done' },
        { actionKind: 'browser_observe', status: 'done' },
        { actionKind: 'browser_finish', status: 'done' },
      ]),
    ).toMatchObject({
      total: 9,
      done: 8,
      failed: 1,
      running: 0,
      cancelled: 0,
      label:
        '1 项操作已应用 · 1 项操作未确认完成 · 1 次页面观察 · 1 次验证通过 · 1 项计划未执行 · 1 次人工交还 · 3 条历史轮次（未验证）',
      tone: 'failed',
    });
  });

  it('keeps informational selected Chrome records neutral when their record status is done', () => {
    expect(
      stepDetailSummary([
        { actionKind: 'selected_chrome_observe', status: 'done' },
        { actionKind: 'selected_chrome_plan_discarded', status: 'done' },
        { actionKind: 'selected_chrome_handoff', status: 'done' },
      ]),
    ).toMatchObject({
      label: '1 次页面观察 · 1 项计划未执行 · 1 次人工交还',
      tone: 'idle',
    });
  });

  it('treats a cancelled-only terminal list as cancelled, not failed', () => {
    expect(
      stepDetailSummary([
        { status: 'done' },
        { status: 'cancelled' },
      ]),
    ).toMatchObject({
      label: '1/2 步完成 · 1 已取消',
      tone: 'cancelled',
    });
  });

  it('renders stale running detail steps as cancelled once the parent task is cancelled', () => {
    const steps = stepDisplayStepsForTask(
      [
        { tickIndex: 0, status: 'running' as const },
        { tickIndex: 1, status: 'done' as const },
        { tickIndex: 2, status: 'running' as const },
      ],
      'cancelled',
    );

    expect(steps.map((step) => step.status)).toEqual(['cancelled', 'done', 'cancelled']);
    expect(stepDetailSummary(steps)).toMatchObject({
      label: '1/3 步完成 · 2 已取消',
      tone: 'cancelled',
    });
  });

  it('does not claim stale terminal steps are still executing', () => {
    const source = [
      { tickIndex: 0, status: 'running' as const },
      { tickIndex: 1, status: 'done' as const },
    ];

    expect(
      stepDisplayStepsForTask(source, 'failed').map((step) => step.status),
    ).toEqual(['failed', 'done']);
    expect(
      stepDisplayStepsForTask(source, 'completed').map((step) => step.status),
    ).toEqual(['done', 'done']);
    expect(
      stepDisplayStepsForTask(source, 'partial_success').map((step) => step.status),
    ).toEqual(['cancelled', 'done']);
  });

  it('does not infer selected Chrome receipt completion from the parent task status', () => {
    const steps = stepDisplayStepsForTask(
      [
        { actionKind: 'selected_chrome_action', status: 'running' as const },
        { actionKind: 'selected_chrome_observe', status: 'running' as const },
        { actionKind: 'selected_chrome_finish', status: 'running' as const },
        {
          actionKind: 'selected_chrome_plan_discarded',
          status: 'running' as const,
        },
        { actionKind: 'selected_chrome_handoff', status: 'running' as const },
        { actionKind: 'navigate', status: 'running' as const },
        { actionKind: 'browser_act', status: 'running' as const },
      ],
      'completed',
    );

    expect(steps.map((step) => step.status)).toEqual([
      'cancelled',
      'cancelled',
      'cancelled',
      'cancelled',
      'cancelled',
      'done',
      'done',
    ]);
    expect(stepDetailSummary(steps).label).toContain('1 项操作未确认完成');
    expect(stepDetailSummary(steps).label).toContain('1 次验证未确认');
  });

  it('provides localized status labels for step badges', () => {
    expect(stepStatusText('running')).toBe('执行中');
    expect(stepStatusLabel('failed', 2)).toBe('步骤 3 · 失败');
  });

  it('formats step durations without exposing zero-millisecond noise', () => {
    expect(stepDurationLabel(null)).toBeNull();
    expect(stepDurationLabel(0)).toBeNull();
    expect(stepDurationLabel(420)).toBe('<1s');
    expect(stepDurationLabel(1250)).toBe('1.3s');
    expect(stepDurationLabel(65_400)).toBe('1分05秒');
  });

  it('uses user-facing titles for raw browser step kinds', () => {
    expect(stepDisplayTitle({ actionKind: 'computer', tickIndex: 0 })).toBe(
      '浏览器操作',
    );
    expect(stepDisplayTitle({ actionKind: 'text', tickIndex: 1 })).toBe(
      '结果说明',
    );
    expect(stepDisplayTitle({ actionKind: 'web_search', tickIndex: 2 })).toBe(
      '联网搜索',
    );
    expect(stepDisplayTitle({ actionKind: 'unknown_tool', tickIndex: 3 })).toBe(
      '任务步骤',
    );
  });

  it('names selected Chrome records by evidence type and marks historical ticks unverified', () => {
    expect(
      stepDisplayTitle({ actionKind: 'selected_chrome_action', tickIndex: 0 }),
    ).toBe('浏览器操作结果');
    expect(
      stepDisplayTitle({ actionKind: 'selected_chrome_observe', tickIndex: 1 }),
    ).toBe('页面观察记录');
    expect(
      stepDisplayTitle({ actionKind: 'selected_chrome_finish', tickIndex: 2 }),
    ).toBe('结果验证记录');
    expect(
      stepDisplayTitle({
        actionKind: 'selected_chrome_plan_discarded',
        tickIndex: 3,
      }),
    ).toBe('未执行计划');
    expect(
      stepDisplayTitle({ actionKind: 'selected_chrome_handoff', tickIndex: 4 }),
    ).toBe('人工交还记录');
    expect(stepDisplayTitle({ actionKind: 'browser_act', tickIndex: 5 })).toBe(
      '历史浏览器轮次（未验证）',
    );
    expect(
      stepDisplayTitle({ actionKind: 'browser_observe', tickIndex: 6 }),
    ).toBe('历史页面观察（未验证）');
    expect(
      stepDisplayTitle({ actionKind: 'browser_finish', tickIndex: 7 }),
    ).toBe('历史结束轮次（未验证）');
  });

  it('hides label-only step summaries but keeps useful descriptions', () => {
    expect(
      stepDisplaySummary({ actionKind: 'computer', actionSummary: 'computer' }),
    ).toBeNull();
    expect(
      stepDisplaySummary({ actionKind: 'text', actionSummary: ' text ' }),
    ).toBeNull();
    expect(
      stepDisplaySummary({
        actionKind: 'computer',
        actionSummary: '表达式 `128^2` 已就绪，按 = 求值。',
      }),
    ).toBe('表达式 `128^2` 已就绪，按 = 求值。');
  });

  it('drops uninformative generic browser detail cards', () => {
    expect(
      shouldShowStepCard({ actionKind: 'computer', actionSummary: 'computer' }),
    ).toBe(false);
    expect(shouldShowStepCard({ actionKind: 'text', actionSummary: 'text' })).toBe(
      false,
    );
    expect(shouldShowStepCard({ actionKind: 'navigate', actionSummary: 'navigate' })).toBe(
      true,
    );
    expect(
      shouldShowStepCard({
        actionKind: 'computer',
        actionSummary: '页面已加载，开始输入计算式。',
      }),
    ).toBe(true);
  });

  it('explains browser tool timeouts without exposing driver jargon', () => {
    expect(
      stepFailureMessage({
        actionKind: 'navigate',
        message:
          '扩展工具调用超时（已等待 30 秒，请确认浏览器标签页仍在加载或重试）',
      }),
    ).toBe('浏览器响应超时，可能是页面仍在加载或扩展连接短暂中断。可以重新执行当前任务。');
  });

  it('explains hibernated browser sessions', () => {
    expect(
      stepFailureMessage({
        actionKind: 'screenshot',
        message: 'browser not allocated',
      }),
    ).toBe('浏览器会话已休眠。重新执行任务时会拉起新的浏览器。');
  });

  it('explains missing browser extension clients', () => {
    expect(
      stepFailureMessage({
        actionKind: 'navigate',
        message: '浏览器扩展未连接，请打开 HOLA DAY 扩展后重试',
      }),
    ).toBe('浏览器扩展未连接。请打开 HOLA DAY 扩展后重试。');
    expect(
      stepFailureMessage({
        actionKind: 'navigate',
        message: 'Could not establish connection. Receiving end does not exist.',
      }),
    ).toBe('浏览器扩展未连接。请打开 HOLA DAY 扩展后重试。');
  });

  it('explains disconnected extension clients separately from generic browser closures', () => {
    expect(
      stepFailureMessage({
        actionKind: 'navigate',
        message: 'socket_closed: 浏览器扩展连接已断开',
      }),
    ).toBe('浏览器扩展连接已断开。请重新打开 HOLA DAY 扩展后重试。');
    expect(
      stepFailureMessage({
        actionKind: 'navigate',
        message: 'The message port closed before a response was received.',
      }),
    ).toBe('浏览器扩展连接已断开。请重新打开 HOLA DAY 扩展后重试。');
  });

  it('explains raw browser transport closures in step details', () => {
    expect(
      stepFailureMessage({
        actionKind: 'navigate',
        message:
          "WebSocket connection to 'wss://holaday.ai/ws' failed: Error during WebSocket handshake: Unexpected response code: 502",
      }),
    ).toBe('浏览器连接中断，请重新执行任务。');
    expect(
      stepFailureMessage({
        actionKind: 'navigate',
        message: 'net::ERR_CONNECTION_CLOSED',
      }),
    ).toBe('无法连接到该站点。请稍后重试，或换一个能直接访问的网址。');
  });

  it('explains extension host permission failures', () => {
    expect(
      stepFailureMessage({
        actionKind: 'navigate',
        message: 'Cannot access contents of url. Extension manifest must request permission.',
      }),
    ).toBe('浏览器扩展缺少当前网站权限。请在扩展里允许访问该网站后重试。');
  });

  it('explains missing active tabs', () => {
    expect(
      stepFailureMessage({
        actionKind: 'navigate',
        message: '浏览器当前没有活动标签页',
      }),
    ).toBe('浏览器当前没有活动标签页。请打开一个网页后重试。');
  });

  it('explains login blockers in step details instead of generic failures', () => {
    expect(
      stepFailureMessage({
        actionKind: 'navigate',
        message: 'login required before checkout',
      }),
    ).toBe('目标网站需要登录。请在浏览器里完成登录后继续，或重新执行任务。');
  });

  it('explains browser transport closures without exposing protocol text', () => {
    expect(
      stepFailureMessage({
        actionKind: 'navigate',
        message: 'Protocol error (Page.navigate): Target closed',
      }),
    ).toBe('浏览器连接中断，请重新执行任务。');
  });

  it('explains fast page switching as a retryable browser step', () => {
    expect(
      stepFailureMessage({
        actionKind: 'click',
        message: 'Execution context was destroyed, most likely because of a navigation',
      }),
    ).toBe('页面正在切换，本次步骤未能稳定完成。可以重新执行当前任务。');
  });

  it('explains raw Chromium navigation failures per step', () => {
    expect(
      stepFailureMessage({
        actionKind: 'navigate',
        message: 'net::ERR_NAME_NOT_RESOLVED at https://nope.example',
      }),
    ).toBe('无法访问该网址。请检查网址是否正确，或换一个能直接访问的页面。');
    expect(
      stepFailureMessage({
        actionKind: 'navigate',
        message: 'net::ERR_CERT_AUTHORITY_INVALID',
      }),
    ).toBe('网站证书异常，浏览器无法安全连接。请确认网址是否正确。');
    expect(
      stepFailureMessage({
        actionKind: 'navigate',
        message: 'net::ERR_CONNECTION_RESET',
      }),
    ).toBe('无法连接到该站点。请稍后重试，或换一个能直接访问的网址。');
  });

  it('hides unknown English step failures but keeps localized ones visible', () => {
    expect(
      stepFailureMessage({
        actionKind: 'bash',
        message: 'command failed with exit code 2',
      }),
    ).toBe('任务执行出错，请重试。如果反复出现请联系 support@holaday.ai。');
    expect(
      stepFailureMessage({
        actionKind: 'custom',
        message: '字段不能为空',
      }),
    ).toBe('字段不能为空');
  });
});
