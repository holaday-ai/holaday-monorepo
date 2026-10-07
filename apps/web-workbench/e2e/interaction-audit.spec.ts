import fs from 'node:fs';
import path from 'node:path';
import { test, expect, type Page, type Locator } from 'playwright/test';
import { decideControl, readProcedures, registerReadOnlyGuard, routePatterns, type Control } from './audit-policy';

type Finding = { id: string; severity: 'P0' | 'P1' | 'P2'; page: string; element: string; steps: string; expected: string; actual: string; screenshot?: string };
type Coverage = { page: string; element?: string; status: string; rule?: string };
type Audit = { viewport: string; mode: string; base: string; findings: Finding[]; coverage: Coverage[]; safetyBlocks: string[]; routes: string[]; started: string; finished?: string };
const output = path.resolve(process.env.HOLADAY_AUDIT_OUTPUT ?? 'e2e/artifacts');
const root = path.resolve('src');
const patterns = routePatterns(fs.readFileSync(path.join(root, 'App.tsx'), 'utf8'));
const readOnly = readProcedures(root);
const publicRoutes = new Set(['/login', '/register', '/privacy', '/terms', '/500', '/cosmic-preview']);
const popupSelector = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]';

function privateWrite(file: string, contents: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, contents, { mode: 0o600 });
  fs.chmodSync(file, 0o600);
}

function safePage(url: string, base: string): string {
  const parsed = new URL(url, base);
  // OAuth fragments and query parameters can contain credentials. Never record them.
  return parsed.origin === new URL(base).origin ? parsed.pathname : '[external destination]';
}

function writeReport(audit: Audit): void {
  privateWrite(path.join(output, `${audit.viewport}.json`), JSON.stringify(audit, null, 2));
  const reports: Audit[] = ['desktop', 'iphone-14'].flatMap(viewport => {
    const file = path.join(output, `${viewport}.json`);
    return fs.existsSync(file) ? [JSON.parse(fs.readFileSync(file, 'utf8')) as Audit] : [];
  });
  const escape = (value: string) => value.replace(/[\r\n|]/g, ' ').replace(/</g, '&lt;');
  const lines = ['# Holaday 全站交互审计', '', '安全边界：不执行生产写入、付费提交或历史记录操作；未分类控件与缺失动态路由明确列为覆盖缺口。控制台原文、请求头、请求体、URL 查询与登录态不进入报告。', ''];
  for (const result of reports) {
    const gaps = result.coverage.filter(entry => /blocked|unreviewed|missing|unavailable|not-verified/.test(entry.status));
    lines.push(`## ${result.viewport} · ${result.mode}`, '', `开始：${result.started}；结束：${result.finished ?? '运行中'}`, '', `问题 ${result.findings.length}；覆盖缺口 ${gaps.length}；拦截请求 ${result.safetyBlocks.length}。`, '');
    for (const finding of result.findings) lines.push(`### ${finding.id} · ${finding.severity}`, '', `页面：${escape(finding.page)}；元素：${escape(finding.element)}`, '', `复现：${escape(finding.steps)}`, '', `期望：${escape(finding.expected)}`, '', `实际：${escape(finding.actual)}`, '', finding.screenshot ? `![${finding.id}](${finding.screenshot})` : '截图：不可用（环境或登录态阻塞）', '');
    lines.push('### 覆盖缺口', '', '| 页面 | 元素/规则 | 状态 |', '| --- | --- | --- |');
    for (const gap of gaps) lines.push(`| ${escape(gap.page)} | ${escape(gap.element ?? gap.rule ?? '')} | ${escape(gap.status)} |`);
    lines.push('', '### 规则覆盖', '', '| 页面 | 元素/规则 | 状态 |', '| --- | --- | --- |');
    for (const entry of result.coverage.filter(entry => entry.rule)) lines.push(`| ${escape(entry.page)} | ${escape(entry.rule ?? '')} | ${escape(entry.status)} |`);
    lines.push('');
  }
  privateWrite(path.join(output, 'report.md'), lines.join('\n'));
}

