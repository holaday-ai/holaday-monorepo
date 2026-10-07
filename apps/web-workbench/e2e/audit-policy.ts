import fs from 'node:fs';
import path from 'node:path';
import type { BrowserContext } from 'playwright/test';

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
}

export type ControlDecision = 'input' | 'safe' | 'final-action' | 'unreviewed';

// Deny before allow: labels alone never authorize a final production mutation.
const FINAL_ACTION = /删除|清除|移到|置顶|取消置顶|重命名|重新执行|重试关联|暂停|恢复|停用|启用|退款|支付|付款|购买|升级|充值|提现|注销|退出登录|登出|解绑|绑定|保存|应用设置|确认|确定|提交|发送|生成|开始执行|立即执行|运行自检|测试连接|安装|接受邀请|邀请成员|发布|上传/;
const SAFE_ACTION = /^(取消|关闭.*|返回.*|上一步|下一步|新任务|搜索任务.*|切换侧边栏|技能|股市任务|今日能量|视频任务|图片任务|规划任务|文件库|项目|管理后台|任务|批量管理任务|任务菜单|更多.*|查看.*|加载更多.*|重试加载更多|选择图片模型|选择视频模型|选择项目|选择技能|执行模式|附件与任务选项|展开输入框|收起输入框|参考资料|添加参考资料|浏览器工作区|通知.*|全部|最近|用示例填入.*|个人资料|设置|套餐与账单|任务历史|用量|帮助.*|系统自检|模型管理)$/;

export function decideControl(control: Control): ControlDecision {
  // Source-reviewed model/spec/project dialogs only change local creative drafts.
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
      ['image', 'font', 'stylesheet'].includes(request.resourceType()) && !request.headers()['authorization'];
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
    for (const match of source.matchAll(/trpc\s*\.\s*([\w\s.]+?)\s*\.\s*query\s*\(/g)) {
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
