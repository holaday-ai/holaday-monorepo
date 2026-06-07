import { describe, expect, it } from 'vitest';
import {
  awaitingUserCopy,
  awaitingUserStreamMessage,
  normalizeAwaitingKind,
} from './awaiting-user-copy';

describe('awaiting user copy', () => {
  it('defaults missing kinds to clarification copy', () => {
    expect(normalizeAwaitingKind(undefined)).toBe('clarification');
    expect(awaitingUserCopy(undefined)).toMatchObject({
      title: '需要你补充信息',
      toolbarLabel: '需要你回复',
      panelBody: '请回到输入框补充信息，任务会继续，不用重新提交任务。',
      composerPlaceholder: '回答 HOLA DAY 的问题...',
    });
  });

  it('keeps browser handoff copy specific to the required action', () => {
    expect(awaitingUserCopy('login')).toMatchObject({
      title: '需要登录',
      streamBody: '请打开浏览器完成登录或扫码，完成后任务会继续，不用重新提交。',
      streamHint: '打开浏览器完成登录',
      panelTitle: '需要登录',
      panelBody: '交互模式已开启。完成登录或扫码后，HOLA DAY 会继续执行，不用重新提交任务。',
      toolbarLabel: '需要登录',
      composerPlaceholder: '登录完成后可在这里补充说明...',
    });
    expect(awaitingUserCopy('captcha')).toMatchObject({
      title: '需要验证',
      streamHint: '打开浏览器通过验证',
      toolbarLabel: '需要验证',
    });
    expect(awaitingUserCopy('browser_action')).toMatchObject({
      title: '等待你确认',
      streamBody: '请打开浏览器查看当前页面。确认无误后完成页面操作，或在下方输入框告诉 HOLA DAY 继续。',
      panelTitle: '等待你确认',
      panelBody: '交互模式已开启。确认当前页面无误后完成页面操作，HOLA DAY 会继续执行，不用重新提交任务。',
      toolbarLabel: '需要确认',
      composerPlaceholder: '确认无误后回复，或说明要调整的地方...',
    });
  });

  it('shows concrete prompts for clarification and browser confirmation parks', () => {
    expect(
      awaitingUserStreamMessage('clarification', '你想订哪一天的机票？'),
    ).toEqual({
      body: '你想订哪一天的机票？',
      followUp: '在下方输入框回答，任务会继续，不用重新提交。',
    });
    expect(
      awaitingUserStreamMessage('browser_action', '请确认是否提交这份申请。'),
    ).toEqual({
      body: '请确认是否提交这份申请。',
      followUp: '确认无误后在浏览器完成操作，或在下方输入框说明后继续。',
    });
  });

  it('keeps login and captcha prompts static even when legacy questions exist', () => {
    expect(awaitingUserStreamMessage('login', 'legacy login prompt')).toMatchObject({
      body: '请打开浏览器完成登录或扫码，完成后任务会继续，不用重新提交。',
      followUp: null,
    });
  });

  it('treats permission walls as access problems, not login prompts', () => {
    expect(awaitingUserCopy('permission')).toMatchObject({
      title: '需要权限',
      streamBody: '当前页面拒绝访问。请确认账号权限，或在下方输入框提供公开来源后继续。',
      streamHint: '授权或提供替代来源',
      panelBody: '当前页面拒绝访问。请确认账号权限，或换一个公开来源后回复继续，不用重新提交任务。',
      toolbarLabel: '需要权限',
      composerPlaceholder: '说明已授权，或提供可访问的替代来源...',
    });
  });
});
