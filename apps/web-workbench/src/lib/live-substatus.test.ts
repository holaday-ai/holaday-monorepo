import { describe, expect, it } from 'vitest';
import { shouldRenderLiveSubStatus } from './live-substatus';

describe('shouldRenderLiveSubStatus', () => {
  it('shows the live sub-status while a task is actively executing', () => {
    expect(shouldRenderLiveSubStatus('executing', false)).toBe(true);
    expect(shouldRenderLiveSubStatus('queued', false)).toBe(true);
    expect(shouldRenderLiveSubStatus('planning', false)).toBe(true);
  });

  it('suppresses it once the task parks in awaiting_user', () => {
    // The 需要登录 banner is the authoritative state; a stale "正在操作
    // 浏览器 / 你可以继续等待" chip would contradict it.
    expect(shouldRenderLiveSubStatus('awaiting_user', false)).toBe(false);
  });

  it('never shows it for terminal tasks', () => {
    expect(shouldRenderLiveSubStatus('completed', true)).toBe(false);
    expect(shouldRenderLiveSubStatus('failed', true)).toBe(false);
    expect(shouldRenderLiveSubStatus('cancelled', true)).toBe(false);
    // terminal flag wins even if status string looks active.
    expect(shouldRenderLiveSubStatus('executing', true)).toBe(false);
  });
});
