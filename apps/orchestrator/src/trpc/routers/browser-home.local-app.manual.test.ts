/**
 * Opt-in local Home UI acceptance. Real HTTP/JWT/SQL/pool/stream/input, owned synthetic site.
 * A Browser-plugin viewer supplies the UI actions; no provider model or website export is used.
 */
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { type Server, createServer } from 'node:http';
import { join, resolve } from 'node:path';
import type { Duplex } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import express from 'express';
import { expect, it, vi } from 'vitest';
import { signAccessToken } from '../../auth/jwt.js';
import { browserHomeSessionId } from '../../browser-home/browser-home-session.js';
import { BrowserPool } from '../../browser-pool/browser-pool.js';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import type { DB } from '../../db/client.js';
import { users } from '../../db/schema/users.js';
import { ExecutionDrain } from '../../execution/execution-drain.js';
import { reloadFeatureFlagsForTest } from '../../execution/feature-flags.js';
import { type OperationLifetime, startOwnedOperation } from '../../execution/owned-operation.js';
import { createHttpApp } from '../../http.js';
import * as messages from '../../llm/messages-adapter.js';
import { authorizeHumanViewportInput } from '../../streaming/captcha-viewport-action.js';
import { createScreencastProxy } from '../../streaming/screencast-proxy.js';
import { openIsolatedMysqlProbe } from '../../testing/isolated-mysql-probe.js';

const boundary = vi.hoisted(() => ({ current: null as DB | null }));
vi.mock('../../db/client.js', () => ({
  db: new Proxy(
    {},
    {
      get(_target, key) {
        if (!boundary.current) throw new Error('Home UI SQL is not ready');
        const value = Reflect.get(boundary.current, key);
        return typeof value === 'function' ? value.bind(boundary.current) : value;
      },
    },
  ),
  pool: { end: async () => {} },
}));

