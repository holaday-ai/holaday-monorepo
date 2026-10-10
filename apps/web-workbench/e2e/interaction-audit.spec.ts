import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { test, expect, type Page, type Locator } from 'playwright/test';
import { decideControl, readProcedures, registerReadOnlyGuard, routePatterns, trackAuditReads, waitForAuditReads, discoverDynamicRoutes, selectAuditRoutes, type Control } from './audit-policy';

type Finding = { id: string; severity: 'P0' | 'P1' | 'P2'; page: string; element: string; steps: string; expected: string; actual: string; screenshot?: string };
type Coverage = { page: string; element?: string; status: string; rule?: string };
type QueuedControl = { control: Control; ancestors: string[] };
type RouteCheckpoint = { queue: QueuedControl[]; done: string[] };
type Audit = { viewport: string; mode: string; base: string; findings: Finding[]; coverage: Coverage[]; safetyBlocks: string[]; routes: string[]; started: string; finished?: string; completedRoutes?: string[]; build?: string; storageReceipt?: string; routeCheckpoints?: Record<string, RouteCheckpoint>; canonicalHashes?: string[]; sharedChecks?: Record<string, string>; popupChecks?: Record<string, string>; dynamicRoutes?: Record<string, string>; shardIncomplete?: boolean; resumed?: string[]; runtimeEvents?: { page: string; path: string; status: number; kind: string }[] };
const output = path.resolve(process.env.HOLADAY_AUDIT_OUTPUT ?? 'e2e/artifacts');
const root = path.resolve('src');
const patterns = routePatterns(fs.readFileSync(path.join(root, 'App.tsx'), 'utf8'));
const readOnly = readProcedures(root);
const publicRoutes = new Set(['/login', '/register', '/privacy', '/terms', '/500', '/cosmic-preview']);
let popupSerial = 0;
const popupSelector = '[role="dialog"]:not([data-state="closed"]), [role="alertdialog"]:not([data-state="closed"]), [role="menu"]:not([data-state="closed"]), [role="listbox"]:not([data-state="closed"])';

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
  const escapeMarkdown = (value: string) => value.replace(/[\r\n|]/g, ' ').replace(/</g, '&lt;');
  const lines = ['# Holaday 全站交互审计', '', '安全边界：不执行生产写入、付费提交或历史记录操作；未分类控件与缺失动态路由明确列为覆盖缺口。控制台原文、请求头、请求体、URL 查询与登录态不进入报告。', ''];
  for (const result of reports) {
    const gaps = result.coverage.filter(entry => /blocked|unreviewed|missing|unavailable|not-verified/.test(entry.status));
    lines.push(`## ${result.viewport} · ${result.mode}`, '', `开始：${result.started}；结束：${result.finished ?? '运行中'}`, '', `问题 ${result.findings.length}；覆盖缺口 ${gaps.length}；拦截请求 ${result.safetyBlocks.length}。`, '');
    for (const finding of result.findings) lines.push(`### ${finding.id} · ${finding.severity}`, '', `页面：${escapeMarkdown(finding.page)}；元素：${escapeMarkdown(finding.element)}`, '', `复现：${escapeMarkdown(finding.steps)}`, '', `期望：${escapeMarkdown(finding.expected)}`, '', `实际：${escapeMarkdown(finding.actual)}`, '', finding.screenshot ? `![${finding.id}](${finding.screenshot})` : '截图：不可用（环境或登录态阻塞）', '');
    lines.push('### 覆盖缺口', '', '| 页面 | 元素/规则 | 状态 |', '| --- | --- | --- |');
    for (const gap of gaps) lines.push(`| ${escapeMarkdown(gap.page)} | ${escapeMarkdown(gap.element ?? gap.rule ?? '')} | ${escapeMarkdown(gap.status)} |`);
    lines.push('', '### 规则覆盖', '', '| 页面 | 元素/规则 | 状态 |', '| --- | --- | --- |');
    for (const entry of result.coverage.filter(entry => entry.rule)) lines.push(`| ${escapeMarkdown(entry.page)} | ${escapeMarkdown(entry.rule ?? '')} | ${escapeMarkdown(entry.status)} |`);
    lines.push('');
  }
  const manual = path.join(output, 'manual-evidence.md');
  if (fs.existsSync(manual)) lines.push(fs.readFileSync(manual, 'utf8'));
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
    await page.screenshot({ path: file, fullPage: false, animations: 'disabled', timeout: 10_000 });
    fs.chmodSync(file, 0o600);
    screenshot = file;
  } catch { /* Record missing evidence rather than inventing a screenshot. */ }
  audit.findings.push({ id, severity, page: route, element, steps, expected, actual, screenshot });
  writeReport(audit);
}

function observationFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  if (message.includes('page.goBack')) return '浏览器后退等待中断';
  if (message.includes('read requests did not settle')) return `只读 API 等待超时：${message.match(/\[[\w.,\-" ]*\]$/)?.[0] ?? '[脱敏接口清单不可用]'}`;
  if (message.includes('strict mode violation')) return '定位器匹配多个控件';
  if (message.includes('locator.') || message.includes('Selector')) return '控件定位或等待中断';
  if (message.includes('page.goto')) return '页面导航等待中断';
  return '观察环境或页面中断（原文不记录）';
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
      const propsKey = Object.keys(element).find(name => name.startsWith('__reactProps$'));
      const handler = propsKey ? (element as unknown as Record<string, { onClick?: unknown }>)[propsKey]?.onClick : undefined;
      const handlerText = typeof handler === 'function' ? String(handler).replace(/\s/g, '') : '';
      const passiveBoundary = !['button', 'a', 'input', 'select', 'textarea'].includes(tag) && /^(?:\(?[\w$]+\)?=>|function\([\w$]+\))\{?(?:return)?[\w$]+\.stopPropagation\(\);?\}?$/.test(handlerText);
      const role = element.getAttribute('role') ?? '';
      const label = element.getAttribute('aria-label') ?? element.getAttribute('title') ?? (element as HTMLInputElement).placeholder ?? element.textContent?.trim().slice(0, 100) ?? '';
      const href = element.getAttribute('href');
      const identityLabel = /^通知，\d+ 条未读$/.test(label) ? '通知' : label;
      const key = JSON.stringify([tag, role, identityLabel, href]);
      const occurrence = counts.get(key) ?? 0;
      counts.set(key, occurrence + 1);
      const id = `audit-${[...candidates].indexOf(element)}`;
      element.setAttribute('data-interaction-audit', id);
      const described = element.getAttribute('aria-describedby')?.split(/\s+/).some(id => Boolean(document.getElementById(id)?.textContent?.trim()));
      const dialog = element.closest('[role="dialog"]');
      const dialogTitle = dialog?.querySelector('h2, [id]')?.textContent?.trim() ?? '';
      const draftChoice = /^(选择图片模型|选择视频模型|视频规格|选择项目|图片生成设置)$/.test(dialogTitle);
      const nearby = element.parentElement?.querySelector('[role="status"], p, small') ?? element.parentElement?.parentElement?.querySelector('[role="status"], p, small');
      return [{ key: `${key}:${occurrence}`, selector: `[data-interaction-audit="${id}"]`, label, tag, role, href, type: element.getAttribute('type'), expanded: element.getAttribute('aria-expanded'), passiveBoundary, sharedSidebar: Boolean(element.closest('[data-sidebar="sidebar"]')), disabled: element.matches(':disabled') || element.getAttribute('aria-disabled') === 'true', draftChoice, hasReason: Boolean(element.getAttribute('title') || described || nearby?.textContent?.trim()) }];
    });
  });
}

async function state(page: Page): Promise<string> {
  return page.evaluate(() => JSON.stringify({
    text: document.body.innerText,
    controlClasses: [...document.querySelectorAll('button, [role=tab], [data-active], [hidden]')].map(element => [element.getAttribute('class'), element.getAttribute('hidden'), element.getAttribute('data-active')]),
    layout: [...document.querySelectorAll('[data-sidebar], [data-state], main, aside')].map(element => [element.tagName, element.getAttribute('data-state'), element.getAttribute('class'), Math.round(element.getBoundingClientRect().width), Math.round(element.getBoundingClientRect().height)]),
    states: [...document.querySelectorAll('[aria-expanded],[aria-selected],[aria-pressed],[aria-checked],:disabled,[role="dialog"],[role="menu"]')].map(element => [element.tagName, element.getAttribute('aria-expanded'), element.getAttribute('aria-selected'), element.getAttribute('aria-pressed'), element.getAttribute('aria-checked'), element.getAttribute('disabled'), element.textContent?.slice(0, 100)]),
  }));
}

async function settle(page: Page): Promise<void> {
  await page.waitForFunction(() => { const text = document.body.innerText.trim(); return text.length > 0 && !/^(加载中[.…]*|Loading[.…]*)$/.test(text); }, undefined, { timeout: 20_000 });
  await waitForAuditReads(page);
  // A bounded stability check. Background polling may continue indefinitely.
  let previous = '';
  for (let attempt = 0; attempt < 15; attempt++) {
    const current = await state(page);
    if (current === previous) return;
    previous = current;
    await page.waitForTimeout(150);
  }
}

