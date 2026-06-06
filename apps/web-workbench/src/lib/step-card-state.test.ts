import { describe, expect, it } from 'vitest';
import {
  shouldShowStepCard,
  stepDurationLabel,
  stepDisplaySummary,
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
      label: '1/4 步完成 · 1 执行中 · 1 失败 · 1 取消',
      tone: 'failed',
    });
  });

  it('treats a cancelled-only terminal list as cancelled, not failed', () => {
    expect(
      stepDetailSummary([
        { status: 'done' },
        { status: 'cancelled' },
      ]),
    ).toMatchObject({
      label: '1/2 步完成 · 1 取消',
      tone: 'cancelled',
    });
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
