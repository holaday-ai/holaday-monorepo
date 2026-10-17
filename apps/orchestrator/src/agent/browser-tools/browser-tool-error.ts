import { PageRedactionError, REDACTION_FAILED_COPY } from './page-redaction.js';

/** Diagnostics may be persisted and shown to a model: no URL credentials/query or stack. */
export function browserToolError(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error);
  const errorMessage = raw
    .split('\n')[0]!
    .replace(/https?:\/\/[^\s"'<>]+/gi, '[URL redacted]')
    .replace(/\b(?:Bearer|Basic)\s+\S+/gi, '[credential redacted]')
    .replace(
      /((?:password|token|secret|api[_-]?key|cookie|authorization)\s*[:=]\s*)[^,;\s]+/gi,
      '$1[redacted]',
    )
    .slice(0, 500);
  let errorCode = 'browser_operation_failed';
  let text = '浏览器操作失败，请根据错误信息检查页面后重试';
  if (error instanceof PageRedactionError) {
    errorCode = 'redaction_failed';
    text = REDACTION_FAILED_COPY;
  } else if (
    /^stale_(?:observation|cursor)$/.test(raw) ||
    /(?:aria-ref.*(?:not found|no node)|no node found.*aria-ref)/i.test(raw)
  ) {
    errorCode = 'stale_ref';
    text = '该 cursor/ref 已失效，请重新 read_page / snapshot 后操作';
  } else if (raw === 'stale_context') {
    errorCode = 'stale_context';
    text = '目标标签或 frame 不属于当前任务或已关闭，请重新 list_tabs / read_page';
  } else if (/Target.*closed|page.*closed|browser.*closed|frame.*detached/i.test(raw)) {
    errorCode = 'browser_context_closed';
    text = '浏览器页面或连接已关闭，请恢复浏览器后重试';
  } else if (/Timeout/i.test(raw)) {
    errorCode = 'browser_timeout';
    text = '操作超时，请重新 snapshot 确认页面状态';
  } else if (/net::|ERR_|ECONN|ENOTFOUND/i.test(raw)) {
    errorCode = 'browser_network_failed';
    text = '浏览器导航或网络请求失败，请检查目标地址后重试';
  } else if (/evaluate|ReferenceError|__name/.test(raw)) {
    errorCode = 'observation_evaluation_failed';
    text = '页面观察脚本执行失败，请重试或联系支持';
  }
  return { ok: false as const, text, errorCode, errorMessage };
}
