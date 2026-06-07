import { describe, expect, it } from 'vitest';
import {
  classifyFriendlyFailure,
  failureResultCopyText,
  friendlyFailureDetail,
  terminalAllowsRerun,
} from './failure-copy';

describe('classifyFriendlyFailure', () => {
  it('separates system-stopped task failures from website failures', () => {
    expect(classifyFriendlyFailure('ORCHESTRATOR_RESTART')).toEqual({
      title: '服务重启中断了任务',
      subtitle: '这个任务没能继续执行；旧记录会保留，重新执行会新开一次尝试。',
      nextStep: '重新执行当前任务。',
    });
    expect(classifyFriendlyFailure('等待用户响应超时（>35分钟），任务已自动释放。')).toEqual({
      title: '等待操作超时',
      subtitle: '任务等你登录、验证或确认太久，已经自动释放资源。',
      nextStep: '重新执行后在新的浏览器会话里继续操作。',
    });
    expect(classifyFriendlyFailure('任务执行超过 20 分钟未更新，已自动标记失败。')).toEqual({
      title: '任务长时间没有进展',
      subtitle: 'HOLA DAY 已自动停止这次尝试，避免任务一直卡在执行中。',
      nextStep: '可以重新执行，或把目标拆成更小的步骤。',
    });
  });

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
      subtitle: '页面可能仍在加载，或浏览器扩展连接短暂中断。请重新执行当前任务。',
      nextStep: '等页面稳定后重新执行当前任务。',
    });
  });

  it('explains missing extension clients without Mode B jargon', () => {
    expect(classifyFriendlyFailure('扩展未连接，无法走 Mode B')).toEqual({
      title: '浏览器扩展未连接',
      subtitle: '请打开 HOLA DAY 扩展后重试；如果不用扩展，也可以重新执行任务。',
      nextStep: '打开 HOLA DAY 扩展，再重新执行任务。',
    });
    expect(classifyFriendlyFailure('Could not establish connection. Receiving end does not exist.')).toEqual({
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
    expect(classifyFriendlyFailure('The message port closed before a response was received.')).toEqual({
      title: '浏览器扩展已断开',
      subtitle: '扩展连接在执行中断开。请重新打开 HOLA DAY 扩展后重试。',
      nextStep: '确认扩展在线，再重新执行当前任务。',
    });
  });

  it('explains extension host permission failures', () => {
    expect(
      classifyFriendlyFailure(
        'Cannot access contents of url "https://example.com/". Extension manifest must request permission.',
      ),
    ).toEqual({
      title: '浏览器扩展缺少权限',
      subtitle: '扩展没有当前网站的访问权限，因此无法继续操作页面。',
      nextStep: '在扩展里允许访问该网站后重新执行当前任务。',
    });
  });

  it('explains invalid browser URLs as fixable input', () => {
    expect(classifyFriendlyFailure('bad_args: expected http(s) URL')).toEqual({
      title: '网址格式不支持',
      subtitle: '浏览器只能打开 http(s) 网页链接。请检查网址后重试。',
      nextStep: '改用 http:// 或 https:// 开头的网址后重新执行。',
    });
  });

  it('classifies raw browser transport closures as disconnected sessions', () => {
    expect(classifyFriendlyFailure('Protocol error (Page.navigate): Target closed')).toEqual({
      title: '浏览器连接中断',
      subtitle: '浏览器会话已断开，请重新执行任务。',
      nextStep: '重新执行任务会建立新的浏览器会话。',
    });
    expect(
      classifyFriendlyFailure(
        "WebSocket connection to 'wss://hd-app.orangebench.tech/ws' failed: Error during WebSocket handshake: Unexpected response code: 502",
      ),
    ).toEqual({
      title: '浏览器连接中断',
      subtitle: '浏览器会话已断开，请重新执行任务。',
      nextStep: '重新执行任务会建立新的浏览器会话。',
    });
    expect(classifyFriendlyFailure('net::ERR_CONNECTION_CLOSED')).toEqual({
      title: '浏览器连接中断',
      subtitle: '浏览器会话已断开，请重新执行任务。',
      nextStep: '重新执行任务会建立新的浏览器会话。',
    });
  });

  it('classifies fast page changes as transient page switching', () => {
    expect(classifyFriendlyFailure('Execution context was destroyed, most likely because of a navigation')).toEqual({
      title: '页面正在切换',
      subtitle: '网站跳转太快导致本次步骤失效，请重新执行当前任务。',
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

  it('offers re-run for both failed and cancelled terminal tasks', () => {
    // Both surface "重新执行" recovery copy, so both must allow the
    // button — otherwise cancelled tasks promise a re-run they can't do.
    expect(terminalAllowsRerun('failed')).toBe(true);
    expect(terminalAllowsRerun('cancelled')).toBe(true);
    // Non-terminal / success states never show the failure card's retry.
    expect(terminalAllowsRerun('completed')).toBe(false);
    expect(terminalAllowsRerun('partial_success')).toBe(false);
    expect(terminalAllowsRerun('awaiting_user')).toBe(false);
    expect(terminalAllowsRerun('executing')).toBe(false);
  });

  it('builds friendly, raw-error-free copy text for failed results', () => {
    // The footer copy/download must never serialise the raw technical
    // error the user can't read.
    expect(
      failureResultCopyText('Protocol error (Page.navigate): Target closed'),
    ).toBe(
      '浏览器连接中断\n浏览器会话已断开，请重新执行任务。\n下一步：重新执行任务会建立新的浏览器会话。',
    );
    expect(
      failureResultCopyText('Protocol error (Page.navigate): Target closed'),
    ).not.toMatch(/Protocol error|Target closed/);
    // Empty / unknown errors still yield a usable summary, never '' .
    expect(failureResultCopyText('')).toBe(
      '任务未能完成\n请重试，或换一种描述方式（更具体的指令、提供示例数据）。\n下一步：换一种更具体的描述后重新执行。',
    );
  });

  it('hides raw English failure details while keeping localized details', () => {
    expect(friendlyFailureDetail('Protocol error (Page.navigate): Target closed')).toBe(
      '浏览器连接中断，请重新执行任务。',
    );
    expect(friendlyFailureDetail('目标网站要求登录')).toBe('目标网站要求登录');
  });
});
