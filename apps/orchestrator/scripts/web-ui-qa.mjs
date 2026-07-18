import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import { chromium, request } from 'playwright';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ORCHESTRATOR_ROOT = path.resolve(SCRIPT_DIR, '..');
const REPO_ROOT = path.resolve(ORCHESTRATOR_ROOT, '../..');
const BASE_URL = process.env.HOLADAY_WEB_QA_BASE_URL ?? 'http://127.0.0.1:5174';
const BASE = new URL(BASE_URL);
const IS_LOCAL = BASE.hostname === '127.0.0.1' || BASE.hostname === 'localhost';
const LOCAL_HTTP_PORT = Number(process.env.HOLADAY_WEB_QA_HTTP_PORT ?? 3101);
const LOCAL_WS_PORT = Number(process.env.HOLADAY_WEB_QA_WS_PORT ?? 3102);
const RUN_ID = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
const OUTPUT_DIR = process.env.HOLADAY_WEB_QA_OUTPUT_DIR ?? path.join('/tmp', `holaday-web-qa-${RUN_ID}`);
const CHROME_PATH = process.env.HOLADAY_WEB_QA_CHROME_PATH
  ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const LOCAL_QA_EMAIL = 'web-ui-qa@holaday.local';
const LOCAL_QA_PASSWORD = 'holaday-ui-qa-password-2026';
const BROWSER_FIXTURE_ID = 'tsk_browser_ui_qa';
const BROWSER_FIXTURE_TITLE = '浏览器界面验收';
const BROWSER_TERMINAL_FIXTURE_ID = 'tsk_browser_terminal_ui_qa';
const BROWSER_TERMINAL_FIXTURE_TITLE = '浏览器终态证据验收';

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'overlay', width: 1280, height: 800 },
  { name: 'compact-desktop', width: 1024, height: 768 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'mobile', width: 390, height: 844 },
];

const ROUTES = [
  { name: 'home', pathname: '/', expected: ['Hello,', '打开网页'] },
  { name: 'video', pathname: '/video', expected: ['用AI创作视频', '历史生成'] },
  { name: 'image', pathname: '/image', expected: ['图片任务', '锁定主角'] },
];

const startedProcesses = [];
let shuttingDown = false;

await fsp.mkdir(OUTPUT_DIR, { recursive: true });

function log(message) {
  process.stdout.write(`${message}\n`);
}

function commandResult(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: options.cwd ?? REPO_ROOT,
    env: options.env ?? process.env,
    encoding: 'utf8',
    stdio: options.stdio ?? 'pipe',
  });
}

function startProcess(name, command, args, options = {}) {
  const logPath = path.join(OUTPUT_DIR, `${name}.log`);
  const logFd = fs.openSync(logPath, 'a');
  const child = spawn(command, args, {
    cwd: options.cwd ?? REPO_ROOT,
    env: options.env ?? process.env,
    detached: process.platform !== 'win32',
    stdio: ['ignore', logFd, logFd],
  });
  startedProcesses.push({ name, child, logFd });
  log(`  started ${name}; log: ${logPath}`);
  return child;
}

function stopStartedProcesses() {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const { child, logFd } of startedProcesses.reverse()) {
    try {
      if (child.exitCode == null) {
        if (process.platform === 'win32') child.kill('SIGTERM');
        else process.kill(-child.pid, 'SIGTERM');
      }
    } catch {
      // The child may already have exited.
    }
    try {
      fs.closeSync(logFd);
    } catch {
      // The descriptor may already be closed.
    }
  }
}

process.on('SIGINT', () => {
  stopStartedProcesses();
  process.exit(130);
});
process.on('SIGTERM', () => {
  stopStartedProcesses();
  process.exit(143);
});

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function urlIsReady(url, timeoutMs = 2_000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    return response.status < 500;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

async function waitForUrl(url, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await urlIsReady(url)) return;
    await sleep(500);
  }
  throw new Error(`${label} did not become ready: ${url}`);
}

function portIsOpen(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    const finish = (value) => {
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(1_000);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

async function ensureDockerServices() {
  if (await portIsOpen(3306) && await portIsOpen(6379)) return;

  let docker = commandResult('docker', ['info', '--format', '{{.ServerVersion}}']);
  if (docker.status !== 0 && process.platform === 'darwin') {
    log('  Docker is not running; opening Docker Desktop...');
    commandResult('open', ['-a', 'Docker']);
    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline) {
      await sleep(2_000);
      docker = commandResult('docker', ['info', '--format', '{{.ServerVersion}}']);
      if (docker.status === 0) break;
    }
  }
  if (docker.status !== 0) {
    throw new Error('Docker is unavailable and MySQL/Redis are not already running.');
  }

  const compose = commandResult('docker', ['compose', 'up', '-d', 'mysql', 'redis']);
  if (compose.status !== 0) {
    throw new Error(`docker compose failed: ${compose.stderr.trim()}`);
  }
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (await portIsOpen(3306) && await portIsOpen(6379)) return;
    await sleep(1_000);
  }
  throw new Error('MySQL/Redis did not become ready within 60 seconds.');
}

