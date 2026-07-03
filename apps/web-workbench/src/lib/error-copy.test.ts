import { describe, expect, it } from 'vitest';
import { humaniseTaskError, taskActionError } from './error-copy';

describe('error-copy', () => {
  it('hides raw English technical failures behind friendly copy', () => {
    expect(humaniseTaskError('connect ECONNREFUSED 127.0.0.1:9222')).toBe(
      '任务执行出错，请重试。如果反复出现请联系 support@holaday.ai。',
    );
  });

  it('formats action toasts with the humanised task error', () => {
    expect(taskActionError('发送失败', 'browser unavailable')).toBe(
      '发送失败：浏览器服务暂时不可用，请稍后重试。',
    );
  });

  it('hides model provider internals in AI service errors', () => {
    expect(humaniseTaskError('API call timed out twice')).toBe('AI 服务连续超时，请稍后重试。');
    expect(humaniseTaskError('Anthropic API error: 429 rate_limit_error')).toBe(
      'AI 服务暂时无法处理请求，可能是请求信息不完整或额度受限。请稍后重试。',
    );
    expect(humaniseTaskError('Anthropic API error: overloaded_error')).toBe('AI 服务暂时出错，请稍后重试。');
  });

  it('hides PayPal SDK wording in payment component failures', () => {
    expect(humaniseTaskError('PayPal SDK failed to load')).toBe('PayPal 暂时无法加载，请刷新页面后重试。');
  });

  it('explains system-stopped tasks without generic failure copy', () => {
    expect(humaniseTaskError('ORCHESTRATOR_RESTART')).toBe(
      '服务刚重启过，这个任务没能继续。重新执行会保留旧记录并新开一次。',
    );
    expect(humaniseTaskError('等待用户响应超时（>35分钟），任务已自动释放。')).toBe(
      '等待你操作的时间已过，任务已自动释放。重新执行后会从新的浏览器会话开始。',
    );
    expect(humaniseTaskError('任务执行超过 20 分钟未更新，已自动标记失败。')).toBe(
      '任务长时间没有进展，已自动停止。可以重新执行，或把步骤拆小一点。',
    );
    expect(humaniseTaskError('queue timeout')).toBe(
      '排队等待时间过长，任务已自动停止。请稍后重新执行。',
    );
  });

  it('maps internal terminal status strings from batch items to user-facing copy', () => {
    expect(humaniseTaskError('task ended with status=partial_success')).toBe(
      '子任务进入需复核状态，请打开任务详情查看缺失项。',
    );
    expect(humaniseTaskError('task ended with status=failed')).toBe(
      '子任务未完成，请打开任务详情查看失败原因。',
    );
    expect(humaniseTaskError('task ended with status=cancelled')).toBe(
      '子任务已取消。',
    );
  });

  it('hides model secret names in missing configuration errors', () => {
    expect(humaniseTaskError('missing ANTHROPIC_API_KEY')).toBe(
      'AI 服务暂未配置，请联系 support@holaday.ai。',
    );
  });

  it('maps extension timeouts to user-facing browser copy', () => {
    expect(humaniseTaskError('扩展工具调用超时（已等待 30 秒，请确认浏览器标签页仍在加载或重试）')).toBe(
      '浏览器响应超时，页面可能仍在加载。请稍后重试。',
    );
  });

  it('maps browser transport closures before the generic English fallback', () => {
    expect(humaniseTaskError('Protocol error (Page.navigate): Target closed')).toBe(
      '浏览器连接中断，请重新执行任务。',
    );
    expect(
      humaniseTaskError(
        "WebSocket connection to 'wss://holaday.ai/ws' failed: Error during WebSocket handshake: Unexpected response code: 502",
      ),
    ).toBe('浏览器连接中断，请重新执行任务。');
    expect(humaniseTaskError('net::ERR_CONNECTION_CLOSED')).toBe(
      '浏览器连接中断，请重新执行任务。',
    );
  });

  it('maps missing extension clients without internal mode names', () => {
    expect(humaniseTaskError('扩展未连接，无法走 Mode B')).toBe(
      '浏览器扩展未连接，请打开 HOLA DAY 扩展后重试。',
    );
    expect(humaniseTaskError('Could not establish connection. Receiving end does not exist.')).toBe(
      '浏览器扩展未连接，请打开 HOLA DAY 扩展后重试。',
    );
  });

  it('maps extension disconnects to reconnect guidance', () => {
    expect(humaniseTaskError('socket_closed: 浏览器扩展连接已断开')).toBe(
      '浏览器扩展连接已断开，请重新打开 HOLA DAY 扩展后重试。',
    );
    expect(humaniseTaskError('Unchecked runtime.lastError: The message port closed before a response was received.')).toBe(
      '浏览器扩展连接已断开，请重新打开 HOLA DAY 扩展后重试。',
    );
  });

  it('maps extension host permission failures to permission guidance', () => {
    expect(
      humaniseTaskError(
        'Cannot access contents of url "https://example.com/". Extension manifest must request permission.',
      ),
    ).toBe('浏览器扩展缺少当前网站权限，请在扩展里允许访问该网站后重试。');
  });

  it('maps invalid browser URLs without leaking schema jargon', () => {
    expect(humaniseTaskError('bad_args: expected http(s) URL')).toBe(
      '网址格式不支持，请使用 http(s) 开头的网页链接后重试。',
    );
  });

  it('maps missing active tab failures to an actionable browser hint', () => {
    expect(humaniseTaskError('浏览器当前没有活动标签页')).toBe(
      '浏览器当前没有活动标签页，请打开一个网页后重试。',
    );
  });

  it('maps raw Chromium navigation failures before the generic fallback', () => {
    expect(humaniseTaskError('net::ERR_NAME_NOT_RESOLVED at https://nope.example')).toBe(
      '无法访问该网址，请检查网址是否拼写正确。',
    );
    expect(humaniseTaskError('net::ERR_CERT_AUTHORITY_INVALID')).toBe(
      '该网站证书有问题，无法安全连接。请确认网址是否正确或换一个站点。',
    );
    expect(humaniseTaskError('net::ERR_CONNECTION_REFUSED')).toBe(
      '无法连接到该站点，请稍后重试或换一个站点。',
    );
  });

  it('maps hibernated browser sessions before the generic fallback', () => {
    expect(humaniseTaskError('browser not allocated: idle-timeout hibernated')).toBe(
      '浏览器已休眠，重新执行任务会打开新的浏览器。',
    );
  });

  it('maps login and captcha browser blockers to explicit next steps', () => {
    expect(humaniseTaskError('login required before checkout')).toBe(
      '目标网站需要登录，请先完成登录后重试。',
    );
    expect(humaniseTaskError('Cloudflare captcha required')).toBe(
      '网站要求人机验证，请在浏览器里完成验证后继续，或重新执行任务。',
    );
  });
});
