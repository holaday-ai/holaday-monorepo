import { describe, expect, it } from 'vitest';
import { awaitingUserCopy, normalizeAwaitingKind } from './awaiting-user-copy';

describe('awaiting user copy', () => {
  it('defaults missing kinds to clarification copy', () => {
    expect(normalizeAwaitingKind(undefined)).toBe('clarification');
    expect(awaitingUserCopy(undefined)).toMatchObject({
      title: '需要你补充信息',
      toolbarLabel: '需要你回复',
    });
  });

  it('keeps browser handoff copy specific to the required action', () => {
    expect(awaitingUserCopy('login')).toMatchObject({
      title: '需要登录',
      streamBody: '请在浏览器画面里完成登录或扫码，完成后任务会继续，不用重新提交。',
      panelTitle: '需要登录',
      panelBody: '交互模式已开启。完成登录或扫码后，HOLA DAY 会继续执行，不用重新提交任务。',
      toolbarLabel: '需要登录',
    });
    expect(awaitingUserCopy('captcha')).toMatchObject({
      title: '需要验证',
      streamHint: '在浏览器画面里通过验证',
      toolbarLabel: '需要验证',
    });
    expect(awaitingUserCopy('browser_action')).toMatchObject({
      title: '需要操作浏览器',
      panelTitle: '需要操作浏览器',
      panelBody: '交互模式已开启。按页面提示完成点击或选择后，HOLA DAY 会继续执行，不用重新提交任务。',
      toolbarLabel: '需要操作浏览器',
    });
  });

  it('treats permission walls as access problems, not login prompts', () => {
    expect(awaitingUserCopy('permission')).toMatchObject({
      title: '需要权限',
      panelBody: '当前页面拒绝访问。请确认账号权限，或换一个公开来源后回复继续，不用重新提交任务。',
      toolbarLabel: '需要权限',
    });
  });
});
