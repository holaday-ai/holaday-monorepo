import { classifyBrowserErrorKind } from './browser-error-kind';

export interface FriendlyFailure {
  title: string;
  subtitle: string;
  nextStep: string;
}

/**
 * Map a raw terminal failure message to the two-line headline shown
 * at the top of the result card. The task is already terminal here,
 * so recovery copy must point to retrying the task, not "continue"
 * flows that only exist while the agent is still awaiting_user.
 */
export function classifyFriendlyFailure(errorText: string): FriendlyFailure {
  const haystack = (errorText ?? '').toLowerCase();
  const browserKind = classifyBrowserErrorKind(errorText);
  if (browserKind === 'dns') {
    return {
      title: '无法打开这个网站',
      subtitle: '请检查网址是否正确，或换一个能直接访问的页面。',
      nextStep: '确认网址可以直接打开后重新执行。',
    };
  }
  if (browserKind === 'ssl') {
    return {
      title: '网站证书异常',
      subtitle: '这个网站无法安全连接。请确认网址是否正确，或换一个可信来源。',
      nextStep: '确认网址安全后重新执行，或换一个站点。',
    };
  }
  if (browserKind === 'connection') {
    return {
      title: '无法连接到这个网站',
      subtitle: '服务器拒绝连接或网络不可达。请稍后重试，或换一个站点。',
      nextStep: '稍后重新执行，或换一个能直接访问的网址。',
    };
  }
  if (browserKind === 'page_switch') {
    return {
      title: '页面正在切换',
      subtitle: '网站跳转太快导致本次步骤失效，请重试当前任务。',
      nextStep: '重新执行时尽量从稳定页面开始。',
    };
  }
  if (browserKind === 'hibernated') {
    return {
      title: '浏览器已休眠',
      subtitle: '这个浏览器会话已经释放。重新执行任务会打开新的浏览器。',
      nextStep: '重新执行当前任务。',
    };
  }
  if (
    /dns|enotfound|getaddrinfo|net::err_name|net::err_address|无法访问|网络错误|网络异常|解析失败/.test(
      haystack,
    )
  ) {
    return {
      title: '无法打开这个网站',
      subtitle: '请检查网址是否正确，或换一个能直接访问的页面。',
      nextStep: '确认网址可以直接打开后重新执行。',
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
      nextStep: '等页面稳定后重新执行当前任务。',
    };
  }
  if (
    /扩展.*未连接|no_extension|extension.*not connected|receiving end does not exist|could not establish connection/.test(
      haystack,
    )
  ) {
    return {
      title: '浏览器扩展未连接',
      subtitle: '请打开 HOLA DAY 扩展后重试；如果不用扩展，也可以重新执行任务。',
      nextStep: '打开 HOLA DAY 扩展，再重新执行任务。',
    };
  }
  if (browserKind === 'extension_permission') {
    return {
      title: '浏览器扩展缺少权限',
      subtitle: '扩展没有当前网站的访问权限，因此无法继续操作页面。',
      nextStep: '在扩展里允许访问该网站后重新执行当前任务。',
    };
  }
  if (browserKind === 'invalid_url') {
    return {
      title: '网址格式不支持',
      subtitle: '浏览器只能打开 http(s) 网页链接。请检查网址后重试。',
      nextStep: '改用 http:// 或 https:// 开头的网址后重新执行。',
    };
  }
  if (browserKind === 'extension_disconnected') {
    return {
      title: '浏览器扩展已断开',
      subtitle: '扩展连接在执行中断开。请重新打开 HOLA DAY 扩展后重试。',
      nextStep: '确认扩展在线，再重新执行当前任务。',
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
      nextStep: '重新执行任务会建立新的浏览器会话。',
    };
  }
  if (/execution context.*destroyed|frame detached|frame[^\w]not|页面.*切换/.test(haystack)) {
    return {
      title: '页面正在切换',
      subtitle: '网站跳转太快导致本次步骤失效，请重试当前任务。',
      nextStep: '重新执行时尽量从稳定页面开始。',
    };
  }
  if (/timeout|timed.?out|超时/.test(haystack)) {
    return {
      title: '操作超时',
      subtitle: '目标网站响应太慢，请稍后再试。',
      nextStep: '稍后重新执行，或换一个响应更稳定的网址。',
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
      nextStep: '重新执行后在浏览器里完成验证。',
    };
  }
  if (/login|sign[\s_-]?in|登录|401|未登录|unauthor|凭据|需要授权/.test(haystack)) {
    return {
      title: '需要先登录',
      subtitle: '请重新执行；如果再次停在登录页，请先完成登录。',
      nextStep: '重新执行后在浏览器里完成登录。',
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
      nextStep: '重新执行任务，或换一个更稳定的网址。',
    };
  }
  return {
    title: '任务未能完成',
    subtitle: '请重试，或换一种描述方式（更具体的指令、提供示例数据）。',
    nextStep: '换一种更具体的描述后重新执行。',
  };
}