async function ensureLocalStack() {
  if (!IS_LOCAL) return;

  const backendHealth = `http://127.0.0.1:${LOCAL_HTTP_PORT}/healthz`;
  if (!await urlIsReady(backendHealth)) {
    log('Preparing local API...');
    await ensureDockerServices();
    startProcess(
      'orchestrator',
      process.execPath,
      ['--import', 'tsx', 'src/index.ts'],
      {
        cwd: ORCHESTRATOR_ROOT,
        env: {
          ...process.env,
          DATABASE_URL: process.env.DATABASE_URL
            ?? 'mysql://holaday:holaday-dev@127.0.0.1:3306/holaday',
          REDIS_URL: process.env.REDIS_URL ?? 'redis://127.0.0.1:6379',
          JWT_SECRET: process.env.JWT_SECRET ?? 'holaday-local-web-qa-secret-at-least-32-characters',
          EXECUTOR_MODE: process.env.EXECUTOR_MODE ?? 'auto',
          HTTP_PORT: String(LOCAL_HTTP_PORT),
          WS_PORT: String(LOCAL_WS_PORT),
        },
      },
    );
    await waitForUrl(backendHealth, 30_000, 'orchestrator');
  }

  if (!await urlIsReady(BASE_URL)) {
    log('Preparing local web app...');
    startProcess(
      'web-workbench',
      'pnpm',
      ['--filter', '@holaday/web-workbench', 'dev', '--host', BASE.hostname],
      {
        env: {
          ...process.env,
          HOLADAY_WEB_PORT: BASE.port || '5174',
          HOLADAY_API_PROXY_TARGET: `http://127.0.0.1:${LOCAL_HTTP_PORT}`,
          HOLADAY_WS_PROXY_TARGET: `ws://127.0.0.1:${LOCAL_WS_PORT}`,
        },
      },
    );
    await waitForUrl(BASE_URL, 30_000, 'web workbench');
  }
}

function accessTokenFrom(body) {
  return body?.result?.data?.accessToken ?? body?.result?.data?.json?.accessToken ?? null;
}

async function authenticate() {
  const explicitToken = process.env.HOLADAY_WEB_QA_TOKEN;
  if (explicitToken) {
    return { token: explicitToken, email: process.env.HOLADAY_WEB_QA_EMAIL ?? null };
  }

  const explicitEmail = process.env.HOLADAY_WEB_QA_EMAIL;
  const explicitPassword = process.env.HOLADAY_WEB_QA_PASSWORD;
  if (!IS_LOCAL && (!explicitEmail || !explicitPassword)) {
    throw new Error(
      'Remote QA requires HOLADAY_WEB_QA_TOKEN or HOLADAY_WEB_QA_EMAIL/HOLADAY_WEB_QA_PASSWORD.',
    );
  }

  const email = explicitEmail ?? LOCAL_QA_EMAIL;
  const password = explicitPassword ?? LOCAL_QA_PASSWORD;
  const api = await request.newContext({ baseURL: BASE_URL });
  try {
    let response = await api.post('/api/trpc/auth.login', { data: { email, password } });
    let body = await response.json().catch(() => null);
    let token = accessTokenFrom(body);

    if (!token && IS_LOCAL) {
      response = await api.post('/api/trpc/auth.register', { data: { email, password } });
      body = await response.json().catch(() => null);
      token = accessTokenFrom(body);
    }
    if (!token) {
      throw new Error(`QA authentication failed with HTTP ${response.status()}.`);
    }
    return { token, email };
  } finally {
    await api.dispose();
  }
}

async function createLocalBrowserFixture(email) {
  if (!IS_LOCAL || !email) return null;
  const connection = await mysql.createConnection(
    process.env.DATABASE_URL ?? 'mysql://holaday:holaday-dev@127.0.0.1:3306/holaday',
  );
  try {
    const [users] = await connection.execute(
      'SELECT id FROM users WHERE email = ? LIMIT 1',
      [email],
    );
    const userId = users[0]?.id;
    if (!userId) throw new Error(`Local QA user was not found: ${email}`);
    await connection.execute(
      `INSERT INTO tasks (
        external_id, user_id, status, intent, title, awaiting_question,
        awaiting_kind, result, created_at, updated_at, started_at
      ) VALUES (?, ?, 'awaiting_user', ?, ?, ?, 'login', ?, NOW(3), NOW(3), NOW(3))
      ON DUPLICATE KEY UPDATE
        user_id = VALUES(user_id), status = 'awaiting_user', intent = VALUES(intent),
        title = VALUES(title), awaiting_question = VALUES(awaiting_question),
        awaiting_kind = 'login', result = VALUES(result), updated_at = NOW(3)`,
      [
        BROWSER_FIXTURE_ID,
        userId,
        '打开 https://example.com',
        BROWSER_FIXTURE_TITLE,
        '请在浏览器中完成登录',
        JSON.stringify({}),
      ],
    );
    const finalScreenshot = fs.readFileSync(
      path.join(
        REPO_ROOT,
        'apps/web-workbench/public/design-ref/video-hero.png',
      ),
    ).toString('base64');
    await connection.execute(
      `INSERT INTO tasks (
        external_id, user_id, status, intent, title, result,
        created_at, updated_at, started_at, completed_at
      ) VALUES (?, ?, 'completed', ?, ?, ?, NOW(3), NOW(3), NOW(3), NOW(3))
      ON DUPLICATE KEY UPDATE
        user_id = VALUES(user_id), status = 'completed', intent = VALUES(intent),
        title = VALUES(title), result = VALUES(result), updated_at = NOW(3),
        completed_at = NOW(3)`,
      [
        BROWSER_TERMINAL_FIXTURE_ID,
        userId,
        '打开 https://example.com',
        BROWSER_TERMINAL_FIXTURE_TITLE,
        JSON.stringify({
          summary: '已打开 https://example.com/',
          finalUrl: 'https://example.com/',
          finalScreenshot,
          finalViewport: { width: 1550, height: 650 },
          metadata: { executionMode: 'browser', lane: 'direct_open' },
        }),
      ],
    );
  } finally {
    await connection.end();
  }
  return async () => {
    const cleanup = await mysql.createConnection(
      process.env.DATABASE_URL ?? 'mysql://holaday:holaday-dev@127.0.0.1:3306/holaday',
    );
    try {
      await cleanup.execute('DELETE FROM tasks WHERE external_id IN (?, ?)', [
        BROWSER_FIXTURE_ID,
        BROWSER_TERMINAL_FIXTURE_ID,
      ]);
    } finally {
      await cleanup.end();
    }
  };
}