const repo = fileURLToPath(new URL('../../../../..', import.meta.url));
const hash = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
async function listen(server: Server) {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing owned HTTP port');
  return `http://127.0.0.1:${address.port}`;
}
async function freePort() {
  const server = createServer();
  const origin = await listen(server);
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return Number(new URL(origin).port);
}
async function close(server: Server | undefined) {
  if (!server) return;
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

it.runIf(process.env.HOLADAY_HOME_UI_PROBE === '1')(
  'serves the real Home entry and manual stream against one isolated native browser',
  async () => {
    expect(process.version).toBe('v22.23.3');
    expect(process.platform).toBe('darwin');
    const out = resolve(process.env.HOLADAY_HOME_UI_PROBE_OUT ?? '');
    expect(out.startsWith('/private/tmp/pr360-readiness/cloud-home-ui-')).toBe(true);
    await mkdir(out, { recursive: true, mode: 0o700 });
    const ledger = join(
      repo,
      '.superpowers/sdd/2026-11-18-browser-assistant-release-readiness/real-site-runtime-20261118/model-relay/requests.json',
    );
    const ledgerBefore = hash(await readFile(ledger));
    const originalEnv = { ...env };
    const admissionMode = process.env.HOLADAY_HOME_UI_ADMISSION;
    expect(['default', 'controlled']).toContain(admissionMode);
    const controlled = admissionMode === 'controlled';
    const cleanupErrors: Array<{ phase: string; error: string }> = [];
    let primaryError: unknown;
    let probe: Awaited<ReturnType<typeof openIsolatedMysqlProbe>> | undefined;
    let pool: BrowserPool | undefined;
    let site: Server | undefined;
    let server: Server | undefined;
    const sockets = new Set<Duplex>();
    const state = { clicks: 0, text: '', bottomClicks: 0, observations: 0 };
    const observedInputs: Array<{ clicks: number; text: string; bottomClicks: number }> = [];
    const requests: Array<{ path: string; method: string }> = [];
    const controls: Array<{ action: string; atUTC: string; pid?: number }> = [];
    const externalFetches: string[] = [];
    let modelCalls = 0;
    let streamsDenied = false;
    let passed = false;
    let nativePid: number | undefined;
    const drain = new ExecutionDrain();
    drain.open();
    const admission = {
      drain,
      tick() {},
      runRoot: <T>(action: (life: OperationLifetime) => Promise<T>) =>
        startOwnedOperation(drain, 'request', (owner) => action({ drain, owner }), {
          errorOutcome: 'unknown',
        }),
    };
    try {
      probe = await openIsolatedMysqlProbe({
        allTableStructures: true,
        artifactPath: join(out, 'mysql-evidence.json'),
      });
      boundary.current = probe.db;
      const owner = `usr_home_ui_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
      await probe.db.insert(users).values({
        id: 7,
        externalId: owner,
        email: 'home-ui@example.test',
        passwordHash: 'synthetic-not-a-login-password',
        plan: 'pro',
        modelDataRegion: 'cn',
      });
      Object.assign(env, {
        BROWSER_HOME_ENABLED: true,
        BROWSER_HOME_ALLOWLIST: owner,
        BROWSER_HOME_PROFILE_V1: false,
        BROWSER_HOME_FILES_V1: false,
        BROWSER_VIEWPORT_V2: true,
        BROWSER_OBSERVATION_V2: true,
        BROWSER_COLLABORATION_V2: true,
        BROWSER_REPLAY_V1: false,
        BROWSER_SESSION_IMPORT_V2: false,
        BROWSER_PROFILE_PERSIST_V1: false,
        ANTHROPIC_API_KEY: '',
        DASHSCOPE_API_KEY: '',
        DASHSCOPE_CN_API_KEY: '',
      });
      vi.stubEnv('HOLADAY_ENV', 'local-test');
      vi.stubEnv('USER_BROWSER_ROUTING_V2', 'false');
      vi.stubEnv('BROWSER_SESSION_VAULT_ENABLED', 'false');
      reloadFeatureFlagsForTest();
      vi.spyOn(messages, 'createQwenMessagesAdapter').mockImplementation(() => {
        modelCalls++;
        throw new Error('No model calls are authorized for Home UI acceptance');
      });
      const nativeFetch = globalThis.fetch;
      vi.stubGlobal(
        'fetch',
        (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
          const url = new URL(
            typeof input === 'string' || input instanceof URL ? String(input) : input.url,
          );
          if (url.hostname !== '127.0.0.1') {
            externalFetches.push(url.origin);
            throw new Error('External provider requests forbidden');
          }
          return nativeFetch(input, init);
        },
      );
      const saveState = () =>
        writeFile(join(out, 'site-state.json'), JSON.stringify({ ...state, requests }, null, 2));
      site = createServer((req, res) => {
        requests.push({ path: req.url ?? '/', method: req.method ?? 'GET' });
        if (req.url === '/observe' && req.method === 'POST') {
          let body = '';
          req.on('data', (part) => {
            body += part;
          });
          req.on('end', () => {
            const data = JSON.parse(body) as { clicks: number; text: string; bottomClicks: number };
            observedInputs.push(data);
            Object.assign(state, data, { observations: state.observations + 1 });
            void saveState().then(() => {
              res.writeHead(204);
              res.end();
            });
          });
          return;
        }
        const second = req.url === '/second';
        res.writeHead(200, {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-store',
        });
        res.end(
          [
            '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>HOLA 云浏览器本地验收</title>',
            '<style>body{font:24px system-ui;margin:24px;background:#fff;color:#17212e}input,button,a{font:inherit;padding:12px;margin:8px}input{width:380px}#bottom{margin-top:1000px}</style>',
            `<h1>${second ? '第二页' : '云浏览器手动操作验收'}</h1>`,
            '<p>仅本地合成内容，无真实账号、无模型请求。</p>',
            '<label>测试输入<input id="text" aria-label="测试输入" autocomplete="off"></label>',
            '<p id="echo">已输入：</p><button id="counter">点击计数：0</button>',
            `<a id="next" href="${second ? '/' : '/second'}">${second ? '返回首页' : '下一页'}</a>`,
            '<div id="bottom"><p>页面底部</p><button id="bottomButton">底部按钮</button></div>',
            '<script>let clicks=0,bottomClicks=0;const input=document.getElementById("text");',
            'function report(){fetch("/observe",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({clicks,text:input.value,bottomClicks})})}',
            'input.oninput=()=>{document.getElementById("echo").textContent="已输入："+input.value;report()};',
            'document.getElementById("counter").onclick=()=>{clicks++;document.getElementById("counter").textContent="点击计数："+clicks;report()};',
            'document.getElementById("bottomButton").onclick=()=>{bottomClicks++;document.getElementById("bottomButton").textContent="底部已点击："+bottomClicks;report()};',
            '</script></html>',
          ].join(''),
        );
      });
      const siteOrigin = await listen(site);
      vi.stubEnv('BROWSER_TEST_FIXTURE_ORIGINS', siteOrigin);
      pool = new BrowserPool(
        {
          maxInstances: 1,
          idleTimeoutMs: 15 * 60_000,
          baseDir: join(out, 'native-browser'),
          cdpPortStart: await freePort(),
          vncPortStart: 5900,
          wsPortStart: 6100,
          displayStart: 160,
          screenSize: '1280x800x24',
          vncEnabled: false,
        },
        logger,
      );
      const app = express();
      app.use(
        '/api',
        createHttpApp({
          planner: {} as never,
          ...(controlled ? { executionDrain: admission } : {}),
          browserPool: pool,
        }),
      );
      const token = await signAccessToken({ sub: owner, plan: 'pro' });
      app.get('/__qa_start', (_req, res) =>
        res
          .type('html')
          .send(
            `<!doctype html><meta charset="utf-8"><title>本地验收入口</title><p>只进入隔离合成账号，不使用真实登录。</p><button onclick=\'localStorage.setItem("holaday.access_token",${JSON.stringify(token)});location.href="/"\' >开始本地验收</button>`,
          ),
      );
      const uiRoot = resolve(process.env.HOLADAY_HOME_UI_WORKBENCH ?? '');
      expect(uiRoot.startsWith('/private/tmp/pr360-readiness/')).toBe(true);
      const manifestPath =
        '/private/tmp/pr360-readiness/candidate-a5ed894a-v1/workbench-files.json';
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Array<{
        path: string;
        sha256: string;
      }>;
      expect(manifest).toHaveLength(332);
      for (const file of manifest)
        expect(hash(await readFile(join(uiRoot, file.path))), file.path).toBe(file.sha256);
      app.use(express.static(uiRoot));
      app.get(/.*/, (_req, res) => res.sendFile('index.html', { root: uiRoot }));
      server = createServer(app);
      const proxy = createScreencastProxy({
        pool,
        logger,
        ...(controlled ? { executionDrain: admission } : {}),
        beforeViewportAction: authorizeHumanViewportInput,
      });
      server.on('upgrade', (req, socket, head) => {
        if (streamsDenied || !req.url?.startsWith('/screencast-ws/')) {
          socket.destroy();
          return;
        }
        sockets.add(socket);
        socket.once('close', () => sockets.delete(socket));
        proxy.handleUpgrade(req, socket, head);
      });
      const origin = await listen(server);
      await writeFile(
        join(out, 'ready.json'),
        JSON.stringify(
          {
            origin,
            startUrl: `${origin}/__qa_start`,
            siteOrigin,
            owner,
            admissionMode,
            deadline: new Date(Date.now() + 15 * 60_000).toISOString(),
            scope:
              'real HTTP/JWT/SQL/pool/stream; synthetic local site/account; no model/KMS/export',
          },
          null,
          2,
        ),
      );
      let lastControl = '';
      const deadline = Date.now() + 15 * 60_000;
      while (Date.now() < deadline) {
        const instance = pool.peek(browserHomeSessionId(owner));
        if (instance?.bravePid && nativePid !== instance.bravePid) {
          nativePid = instance.bravePid;
          await writeFile(join(out, 'native-pid.json'), JSON.stringify({ pid: nativePid }));
        }
        let command = '';
        try {
          command = await readFile(join(out, 'control.json'), 'utf8');
        } catch {}
        if (command && command !== lastControl) {
          lastControl = command;
          const action = (JSON.parse(command) as { action: string }).action;
          controls.push({ action, atUTC: new Date().toISOString(), pid: nativePid });
          await writeFile(join(out, 'control-receipts.json'), JSON.stringify(controls, null, 2));
          if (action === 'disconnect') {
            streamsDenied = true;
            for (const socket of sockets) socket.destroy();
          } else if (action === 'reconnect') streamsDenied = false;
          else if (action === 'finish') break;
          else throw new Error('Unknown local UI control action');
        }
        await wait(250);
      }
      expect(controls.at(-1)?.action, 'Operator did not finish before the bounded window').toBe(
        'finish',
      );
      expect(observedInputs.some((r) => r.clicks > 0)).toBe(true);
      expect(observedInputs.some((r) => r.text.length > 0)).toBe(true);
      expect(observedInputs.some((r) => r.bottomClicks > 0)).toBe(true);
      expect(requests.some((r) => r.path === '/second')).toBe(true);
      expect(controls.some((r) => r.action === 'disconnect')).toBe(true);
      expect(controls.some((r) => r.action === 'reconnect')).toBe(true);
      expect(modelCalls).toBe(0);
      expect(externalFetches).toEqual([]);
      const rows = await probe.db.execute(sql.raw('SELECT COUNT(*) AS n FROM tasks'));
      expect(Number((rows[0] as unknown as Array<{ n: number }>)[0]?.n)).toBe(0);
      expect(hash(await readFile(ledger))).toBe(ledgerBefore);
      await saveState();
      passed = true;
    } catch (error) {
      primaryError = error;
    } finally {
      for (const socket of sockets) socket.destroy();
      const cleanup = async (phase: string, action: () => Promise<unknown>) => {
        try {
          await action();
        } catch (error) {
          cleanupErrors.push({ phase, error: String(error) });
        }
      };
      await cleanup('http', () => close(server));
      await cleanup('nativePool', async () => pool?.shutdown());
      await cleanup('site', () => close(site));
      await cleanup('sql', async () => probe?.close());
      boundary.current = null;
      vi.restoreAllMocks();
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
      Object.assign(env, originalEnv);
      reloadFeatureFlagsForTest();
      await writeFile(
        join(out, 'receipt.json'),
        JSON.stringify(
          {
            passed: passed && cleanupErrors.length === 0,
            uiPassed: passed,
            admissionMode,
            cleanupErrors,
            primaryError: primaryError instanceof Error ? primaryError.message : primaryError,
            modelCalls,
            externalFetches,
            state,
            observedInputs,
            requests,
            controls,
            nativePid,
            ledgerUnchanged: hash(await readFile(ledger)) === ledgerBefore,
            sqlSchemaCleaned: !cleanupErrors.some((r) => r.phase === 'sql'),
            httpClosed: !cleanupErrors.some((r) => r.phase === 'http'),
            nativePoolClosed: !cleanupErrors.some((r) => r.phase === 'nativePool'),
            kmsCalls: 0,
            websiteExports: 0,
            oldTaskReplayed: false,
            productionChanged: false,
            realAccountAcceptance: false,
          },
          null,
          2,
        ),
      );
    }
    if (primaryError) throw primaryError;
    expect(cleanupErrors, 'Local fixture cleanup did not complete').toEqual([]);
  },
  16 * 60_000,
);