async function checkPopup(audit: Audit, page: Page, trigger: Locator, control: Control, baselinePopupCount = 0): Promise<void> {
  if (control.expanded !== 'false' && !/选择.*模型|生成设置|选择项目/.test(control.label)) return;
  const touch = await page.evaluate(() => navigator.maxTouchPoints > 0);
  const popups = page.locator(popupSelector).filter({ visible: true });
  if (await popups.count() <= baselinePopupCount) return;
  let openedId = '';
  const rememberOpened = async () => {
    openedId = `popup-${++popupSerial}`;
    await popups.evaluateAll((nodes, value) => nodes.slice(value.baseline).forEach(node => node.setAttribute('data-audit-popup', value.id)), { baseline: baselinePopupCount, id: openedId });
  };
  await rememberOpened();
  const rule = '触发器重复点击/外部点击/Esc/互斥';
  const didClose = async () => {
    try { await expect.poll(() => page.locator(`[data-audit-popup="${openedId}"]`).filter({ visible: true }).count(), { timeout: 1_500 }).toBe(0); return true; }
    catch { return false; }
  };
  const clickTrigger = async () => {
    const box = await trigger.boundingBox();
    if (!box) throw new Error('Trigger unavailable');
    const point = { x: box.x + box.width / 2, y: box.y + box.height / 2, selector: control.selector };
    const safe = await page.evaluate(({ x, y, selector }) => {
      const hit = document.elementFromPoint(x, y);
      const target = document.querySelector(selector);
      return Boolean(hit && target && (target.contains(hit) || !hit.closest('button,a,input,[role="menuitem"],[role="dialog"],[role="menu"],[role="listbox"]')));
    }, point);
    if (!safe) throw new Error('Trigger point covered by another interactive element');
    if (touch) await page.touchscreen.tap(point.x, point.y); else await page.mouse.click(point.x, point.y);
    await settle(page);
  };
  const reopen = async () => { await clickTrigger(); await rememberOpened(); };
  await clickTrigger();
  if (!await didClose()) {
    await finding(audit, page, 'P1', control.label, '点击触发器展开，再点击同一触发器', '弹层收起', '再次点击后弹层仍打开');
    await page.keyboard.press('Escape');
  }
  await reopen();
  await page.keyboard.press('Escape'); await settle(page);
  if (!await didClose()) await finding(audit, page, 'P1', control.label, '展开后按 Esc', '弹层收起', 'Esc 未关闭弹层');
  await page.keyboard.press('Escape');
  await reopen();
  // Find a genuine outside point, not a button underneath the popup.
  const point = await page.evaluate(() => {
    for (const [x, y] of [[8, 8], [window.innerWidth - 8, window.innerHeight - 8], [window.innerWidth / 2, 8]]) {
      const element = document.elementFromPoint(x, y);
      if (element && !element.closest('button,a,input,[data-interaction-audit],[role="dialog"],[role="menu"],[role="listbox"]')) return { x, y };
    }
    return null;
  });
  if (point) {
    if (touch) await page.touchscreen.tap(point.x, point.y); else await page.mouse.click(point.x, point.y);
    await settle(page);
    if (!await didClose()) await finding(audit, page, 'P1', control.label, '展开后点击外部空白', '弹层收起', '外部点击未关闭弹层');
  } else audit.coverage.push({ page: safePage(page.url(), audit.base), element: control.label, status: 'not-verified: 没有安全的外部空白点', rule });
  await page.keyboard.press('Escape');
  // Cross-trigger mutual exclusion is verified for independently focusable nonmodal popovers.
  await reopen();
  if (baselinePopupCount > 0) { audit.coverage.push({ page: safePage(page.url(), audit.base), element: control.label, status: 'not-applicable: 嵌套菜单允许保留父弹层；独立弹层互斥另行检查', rule }); await page.keyboard.press('Escape'); return; }
  const independent = await page.evaluate(({ entries, selector }) => entries.filter(entry => !document.querySelector(entry.selector)?.closest(selector)), { entries: await controls(page), selector: popupSelector });
  if (await page.evaluate(() => document.body.style.pointerEvents === 'none')) {
    audit.coverage.push({ page: safePage(page.url(), audit.base), element: control.label, status: 'source-reviewed: 模态浮层阻止背景点击；独立非模态互斥由修复回归断言验证', rule });
    await page.keyboard.press('Escape'); return;
  }
  const other = independent.find(entry => entry.key !== control.key && entry.expanded === 'false' && decideControl(entry) === 'safe' && !entry.disabled);
  if (other) {
    const locator = page.locator(other.selector);
    try {
      if (touch) await locator.tap({ timeout: 2_000 }); else await locator.click({ timeout: 2_000 });
      await settle(page);
      await expect.poll(() => popups.count(), { timeout: 1_500 }).toBeLessThanOrEqual(Math.max(1, baselinePopupCount + 1)).catch(() => undefined);
      if (await popups.count() > Math.max(1, baselinePopupCount + 1)) await finding(audit, page, 'P1', control.label, '展开后点击另一弹层触发器', '同时最多一个弹层', '存在多个打开的弹层');
    } catch { audit.coverage.push({ page: safePage(page.url(), audit.base), element: control.label, status: 'not-verified: 另一触发器受焦点层遮挡', rule }); }
  } else audit.coverage.push({ page: safePage(page.url(), audit.base), element: control.label, status: 'not-verified: 无另一可用触发器', rule });
  await page.keyboard.press('Escape');
  audit.coverage.push({ page: safePage(page.url(), audit.base), element: control.label, status: 'checked', rule });
}