function boxesOverlap(a, b) {
  return !(
    a.x + a.width <= b.x ||
    b.x + b.width <= a.x ||
    a.y + a.height <= b.y ||
    b.y + b.height <= a.y
  );
}

async function resetDedicatedLocalQaQuota(email) {
  if (!IS_LOCAL || email !== LOCAL_QA_EMAIL) return;
  const connection = await mysql.createConnection(
    process.env.DATABASE_URL ?? 'mysql://holaday:holaday-dev@127.0.0.1:3306/holaday',
  );
  try {
    await connection.execute(
      `UPDATE task_quotas AS quota
       INNER JOIN users AS user ON user.id = quota.user_id
       SET quota.tasks_used = 0,
           quota.opus_used = 0,
           quota.updated_at = NOW(3)
       WHERE user.email = ? AND quota.period_end > NOW(3)`,
      [email],
    );
  } finally {
    await connection.end();
  }
}

function screenshotName(route, viewport, suffix = '') {
  return `${route}-${viewport}${suffix ? `-${suffix}` : ''}.png`;
}

async function assertDialogFits(page, dialog) {
  const box = await dialog.boundingBox();
  if (!box) throw new Error('Dialog has no visible bounding box.');
  const viewport = page.viewportSize();
  if (!viewport) throw new Error('Browser viewport is unavailable.');
  if (box.x < 0 || box.y < 0 || box.x + box.width > viewport.width || box.y + box.height > viewport.height) {
    throw new Error(`Dialog overflows viewport ${viewport.width}x${viewport.height}.`);
  }
}

async function assertDialogImagesReady(dialog) {
  const images = dialog.locator('img');
  const count = await images.count();
  if (count === 0) return;
  await images.evaluateAll(async (nodes) => {
    await Promise.all(nodes.map(async (node) => {
      if (!(node instanceof HTMLImageElement)) return;
      if (!node.complete) {
        await new Promise((resolve) => {
          node.addEventListener('load', resolve, { once: true });
          node.addEventListener('error', resolve, { once: true });
        });
      }
      await node.decode().catch(() => undefined);
    }));
  });
  const broken = await images.evaluateAll((nodes) => nodes.filter((node) => (
    node instanceof HTMLImageElement && (node.naturalWidth === 0 || node.naturalHeight === 0)
  )).map((node) => node.getAttribute('src')));
  if (broken.length > 0) {
    throw new Error(`Dialog has ${broken.length} broken preview image(s): ${broken.join(', ')}`);
  }
}

async function openPicker(page, label, dialogName, closeLabel, screenshotPath) {
  const labelNode = page.getByText(label, { exact: true }).first();
  const trigger = labelNode.locator('..').getByRole('button').first();
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: dialogName });
  await dialog.waitFor({ state: 'visible' });
  await assertDialogFits(page, dialog);
  await assertDialogImagesReady(dialog);
  await page.screenshot({ path: screenshotPath, fullPage: false });
  await page.getByRole('button', { name: closeLabel }).click();
  await dialog.waitFor({ state: 'hidden' });
}

