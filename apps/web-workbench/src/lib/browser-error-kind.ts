export type BrowserErrorKind =
  | 'dns'
  | 'ssl'
  | 'timeout'
  | 'connection'
  | 'extension_timeout'
  | 'extension_missing'
  | 'extension_disconnected'
  | 'extension_permission'
  | 'invalid_url'
  | 'no_active_tab'
  | 'transport_closed'
  | 'page_switch'
  | 'hibernated'
  | 'captcha'
  | 'login'
  | 'generic_browser';

export function classifyBrowserErrorKind(
  raw: string | null | undefined,
): BrowserErrorKind | null {
  const text = raw?.trim().toLowerCase();
  if (!text) return null;

  if (/扩展工具调用超时|浏览器扩展响应超时|extension tool.*timeout|browser tool.*timeout/.test(text)) {
    return 'extension_timeout';
  }
  if (
    /扩展.*未连接|no_extension|extension.*not connected|receiving end does not exist|could not establish connection/.test(
      text,
    )
  ) {
    return 'extension_missing';
  }
  if (
    /cannot access contents of (the )?url|extension manifest must request permission|missing host permission|host permission|扩展.*权限|浏览器.*权限不足/.test(
      text,
    )
  ) {
    return 'extension_permission';
  }
  if (/bad_args|bad_url|invalid url|expected http\(s\) url|只支持.*http|不支持.*网址|网址.*无效|导航地址无效/.test(text)) {
    return 'invalid_url';
  }
  if (
    /浏览器扩展连接已断开|扩展.*断开|extension.*disconnect|extension.*closed|socket_closed|message port closed before a response/.test(
      text,
    )
  ) {
    return 'extension_disconnected';
  }
  if (/no_active_tab|没有活动标签页|当前没有活动标签页/.test(text)) {
    return 'no_active_tab';
  }
  if (/browser not allocated|no browser allocated|409|hibernat|idle-timeout|休眠/.test(text)) {
    return 'hibernated';
  }
  if (
    /dns|enotfound|getaddrinfo|dns_probe_finished_nxdomain|err_name_not_resolved|err_name_resolution_failed|net::err_name|无法访问|解析失败/.test(
      text,
    )
  ) {
    return 'dns';
  }
  if (/err_cert|ssl error|err_ssl|certificate_verify_failed|证书/.test(text)) {
    return 'ssl';
  }
  if (
    /execution context.*destroyed|frame.*detached|frame[^\w]not|err_aborted|navigation.*interrupted|页面.*切换/.test(
      text,
    )
  ) {
    return 'page_switch';
  }
  if (/target closed|session closed|socket_closed|websocket.*closed|browser.*disconnected|cdp.*closed|连接.*中断/.test(text)) {
    return 'transport_closed';
  }
  if (/err_connection_refused|err_connection_reset|err_address_unreachable|err_internet_disconnected/.test(text)) {
    return 'connection';
  }
  if (/navigation.*timeout|navigate.*timeout|timeout|timed.?out|err_timed_out|err_connection_timed_out|超时/.test(text)) {
    return 'timeout';
  }
  if (/captcha|recaptcha|hcaptcha|cloudflare|人机|验证码|滑块|are you a (human|robot)/.test(text)) {
    return 'captcha';
  }
  if (/login|sign[\s_-]?in|登录|401|未登录|unauthor|凭据|需要授权/.test(text)) {
    return 'login';
  }
  if (/browser|chromium|brave|cdp|websocket|浏览器|screencast/.test(text)) {
    return 'generic_browser';
  }
  return null;
}
