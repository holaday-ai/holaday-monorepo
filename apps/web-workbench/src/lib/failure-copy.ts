export interface FriendlyFailure {
  title: string;
  subtitle: string;
}

/**
 * Map a raw terminal failure message to the two-line headline shown
 * at the top of the result card. The task is already terminal here,
 * so recovery copy must point to retrying the task, not "continue"
 * flows that only exist while the agent is still awaiting_user.
 */
export function classifyFriendlyFailure(errorText: string): FriendlyFailure {
  const haystack = (errorText ?? '').toLowerCase();
  if (
    /dns|enotfound|getaddrinfo|net::err_name|net::err_address|无法访问|网络错误|网络异常|解析失败/.test(
      haystack,
    )
  ) {
    return {
      title: '无法打开这个网站',
      subtitle: '请检查网址是否正确，或换一个能直接访问的页面。',
    };
  }
  if (
    /扩展工具调用超时|extension tool.*timeout|browser tool.*timeout|navigation.*timeout|navigate.*timeout/.test(
      haystack,
    )
  ) {
    return {
      title: '浏览器响应超时',
      subtitle: '页面可能仍在加载，或浏览器扩展连接短暂中断。请重试当前任务。',
    };
  }
  if (/扩展.*未连接|no_extension|extension.*not connected/.test(haystack)) {
    return {
      title: '浏览器扩展未连接',
      subtitle: '请打开 HOLA DAY 扩展后重试；如果不用扩展，也可以重新执行任务。',
    };
  }
  if (
    /protocol error|target closed|session closed|socket_closed|websocket.*closed|browser.*disconnected|cdp.*closed|连接.*中断/.test(
      haystack,
    )
  ) {
    return {
      title: '浏览器连接中断',
      subtitle: '浏览器会话已断开，请重新执行任务。',
    };
  }
  if (/execution context.*destroyed|frame detached|frame[^\w]not|页面.*切换/.test(haystack)) {
    return {
      title: '页面正在切换',
      subtitle: '网站跳转太快导致本次步骤失效，请重试当前任务。',
    };
  }
  if (/timeout|timed.?out|超时/.test(haystack)) {
    return {
      title: '操作超时',
      subtitle: '目标网站响应太慢，请稍后再试。',
    };
  }
  if (
    /captcha|recaptcha|hcaptcha|验证码|人机|滑块|cloudflare|are you a (human|robot)/.test(
      haystack,
    )
  ) {
    return {
      title: '网站要求验证身份',
      subtitle: '请重新执行；如果再次出现验证，请在浏览器里手动完成。',
    };
  }
  if (/login|sign[\s_-]?in|登录|401|未登录|unauthor|凭据|需要授权/.test(haystack)) {
    return {
      title: '需要先登录',
      subtitle: '请重新执行；如果再次停在登录页，请先完成登录。',
    };
  }
  if (
    /browser|chromium|brave|cdp|websocket|浏览器|frame[^\w]not|screencast/.test(
      haystack,
    )
  ) {
    return {
      title: '浏览器遇到问题',
      subtitle: '请重新执行任务；如果反复出现，可以换一个更稳定的网址。',
    };
  }
  return {
    title: '任务未能完成',
    subtitle: '请重试，或换一种描述方式（更具体的指令、提供示例数据）。',
  };
}