async function finding(audit: Audit, page: Page, severity: Finding['severity'], element: string, steps: string, expected: string, actual: string): Promise<void> {
  const route = safePage(page.url(), audit.base);
  if (audit.findings.some(entry => entry.page === route && entry.element === element && entry.actual === actual)) return;
  const id = `${audit.viewport}-${String(audit.findings.length + 1).padStart(4, '0')}`;
  const file = path.join(output, 'screenshots', `${id}.png`);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  let screenshot: string | undefined;
  try {
    await page.screenshot({ path: file, fullPage: false, timeout: 10_000 });
    fs.chmodSync(file, 0o600);
    screenshot = file;
  } catch { /* Record missing evidence rather than inventing a screenshot. */ }
  audit.findings.push({ id, severity, page: route, element, steps, expected, actual, screenshot });
  writeReport(audit);
}

async function controls(page: Page): Promise<Control[]> {
  return page.evaluate(() => {
    const selector = 'button,a[href],input,select,textarea,[role="button"],[role="tab"],[role="menuitem"],[role="menuitemradio"],[role="switch"],[role="combobox"],[onclick]';
    const candidates = new Set<Element>(document.querySelectorAll(selector));
    // React delegates onClick instead of adding an HTML onclick attribute.
    for (const element of document.querySelectorAll('body *')) {
      const key = Object.keys(element).find(name => name.startsWith('__reactProps$'));
      if (key && typeof (element as unknown as Record<string, { onClick?: unknown }>)[key]?.onClick === 'function') candidates.add(element);
    }
    const counts = new Map<string, number>();
    return [...candidates].flatMap(element => {
      const rect = element.getBoundingClientRect();
      if (!rect.width || !rect.height || element.closest('[aria-hidden="true"], [inert]') || getComputedStyle(element).visibility === 'hidden') return [];
      const tag = element.tagName.toLowerCase();
      const role = element.getAttribute('role') ?? '';
      const label = element.getAttribute('aria-label') ?? element.getAttribute('title') ?? (element as HTMLInputElement).placeholder ?? element.textContent?.trim().slice(0, 100) ?? '';
      const href = element.getAttribute('href');
      const key = JSON.stringify([tag, role, label, href]);
      const occurrence = counts.get(key) ?? 0;
      counts.set(key, occurrence + 1);
      const id = `audit-${[...candidates].indexOf(element)}`;
      element.setAttribute('data-interaction-audit', id);
      const described = element.getAttribute('aria-describedby')?.split(/\s+/).some(id => Boolean(document.getElementById(id)?.textContent?.trim()));
      const dialog = element.closest('[role="dialog"]');
      const dialogTitle = dialog?.querySelector('h2, [id]')?.textContent?.trim() ?? '';
      const draftChoice = /^(选择图片模型|选择视频模型|视频规格|选择项目|图片生成设置)$/.test(dialogTitle);
      const nearby = element.parentElement?.querySelector('[role="status"], p, small');
      return [{ key: `${key}:${occurrence}`, selector: `[data-interaction-audit="${id}"]`, label, tag, role, href, type: element.getAttribute('type'), expanded: element.getAttribute('aria-expanded'), disabled: element.matches(':disabled') || element.getAttribute('aria-disabled') === 'true', draftChoice, hasReason: Boolean(element.getAttribute('title') || described || nearby?.textContent?.trim()) }];
    });
  });
}

async function state(page: Page): Promise<string> {
  return page.evaluate(() => JSON.stringify({
    text: document.body.innerText,
    states: [...document.querySelectorAll('[aria-expanded],[aria-selected],[aria-pressed],[aria-checked],:disabled,[role="dialog"],[role="menu"]')].map(element => [element.tagName, element.getAttribute('aria-expanded'), element.getAttribute('aria-selected'), element.getAttribute('aria-pressed'), element.getAttribute('aria-checked'), element.getAttribute('disabled'), element.textContent?.slice(0, 100)]),
  }));
}

async function settle(page: Page): Promise<void> {
  await page.waitForFunction(() => document.body.innerText.length > 40, { timeout: 20_000 });
  // A bounded stability check. Background polling may continue indefinitely.
  let previous = '';
  for (let attempt = 0; attempt < 15; attempt++) {
    const current = await state(page);
    if (current === previous) return;
    previous = current;
    await page.waitForTimeout(150);
  }
}