async function exerciseRoute(page, route, viewport) {
  const evidence = [];

  if (route.name === 'home') {
    const globalBrowserEntry = page.getByRole('button', { name: '浏览器工作区' });
    await globalBrowserEntry.waitFor({ state: 'visible' });
    if (await globalBrowserEntry.locator('svg').count() === 0) {
      throw new Error('The global browser workspace entry is missing its panel icon.');
    }
    await globalBrowserEntry.click();
    const idleBrowserWorkspace = page.getByRole('region', { name: '浏览器工作区' });
    await idleBrowserWorkspace.waitFor({ state: 'visible' });
    await idleBrowserWorkspace.getByText('输入网址开始浏览', { exact: true }).waitFor({ state: 'visible' });
    await idleBrowserWorkspace.getByLabel('浏览器工具栏').waitFor({ state: 'visible' });
    const browserLaunchBar = idleBrowserWorkspace.getByLabel(
      '浏览器启动栏 (输入网址或搜索内容，Enter 开始)',
    );
    await browserLaunchBar.waitFor({ state: 'visible' });
    if (await browserLaunchBar.getAttribute('readonly')) {
      throw new Error('The shell browser launch bar is unexpectedly read-only.');
    }
    await browserLaunchBar.fill('example.com');
    if (await idleBrowserWorkspace.getByRole('button', { name: '开始浏览' }).isDisabled()) {
      throw new Error('The shell browser launch action stayed disabled after valid input.');
    }
    await browserLaunchBar.press('Escape');
    if (viewport.name === 'desktop') {
      const mainWorkspaceBox = await page.getByTestId('workbench-main-panel').boundingBox();
      if (!mainWorkspaceBox || mainWorkspaceBox.width < 550) {
        throw new Error(
          `Global browser workspace squeezed the main task column: ${JSON.stringify(mainWorkspaceBox)}.`,
        );
      }
      const composerBox = await page
        .getByPlaceholder('描述你想让 HOLA DAY 做什么...')
        .boundingBox();
      if (!composerBox || composerBox.width < 480) {
        throw new Error(
          `Global browser workspace squeezed the home composer: ${JSON.stringify(composerBox)}.`,
        );
      }
      const suggestionBoxes = await Promise.all(
        ['直播复盘', '查资料', '打开网页', '行情查询', '下载文件', '定时任务'].map((label) =>
          page.getByRole('button', { name: `用示例填入：${label}`, exact: true }).boundingBox(),
        ),
      );
      const suggestionRows = new Set(
        suggestionBoxes
          .filter(Boolean)
          .map((box) => Math.round(box.y / 8) * 8),
      );
      if (suggestionBoxes.some((box) => !box || box.width < 100) || suggestionRows.size > 2) {
        throw new Error(
          `Global browser workspace collapsed the home actions: ${JSON.stringify(suggestionBoxes)}.`,
        );
      }
      await page.screenshot({
        path: path.join(OUTPUT_DIR, screenshotName(route.name, viewport.name, 'browser-inline')),
        fullPage: false,
      });
      await globalBrowserEntry.click();
    } else {
      let workspaceBox = null;
      const workspaceBoundsDeadline = Date.now() + 1_000;
      while (Date.now() < workspaceBoundsDeadline) {
        workspaceBox = await idleBrowserWorkspace.boundingBox();
        if (
          workspaceBox &&
          workspaceBox.x >= -1 &&
          workspaceBox.y >= -1 &&
          workspaceBox.x + workspaceBox.width <= viewport.width + 1 &&
          workspaceBox.y + workspaceBox.height <= viewport.height + 1
        ) {
          break;
        }
        await page.waitForTimeout(50);
      }
      if (
        !workspaceBox ||
        workspaceBox.x < -1 ||
        workspaceBox.y < -1 ||
        workspaceBox.x + workspaceBox.width > viewport.width + 1 ||
        workspaceBox.y + workspaceBox.height > viewport.height + 1
      ) {
        throw new Error(
          `Global browser workspace overflows ${viewport.name}: ${JSON.stringify(workspaceBox)}.`,
        );
      }
      await page.screenshot({
        path: path.join(OUTPUT_DIR, screenshotName(route.name, viewport.name, 'browser-workspace')),
        fullPage: false,
      });
      await idleBrowserWorkspace.getByRole('button', { name: '收起浏览器' }).click();
    }
    await idleBrowserWorkspace.waitFor({ state: 'hidden' });
    evidence.push('全局浏览器工作区可直接输入网址或搜索内容，并可在无任务时打开和关闭');

    const browserEntry = page.getByRole('button', { name: '打开网页' });
    await browserEntry.waitFor({ state: 'visible' });
    if (await browserEntry.locator('svg').count() === 0) {
      throw new Error('The 打开网页 entry is missing its browser icon.');
    }
    evidence.push('打开网页入口及图标可见');

    if (IS_LOCAL && viewport.name === 'desktop') {
      await page.getByText(BROWSER_FIXTURE_TITLE, { exact: true }).first().click();
      await page.getByLabel('HOLA DAY 浏览器').waitFor({ state: 'visible' });
      await page
        .getByLabel('浏览器目标地址 (正在打开，尚未确认到达)')
        .waitFor({ state: 'visible' });
      const toolbarBox = await page.getByLabel('浏览器工具栏').boundingBox();
      const accountDockBox = await page.getByLabel('账户与通知').boundingBox();
      if (toolbarBox && accountDockBox) {
        const overlaps = !(
          accountDockBox.x + accountDockBox.width <= toolbarBox.x ||
          accountDockBox.x >= toolbarBox.x + toolbarBox.width ||
          accountDockBox.y + accountDockBox.height <= toolbarBox.y ||
          accountDockBox.y >= toolbarBox.y + toolbarBox.height
        );
        if (overlaps) throw new Error('Account controls overlap the browser toolbar.');
      }
      await page.getByRole('button', { name: '全屏浏览器模式' }).click();
      const exitFullscreen = page.getByRole('button', { name: '退出全屏' });
      await exitFullscreen.waitFor({ state: 'visible' });
      await page
        .getByLabel('浏览器目标地址 (正在打开，尚未确认到达)')
        .waitFor({ state: 'visible' });
      if (await page.getByRole('alert').filter({ hasText: '需要登录' }).isVisible().catch(() => false)) {
        throw new Error('The awaiting-user banner overlaps the fullscreen browser surface.');
      }
      if (await page.getByRole('button', { name: '收起浏览器' }).isVisible().catch(() => false)) {
        throw new Error('The collapsed-panel handle remains visible in fullscreen.');
      }
      const fullscreenShot = path.join(
        OUTPUT_DIR,
        screenshotName(route.name, viewport.name, 'browser-fullscreen'),
      );
      await page.screenshot({ path: fullscreenShot, fullPage: false });
      const usedNativeFullscreen = await page.evaluate(() => document.fullscreenElement !== null);
      await exitFullscreen.click();
      await page.getByRole('button', { name: '全屏浏览器模式' }).waitFor({ state: 'visible' });
      const selectedBrowserPanel = page.getByRole('region', { name: '浏览器工作区' });
      await selectedBrowserPanel.getByRole('button', { name: '收起浏览器' }).click();
      await selectedBrowserPanel.waitFor({ state: 'hidden' });
      const taskBrowserButton = page.getByRole('button', { name: '需要登录' }).first();
      await taskBrowserButton.waitFor({ state: 'visible' });
      const [taskBrowserButtonBox, closedAccountDockBox] = await Promise.all([
        taskBrowserButton.boundingBox(),
        page.getByLabel('账户与通知').boundingBox(),
      ]);
      if (
        taskBrowserButtonBox &&
        closedAccountDockBox &&
        taskBrowserButtonBox.x + taskBrowserButtonBox.width > closedAccountDockBox.x
      ) {
        throw new Error('Task browser action overlaps the account controls.');
      }
      await taskBrowserButton.click();
      await selectedBrowserPanel.waitFor({ state: 'visible' });
      if (await selectedBrowserPanel.getByText('输入网址开始浏览', { exact: true }).isVisible().catch(() => false)) {
        throw new Error('Desktop selected browser task reopened as the empty global workspace.');
      }
      evidence.push(
        `浏览器任务面板、地址栏、关闭重开和${usedNativeFullscreen ? '原生' : '应用内兜底'}全屏可用`,
      );
    }
  }

  if (viewport.name !== 'desktop') return evidence;

  if (route.name === 'video') {
    const modelShot = path.join(OUTPUT_DIR, screenshotName(route.name, viewport.name, 'model-dialog'));
    await openPicker(page, 'AI 模型', '选择视频模型', '关闭模型选择', modelShot);
    const styleShot = path.join(OUTPUT_DIR, screenshotName(route.name, viewport.name, 'style-dialog'));
    await openPicker(page, '风格样式', '选择氛围', '关闭风格选择', styleShot);
    evidence.push('视频模型和风格弹窗可打开、关闭且不越界');
  }

  if (route.name === 'image') {
    const modelShot = path.join(OUTPUT_DIR, screenshotName(route.name, viewport.name, 'model-dialog'));
    await openPicker(page, 'AI 模型', '选择图片模型', '关闭模型选择', modelShot);
    const styleShot = path.join(OUTPUT_DIR, screenshotName(route.name, viewport.name, 'style-dialog'));
    await openPicker(page, '风格样式', '选择图片风格', '关闭图片风格选择', styleShot);
    evidence.push('图片模型和风格弹窗可打开、关闭且不越界');
  }

  return evidence;
}

