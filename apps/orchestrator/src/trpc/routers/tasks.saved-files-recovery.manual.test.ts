/** Explicit, read-only restoration of our own historical SQL/file evidence. Never executes a task. */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { connect } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import express from 'express';
import { type Browser, chromium } from 'playwright';
import { afterAll, expect, it, vi } from 'vitest';
import { signAccessToken } from '../../auth/jwt.js';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import type { DB } from '../../db/client.js';
import { taskFiles } from '../../db/schema/task-files.js';
import { tasks } from '../../db/schema/tasks.js';
import { reloadFeatureFlagsForTest } from '../../execution/feature-flags.js';
import * as storage from '../../files/storage-provider.js';
import { createHttpApp } from '../../http.js';
import * as messages from '../../llm/messages-adapter.js';
import { openIsolatedMysqlProbe } from '../../testing/isolated-mysql-probe.js';
import * as extensionWs from '../../ws/server.js';

const boundary = vi.hoisted(() => ({ current: null as DB | null }));
vi.mock('../../db/client.js', () => ({
  db: new Proxy(
    {},
    {
      get(_target, key) {
        if (!boundary.current) throw new Error('Read-only SQL boundary is not ready');
        const value = Reflect.get(boundary.current, key);
        return typeof value === 'function' ? value.bind(boundary.current) : value;
      },
    },
  ),
  pool: { end: async () => {} },
}));
const root = fileURLToPath(new URL('../../../../..', import.meta.url));
const runtime = join(
  root,
  '.superpowers/sdd/2026-11-18-browser-assistant-release-readiness/real-site-runtime-20261118',
);
const incident = join(runtime, 'joint-app-v3');
const taskId = 'tsk_2ncmrVDbv9Yh5xWG3Tf4z';
const originalEnv = { ...env };
let close: (() => Promise<void>) | undefined;
let browser: Browser | undefined;
afterAll(async () => {
  await browser?.close();
  await close?.();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  Object.assign(env, originalEnv);
  reloadFeatureFlagsForTest();
  console.log('HISTORICAL_READONLY_CLEANUP_COMPLETE', { exitCode: process.exitCode ?? 0 });
});