async function checkPopup(audit: Audit, page: Page, trigger: Locator, control: Control): Promise<void> {
  if (control.expanded !== 'false' && !/选择.*模型|生成设置|选择项目/.test(control.label)) return;
  const popups = page.locator(popupSelector).filter({ visible: true });
  if (!await popups.count()) return;
  const rule = '触发器重复点击/外部点击/Esc/互斥';
  const reopen = async () => { await trigger.click(); await settle(page); };
  await trigger.click(); await settle(page);
  if (await popups.count()) {
    await finding(audit, page, 'P1', control.label, '点击触发器展开，再点击同一触发器', '弹层收起', '再次点击后弹层仍打开');
    await page.keyboard.press('Escape');
  }
  await reopen();
  await page.keyboard.press('Escape'); await settle(page);
  if (await popups.count()) await finding(audit, page, 'P1', control.label, '展开后按 Esc', '弹层收起', 'Esc 未关闭弹层');
  await page.keyboard.press('Escape');
  await reopen();
  // Find a genuine outside point, not a button underneath the popup.
  const point = await page.evaluate(() => {
    for (const [x, y] of [[8, 8], [window.innerWidth - 8, window.innerHeight - 8], [window.innerWidth / 2, 8]]) {
      const element = document.elementFromPoint(x, y);
      if (element && !element.closest('button,a,input,[role="dialog"],[role="menu"],[role="listbox"]')) return { x, y };
    }
    return null;
  });
  if (point) {
    await page.mouse.click(point.x, point.y); await settle(page);
    if (await popups.count()) await finding(audit, page, 'P1', control.label, '展开后点击外部空白', '弹层收起', '外部点击未关闭弹层');
  } else audit.coverage.push({ page: safePage(page.url(), audit.base), element: control.label, status: 'not-verified: 没有安全的外部空白点', rule });
  await page.keyboard.press('Escape');
  // Cross-trigger mutual exclusion is verified for independently focusable nonmodal popovers.
  await reopen();
  const other = (await controls(page)).find(entry => entry.key !== control.key && entry.expanded === 'false' && decideControl(entry) === 'safe' && !entry.disabled);
  if (other) {
    const locator = page.locator(other.selector);
    try {
      await locator.click({ timeout: 2_000 }); await settle(page);
      if (await popups.count() > 1) await finding(audit, page, 'P1', control.label, '展开后点击另一弹层触发器', '同时最多一个弹层', '存在多个打开的弹层');
    } catch { audit.coverage.push({ page: safePage(page.url(), audit.base), element: control.label, status: 'not-verified: 另一触发器受焦点层遮挡', rule }); }
  } else audit.coverage.push({ page: safePage(page.url(), audit.base), element: control.label, status: 'not-verified: 无另一可用触发器', rule });
  await page.keyboard.press('Escape');
  audit.coverage.push({ page: safePage(page.url(), audit.base), element: control.label, status: 'checked', rule });
}