async function checkRoute(browser, token, route, viewport) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    locale: 'zh-CN',
    colorScheme: 'light',
    reducedMotion: 'reduce',
  });
  await context.addInitScript((accessToken) => {
    localStorage.setItem('holaday.access_token', accessToken);
  }, token);

  const page = await context.newPage();
  const consoleErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(error.message));

  const result = {
    route: route.pathname,
    viewport: viewport.name,
    size: `${viewport.width}x${viewport.height}`,
    status: 'failed',
    evidence: [],
    consoleErrors,
  };

  try {
    const response = await page.goto(new URL(route.pathname, BASE_URL).href, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
    await page.evaluate(() => document.fonts.ready);

    if (!response || response.status() >= 400) {
      throw new Error(`Navigation returned HTTP ${response?.status() ?? 'no response'}.`);
    }
    if (page.url().includes('/login')) throw new Error('Authenticated route redirected to login.');
    for (const text of route.expected) {
      await page.getByText(text, { exact: false }).first().waitFor({ state: 'visible' });
    }

    const bodyText = (await page.locator('body').innerText()).trim();
    if (bodyText.length < 40) throw new Error('Page rendered as an empty shell.');

    const overlay = page.locator('[data-nextjs-dialog], .vite-error-overlay, #webpack-dev-server-client-overlay');
    if (await overlay.count()) throw new Error('Framework error overlay is visible.');

    const layout = await page.evaluate(() => ({
      horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      fontStatus: document.fonts.status,
    }));
    if (layout.horizontalOverflow > 1) {
      throw new Error(`Document has ${layout.horizontalOverflow}px horizontal overflow.`);
    }
    if (layout.fontStatus !== 'loaded') throw new Error(`Fonts are not ready: ${layout.fontStatus}.`);

    if (viewport.width <= 768) {
      const headingBox = await page.locator('h1').first().boundingBox();
      if (!headingBox) throw new Error('Primary page heading is not visible.');
      if (headingBox.x > 120) {
        throw new Error(
          `Primary content starts at x=${Math.round(headingBox.x)}px; desktop sidebar is squeezing the responsive layout.`,
        );
      }
      const mobileMenu = page.getByRole('button', { name: '打开任务列表' });
      await mobileMenu.waitFor({
        state: 'visible',
        timeout: 3_000,
      });
      await mobileMenu.click();
      const mobileDrawer = page.getByRole('dialog').filter({ hasText: '新任务' }).first();
      await mobileDrawer.waitFor({ state: 'visible', timeout: 3_000 });
      await page.mouse.click(viewport.width - 4, Math.round(viewport.height / 2));
      await mobileDrawer.waitFor({ state: 'hidden', timeout: 3_000 });
    }

    result.evidence = await exerciseRoute(page, route, viewport);
    const screenshotPath = path.join(OUTPUT_DIR, screenshotName(route.name, viewport.name));
    await page.screenshot({ path: screenshotPath, fullPage: false });
    result.screenshot = screenshotPath;

    if (consoleErrors.length > 0) {
      throw new Error(`Console emitted ${consoleErrors.length} error(s).`);
    }

    result.status = 'passed';
    return result;
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
    const failureShot = path.join(OUTPUT_DIR, screenshotName(route.name, viewport.name, 'failure'));
    await page.screenshot({ path: failureShot, fullPage: false }).catch(() => undefined);
    result.screenshot = failureShot;
    return result;
  } finally {
    await context.close();
  }
}

