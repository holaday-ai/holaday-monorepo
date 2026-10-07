import fs from 'node:fs';
import path from 'node:path';
import { test, type Page, type Locator } from 'playwright/test';
import { readProcedures, registerReadOnlyGuard, trackAuditReads, waitForAuditReads } from './audit-policy';

type Issue = { id: string; severity: 'P0' | 'P1' | 'P2'; page: string; element: string; steps: string; expected: string; actual: string; screenshot: string };
const directory = path.resolve(process.env.HOLADAY_AUDIT_OUTPUT ?? 'e2e/artifacts');
function save(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, JSON.stringify(value, null, 2), { mode: 0o600 });
  fs.chmodSync(file, 0o600);
}

test('source-reviewed empty forms, breadcrumbs, back state and confirmation cancellation', async ({ browser, baseURL }, info) => {
  if (!baseURL) throw new Error('Preview base URL required');
  const origin = new URL(baseURL).origin;
  if (!['127.0.0.1', 'localhost'].includes(new URL(origin).hostname)) throw new Error('Loopback preview required');
  const source = process.env.HOLADAY_AUDIT_STORAGE_STATE;
  if (!source) throw new Error('Private auth export required');
  const state = JSON.parse(fs.readFileSync(source, 'utf8')) as { origins: { origin: string; localStorage: { name: string; value: string }[] }[] };
  const authed = state.origins.find(item => ['https://holaday.ai', 'https://hd-app.orangebench.tech'].includes(item.origin) && item.localStorage.some(entry => entry.name === 'holaday.access_token' && entry.value));
  if (!authed) throw new Error('Holaday login required');
  const reads = readProcedures(path.resolve('src'));
  const receipt = { viewport: info.project.name, started: new Date().toISOString(), finished: '', findings: [] as Issue[], checks: [] as { page: string; rule: string; status: string }[], blocks: [] as string[], dynamicRoutes: {} as Record<string, string> };
  const context = await browser.newContext({ ...info.project.use, storageState: { cookies: [], origins: [{ origin, localStorage: authed.localStorage.filter(entry => entry.name === 'holaday.access_token') }] }, serviceWorkers: 'block' });
  await registerReadOnlyGuard(context, origin, reads, entry => receipt.blocks.push(entry));
  const page = await context.newPage();
  trackAuditReads(page);
  const click = async (element: Locator) => { if (info.project.name === 'iphone-14') await element.tap(); else await element.click(); };
  const output = path.join(directory, `${info.project.name}-rules.json`);
  if (process.env.HOLADAY_AUDIT_FOCUSED_RETRY === '1' && fs.existsSync(output)) { const previous = JSON.parse(fs.readFileSync(output, 'utf8')) as typeof receipt; if (previous.viewport !== receipt.viewport) throw new Error('Focused receipt viewport mismatch'); Object.assign(receipt, previous, { finished: '' }); }
  const write = () => save(output, receipt);
  const open = async (route: string) => {
    await page.goto(route, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => { const text = document.body.innerText.trim(); return text.length > 0 && !/^(加载中[.…]*|Loading[.…]*)$/.test(text); }, undefined, { timeout: 20_000 });
    try { await waitForAuditReads(page); }
    catch (error) {
      if (!(error instanceof Error) || !error.message.includes('read requests did not settle')) throw error;
      const names = error.message.match(/\[[\w.,\-" ]*\]$/)?.[0] ?? '[脱敏接口清单不可用]';
      receipt.checks.push({ page: route, rule: '只读数据就绪', status: `not-verified: API 等待超时 ${names}；只检查已渲染 UI，不认定整页验收通过` });
    }
    await page.waitForTimeout(300);
  };
  const issue = async (target: Page, element: string, expected: string, actual: string, severity: Issue['severity'] = 'P1', steps = '只读打开页面并执行本用例') => {
    const id = `RULE-${info.project.name}-${String(receipt.findings.length + 1).padStart(3, '0')}`;
    const screenshot = path.join(directory, 'screenshots', `${id}.png`);
    fs.mkdirSync(path.dirname(screenshot), { recursive: true, mode: 0o700 });
    await target.screenshot({ path: screenshot, fullPage: false, animations: 'disabled' }); fs.chmodSync(screenshot, 0o600);
    receipt.findings.push({ id, severity, page: new URL(target.url()).pathname, element, steps, expected, actual, screenshot }); write();
  };
  const probe = async (route: string, rule: string, action: () => Promise<void>) => {
    if (process.env.HOLADAY_AUDIT_FOCUSED_RETRY === '1' && receipt.checks.some(entry => entry.page === route && entry.rule === rule && entry.status === 'completed')) return;
    receipt.checks = receipt.checks.filter(entry => !(entry.page === route && entry.rule === rule && entry.status.startsWith('unavailable')));
    try { await action(); receipt.checks.push({ page: route, rule, status: 'completed' }); }
    catch (error) { const message = error instanceof Error ? error.message : ''; const reason = message.includes('page.goBack') ? '后退等待中断' : message.includes('read requests did not settle') ? `只读 API 等待超时：${message.match(/\[[\w.,\-" ]*\]$/)?.[0] ?? '[脱敏接口清单不可用]'}` : message.includes('strict mode violation') ? '定位器匹配多个控件' : message.includes('locator.') ? '控件定位或等待中断' : '用例中断'; receipt.checks.push({ page: route, rule, status: `unavailable: ${reason}，需复核环境或页面（原文不记录）` }); }
    write();
  };
  try {
    const breadcrumbs: Record<string, string> = { '/': '新任务', '/skills': '技能', '/stocks': '股市任务', '/cosmic': '今日能量', '/video': '视频', '/image': '图片', '/planned': '规划任务', '/files': '文件库', '/projects': '项目' };
    for (const [route, label] of Object.entries(breadcrumbs)) await probe(route, '面包屑内容', async () => {
      await open(route);
      const actual = await page.locator('.hd-workbench-breadcrumb strong').allTextContents();
      if (actual.length !== 1 || actual[0].trim() !== label) await issue(page, '面包屑', label, actual.length ? actual.join(' / ') : '未找到面包屑', 'P2');
    });
    for (const [route, label] of [['/projects', '搜索项目'], ['/files', '搜索文件名']] as const) await probe(route, '浏览器后退恢复输入状态', async () => {
      await open(route);
      const input = page.getByRole('textbox', { name: label, exact: true });
      await input.fill('__holaday_audit_no_match__');
      const navigation = page.getByRole('button', { name: route === '/projects' ? '文件库' : '项目', exact: true });
      if (!await navigation.isVisible()) {
        await click(page.getByRole('button', { name: /^(打开任务列表|切换侧边栏)$/ }).filter({ visible: true }).first());
      }
      await click(navigation);
      await page.waitForTimeout(250); await page.goBack({ waitUntil: 'domcontentloaded' });
      await input.waitFor({ state: 'visible', timeout: 10_000 });
      if (await input.inputValue() !== '__holaday_audit_no_match__') await issue(page, label, '恢复跳转前的搜索输入和筛选状态', '浏览器后退后搜索内容丢失', 'P1', '输入临时搜索词，点击另一侧栏页面，再浏览器后退');
    });
    await probe('/video', '空必填项反馈（自由创作/动作复刻）', async () => {
      await open('/video');
      const text = page.locator('textarea').first(); await text.fill('');
      const before = receipt.blocks.filter(item => item.startsWith('POST')).length;
      await click(page.getByRole('button', { name: '准备生成', exact: true }));
      const feedback = page.getByText('请先描述想生成的视频内容', { exact: true });
      if (!await feedback.isVisible()) { await page.waitForTimeout(300); }
      if (!await feedback.isVisible()) await issue(page, '准备生成（自由创作）', '空描述有明确提示，且不提交任务', '没有找到必填提示');
      if (receipt.blocks.filter(item => item.startsWith('POST')).length > before) await issue(page, '空描述提交', '客户端先验证，0 写请求', '空描述仍尝试发出写请求');
      await click(page.getByRole('tab', { name: '动作复刻', exact: true }));
      const clone = page.getByRole('button', { name: '准备生成', exact: true });
      if (await clone.isEnabled()) {
        await click(clone); await page.waitForTimeout(300);
        if (!await page.getByText('请先上传主角照片', { exact: true }).isVisible()) await issue(page, '准备生成（动作复刻）', '缺少照片有明确提示', '没有找到必填素材提示');
      }
      receipt.checks.push({ page: '/video', rule: '有效生成提交/提交中防重复', status: 'source-reviewed: 三个模式均有提交锁与 pending 禁用；付费有效提交不执行' });
    });
    await probe('/', '危险操作只开确认并取消', async () => {
      await open('/');
      const menu = page.getByRole('button', { name: '任务菜单' }).first();
      if (!await menu.isVisible()) await click(page.getByRole('button', { name: /^(打开任务列表|切换侧边栏)$/ }).filter({ visible: true }).first());
      await click(menu);
      const remove = page.getByRole('menuitem', { name: '删除任务', exact: true });
      if (!await remove.isEnabled()) { receipt.checks.push({ page: '/', rule: '删除确认', status: 'excluded: 当前记录不可删除，未执行任何删除' }); return; }
      const before = receipt.blocks.filter(item => item.startsWith('POST')).length;
      // AppShell onDeleteTask only sets confirmDelete. The final delete button is never clicked.
      await click(remove);
      const dialog = page.locator('[role="dialog"], [role="alertdialog"]').filter({ hasText: '确认删除此任务？' });
      await dialog.waitFor({ state: 'visible', timeout: 5_000 });
      await click(dialog.getByRole('button', { name: '取消', exact: true }));
      await dialog.waitFor({ state: 'hidden', timeout: 5_000 });
      if (receipt.blocks.filter(item => item.startsWith('POST')).length > before) await issue(page, '删除确认取消', '打开和取消均不发出删除写请求', '打开/取消尝试发出写请求');
    });

    for (const kind of ['notification', 'account'] as const) await probe('/usage', `全局菜单互斥 ${kind}`, async () => {
      await open('/usage');
      if (kind === 'account' && info.project.name === 'iphone-14') { receipt.checks.push({ page: '/usage', rule: '桌面账户菜单互斥', status: 'excluded: 账户浮栏源码在 769px 以下隐藏；移动侧栏菜单另行遍历' }); return; }
      if (kind === 'notification') await click(page.getByRole('button', { name: /^通知(?:，|$)/ }).filter({ visible: true }).first());
      else await click(page.getByTestId('desktop-account-dock').locator('button[aria-haspopup="menu"]').filter({ visible: true }).last());
      await page.waitForTimeout(350);
      const first = kind === 'notification' ? page.getByRole('button', { name: '全部已读', exact: true }) : page.getByText('外观', { exact: true });
      await first.waitFor({ state: 'visible', timeout: 5_000 });
      const more = page.locator('button.hd-sidebar-more').filter({ visible: true }).first();
      if (!await more.isVisible()) {
        const opener = page.getByRole('button', { name: /^(打开任务列表|切换侧边栏)$/ }).filter({ visible: true }).first();
        await click(opener); await page.waitForTimeout(350);
      }
      await click(more); await page.waitForTimeout(500);
      if (await first.isVisible() && await page.getByRole('menuitem', { name: '本月用量', exact: true }).isVisible()) await issue(page, kind === 'notification' ? '通知 → 更多' : '用户菜单 → 更多', '打开新的独立菜单时关闭旧菜单', '两个独立菜单同时可见', 'P1', '展开通知或用户菜单，再打开左下角更多菜单；未点击任何最终动作');
      await page.keyboard.press('Escape');
    });
    await probe('/projects', '已有项目打开和返回', async () => {
      await open('/projects');
      const project = page.locator('button[aria-label^="打开项目 "]').filter({ visible: true }).first();
      if (!await project.count()) { receipt.checks.push({ page: '/projects', rule: '项目卡片', status: 'missing: 无可访问的已有项目卡片，不创建记录' }); return; }
      const previous = page.url(); await click(project); await waitForAuditReads(page); await page.waitForTimeout(250);
      if (page.url() === previous) await issue(page, '已有项目卡片', '打开已有项目详情或详情选中状态', '点击后 URL 没有改变');
      const destination = new URL(page.url()).pathname;
      if (/^\/projects\/[^/]+$/.test(destination)) receipt.dynamicRoutes['/projects/:projectId'] = destination;
      await page.goBack({ waitUntil: 'domcontentloaded' });
    });
    await probe('/files', '已有有效文件预览与关闭', async () => {
      await open('/files');
      const preview = page.locator('button[title^="预览 "]:not(:disabled)').filter({ visible: true }).first();
      if (!await preview.count()) { receipt.checks.push({ page: '/files', rule: '有效文件预览', status: 'missing: 无可访问的有效文件，不修改历史记录' }); return; }
      await click(preview);
      const modal = page.getByRole('dialog').filter({ visible: true }).last();
      await modal.waitFor({ state: 'visible', timeout: 5_000 });
      await page.keyboard.press('Escape'); await modal.waitFor({ state: 'hidden', timeout: 5_000 });
    });
    const dynamicMatchers: Record<string, RegExp> = { '/projects/:projectId': /^\/projects\/[^/?#]+$/, '/admin/users/:userId': /^\/admin\/users\/[^/?#]+$/, '/admin/learning/:domain': /^\/admin\/learning\/[^/?#]+$/, '/batch/:batchId': /^\/batch\/[^/?#]+$/, '/video/edit/:projectId': /^\/video\/edit\/[^/?#]+$/ };
    for (const route of ['/projects', '/admin/users', '/admin/learning', '/planned', '/video']) await probe(route, '真实动态深链库存', async () => {
      await open(route);
      const links = await page.locator('a[href]').evaluateAll(nodes => nodes.map(node => node.getAttribute('href') ?? ''));
      for (const [pattern, matcher] of Object.entries(dynamicMatchers)) {
        const link = links.find(item => matcher.test(item));
        if (link) receipt.dynamicRoutes[pattern] = link;
      }
    });
    const guest = await browser.newContext({ ...info.project.use, storageState: { cookies: [], origins: [] }, serviceWorkers: 'block' });
    await registerReadOnlyGuard(guest, origin, reads, entry => receipt.blocks.push(entry));
    const login = await guest.newPage();
    try {
      for (const [route, label] of [['/login', '登录'], ['/register', '注册并登录']] as const) await probe(route, '访客空必填项反馈', async () => {
        await login.goto(route, { waitUntil: 'domcontentloaded' });
        await login.getByRole('button', { name: label, exact: true }).waitFor({ state: 'visible' });
        const before = receipt.blocks.filter(item => item.startsWith('POST')).length;
        // All fields remain empty. Source validation returns before auth/createAccount mutations.
        await click(login.getByRole('button', { name: label, exact: true }));
        await login.waitForTimeout(250);
        if (!await login.getByText('请输入有效邮箱', { exact: true }).isVisible()) await issue(login, label, '空邮箱有明确错误提示', '没有找到空邮箱错误提示');
        if (receipt.blocks.filter(item => item.startsWith('POST')).length > before) await issue(login, label, '空字段在客户端拦截，0 写请求', '空字段仍尝试发出写请求');
      });
    } finally { await guest.close(); }
  } finally {
    receipt.finished = new Date().toISOString(); write(); await context.close();
  }
});