test('full route interaction audit against production reads', async ({ browser, baseURL }, testInfo) => {
  const base = baseURL!;
  const parsed = new URL(base);
  expect(['127.0.0.1', 'localhost'].includes(parsed.hostname), 'Audit must run against loopback preview').toBe(true);
  const audit: Audit = { viewport: testInfo.project.name, mode: process.env.HOLADAY_AUDIT_MODE ?? 'observe', base: parsed.origin, findings: [], coverage: [], safetyBlocks: [], routes: patterns, started: new Date().toISOString() };
  const storageFile = process.env.HOLADAY_AUDIT_STORAGE_STATE;
  if (!storageFile || !fs.existsSync(storageFile)) {
    audit.coverage.push({ page: '*', status: 'blocked: 缺少 BOSS 导出的 storageState', rule: '登录后全站审计' });
    audit.finished = new Date().toISOString(); writeReport(audit);
    throw new Error('Provide HOLADAY_AUDIT_STORAGE_STATE as a private local file path; never paste credentials into logs.');
  }
  const saved = JSON.parse(fs.readFileSync(storageFile, 'utf8')) as { origins: { origin: string; localStorage: { name: string; value: string }[] }[] };
  const origin = saved.origins?.find(entry => ['https://holaday.ai', 'https://hd-app.orangebench.tech', parsed.origin].includes(entry.origin) && entry.localStorage.some(item => item.name === 'holaday.access_token' && item.value));
  if (!origin) {
    audit.coverage.push({ page: '*', status: 'blocked: 导出文件没有 Holaday 登录态', rule: '登录后全站审计' });
    audit.finished = new Date().toISOString(); writeReport(audit);
    throw new Error('The exported storageState has no Holaday login; no secret values were logged.');
  }
  const context = await browser.newContext({ ...testInfo.project.use, storageState: { cookies: [], origins: [{ origin: parsed.origin, localStorage: origin.localStorage.filter(item => item.name === 'holaday.access_token') }] }, serviceWorkers: 'block' });
  const page = await context.newPage();
  const dynamicRoutes: Record<string, string> = {};
  let requests = 0;
  let documentLoads = 0;
  let consoleErrors = 0;
  let promiseErrors = 0;
  let badResponses = 0;
  await registerReadOnlyGuard(context, parsed.origin, readOnly, entry => audit.safetyBlocks.push(entry));
  page.on('dialog', dialog => { void dialog.dismiss(); });
  page.on('console', message => { if (message.type() === 'error') consoleErrors++; });
  page.on('pageerror', () => promiseErrors++);
  page.on('request', request => { requests++; if (request.isNavigationRequest() && request.frame() === page.mainFrame()) documentLoads++; });
  page.on('response', async response => {
    if (response.status() >= 400 && response.headers()['x-holaday-ui-audit'] !== 'read-only-block' && !(response.status() === 401 && publicRoutes.has(safePage(page.url(), base)))) badResponses++;
    // Discover real dynamic IDs only from read responses. No invented production records.
    if (!response.url().includes('/api/trpc/') || response.status() !== 200) return;
    try {
      const json: unknown = await response.json();
      const procedures = decodeURIComponent(new URL(response.url()).pathname.replace('/api/trpc/', '')).split(',');
      const walk = (value: unknown, depth = 0): void => {
        if (!value || typeof value !== 'object' || depth > 12) return;
        for (const [key, child] of Object.entries(value)) {
          if (typeof child === 'string' && /^[\w-]+$/.test(child)) {
            let pattern: string | undefined;
            if (key === 'projectId' && procedures.some(name => name.startsWith('projects.'))) pattern = '/projects/:projectId';
            if (key === 'projectId' && procedures.some(name => /videoEditing/.test(name))) pattern = '/video/edit/:projectId';
            if (key === 'userId') pattern = '/admin/users/:userId';
            if (key === 'batchId') pattern = '/batch/:batchId';
            if (key === 'domain') pattern = '/admin/learning/:domain';
            if (pattern && !dynamicRoutes[pattern]) dynamicRoutes[pattern] = pattern.replace(/:[\w]+/, encodeURIComponent(child));
          } else walk(child, depth + 1);
        }
      };
      walk(json);
    } catch { /* A failed body read is not evidence of an API failure. */ }
  });
  const explicit = process.env.HOLADAY_AUDIT_ROUTE_MAP ? JSON.parse(fs.readFileSync(process.env.HOLADAY_AUDIT_ROUTE_MAP, 'utf8')) as Record<string, string> : {};
  try {
    await page.goto('/'); await settle(page);
    if (await page.locator('input[type="password"]').isVisible() || await page.getByRole('button', { name: '使用 Google 登录', exact: true }).isVisible()) {
      await finding(audit, page, 'P0', '登录环境', '使用导出登录态打开本地预览', '测试账号进入工作台', '登录态失效或 API 不接受该登录态');
      audit.coverage.push({ page: '*', status: 'blocked: 登录态无效', rule: '全站登录后审计' });
      throw new Error('Login state unavailable; no authenticated route acceptance was performed.');
    }
    for (const pattern of patterns) {
      if (pattern === '*') { audit.coverage.push({ page: pattern, status: 'not-verified: 未提供真实未知路由', rule: '404 路由' }); continue; }
      const target = explicit[pattern] ?? dynamicRoutes[pattern] ?? pattern;
      if (target.includes(':') || !target.startsWith('/') || target.startsWith('//')) { audit.coverage.push({ page: pattern, status: 'missing: 没有可访问的真实动态对象', rule: '深链' }); continue; }
      if (pattern === '/account/closure-recovery' || pattern === '/organizations/invitations/accept') { audit.coverage.push({ page: pattern, status: 'blocked: 账号恢复/接受邀请有真实副作用', rule: '安全边界' }); continue; }
      const beforeErrors = [consoleErrors, promiseErrors, badResponses];
      await page.goto(target); await settle(page);
      audit.coverage.push({ page: pattern, status: 'opened', rule: '深链' });
      if (await page.locator('main').count() && !await page.locator('main').first().innerText()) await finding(audit, page, 'P0', '页面主体', '深链直开', '页面有主体内容', '页面主体为空');
      const width = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, viewport: window.innerWidth }));
      if (width.scroll > width.viewport + 1) await finding(audit, page, 'P1', '移动端布局', '按当前视口深链打开', '无横向滚动', `内容宽 ${width.scroll} 超过视口 ${width.viewport}`);
      audit.coverage.push({ page: pattern, status: 'checked', rule: '横向滚动' });
      const initial = await controls(page);
      const queue = initial.map(control => ({ control, ancestors: [] as string[] }));
      const seen = new Set<string>();
      for (let index = 0; index < queue.length; index++) {
        const { control, ancestors } = queue[index];
        const identity = `${ancestors.join('|')}/${control.key}`;
        if (seen.has(identity)) continue;
        seen.add(identity);
        await page.goto(target); await settle(page);
        let replayed = true;
        for (const key of ancestors) {
          const opener = (await controls(page)).find(entry => entry.key === key);
          if (!opener || decideControl(opener) !== 'safe') { replayed = false; break; }
          await page.locator(opener.selector).click(); await settle(page);
        }
        const current = replayed ? (await controls(page)).find(entry => entry.key === control.key) : undefined;
        if (!current) { audit.coverage.push({ page: pattern, element: control.label, status: 'unavailable: 控件在独立重放后不存在' }); continue; }
        const element = page.locator(current.selector);
        if (current.disabled) {
          if (!current.hasReason) await finding(audit, page, 'P2', current.label || '[无标签禁用控件]', '检查禁用控件', 'title、关联说明或旁边文字解释原因', '未找到禁用原因');
          audit.coverage.push({ page: pattern, element: current.label, status: 'checked', rule: '禁用原因' });
          continue;
        }
        if (current.href && /^https?:|^\/\//.test(current.href)) {
          if (await element.getAttribute('target') !== '_blank') await finding(audit, page, 'P1', current.label, '检查外链', '外链新开标签', '外链未设置 _blank');
          audit.coverage.push({ page: pattern, element: current.label, status: 'checked', rule: '外链新标签（静态检查，未外发）' }); continue;
        }
        if (await element.getAttribute('aria-selected') === 'true' || await element.getAttribute('aria-pressed') === 'true' || (current.role === 'menuitemradio' && await element.getAttribute('aria-checked') === 'true')) {
          audit.coverage.push({ page: pattern, element: current.label, status: 'checked: 当前选中项重复点击具有幂等语义', rule: '当前选中项' });
          continue;
        }
        const decision = decideControl(current);
        if (decision === 'final-action' || decision === 'unreviewed') { audit.coverage.push({ page: pattern, element: current.label || '[无标签控件]', status: decision === 'final-action' ? 'excluded: 最终写入/付费或即时持久化动作' : 'unreviewed: 需要确认行为后加入安全清单' }); continue; }
        if (decision === 'input') {
          await element.focus();
          expect(await element.evaluate(node => document.activeElement === node), 'Editable control receives focus').toBe(true);
          audit.coverage.push({ page: pattern, element: current.label, status: 'checked', rule: '输入焦点' }); continue;
        }
        const oldState = await state(page), oldUrl = page.url(), oldRequests = requests, oldLoads = documentLoads;
        try {
          // Trial detects obscured controls without forcing a click through overlays.
          await element.click({ trial: true, timeout: 2_000 });
          await element.click(); await settle(page);
        } catch {
          await finding(audit, page, 'P1', current.label || '[无标签控件]', '滚动到元素并尝试点击', '控件可点击', '元素被遮挡或无法正常点击'); continue;
        }
        if (page.url() === oldUrl && await state(page) === oldState && requests === oldRequests) await finding(audit, page, 'P1', current.label || '[无标签控件]', '独立打开页面后点击控件', '路由、DOM、请求或可编辑焦点产生变化', '点击没有可观察效果');
        if (current.href?.startsWith('/') && documentLoads > oldLoads) await finding(audit, page, 'P1', current.label, '点击应用内链接', 'React Router 页面切换', '触发整页刷新');
        if (/加载更多/.test(current.label)) {
          const beforeCount = initial.filter(entry => entry.label === '任务菜单').length;
          const afterCount = (await controls(page)).filter(entry => entry.label === '任务菜单').length;
          const noMore = /没有更多|已全部加载|没有更多可见/.test(await page.locator('body').innerText()) || !await page.getByRole('button', { name: /加载更多/ }).count();
          if (afterCount <= beforeCount && !noMore && pattern === '/') await finding(audit, page, 'P1', current.label, '点击加载更多并等待完成', '条目增加或明确提示没有更多', '可见条目未增加，按钮继续可点击');
          audit.coverage.push({ page: pattern, element: current.label, status: 'checked', rule: '分页/加载更多' });
        }
        if (page.url() === oldUrl) {
          const added = (await controls(page)).filter(entry => !initial.some(initialEntry => initialEntry.key === entry.key));
          if (ancestors.length < 3) for (const child of added) queue.push({ control: child, ancestors: [...ancestors, current.key] });
          await checkPopup(audit, page, element, current);
        } else {
          await page.goBack(); await settle(page);
          if (page.url() !== oldUrl) await finding(audit, page, 'P1', current.label, '应用内跳转后浏览器后退', '恢复上一 URL/页面状态', '后退没有返回原 URL');
          audit.coverage.push({ page: pattern, element: current.label, status: 'checked', rule: '浏览器后退（URL）' });
        }
        audit.coverage.push({ page: pattern, element: current.label, status: 'clicked' });
      }
      if (consoleErrors > beforeErrors[0] || promiseErrors > beforeErrors[1] || badResponses > beforeErrors[2]) await finding(audit, page, 'P1', '运行时/网络', '深链打开并遍历安全控件', '0 console error、0 未处理异常、0 非预期 4xx/5xx', `新增 console error=${consoleErrors - beforeErrors[0]}，pageerror=${promiseErrors - beforeErrors[1]}，异常响应=${badResponses - beforeErrors[2]}（原文不记录）`);
      audit.coverage.push({ page: pattern, status: 'not-verified: 需逐表单审定无副作用的提交验证', rule: '必填提示/提交防重复' });
      audit.coverage.push({ page: pattern, status: 'not-verified: 需与页面标题/项目名逐项比对', rule: '面包屑内容' });
      audit.coverage.push({ page: pattern, status: 'not-verified: 实时浏览器 stream 被只读防护拦截', rule: '移动实时画面无遮挡' });
      writeReport(audit);
    }
  } finally {
    audit.finished = new Date().toISOString(); writeReport(audit);
    await context.close();
  }
  if (audit.mode === 'verify') {
    expect(audit.findings.filter(entry => entry.severity !== 'P2').length, 'P0/P1 must be zero; see private report').toBe(0);
    expect(audit.coverage.filter(entry => /blocked|unreviewed|missing|unavailable|not-verified/.test(entry.status)).length, 'Full acceptance requires closing every coverage gap').toBe(0);
    expect(audit.safetyBlocks.length, 'Blocked requests require review and cannot be counted as clean network acceptance').toBe(0);
  }
});