async function checkResponsiveBrowserFixture(browser, token, viewport) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    locale: 'zh-CN',
    colorScheme: 'light',
    reducedMotion: 'reduce',
  });
  await context.addInitScript((accessToken) => {
    localStorage.setItem('holaday.access_token', accessToken);
  }, token);
  const page = await context.newPage();
  const consoleErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(error.message));
  const result = {
    route: `/?task=${BROWSER_FIXTURE_ID}`,
    viewport: `${viewport.name}-browser-panel`,
    size: `${viewport.width}x${viewport.height}`,
    status: 'failed',
    evidence: [],
    consoleErrors,
  };

  try {
    await page.goto(new URL(`/?task=${BROWSER_FIXTURE_ID}`, BASE_URL).href, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    const panel = page.getByRole('region', { name: '浏览器工作区' });
    await panel.waitFor({ state: 'visible', timeout: 5_000 });
    const pendingTarget = panel.getByLabel('浏览器目标地址 (正在打开，尚未确认到达)');
    await pendingTarget.waitFor({ state: 'visible' });
    if ((await pendingTarget.inputValue()) !== 'https://example.com') {
      throw new Error('Browser startup target is missing or does not match the selected task.');
    }
    let panelBox = null;
    const panelBoundsDeadline = Date.now() + 2_000;
    while (Date.now() < panelBoundsDeadline) {
      panelBox = await panel.boundingBox();
      if (
        panelBox &&
        panelBox.x >= -1 &&
        panelBox.y >= -1 &&
        panelBox.x + panelBox.width <= viewport.width + 1 &&
        panelBox.y + panelBox.height <= viewport.height + 1
      ) {
        break;
      }
      await page.waitForTimeout(50);
    }
    if (!panelBox) throw new Error('Responsive browser panel has no visible bounds.');
    if (
      panelBox.x < -1 ||
      panelBox.y < -1 ||
      panelBox.x + panelBox.width > viewport.width + 1 ||
      panelBox.y + panelBox.height > viewport.height + 1
    ) {
      throw new Error(
        `Responsive browser panel overflows its viewport: ${JSON.stringify(panelBox)}.`,
      );
    }
    if (viewport.width >= 768) {
      const taskWorkspaceBox = await page
        .getByTestId('workbench-main-panel')
        .boundingBox();
      if (!taskWorkspaceBox) {
        throw new Error('Task workspace has no visible bounds beside the browser panel.');
      }
      if (boxesOverlap(taskWorkspaceBox, panelBox)) {
        throw new Error(
          `Task and browser workspaces overlap instead of sharing one plane: ${JSON.stringify({ taskWorkspaceBox, panelBox })}.`,
        );
      }
    }

    await panel.getByRole('button', { name: '收起浏览器' }).first().click();
    await panel.waitFor({ state: 'hidden' });
    const mobileTaskHeaderVisible = await page
      .getByTestId('mobile-task-header')
      .isVisible()
      .catch(() => false);
    const desktopTaskHeader = page.getByTestId('desktop-task-header-band');
    const desktopTaskHeaderVisible = await desktopTaskHeader.isVisible().catch(() => false);
    if (Number(mobileTaskHeaderVisible) + Number(desktopTaskHeaderVisible) !== 1) {
      throw new Error('Task header breakpoint rendered zero or multiple visible header bands.');
    }
    const accountDock = page.getByTestId('desktop-account-dock');
    if (await accountDock.isVisible().catch(() => false)) {
      const [accountDockBox, taskHeaderBox] = await Promise.all([
        accountDock.boundingBox(),
        desktopTaskHeader.boundingBox(),
      ]);
      if (
        accountDockBox &&
        taskHeaderBox &&
        accountDockBox.y + accountDockBox.height > taskHeaderBox.y + taskHeaderBox.height + 1
      ) {
        throw new Error('Desktop account dock extends below the reserved task header band.');
      }
    }
    const reopenButton = viewport.width <= 768
      ? page.getByRole('button', { name: '浏览器工作区' }).first()
      : page.getByRole('button', { name: '需要登录' }).first();
    await reopenButton.click();
    await panel.waitFor({ state: 'visible' });
    await page.waitForTimeout(350);
    if (await panel.getByText('输入网址开始浏览', { exact: true }).isVisible().catch(() => false)) {
      throw new Error('Selected browser task reopened as the empty global workspace.');
    }

    const horizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    if (horizontalOverflow > 1) {
      throw new Error(`Responsive browser task has ${horizontalOverflow}px horizontal overflow.`);
    }
    if (consoleErrors.length > 0) {
      throw new Error(`Console emitted ${consoleErrors.length} error(s).`);
    }

    const screenshotPath = path.join(
      OUTPUT_DIR,
      screenshotName('browser-panel', viewport.name),
    );
    await page.screenshot({ path: screenshotPath, fullPage: false });
    result.screenshot = screenshotPath;
    result.evidence = ['浏览器抽屉自动打开、收起和重新打开均可用'];
    result.status = 'passed';
    return result;
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
    const failureShot = path.join(
      OUTPUT_DIR,
      screenshotName('browser-panel', viewport.name, 'failure'),
    );
    await page.screenshot({ path: failureShot, fullPage: false }).catch(() => undefined);
    result.screenshot = failureShot;
    return result;
  } finally {
    await context.close();
  }
}