it.runIf(process.env.HOLADAY_SAVED_FILE_RECOVERY_MANUAL === '1')(
  'restores actual saved files through historical App UI without replaying the unresolved task',
  async () => {
    expect(process.env.HOLADAY_SQL_PERSISTENCE_PROBE).toBe('1');
    const out = resolve(process.env.HOLADAY_SAVED_FILE_RECOVERY_OUT ?? '');
    expect(out.startsWith('/private/tmp/pr360-readiness/saved-file-recovery-historical-')).toBe(
      true,
    );
    const artifacts = join(out, 'artifacts');
    await mkdir(artifacts, { recursive: true, mode: 0o700 });
    await writeFile(
      join(artifacts, 'owner.json'),
      JSON.stringify({ pid: process.pid, readOnly: true }),
      { flag: 'wx', mode: 0o600 },
    );
    const hash = (data: Buffer | string) => createHash('sha256').update(data).digest('hex');
    const candidatePath = process.env.HOLADAY_SAVED_FILE_RECOVERY_CANDIDATE;
    let candidateBinding: Record<string, unknown> | null = null;
    const uiDir = join(artifacts, 'workbench');
    if (candidatePath) {
      const manifestPath = resolve(candidatePath);
      expect(manifestPath.startsWith('/private/tmp/pr360-readiness/candidate-')).toBe(true);
      const candidateRoot = dirname(manifestPath);
      const manifestBytes = await readFile(manifestPath);
      const candidate = JSON.parse(manifestBytes.toString());
      expect(candidate.kind).toBe('local_review_build_only');
      expect(candidate.sourceCommit).toMatch(/^[a-f0-9]{40}$/);
      expect(candidate.executionAllowed).toBe(false);
      expect(candidate.runtimeInputs).toBe('runtime-inputs.json');
      const inputBytes = await readFile(join(candidateRoot, 'runtime-inputs.json'));
      expect(hash(inputBytes)).toBe(candidate.runtimeInputsSHA256);
      const inputs = JSON.parse(inputBytes.toString()) as Array<{ path: string; sha256: string }>;
      expect(inputs.length).toBe(candidate.runtimeInputCount);
      expect(inputs.length).toBeLessThan(5000);
      for (const input of inputs) {
        const path = resolve(root, input.path);
        expect(path.startsWith(`${resolve(root)}/`)).toBe(true);
        expect(hash(await readFile(path)), input.path).toBe(input.sha256);
      }
      const artifact = candidate.artifacts.workbench;
      expect(artifact.archive).toMatch(/^workbench-[a-f0-9]{8}\.zip$/);
      expect(artifact.fileManifest).toBe('workbench-files.json');
      const archivePath = join(candidateRoot, artifact.archive);
      expect(hash(await readFile(archivePath))).toBe(artifact.sha256);
      const fileBytes = await readFile(join(candidateRoot, artifact.fileManifest));
      expect(hash(fileBytes)).toBe(artifact.fileManifestSHA256);
      const extracted = spawnSync(
        'python3',
        [
          '-c',
          [
            'from pathlib import Path, PurePosixPath',
            'import sys, zipfile, stat',
            'with zipfile.ZipFile(sys.argv[1]) as archive:',
            ' entries = archive.infolist()',
            ' assert len(entries) < 5000 and sum(e.file_size for e in entries) < 256*1024*1024',
            ' for entry in entries:',
            '  path = PurePosixPath(entry.filename)',
            '  assert not path.is_absolute() and ".." not in path.parts and "\\\\" not in entry.filename',
            '  assert not stat.S_ISLNK(entry.external_attr >> 16)',
            ' assert archive.testzip() is None',
            ' archive.extractall(sys.argv[2])',
          ].join('\n'),
          archivePath,
          uiDir,
        ],
        { encoding: 'utf8' },
      );
      expect(extracted.status, extracted.stderr).toBe(0);
      const entries = JSON.parse(fileBytes.toString()) as Array<{ path: string; sha256: string }>;
      expect(entries.length).toBe(artifact.files);
      for (const entry of entries) {
        const path = resolve(uiDir, entry.path);
        expect(path.startsWith(`${uiDir}/`)).toBe(true);
        expect(hash(await readFile(path)), entry.path).toBe(entry.sha256);
      }
      candidateBinding = {
        sourceCommit: candidate.sourceCommit,
        manifestSHA256: hash(manifestBytes),
        workbenchZIP_SHA256: artifact.sha256,
        runtimeInputsVerified: inputs.length,
        extractedFilesVerified: entries.length,
        scope:
          'actual frozen workbench ZIP with equivalent source backend; compiled backend boot not claimed',
      };
    }
    const ledgerPath = join(runtime, 'model-relay/requests.json');
    const ledgerBefore = await readFile(ledgerPath);
    const ledger = JSON.parse(ledgerBefore.toString());
    // Pin the already-authorized and audited current ledger byte-for-byte.
    // UI restoration cannot reserve a new attempt or turn a missing reply into a receipt.
    expect(hash(ledgerBefore)).toBe(
      'bd6c4a02fbf7f6a0811f621fae83f2f573eec6f2036f7d2ae12abc73ef941aa1',
    );
    expect(ledger.maxAttempts).toBe(41);
    expect(ledger.attempts).toHaveLength(36);
    expect(
      ledger.attempts.flatMap((a: { state: string }, index: number) =>
        a.state === 'unknown' ? [index + 1] : [],
      ),
    ).toEqual([14, 36]);
    const dump = await readFile(join(incident, 'owned-incident-sql.sql'));
    expect(hash(dump)).toBe('7f0950acc9c656ea7575b191ed1a47cacc9b931185bc2e120b3320ecef87bf9a');
    const probe = await openIsolatedMysqlProbe({
      allTableStructures: true,
      artifactPath: join(artifacts, 'mysql-evidence.json'),
    });
    close = () => probe.close();
    boundary.current = probe.db;
    const [marker] = await probe.db.execute(sql`SELECT token FROM codex_probe_owner`);
    if ((marker as unknown as { token: string }[])[0]?.token !== probe.ownershipToken)
      throw new Error('Owned schema marker changed');
    const allowed = new Set([
      'users',
      'tasks',
      'task_steps',
      'task_events',
      'task_files',
      'task_quotas',
    ]);
    const restoredTables: string[] = [];
    await probe.db.execute(sql`SET FOREIGN_KEY_CHECKS=0`);
    try {
      for (const line of dump.toString().split('\n')) {
        const match = /^INSERT INTO `([a-z0-9_]+)` VALUES /.exec(line);
        if (!match || !allowed.has(match[1]!)) continue;
        await probe.db.execute(sql.raw(line));
        restoredTables.push(match[1]!);
      }
    } finally {
      await probe.db.execute(sql`SET FOREIGN_KEY_CHECKS=1`);
    }
    expect(restoredTables).toContain('tasks');
    expect(restoredTables).toContain('task_files');
    const taskRows = await probe.db
      .select({ taskId: tasks.externalId, status: tasks.status })
      .from(tasks);
    expect(taskRows).toEqual([{ taskId, status: 'executing' }]);
    const fileRows = await probe.db
      .select({
        fileId: taskFiles.externalId,
        filename: taskFiles.filename,
        sizeBytes: taskFiles.sizeBytes,
      })
      .from(taskFiles);
    expect(fileRows).toHaveLength(2);
    const rowsBefore = JSON.stringify({ taskRows, fileRows });
    vi.spyOn(storage, 'getSharedStorageProvider').mockReturnValue(
      new storage.LocalStorageProvider(join(incident, 'files'), logger),
    );
    const model = vi.spyOn(messages, 'createQwenMessagesAdapter').mockImplementation(() => {
      throw new Error('Read-only recovery must never dispatch a model');
    });
    Object.assign(env, {
      ANTHROPIC_API_KEY: '',
      DASHSCOPE_API_KEY: '',
      DASHSCOPE_CN_API_KEY: '',
      BROWSER_TASK_FILES_V1: true,
    });
    for (const [key, value] of Object.entries({
      USER_BROWSER_ROUTING_V2: 'true',
      BROWSER_TASK_TABS_ENABLED: 'true',
      BROWSER_LAUNCH_RECOVERY_ENABLED: 'false',
      BROWSER_SESSION_VAULT_ENABLED: 'false',
    }))
      vi.stubEnv(key, value);
    reloadFeatureFlagsForTest();
    const ws = extensionWs.createWsServer(0);
    await ws.ready;
    const address = ws.wss.address();
    if (!address || typeof address === 'string') throw new Error('No owned WS listener');
    const wsPort = address.port;
    const app = express();
    let blockedMutations = 0;
    app.use('/api', (req, res, next) => {
      if (!['GET', 'HEAD'].includes(req.method)) {
        blockedMutations++;
        res.status(403).json({ error: 'Historical recovery is read-only' });
        return;
      }
      next();
    });
    app.use('/api', createHttpApp({ planner: {} as never }));
    app.use(express.static(uiDir));
    if (!candidateBinding) app.use(express.static(join(root, 'apps/web-workbench/public')));
    const tokens = {
      owner: await signAccessToken({ sub: 'usr_acceptance_github', plan: 'pro' }),
      other: await signAccessToken({ sub: 'usr_acceptance_sheets', plan: 'pro' }),
    };
    app.get('/operator-bootstrap', (_req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Referrer-Policy', 'no-referrer');
      res
        .type('html')
        .send(
          `<!doctype html><script>localStorage.setItem('holaday.access_token',${JSON.stringify(tokens.owner)});location.replace('/');</script>`,
        );
    });
    app.get(/.*/, (_req, res) => res.sendFile('index.html', { root: uiDir }));
    const server = createServer(app);
    const ingress = new Set<ReturnType<typeof connect>>();
    const unexpectedProxyErrors: string[] = [];
    let handledProxyDisconnects = 0;
    const proxyError = (side: string, error: Error) => {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ECONNRESET' || code === 'EPIPE') handledProxyDisconnects++;
      else unexpectedProxyErrors.push(`${side}:${code ?? error.message}`);
    };
    server.on('upgrade', (req, socket, head) => {
      // Browser navigation can reset the upgraded ingress before the WS close
      // handshake. Own that local socket error; unexpected proxy failures still fail.
      socket.on('error', (error) => {
        proxyError('ingress', error);
        socket.destroy();
      });
      if (req.url !== '/ws') {
        socket.destroy();
        return;
      }
      const upstream = connect(wsPort, '127.0.0.1', () => {
        upstream.write(
          `${req.method} / HTTP/${req.httpVersion}\r\n${req.rawHeaders.reduce((s, h, i) => s + h + (i % 2 ? '\r\n' : ': '), '')}\r\n`,
        );
        if (head.length) upstream.write(head);
        socket.pipe(upstream).pipe(socket);
      });
      ingress.add(upstream);
      upstream.on('close', () => {
        ingress.delete(upstream);
        socket.destroy();
      });
      upstream.on('error', (error) => {
        proxyError('upstream', error);
        socket.destroy();
      });
      socket.on('close', () => upstream.destroy());
    });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    const httpAddress = server.address();
    if (!httpAddress || typeof httpAddress === 'string') throw new Error('No owned HTTP listener');
    const origin = `http://127.0.0.1:${httpAddress.port}`;
    close = async () => {
      for (const upstream of ingress) upstream.destroy();
      await ws.close();
      server.closeIdleConnections();
      await new Promise<void>((done, reject) =>
        server.close((error) => (error ? reject(error) : done())),
      );
      await probe.close();
      await writeFile(
        join(artifacts, 'proxy-closure.json'),
        JSON.stringify(
          {
            handledProxyDisconnects,
            unexpectedProxyErrors,
          },
          null,
          2,
        ),
      );
      expect(unexpectedProxyErrors).toEqual([]);
    };
    if (!candidateBinding) {
      const web = join(root, 'apps/web-workbench');
      const entry = join(artifacts, 'ui-entry');
      await mkdir(entry);
      await writeFile(
        join(entry, 'index.html'),
        '<!doctype html><html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Holaday 文件恢复验收</title></head><body><div id="root"></div><script type="module" src="/entry.tsx"></script></body></html>',
      );
      await writeFile(join(entry, 'entry.tsx'), `import '${web}/src/main.tsx';`);
      const config = join(entry, 'vite.config.mjs');
      await writeFile(
        config,
        `import app from '${web}/vite.config.ts';export default {...app,root:${JSON.stringify(entry)},resolve:{alias:{'@':${JSON.stringify(join(web, 'src'))},'react':${JSON.stringify(join(web, 'node_modules/react'))},'react-dom':${JSON.stringify(join(web, 'node_modules/react-dom'))}}},css:{postcss:${JSON.stringify(web)}},build:{...app.build,outDir:${JSON.stringify(uiDir)},emptyOutDir:true}};`,
      );
      const build = spawnSync(
        process.execPath,
        [join(web, 'node_modules/vite/bin/vite.js'), 'build', '--config', config],
        { cwd: web, encoding: 'utf8', env: { ...process.env, NODE_ENV: 'production' } },
      );
      await writeFile(
        join(artifacts, 'workbench-build.log'),
        (build.stdout ?? '') + (build.stderr ?? ''),
      );
      expect(build.status).toBe(0);
    }
    browser = await chromium.launch({
      channel: 'chrome',
      headless: true,
      args: ['--renderer-process-limit=2', '--js-flags=--max-old-space-size=256'],
    });
    const context = await browser.newContext({ acceptDownloads: true });
    const page = await context.newPage();
    const consoleErrors: string[] = [];
    const consoleWarnings: string[] = [];
    page.on('pageerror', (error) => consoleErrors.push(error.message));
    page.on('console', (message) => {
      if (['error', 'warning'].includes(message.type()))
        consoleWarnings.push(
          `${message.type()}: ${message
            .text()
            .replace(/https?:\/\/[^\s]+/g, '[url omitted]')
            .slice(0, 200)}`,
        );
    });
    const otherUser = await context.request.get(
      `${origin}/api/trpc/auth.me?batch=1&input=%7B%220%22%3A%7B%7D%7D`,
      { headers: { authorization: `Bearer ${tokens.other}` } },
    );
    expect(otherUser.status()).toBe(200);
    const foreignTask = await context.request.get(
      `${origin}/api/trpc/tasks.detail?batch=1&input=${encodeURIComponent(JSON.stringify({ 0: { taskId } }))}`,
      { headers: { authorization: `Bearer ${tokens.other}` } },
    );
    expect(foreignTask.status()).toBe(404);
    const foreignFile = await context.request.get(
      `${origin}/api/files/${fileRows[0]!.fileId}/download`,
      { headers: { authorization: `Bearer ${tokens.other}` } },
    );
    expect([403, 404]).toContain(foreignFile.status());
    await page.goto(`${origin}/operator-bootstrap`, { waitUntil: 'domcontentloaded' });
    await page
      .getByRole('button', { name: '选择 Chrome 页面' })
      .first()
      .waitFor({ timeout: 30000 });
    await page.goto(`${origin}/history`);
    const historyRow = page
      .getByRole('button')
      .filter({ hasText: '在给定GitHub固定提交的JSON文件页面' })
      .last();
    await historyRow.getByText('执行结果待核实').waitFor();
    await page
      .getByRole('button')
      .filter({ hasText: '在给定GitHub固定提交的JSON文件页面' })
      .last()
      .click();
    await page.waitForURL(`**/?task=${taskId}`);
    await page.reload();
    const views = [];
    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(viewport);
      await page.goto(`${origin}/?task=${taskId}`);
      await page.getByText('文件已保存，任务结果尚未确认。').waitFor({ timeout: 10000 });
      await page.getByRole('region', { name: '执行结果待核实' }).waitFor();
      expect(await page.getByTestId('live-status-line').count()).toBe(0);
      expect(await page.title()).toBe(candidateBinding ? 'HOLA DAY' : 'Holaday 文件恢复验收');
      expect(await page.locator('vite-error-overlay').count()).toBe(0);
      expect(await page.getByTestId('assistant-answer').count()).toBe(0);
      const downloads = [];
      for (const filename of ['pr360-premerge-20261118.json', 'summary.csv']) {
        const button = page.getByRole('button', {
          name: new RegExp(`下载.*${filename.replaceAll('.', '\\.')}`),
        });
        await button.waitFor();
        expect(await button.count()).toBe(1);
        const pending = page.waitForEvent('download');
        await button.click();
        const download = await pending;
        expect(download.suggestedFilename()).toBe(filename);
        const stream = await download.createReadStream();
        if (!stream) throw new Error('No actual download stream');
        const chunks: Buffer[] = [];
        for await (const chunk of stream) chunks.push(Buffer.from(chunk));
        const bytes = Buffer.concat(chunks);
        expect(bytes.length).toBeLessThan(65536);
        const path = join(artifacts, `${viewport.width}-${filename}`);
        await writeFile(path, bytes);
        const bounds = await button.boundingBox();
        expect(bounds).not.toBeNull();
        expect(bounds!.x).toBeGreaterThanOrEqual(0);
        expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width + 1);
        downloads.push({ filename, path, sizeBytes: bytes.length, sha256: hash(bytes), bounds });
        await download.delete();
      }
      const comparison = spawnSync(
        'python3',
        [
          '/Users/yaleiqi/.holaday-recovery/tasks/browser-assistant-next/release-readiness-20261118/real-site-preflight/verify-deliveries.py',
          'github',
          downloads[0]!.path,
          downloads[1]!.path,
        ],
        { encoding: 'utf8' },
      );
      expect(comparison.status, comparison.stderr).toBe(0);
      await page.screenshot({ path: join(artifacts, `history-files-${viewport.width}.png`) });
      views.push({ viewport, downloads, facts: JSON.parse(comparison.stdout) });
    }
    const preparationFeedbackViews = [];
    let syntheticCreateResponses = 0;
    if (process.env.HOLADAY_PREPARATION_FEEDBACK_VISUAL === '1') {
      // Only the browser receives a synthetic rejected write. The read-only
      // fixture server and its SQL never receive this submission.
      await page.route('**/api/trpc/tasks.create*', async (route) => {
        syntheticCreateResponses++;
        await writeFile(
          join(artifacts, 'synthetic-submit-count.json'),
          JSON.stringify({ syntheticCreateResponses }),
        );
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify([
            {
              error: {
                message: '合成验收：创建结果尚未确认，请保留输入。',
                code: -32603,
                data: { code: 'INTERNAL_SERVER_ERROR', httpStatus: 500, path: 'tasks.create' },
              },
            },
          ]),
        });
      });
      for (const viewport of [
        { width: 1440, height: 900 },
        { width: 390, height: 844 },
      ]) {
        await page.setViewportSize(viewport);
        await page.goto(`${origin}/`, { waitUntil: 'domcontentloaded' });
        const input = page.getByRole('textbox').first();
        await input.fill('合成验收：保留这段未确认的输入，不执行网页操作');
        await input.press('Enter');
        const alert = page.getByRole('alert').filter({ hasText: '提交失败' });
        await alert.waitFor({ timeout: 10000 });
        await page
          .getByText('任务创建待核实', { exact: true })
          .first()
          .waitFor({ state: 'attached' });
        const errorText = await alert.textContent();
        expect(errorText).toContain('提交失败');
        await page.waitForTimeout(4500);
        expect(await page.getByRole('button', { name: `关闭提示：${errorText}` }).count()).toBe(0);
        expect(await alert.isVisible()).toBe(true);
        expect(await input.inputValue()).toBe('合成验收：保留这段未确认的输入，不执行网页操作');
        const bounds = await alert.boundingBox();
        expect(bounds).not.toBeNull();
        expect(bounds!.x).toBeGreaterThanOrEqual(0);
        expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width + 1);
        expect(bounds!.y).toBeGreaterThanOrEqual(0);
        expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height + 1);
        await page.screenshot({
          path: join(artifacts, `preparation-feedback-${viewport.width}.png`),
        });
        preparationFeedbackViews.push({
          viewport,
          bounds,
          inputPreserved: true,
          errorStillVisibleAfterToast: true,
          unknownCreationTitle: '任务创建待核实',
          syntheticBrowserResponseOnly: true,
          actualTaskCreated: false,
        });
        await input.fill('修改后的合成指令');
        expect(await alert.count()).toBe(0);
      }
      expect(syntheticCreateResponses).toBe(2);
      expect(blockedMutations).toBe(0);
      await page.unroute('**/api/trpc/tasks.create*');
    }
    expect(consoleErrors).toEqual([]);
    expect(model).not.toHaveBeenCalled();
    expect(hash(await readFile(ledgerPath))).toBe(hash(ledgerBefore));
    const afterTasks = await probe.db
      .select({ taskId: tasks.externalId, status: tasks.status })
      .from(tasks);
    const afterFiles = await probe.db
      .select({
        fileId: taskFiles.externalId,
        filename: taskFiles.filename,
        sizeBytes: taskFiles.sizeBytes,
      })
      .from(taskFiles);
    expect(JSON.stringify({ taskRows: afterTasks, fileRows: afterFiles })).toBe(rowsBefore);
    await writeFile(
      join(artifacts, 'result.json'),
      JSON.stringify(
        {
          scope:
            process.env.HOLADAY_PREPARATION_FEEDBACK_VISUAL === '1'
              ? 'frozen UI historical saved files plus browser-only synthetic rejected submissions; no new task acceptance'
              : 'historical actual saved-file recovery only; original task result remains unresolved',
          browser: browser.version(),
          candidateBinding,
          browserPlugin: 'Browser plugin not available; existing project Playwright workflow',
          readOnlyHTTP: true,
          origin,
          restoredTables,
          sql: '8.0.46',
          taskId,
          taskStatusUnchanged: 'executing',
          taskAccepted: false,
          originalWebsiteExports: 0,
          modelAPICalls: 0,
          canonicalModelLedgerUnchanged: true,
          historyReload: true,
          executionObservation: { state: 'unconfirmed', reason: 'session_not_observed' },
          executionObservationScope: 'current_process_only_not_a_terminal_verdict',
          foreignTaskStatus: foreignTask.status(),
          foreignFileStatus: foreignFile.status(),
          blockedMutations,
          preparationFeedbackViews,
          syntheticCreateResponses,
          consoleErrors,
          consoleWarnings,
          views,
          productionChanged: false,
        },
        null,
        2,
      ),
    );
    await context.close();
    await browser.close();
    browser = undefined;
  },
  180000,
);
