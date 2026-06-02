const GENERIC_EXTENSION_ERROR =
  '操作没有完成，请稍后重试。如果反复出现，可以重新加载 HOLA DAY 扩展。';

const RULES: ReadonlyArray<{ match: RegExp; message: string }> = [
  {
    match: /401|unauthor|未登录|登录已失效|token/i,
    message: '登录状态已失效，请到 holaday.ai 重新登录后再试。',
  },
  {
    match: /extension.*not connected|receiving end does not exist|could not establish connection|扩展.*未连接/i,
    message: '浏览器扩展未连接，请重新加载 HOLA DAY 扩展后重试。',
  },
  {
    match: /service worker.*restart|extension context invalidated|extension.*reload|worker.*restarting/i,
    message: '浏览器扩展后台正在重启，请稍等几秒后重试。',
  },
  {
    match:
      /message port closed|extension.*disconnect|socket_closed|websocket.*closed|err_connection_(?:closed|reset)|连接.*中断/i,
    message: '浏览器连接中断，请重新打开 HOLA DAY 扩展后重试。',
  },
  {
    match: /502|bad gateway|websocket.*handshake|unexpected response code/i,
    message: '浏览器代理服务暂时不可用，请稍后重试；如果刚更新扩展，请重新加载 HOLA DAY。',
  },
  {
    match: /timeout|timed.?out|超时/i,
    message: '请求超时，页面或服务可能仍在加载，请稍后重试。',
  },
  {
    match: /cannot access contents|host permission|manifest must request permission|权限/i,
    message: '浏览器扩展缺少当前网站权限，请允许访问该网站后重试。',
  },
  {
    match: /invalid url|bad_url|expected http|网址.*无效/i,
    message: '网址格式不支持，请使用 http(s) 开头的网页链接。',
  },
  {
    match: /failed to fetch|network|err_connection|err_internet|enotfound|dns/i,
    message: '网络连接失败，请检查网络后重试。',
  },
];

export function humanizeExtensionError(
  error: unknown,
  fallback = GENERIC_EXTENSION_ERROR,
): string {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : '';
  const text = raw.trim();
  if (!text) return fallback;
  for (const rule of RULES) {
    if (rule.match.test(text)) return rule.message;
  }
  if (looksLikeEnglishTech(text)) return fallback;
  return text;
}

function looksLikeEnglishTech(text: string): boolean {
  let ascii = 0;
  for (const ch of text) {
    if (ch.codePointAt(0)! < 128) ascii += 1;
  }
  return ascii / text.length > 0.85;
}
