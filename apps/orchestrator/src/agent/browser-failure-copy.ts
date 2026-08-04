export function friendlyBrowserFailureReason(raw: string | null | undefined): string | null {
  const r = raw?.trim().toLowerCase();
  if (!r) return null;

  const missingExtension =
    /扩展.*未连接|no_extension|extension.*not connected|receiving end does not exist|could not establish connection/;
  const extensionPermission =
    /cannot access contents of (the )?url|extension manifest must request permission|missing host permission|host permission|扩展.*权限|浏览器.*权限不足/;
  const extensionDisconnected =
    /socket_closed|浏览器扩展连接已断开|extension.*disconnect|extension.*closed|message port closed before a response/;

  if (missingExtension.test(r)) {
    return '浏览器扩展未连接。请打开 HOLA DAY 扩展后重试。';
  }
  if (extensionPermission.test(r)) {
    return '浏览器扩展缺少当前网站权限。请在扩展里允许访问该网站后重试。';
  }
  if (extensionDisconnected.test(r)) {
    return '浏览器扩展连接已断开。请重新打开 HOLA DAY 扩展后重试。';
  }
  if (/扩展工具调用超时|浏览器扩展响应超时|extension tool.*timeout|browser tool.*timeout/.test(r)) {
    return '浏览器扩展响应超时。页面可能仍在加载，请稍后重试。';
  }
  if (/browser not allocated|no browser allocated|hibernat|idle-timeout|休眠/.test(r)) {
    return '浏览器已休眠。重新执行任务会打开新的浏览器。';
  }
  if (
    /protocol error|target closed|session closed|websocket.*closed|browser.*disconnected|cdp.*closed|连接.*中断/.test(
      r,
    )
  ) {
    return '浏览器连接中断。请重新执行任务。';
  }
  if (
    /execution context.*destroyed|frame.*detached|frame[^\w]not|err_aborted|navigation.*interrupted/.test(
      r,
    )
  ) {
    return '页面正在切换，本次浏览器步骤未能稳定完成。请重试。';
  }
  if (
    /dns|enotfound|getaddrinfo|dns_probe_finished_nxdomain|err_name_not_resolved|err_name_resolution_failed|net::err_name/.test(
      r,
    )
  ) {
    return '无法访问该网址。请检查网址是否拼写正确。';
  }
  if (/err_cert|ssl error|err_ssl|certificate_verify_failed|证书/.test(r)) {
    return '该网站证书有问题，无法安全连接。请确认网址是否正确或换一个站点。';
  }
  if (
    /err_connection_closed|err_connection_refused|err_connection_reset|err_address_unreachable|err_internet_disconnected/.test(
      r,
    )
  ) {
    return '无法连接到该站点。请稍后重试或换一个站点。';
  }
  return null;
}
