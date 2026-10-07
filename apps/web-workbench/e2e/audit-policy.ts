import fs from 'node:fs';
import path from 'node:path';
import type { BrowserContext, Page, Request } from 'playwright/test';

export interface Control {
  key: string;
  selector: string;
  label: string;
  tag: string;
  role: string;
  href: string | null;
  type: string | null;
  expanded: string | null;
  disabled: boolean;
  hasReason: boolean;
  draftChoice?: boolean;
  passiveBoundary?: boolean;
  sharedSidebar?: boolean;
}

export type ControlDecision = 'input' | 'safe' | 'final-action' | 'unreviewed';

// Deny before allow: labels alone never authorize a final production mutation.
const FINAL_ACTION = /删除|清除|移到|置顶|取消置顶|重命名|重新执行|重试关联|暂停|恢复|停用|启用|退款|支付|付款|购买|升级|充值|提现|注销|退出登录|登出|解绑|绑定|保存|应用设置|确认|确定|提交|发送|生成|开始执行|立即执行|运行自检|测试连接|安装|接受邀请|邀请成员|发布|上传/;
const SAFE_ACTION = /^(取消|关闭.*|返回.*|上一步|下一步|新任务|搜索任务.*|切换侧边栏|打开任务列表|技能|股市任务|今日能量|视频任务|图片任务|规划任务|文件库|项目|管理后台|任务|批量管理任务|任务菜单|更多.*|查看.*|加载更多.*|重试加载更多|选择图片模型|选择视频模型|选择项目|选择技能|执行模式|附件与任务选项|展开输入框|收起输入框|参考资料|添加参考资料|浏览器工作区|通知.*|全部|最近|用示例填入.*|个人资料|设置|套餐与账单|任务历史|用量|帮助.*|系统自检|模型管理)$/;

export function decideControl(control: Control): ControlDecision {
  // Source-reviewed model/spec/project dialogs only change local creative drafts.
  if (/显示密码|查看密码|显示.*密钥|查看.*密钥|复制.*密钥|显示.*Token|查看.*Token/i.test(control.label)) return 'final-action';
  if (control.draftChoice) return 'safe';
  // These labels open draft-only settings, not generation submission.
  if (control.label === '生成设置') return 'safe';
  if (FINAL_ACTION.test(control.label)) return 'final-action';
  if (control.href) {
    if (control.href.startsWith('#')) return 'safe';
    if (control.href.startsWith('/') && !control.href.startsWith('//') &&
      !/^\/(api|logout|auth)(\/|$)/.test(control.href)) return 'safe';
    // External links are inspected for target/rel without transmitting/navigating.
    return 'unreviewed';
  }
  if (control.tag === 'input' || control.tag === 'textarea' || control.tag === 'select') {
    return ['submit', 'button', 'file', 'checkbox', 'radio', 'password', 'hidden'].includes(control.type ?? '')
      ? 'unreviewed' : 'input';
  }
  if (['tab', 'combobox'].includes(control.role)) return 'safe';
  if (control.expanded !== null || SAFE_ACTION.test(control.label)) return 'safe';
  return 'unreviewed';
}

export async function registerReadOnlyGuard(context: BrowserContext, baseOrigin: string, procedures: Set<string>, onBlock: (entry: string) => void): Promise<void> {
  await context.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const asset = request.method() === 'GET' && url.protocol === 'https:' &&
      ['image', 'font', 'stylesheet'].includes(request.resourceType()) && !request.headers().authorization;
    if (allowRequest(request.method(), url, baseOrigin, procedures) || asset) {
      await route.fallback();
      return;
    }
    onBlock(`${request.method()} ${url.origin === baseOrigin ? url.pathname : '[external destination]'}`);
    await route.fulfill({ status: 409, headers: { 'x-holaday-ui-audit': 'read-only-block' }, contentType: 'application/json', body: '{"error":"UI_AUDIT_READ_ONLY_GUARD"}' });
  });
  await context.routeWebSocket('**/*', socket => {
    onBlock('WS [stream excluded from live actions]');
    socket.close();
  });
}

const activeReads = new WeakMap<Page, Set<Request>>();
const timedOutReads = new WeakSet<Request>();
export function trackAuditReads(page: Page): void {
  const pending = new Set<Request>();
  activeReads.set(page, pending);
  page.on('framenavigated', frame => { if (frame === page.mainFrame()) pending.clear(); });
  page.on('request', request => {
    if (request.method() === 'GET' && ['127.0.0.1', 'localhost'].includes(new URL(request.url()).hostname) && new URL(request.url()).pathname.startsWith('/api/trpc/')) pending.add(request);
  });
  page.on('requestfinished', request => pending.delete(request));
  page.on('requestfailed', request => pending.delete(request));
}
export async function waitForAuditReads(page: Page, timeoutMs = 12_000): Promise<void> {
  const pending = activeReads.get(page);
  const fail = (): never => {
    for (const request of pending ?? []) timedOutReads.add(request);
    const paths = [...(pending ?? [])].map(request => decodeURIComponent(new URL(request.url()).pathname.slice('/api/trpc/'.length))).filter(name => /^[\w.,-]+$/.test(name)).slice(0, 16);
    throw new Error(`Production read requests did not settle within the bounded observation window: ${JSON.stringify(paths)}`);
  };
  // An identical outstanding request has already exhausted its observation window.
  // Continue to report failure, but do not spend another full window per nested action.
  if (pending?.size && [...pending].every(request => timedOutReads.has(request))) fail();
  const deadline = Date.now() + timeoutMs;
  do {
    await page.waitForTimeout(100);
    if (!pending?.size) { await page.waitForTimeout(200); if (!pending?.size) return; }
  } while (Date.now() < deadline);
  fail();
}

function sourceFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(file) : /\.(ts|tsx)$/.test(file) && !/\.(test|spec)\./.test(file) ? [file] : [];
  });
}

export function readProcedures(sourceRoot: string): Set<string> {
  const procedures = new Set<string>();
  for (const file of sourceFiles(sourceRoot)) {
    const source = fs.readFileSync(file, 'utf8');
    const clients = ['trpc', ...[...source.matchAll(/\b(?:const|let)\s+(\w+)(?:\s*:[^;\n=]+)?\s*=\s*trpc\s*;/g)].map(match => match[1])];
    const reads = new RegExp(`(?:${clients.join('|')})\\s*\\.\\s*([\\w\\s.]+?)\\s*\\.\\s*query\\b`, 'g');
    for (const match of source.matchAll(reads)) {
      procedures.add(match[1].replace(/\s/g, ''));
    }
  }
  return procedures;
}

export function allowRequest(method: string, url: URL, baseOrigin: string, procedures: Set<string>): boolean {
  if (url.origin !== baseOrigin) return false;
  if (method !== 'GET' && method !== 'HEAD') return false;
  if (!url.pathname.startsWith('/api/')) return !/^\/(ws|screencast-ws|vnc-ws)(\/|$)/.test(url.pathname);
  if (url.pathname.startsWith('/api/trpc/')) {
    const names = decodeURIComponent(url.pathname.slice('/api/trpc/'.length)).split(',');
    return names.length > 0 && names.every(name => procedures.has(name));
  }
  return /^\/api\/(healthz|files\/[^/]+\/(download|preview))$/.test(url.pathname);
}

export function routePatterns(appSource: string): string[] {
  return [...new Set([...appSource.matchAll(/<Route\s+(?:[^>]*?\s)?path="([^"]+)"/g)].map(match => match[1]))];
}
