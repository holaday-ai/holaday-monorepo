import { describe, expect, it } from 'vitest';
import {
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

  it('keeps unknown step failures visible', () => {
    expect(
      stepFailureMessage({
        actionKind: 'bash',
        message: 'command failed with exit code 2',
      }),
    ).toBe('command failed with exit code 2');
  });
});
