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
      nextStep: '等页面稳定后重新执行当前任务。',
    });
  });

  it('explains missing extension clients without Mode B jargon', () => {
    expect(classifyFriendlyFailure('扩展未连接，无法走 Mode B')).toEqual({
      title: '浏览器扩展未连接',
      subtitle: '请打开 HOLA DAY 扩展后重试；如果不用扩展，也可以重新执行任务。',
      nextStep: '打开 HOLA DAY 扩展，再重新执行任务。',
    });
  });

  it('explains extension disconnects without making them look like generic timeouts', () => {
    expect(classifyFriendlyFailure('浏览器扩展连接已断开，请重新打开 HOLA DAY 扩展后重试')).toEqual({
      title: '浏览器扩展已断开',
      subtitle: '扩展连接在执行中断开。请重新打开 HOLA DAY 扩展后重试。',
      nextStep: '确认扩展在线，再重新执行当前任务。',
    });
  });

  it('classifies raw browser transport closures as disconnected sessions', () => {
    expect(classifyFriendlyFailure('Protocol error (Page.navigate): Target closed')).toEqual({
      title: '浏览器连接中断',
      subtitle: '浏览器会话已断开，请重新执行任务。',
      nextStep: '重新执行任务会建立新的浏览器会话。',
    });
  });

  it('classifies fast page changes as transient page switching', () => {
    expect(classifyFriendlyFailure('Execution context was destroyed, most likely because of a navigation')).toEqual({
      title: '页面正在切换',
      subtitle: '网站跳转太快导致本次步骤失效，请重试当前任务。',
      nextStep: '重新执行时尽量从稳定页面开始。',
    });
  });

  it('explains hibernated browser sessions as requiring a fresh run', () => {
    expect(classifyFriendlyFailure('browser not allocated: idle-timeout hibernated')).toEqual({
      title: '浏览器已休眠',
      subtitle: '这个浏览器会话已经释放。重新执行任务会打开新的浏览器。',
      nextStep: '重新执行当前任务。',
    });
  });

  it('classifies SSL and connection browser failures with actionable recovery', () => {
    expect(classifyFriendlyFailure('net::ERR_CERT_DATE_INVALID')).toEqual({
      title: '网站证书异常',
      subtitle: '这个网站无法安全连接。请确认网址是否正确，或换一个可信来源。',
      nextStep: '确认网址安全后重新执行，或换一个站点。',
    });
    expect(classifyFriendlyFailure('net::ERR_CONNECTION_REFUSED')).toEqual({
      title: '无法连接到这个网站',
      subtitle: '服务器拒绝连接或网络不可达。请稍后重试，或换一个站点。',
      nextStep: '稍后重新执行，或换一个能直接访问的网址。',
    });
  });
});
