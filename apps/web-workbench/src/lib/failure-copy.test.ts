import { describe, expect, it } from 'vitest';
import { classifyFriendlyFailure } from './failure-copy';

describe('classifyFriendlyFailure', () => {
  it('uses terminal-safe login recovery copy', () => {
    expect(classifyFriendlyFailure('login required').subtitle).toBe(
      '请重新执行；如果再次停在登录页，请先完成登录。',
    );
  });

  it('uses terminal-safe captcha recovery copy', () => {
    expect(classifyFriendlyFailure('Cloudflare human verification').subtitle).toBe(
      '请重新执行；如果再次出现验证，请在浏览器里手动完成。',
    );
  });

  it('keeps timeout copy concise', () => {
    expect(classifyFriendlyFailure('SUPERCAR_TIMEOUT').title).toBe('操作超时');
  });

  it('explains browser extension timeouts as retryable browser stalls', () => {
    const copy = classifyFriendlyFailure('扩展工具调用超时（已等待 30 秒）');

    expect(copy).toEqual({
      title: '浏览器响应超时',
      subtitle: '页面可能仍在加载，或浏览器扩展连接短暂中断。请重试当前任务。',
    });
  });

  it('explains missing extension clients without Mode B jargon', () => {
    expect(classifyFriendlyFailure('扩展未连接，无法走 Mode B')).toEqual({
      title: '浏览器扩展未连接',
      subtitle: '请打开 HOLA DAY 扩展后重试；如果不用扩展，也可以重新执行任务。',
    });
  });

  it('classifies raw browser transport closures as disconnected sessions', () => {
    expect(classifyFriendlyFailure('Protocol error (Page.navigate): Target closed')).toEqual({
      title: '浏览器连接中断',
      subtitle: '浏览器会话已断开，请重新执行任务。',
    });
  });

  it('classifies fast page changes as transient page switching', () => {
    expect(classifyFriendlyFailure('Execution context was destroyed, most likely because of a navigation')).toEqual({
      title: '页面正在切换',
      subtitle: '网站跳转太快导致本次步骤失效，请重试当前任务。',
    });
  });
});
