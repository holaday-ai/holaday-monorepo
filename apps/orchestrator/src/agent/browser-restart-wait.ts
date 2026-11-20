export const BROWSER_RESTART_WAIT_CODE = 'BROWSER_RESULT_UNCONFIRMED';
export const BROWSER_RESTART_WAIT_QUESTION =
  '服务重启后，上次浏览器操作的结果尚未核实。请先检查当前页面和下载记录；已生效的操作不会自动重复。核对后请在新任务中明确剩余步骤。';

/** SQL JSON may be returned as text by an older adapter. Missing/corrupt data
 * never grants browser recovery semantics to an unrelated task. */
export function isLocalChromeTaskSource(value: unknown): boolean {
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return false;
    }
  }
  return (
    !!value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    (value as Record<string, unknown>).browserSource === 'local-chrome'
  );
}