async function checkMobileTerminalEvidence(browser, token) {
  const viewport = VIEWPORTS.find((item) => item.name === 'mobile');
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    locale: 'zh-CN',
    colorScheme: 'light',
    reducedMotion: 'reduce',
  });
  await context.addInitScript((accessToken) => {
    localStorage.setItem('holaday.access_token', accessToken);
  }, token);
  const page = await context.newPage();
  const result = {
    route: `/?task=${BROWSER_TERMINAL_FIXTURE_ID}`,
    viewport: 'mobile-terminal-evidence',
    size: `${viewport.width}x${viewport.height}`,
    status: 'failed',
    evidence: [],
    consoleErrors: [],
  };

  try {
    await page.goto(new URL(result.route, BASE_URL).href, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    const panel = page.getByRole('region', { name: '浏览器工作区' });
    if (!await panel.isVisible().catch(() => false)) {
      await page
        .getByRole('button', { name: '浏览器工作区', exact: true })
        .click();
    }
    await panel.waitFor({ state: 'visible', timeout: 5_000 });
    const evidenceTitle = panel.getByText('终态证据', { exact: true });
    const fitControl = panel.getByRole('button', { name: '按原始尺寸查看' });
    await Promise.all([
      evidenceTitle.waitFor({ state: 'visible' }),
      fitControl.waitFor({ state: 'visible' }),
    ]);
    const [titleBox, controlBox] = await Promise.all([
      evidenceTitle.boundingBox(),
      fitControl.boundingBox(),
    ]);
    if (!titleBox || !controlBox) {
      throw new Error('Terminal evidence title or fit control has no visible bounds.');
    }
    if (boxesOverlap(titleBox, controlBox)) {
      throw new Error('Mobile evidence fit control overlaps the terminal evidence heading.');
    }
    const screenshotPath = path.join(
      OUTPUT_DIR,
      screenshotName('browser-terminal-evidence', 'mobile'),
    );
    await page.screenshot({ path: screenshotPath, fullPage: false });
    result.screenshot = screenshotPath;
    result.evidence = ['终态截图缩放控件与证据标题互不遮挡'];
    result.status = 'passed';
    return result;
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
    const failureShot = path.join(
      OUTPUT_DIR,
      screenshotName('browser-terminal-evidence', 'mobile', 'failure'),
    );
    await page.screenshot({ path: failureShot, fullPage: false }).catch(() => undefined);
    result.screenshot = failureShot;
    return result;
  } finally {
    await context.close();
  }
}

async function checkInlineTerminalEvidence(browser, token, viewport) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    locale: 'zh-CN',
    colorScheme: 'light',
    reducedMotion: 'reduce',
  });
  await context.addInitScript((accessToken) => {
    localStorage.setItem('holaday.access_token', accessToken);
  }, token);
  const page = await context.newPage();
  const result = {
    route: `/?task=${BROWSER_TERMINAL_FIXTURE_ID}`,
    viewport: `${viewport.name}-terminal-evidence`,
    size: `${viewport.width}x${viewport.height}`,
    status: 'failed',
    evidence: [],
    consoleErrors: [],
  };

  try {
    await page.goto(new URL(result.route, BASE_URL).href, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    const panel = page.getByRole('region', { name: '浏览器工作区' });
    if (!await panel.isVisible().catch(() => false)) {
      const taskToggle = page.getByRole('button', {
        name: '查看浏览器',
        exact: true,
      });
      if (await taskToggle.isVisible().catch(() => false)) {
        await taskToggle.click();
      } else {
        await page
          .getByRole('button', { name: '浏览器工作区', exact: true })
          .click();
      }
    }
    await panel.waitFor({ state: 'visible', timeout: 5_000 });
    const taskWorkspace = page.getByTestId('workbench-main-panel');
    const evidenceImage = panel.getByRole('img', {
      name: '任务完成时的浏览器画面',
    });
    const fullscreenEvidenceButton = panel.getByRole('button', {
      name: '全屏查看任务截图',
      exact: true,
    });
    await evidenceImage.waitFor({ state: 'visible' });
    await fullscreenEvidenceButton.waitFor({ state: 'visible' });
    await page.waitForTimeout(250);
    const [taskBox, panelBox, imageBox] = await Promise.all([
      taskWorkspace.boundingBox(),
      panel.boundingBox(),
      evidenceImage.boundingBox(),
    ]);
    if (!taskBox || !panelBox || !imageBox) {
      throw new Error('Inline terminal evidence surfaces have no visible bounds.');
    }
    if (boxesOverlap(taskBox, panelBox)) {
      throw new Error('Inline terminal browser overlays the task workspace.');
    }
    const fittedGeometry = await evidenceImage.evaluate((image) => {
      const host = image.parentElement?.parentElement;
      if (!host) return null;
      const imageRect = image.getBoundingClientRect();
      const hostRect = host.getBoundingClientRect();
      return {
        imageWidth: imageRect.width,
        imageHeight: imageRect.height,
        hostWidth: hostRect.width,
        hostHeight: hostRect.height,
        scrollWidth: host.scrollWidth,
        scrollHeight: host.scrollHeight,
        naturalWidth: image.naturalWidth,
        naturalHeight: image.naturalHeight,
      };
    });
    if (!fittedGeometry) {
      throw new Error('Terminal evidence viewer has no measurable host.');
    }
    if (
      fittedGeometry.imageWidth > fittedGeometry.hostWidth + 1 ||
      fittedGeometry.imageHeight > fittedGeometry.hostHeight + 1 ||
      fittedGeometry.scrollWidth > fittedGeometry.hostWidth + 1
    ) {
      throw new Error(
        `Terminal screenshot is cropped in its default fit mode: ${JSON.stringify(fittedGeometry)}.`,
      );
    }
    const displayedAspect = fittedGeometry.imageWidth / fittedGeometry.imageHeight;
    const naturalAspect = fittedGeometry.naturalWidth / fittedGeometry.naturalHeight;
    if (Math.abs(displayedAspect - naturalAspect) > 0.02) {
      throw new Error(
        `Terminal screenshot aspect ratio is distorted: ${JSON.stringify(fittedGeometry)}.`,
      );
    }
    if (panelBox.width < 359) {
      throw new Error(
        `Inline terminal browser is below its readable width floor: ${panelBox.width}px.`,
      );
    }
    if (fittedGeometry.hostHeight > fittedGeometry.imageHeight + 2) {
      throw new Error(
        `Wide terminal screenshot is floating inside an empty full-height canvas: ${JSON.stringify(
          fittedGeometry,
        )}.`,
      );
    }
    const screenshotPath = path.join(
      OUTPUT_DIR,
      screenshotName('browser-terminal-evidence', viewport.name),
    );
    await page.screenshot({ path: screenshotPath, fullPage: false });
    result.screenshot = screenshotPath;
    result.evidence = ['任务区与浏览器同平面，窄栏宽度不少于 360px，横向终态截图使用紧凑预览并提供全屏查看'];
    result.status = 'passed';
    return result;
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
    const failureShot = path.join(
      OUTPUT_DIR,
      screenshotName('browser-terminal-evidence', viewport.name, 'failure'),
    );
    await page.screenshot({ path: failureShot, fullPage: false }).catch(() => undefined);
    result.screenshot = failureShot;
    return result;
  } finally {
    await context.close();
  }
}