test('full route interaction audit against production reads', async ({ browser, baseURL }, testInfo) => {
  if (!baseURL) throw new Error('Preview base URL required');
  test.setTimeout(18 * 60_000);
  const deadline = Date.now() + Math.min(16 * 60_000, Math.max(30_000, Number(process.env.HOLADAY_AUDIT_BUDGET_MS) || 16 * 60_000));
  const selected = selectAuditRoutes(patterns, process.env.HOLADAY_AUDIT_ROUTES);
  const build = createHash('sha256').update(fs.readFileSync('dist/index.html')).digest('hex');
  const storageFile = process.env.HOLADAY_AUDIT_STORAGE_STATE;
  const storageStat = storageFile && fs.existsSync(storageFile) ? fs.statSync(storageFile) : null;
  const storageReceipt = storageStat ? `${storageStat.mtimeMs}:${storageStat.size}` : undefined;
  const base = baseURL;
  const parsed = new URL(base);
  expect(['127.0.0.1', 'localhost'].includes(parsed.hostname), 'Audit must run against loopback preview').toBe(true);
  const audit: Audit = { viewport: testInfo.project.name, mode: process.env.HOLADAY_AUDIT_MODE ?? 'observe', base: parsed.origin, findings: [], coverage: [], safetyBlocks: [], routes: patterns, started: new Date().toISOString(), completedRoutes: [], build, storageReceipt, routeCheckpoints: {}, canonicalHashes: [], sharedChecks: {}, dynamicRoutes: {} };
  const previousFile = path.join(output, `${audit.viewport}.json`);
  if (process.env.HOLADAY_AUDIT_RESUME === '1' && fs.existsSync(previousFile)) {
    const previous = JSON.parse(fs.readFileSync(previousFile, 'utf8')) as Audit;
    if (previous.viewport !== audit.viewport || previous.base !== audit.base || previous.build !== build || previous.mode !== audit.mode || previous.storageReceipt !== storageReceipt) throw new Error('Resume receipt does not match current viewport/origin');
    Object.assign(audit, previous, { finished: undefined, resumed: [...(previous.resumed ?? []), new Date().toISOString()] });
    audit.completedRoutes ??= [];
    audit.shardIncomplete = false;
  }
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
  context.setDefaultTimeout(8_000); context.setDefaultNavigationTimeout(30_000);
  const page = await context.newPage();
  trackAuditReads(page);
  audit.runtimeEvents ??= [];
  const touch = testInfo.project.name === 'iphone-14';
  const dynamicRoutes = audit.dynamicRoutes ??= {};
  const auditedCanonicalRoutes = new Set(audit.canonicalHashes ?? []);
  const sharedSidebarChecks = new Map(Object.entries(audit.sharedChecks ?? {}));
  let requests = 0;
  let documentLoads = 0;
  let consoleErrors = 0;
  let promiseErrors = 0;
  let badResponses = 0;
  await registerReadOnlyGuard(context, parsed.origin, readOnly, entry => audit.safetyBlocks.push(entry));
  page.on('dialog', dialog => { void dialog.dismiss(); });
  page.on('console', message => {
    if (message.type() !== 'error') return;
    const text = message.text();
    let location = '';
    try { location = new URL(message.location().url).pathname; } catch { /* No location is recorded. */ }
    const guarded = location && audit.safetyBlocks.some(entry => entry.endsWith(` ${location}`));
    if (text.includes('UI_AUDIT_READ_ONLY_GUARD') || (guarded && /409/.test(text))) return;
    consoleErrors++;
  });
  page.on('pageerror', () => promiseErrors++);
  page.on('request', request => { requests++; if (request.isNavigationRequest() && request.frame() === page.mainFrame()) documentLoads++; });
  page.on('response', response => {
    if (response.status() >= 400 && response.headers()['x-holaday-ui-audit'] !== 'read-only-block' && !(response.status() === 401 && publicRoutes.has(safePage(page.url(), base)))) { badResponses++; audit.runtimeEvents?.push({ page: safePage(page.url(), base), path: new URL(response.url()).origin === parsed.origin ? new URL(response.url()).pathname : '[external resource]', status: response.status(), kind: response.request().resourceType() }); }
  });
  const discoveryReads = new Set<Promise<void>>();
  page.on('requestfinished', request => {
    const url = new URL(request.url());
    if (url.origin !== parsed.origin || !url.pathname.startsWith('/api/trpc/') || !/(?:projects\.|admin\.|videoEditing|batch|tasks\.)/.test(url.pathname)) return;
    const read = (async () => {
    // Discover real dynamic IDs only from read responses. No invented production records.
    try {
      const response = await request.response();
      if (!response || response.status() !== 200) return;
      const json: unknown = await response.json();
      const procedures = decodeURIComponent(new URL(response.url()).pathname.replace('/api/trpc/', '')).split(',');
      for (const [pattern, target] of Object.entries(discoverDynamicRoutes(json, procedures))) dynamicRoutes[pattern] ??= target;
    } catch { /* A failed body read is not evidence of an API failure. */ }
    })();
    discoveryReads.add(read);
    void read.finally(() => discoveryReads.delete(read));
  });
  const observe = async (): Promise<void> => {
    try { await settle(page); }
    catch (error) {
      if (!(error instanceof Error) || !error.message.includes('read requests did not settle')) throw error;
      audit.coverage.push({ page: safePage(page.url(), base), status: `not-verified: ${observationFailure(error)}；只继续已渲染 UI 的观察，不认定 API 或页面验收通过`, rule: '只读数据就绪' });
      await page.waitForTimeout(300);
    }
  };
  const explicit = process.env.HOLADAY_AUDIT_ROUTE_MAP ? JSON.parse(fs.readFileSync(process.env.HOLADAY_AUDIT_ROUTE_MAP, 'utf8')) as Record<string, string> : {};
  try {
    await page.goto('/', { waitUntil: 'domcontentloaded' }); await observe();
    if (await page.locator('input[type="password"]').isVisible() || await page.getByRole('button', { name: '使用 Google 登录', exact: true }).isVisible()) {
      await finding(audit, page, 'P0', '登录环境', '使用导出登录态打开本地预览', '测试账号进入工作台', '登录态失效或 API 不接受该登录态');
      audit.coverage.push({ page: '*', status: 'blocked: 登录态无效', rule: '全站登录后审计' });
      throw new Error('Login state unavailable; no authenticated route acceptance was performed.');
    }
    routeLoop: for (const pattern of selected) {
      if (Date.now() >= deadline) { audit.shardIncomplete = true; break; }
      await Promise.all([...discoveryReads]);
      if (audit.completedRoutes?.includes(pattern)) continue;
      const target = pattern === '*' ? '/__holaday_ui_audit_not_found__' : explicit[pattern] ?? dynamicRoutes[pattern] ?? pattern;
      if (target.includes(':') || !target.startsWith('/') || target.startsWith('//')) { audit.coverage.push({ page: pattern, status: 'missing: 没有可访问的真实动态对象', rule: '深链' }); continue; }
      if (pattern === '/account/closure-recovery' || pattern === '/organizations/invitations/accept') { audit.coverage.push({ page: pattern, status: 'blocked: 账号恢复/接受邀请有真实副作用', rule: '安全边界' }); continue; }
      const beforeErrors = [consoleErrors, promiseErrors, badResponses];
      try {
      privateWrite(path.join(output, `${audit.viewport}-progress.json`), JSON.stringify({ route: pattern, phase: 'opening', findings: audit.findings.length, at: new Date().toISOString() }));
      await page.goto(target, { waitUntil: 'domcontentloaded' }); await observe();
      audit.coverage.push({ page: pattern, status: 'opened', rule: '深链' });
      const canonical = createHash('sha256').update(new URL(page.url()).pathname + new URL(page.url()).search).digest('hex');
      if ((pattern === '/login' || pattern === '/register') && new URL(page.url()).pathname !== pattern) {
        audit.coverage.push({ page: pattern, status: 'checked: 已登录用户正常重定向；访客表单另行检查', rule: '登录重定向' });
        audit.completedRoutes?.push(pattern); writeReport(audit); continue;
      }
      if (auditedCanonicalRoutes.has(canonical) && !audit.routeCheckpoints?.[pattern]) {
        audit.coverage.push({ page: pattern, status: 'checked: 别名指向已审计的同一页面与状态', rule: '别名重定向' });
        audit.completedRoutes?.push(pattern); writeReport(audit); continue;
      }
      if (await page.locator('main').count() && !await page.locator('main').first().innerText()) await finding(audit, page, 'P0', '页面主体', '深链直开', '页面有主体内容', '页面主体为空');
      const width = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, viewport: window.innerWidth }));
      if (width.scroll > width.viewport + 1) await finding(audit, page, 'P1', '移动端布局', '按当前视口深链打开', '无横向滚动', `内容宽 ${width.scroll} 超过视口 ${width.viewport}`);
      audit.coverage.push({ page: pattern, status: 'checked', rule: '横向滚动' });
      const initial = await controls(page);
      const checkpoint = (audit.routeCheckpoints ??= {})[pattern] ??= { queue: initial.map(control => ({ control, ancestors: [] })), done: [] };
      const queue = checkpoint.queue;
      const seen = new Set<string>();
      const knownBackground = new Set(initial.map(control => control.key));
      for (let index = 0; index < queue.length; index++) {
        const { control, ancestors } = queue[index];
        const identity = `${ancestors.join('|')}/${control.key}`;
        if (seen.has(identity)) continue;
        seen.add(identity);
        if (checkpoint.done.includes(identity)) continue;
        if (Date.now() >= deadline) { audit.shardIncomplete = true; break routeLoop; }
        try {
        if (control.passiveBoundary) { audit.coverage.push({ page: pattern, element: control.label, status: 'source-reviewed: 只阻止事件冒泡的容器，不是操作控件' }); continue; }
        const sharedCheck = control.sharedSidebar && sharedSidebarChecks.get(control.key);
        if (sharedCheck && !control.disabled) { audit.coverage.push({ page: pattern, element: control.label, status: `checked-render: 共享侧栏控件在本页可见；交互已在 ${sharedCheck} 独立验证` }); continue; }
        if (control.disabled && (control.hasReason || /未配置|不可用|暂未开放|即将开放|加载中|提交中|同步中|上传中|处理中/.test(control.label))) { audit.coverage.push({ page: pattern, element: control.label, status: 'checked-inventory: 当前渲染禁用状态有原因说明；无需点击或重复加载', rule: '禁用原因' }); continue; }
        const initialDecision = decideControl(control);
        const externalLink = Boolean(control.href && /^https?:|^\/\//.test(control.href));
        if (!control.disabled && !externalLink && (initialDecision === 'final-action' || initialDecision === 'unreviewed')) {
          audit.coverage.push({ page: pattern, element: control.label || '[无标签控件]', status: initialDecision === 'final-action' ? 'excluded: 最终写入/付费或即时持久化动作' : 'unreviewed: 需要确认行为后加入安全清单' });
          continue;
        }
        try {
        privateWrite(path.join(output, `${audit.viewport}-progress.json`), JSON.stringify({ route: pattern, phase: 'controls', index, queued: queue.length, element: control.label, findings: audit.findings.length, at: new Date().toISOString() }));
        await page.goto(target, { waitUntil: 'domcontentloaded' }); await observe();
        let replayed = true;
        for (const key of ancestors) {
          const opener = (await controls(page)).find(entry => entry.key === key);
          if (!opener || decideControl(opener) !== 'safe') { replayed = false; break; }
          if (touch) await page.locator(opener.selector).tap(); else await page.locator(opener.selector).click();
          await observe();
        }
        const current = replayed ? (await controls(page)).find(entry => entry.key === control.key) : undefined;
        if (!current) { audit.coverage.push({ page: pattern, element: control.label, status: 'unavailable: 控件在独立重放后不存在' }); continue; }
        const element = page.locator(current.selector);
        if (current.disabled) {
          if (!current.hasReason && !/未配置|不可用|暂未开放|即将开放|加载中|提交中|同步中|上传中|处理中/.test(current.label)) await finding(audit, page, 'P2', current.label || '[无标签禁用控件]', '检查禁用控件', 'title、关联说明或旁边文字解释原因', '未找到禁用原因');
          audit.coverage.push({ page: pattern, element: current.label, status: 'checked', rule: '禁用原因' });
          continue;
        }
        if (current.href && (await element.getAttribute('target') === '_blank' || /^https?:|^\/\//.test(current.href))) {
          if (await element.getAttribute('target') !== '_blank') await finding(audit, page, 'P1', current.label, '检查外链', '外链新开标签', '外链未设置 _blank');
          audit.coverage.push({ page: pattern, element: current.label, status: 'checked', rule: '新标签链接（静态检查，未外发）' }); continue;
        }
        if (await element.evaluate(node => node.matches('.hd-media-history button.border-b-2')) || await element.getAttribute('aria-selected') === 'true' || await element.getAttribute('aria-pressed') === 'true' || (current.role === 'menuitemradio' && await element.getAttribute('aria-checked') === 'true')) {
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
        const beforeControls = await controls(page);
        if (ancestors.length === 0) for (const background of beforeControls) knownBackground.add(background.key);
        const beforePopupCount = await page.locator(popupSelector).filter({ visible: true }).count();
        const oldState = await state(page);
        const oldUrl = page.url();
        const oldRequests = requests;
        const oldLoads = documentLoads;
        const idempotent = await element.getAttribute('aria-current') !== null || await element.getAttribute('data-active') === 'true' || Boolean(current.href && new URL(current.href, oldUrl).href === oldUrl);
        try {
          // Trial detects obscured controls without forcing a click through overlays.
          if (touch) { await element.tap({ trial: true, timeout: 2_000 }); await element.tap(); }
          else { await element.click({ trial: true, timeout: 2_000 }); await element.click(); }
          if (/加载更多任务/.test(current.label)) await expect.poll(async () => !await element.count() || await element.isEnabled(), { timeout: 90_000 }).toBe(true);
          await observe();
        } catch {
          await finding(audit, page, 'P1', current.label || '[无标签控件]', '滚动到元素并尝试点击', '控件可点击', '元素被遮挡或无法正常点击'); continue;
        }
        if (page.url() === oldUrl && await state(page) === oldState && requests === oldRequests && !(current.label === '新任务' && new URL(oldUrl).pathname === '/') && !idempotent) await finding(audit, page, 'P1', current.label || '[无标签控件]', '独立打开页面后点击控件', '路由、DOM、请求或可编辑焦点产生变化', '点击没有可观察效果');
        if (current.href?.startsWith('/') && documentLoads > oldLoads) await finding(audit, page, 'P1', current.label, '点击应用内链接', 'React Router 页面切换', '触发整页刷新');
        if (/加载更多/.test(current.label)) {
          const beforeCount = beforeControls.filter(entry => entry.label === '任务菜单').length;
          const afterCount = (await controls(page)).filter(entry => entry.label === '任务菜单').length;
          const noMore = /没有更多|已全部加载|没有更多可见/.test(await page.locator('body').innerText()) || !await page.getByRole('button', { name: /加载更多/ }).count();
          if (afterCount <= beforeCount && !noMore && /加载更多任务/.test(current.label)) await finding(audit, page, 'P1', current.label, '点击加载更多并等待完成', '条目增加或明确提示没有更多', '可见条目未增加，按钮继续可点击');
          audit.coverage.push({ page: pattern, element: current.label, status: /加载更多任务/.test(current.label) ? 'checked' : 'not-verified: 需逐表格确认条目数量变化', rule: '分页/加载更多' });
        }
        if (page.url() === oldUrl) {
          const added = (await controls(page)).filter(entry => !knownBackground.has(entry.key) && !beforeControls.some(beforeEntry => beforeEntry.key === entry.key));
          if (ancestors.length < 3) for (const child of added) queue.push({ control: child, ancestors: [...ancestors, current.key] });
          const popupKey = current.key.replace(/:\d+$/, '');
          const previousPopupCheck = audit.popupChecks?.[popupKey];
          try {
            if (previousPopupCheck) {
              audit.coverage.push({ page: pattern, element: current.label, status: `checked-render: 本实例已独立点击；同类型浮层开关规则已在 ${previousPopupCheck} 验证`, rule: '复用组件浮层规则' });
              await page.keyboard.press('Escape');
            } else {
              const findingsBefore = audit.findings.length; const coverageBefore = audit.coverage.length;
              await checkPopup(audit, page, element, current, beforePopupCount);
              const checks = audit.coverage.slice(coverageBefore);
              if (audit.findings.length === findingsBefore && checks.length && !checks.some(check => /not-verified|unavailable/.test(check.status))) (audit.popupChecks ??= {})[popupKey] = pattern;
            }
          }
          catch {
            audit.coverage.push({ page: pattern, element: current.label, status: 'not-verified: 弹层阻挡安全触发点；需人工复核，不能直接判为产品缺陷', rule: '弹层开关' });
            await page.keyboard.press('Escape').catch(() => undefined);
          }
        } else if (new URL(page.url()).pathname === new URL(oldUrl).pathname) {
          audit.coverage.push({ page: pattern, element: current.label, status: 'checked: 同页查询/锚点状态更新；真实页面跳转的后退恢复另由规则验证', rule: 'URL 状态' });
        } else {
          await page.goBack({ waitUntil: 'domcontentloaded' }); await observe();
          if (page.url() !== oldUrl) await finding(audit, page, 'P1', current.label, '应用内跳转后浏览器后退', '恢复上一 URL/页面状态', '后退没有返回原 URL');
          audit.coverage.push({ page: pattern, element: current.label, status: 'checked', rule: '浏览器后退（URL）' });
        }
        audit.coverage.push({ page: pattern, element: current.label, status: 'clicked' });
        if (current.sharedSidebar) { sharedSidebarChecks.set(current.key, pattern); (audit.sharedChecks ??= {})[current.key] = pattern; }
        } catch (error) { audit.coverage.push({ page: pattern, element: control.label, status: `unavailable: ${observationFailure(error)}；此控件单列缺口，继续本页其余控件`, rule: '控件异常续跑' }); }
        } finally { checkpoint.done.push(identity); writeReport(audit); }
      }
      if (consoleErrors > beforeErrors[0] || promiseErrors > beforeErrors[1] || badResponses > beforeErrors[2]) await finding(audit, page, 'P1', '运行时/网络', '深链打开并遍历安全控件', '0 console error、0 未处理异常、0 非预期 4xx/5xx', `新增 console error=${consoleErrors - beforeErrors[0]}，pageerror=${promiseErrors - beforeErrors[1]}，异常响应=${badResponses - beforeErrors[2]}（原文不记录）`);
      audit.coverage.push({ page: pattern, status: (await page.locator('form,input[required],textarea[required],[data-creative-composer]').count()) ? 'not-verified: 由补充规则或逐表单源码复核；不执行有效持久化提交' : 'not-applicable: 当前观察状态没有必填表单', rule: '必填提示/提交防重复' });
      audit.coverage.push({ page: pattern, status: 'not-verified: 需与页面标题/项目名逐项比对', rule: '面包屑内容' });
      audit.coverage.push({ page: pattern, status: (new URL(page.url()).pathname === '/') ? 'not-verified: 活动实时画面需真实会话；不创建或重放任务' : 'not-applicable: 当前页面没有实时浏览器主体', rule: '移动实时画面无遮挡' });
      auditedCanonicalRoutes.add(canonical); audit.canonicalHashes = [...auditedCanonicalRoutes];
      delete audit.routeCheckpoints?.[pattern];
      audit.completedRoutes?.push(pattern);
      writeReport(audit);
      } catch (error) {
        audit.coverage.push({ page: pattern, status: `unavailable: ${observationFailure(error)}；已继续后续页面`, rule: '异常续跑' });
        await finding(audit, page, 'P0', '页面/审计运行异常', '深链打开并遍历该页安全控件', '页面与安全控件可正常完成观察', '此页观察中断；需结合截图区分产品和审计环境问题');
        writeReport(audit);
      }
    }
  } finally {
    audit.finished = new Date().toISOString(); writeReport(audit);
    await context.close();
  }
  expect(audit.shardIncomplete, 'Shard reached its bounded budget; resume this receipt to continue remaining controls').not.toBe(true);
  if (audit.mode === 'verify') {
    expect(audit.findings.filter(entry => entry.severity !== 'P2').length, 'P0/P1 must be zero; see private report').toBe(0);
    expect(audit.coverage.filter(entry => /blocked|unreviewed|missing|unavailable|not-verified/.test(entry.status)).length, 'Full acceptance requires closing every coverage gap').toBe(0);
    expect(audit.safetyBlocks.length, 'Blocked requests require review and cannot be counted as clean network acceptance').toBe(0);
  }
});