async function main() {
  log(`Holaday web QA: ${BASE_URL}`);
  log(`Artifacts: ${OUTPUT_DIR}`);
  await ensureLocalStack();
  const auth = await authenticate();
  await resetDedicatedLocalQaQuota(auth.email);
  const cleanupBrowserFixture = await createLocalBrowserFixture(auth.email);

  const launchOptions = fs.existsSync(CHROME_PATH)
    ? { headless: true, executablePath: CHROME_PATH }
    : { headless: true, channel: 'chrome' };
  const results = [];
  let browser;
  try {
    browser = await chromium.launch(launchOptions);
    for (const viewport of VIEWPORTS) {
      for (const route of ROUTES) {
        const result = await checkRoute(browser, auth.token, route, viewport);
        results.push(result);
        log(`${result.status === 'passed' ? 'PASS' : 'FAIL'} ${result.size} ${result.route}${result.error ? ` - ${result.error}` : ''}`);
      }
    }
    if (IS_LOCAL) {
      for (const viewport of VIEWPORTS.filter((item) => item.name !== 'desktop')) {
        const result = await checkResponsiveBrowserFixture(browser, auth.token, viewport);
        results.push(result);
        log(`${result.status === 'passed' ? 'PASS' : 'FAIL'} ${result.size} ${result.route}${result.error ? ` - ${result.error}` : ''}`);
      }
      const terminalEvidenceResult = await checkMobileTerminalEvidence(
        browser,
        auth.token,
      );
      results.push(terminalEvidenceResult);
      log(`${terminalEvidenceResult.status === 'passed' ? 'PASS' : 'FAIL'} ${terminalEvidenceResult.size} ${terminalEvidenceResult.route}${terminalEvidenceResult.error ? ` - ${terminalEvidenceResult.error}` : ''}`);
      for (const viewport of VIEWPORTS.filter((item) =>
        item.name === 'compact-desktop' || item.name === 'tablet'
      )) {
        const inlineTerminalEvidenceResult = await checkInlineTerminalEvidence(
          browser,
          auth.token,
          viewport,
        );
        results.push(inlineTerminalEvidenceResult);
        log(`${inlineTerminalEvidenceResult.status === 'passed' ? 'PASS' : 'FAIL'} ${inlineTerminalEvidenceResult.size} ${inlineTerminalEvidenceResult.route}${inlineTerminalEvidenceResult.error ? ` - ${inlineTerminalEvidenceResult.error}` : ''}`);
      }
    }
  } finally {
    await browser?.close();
    await cleanupBrowserFixture?.();
  }

  const reportPath = path.join(OUTPUT_DIR, 'report.json');
  const failures = results.filter((result) => result.status !== 'passed');
  await fsp.writeFile(
    reportPath,
    `${JSON.stringify({ baseUrl: BASE_URL, generatedAt: new Date().toISOString(), results }, null, 2)}\n`,
  );
  log(`Report: ${reportPath}`);
  if (failures.length > 0) {
    throw new Error(`${failures.length} browser check(s) failed.`);
  }
  log(`PASS ${results.length}/${results.length} browser checks`);
}

try {
  await main();
} catch (error) {
  process.stderr.write(`Web QA failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
} finally {
  stopStartedProcesses();
}
