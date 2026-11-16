/**
 * BROWSER-HOME-1 — browserHome router: the flag / allowlist gate, open / nav / close on a fake pool,
 * address-bar policy (file://, private networks, metadata, localhost refused with the policy's
 * Chinese message) and search words by the user's region.
 */
import { pino } from 'pino';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultBrowserNetworkPolicy } from '../../agent/browser-network-policy.js';
import { browserControlSessions } from '../../agent/supercar/browser-control-sessions.js';
import { browserHomeSessions } from '../../browser-home/browser-home-session.js';
import type { BrowserInstance } from '../../browser-pool/types.js';
import { env as appEnv } from '../../config/env.js';
import type { Context } from '../context.js';
import { browserHomeRouter } from './browser-home.js';

const original = {
  enabled: appEnv.BROWSER_HOME_ENABLED,
  allowlist: appEnv.BROWSER_HOME_ALLOWLIST,
  region: appEnv.MODEL_DATA_REGION_DEFAULT,
};

function fakePool(capabilities?: BrowserInstance['capabilities']) {
  const instances = new Map<string, BrowserInstance>();
  const gotos: string[] = [];
  /** Test hook: how the next goto behaves (sets the landed URL, may throw). */
  const loads: Array<(target: string) => { url: string; error?: Error }> = [];
  const pool = {
    allocate: vi.fn(async (taskId: string, userId: string) => {
      let url = 'about:blank';
      const page = {
        url: () => url,
        goto: async (target: string) => {
          gotos.push(target);
          const load = target === 'about:blank' ? undefined : loads.shift();
          const outcome = load ? load(target) : { url: target };
          url = outcome.url;
          if (outcome.error) throw outcome.error;
        },
        goBack: async () => null,
        goForward: async () => null,
        reload: async () => {},
      };
      const inst = {
        taskId,
        userId,
        status: 'ready',
        capabilities,
        lastActiveAt: Date.now(),
        createdAt: Date.now(),
        index: 0,
        executor: { getPage: async () => page },
      } as unknown as BrowserInstance;
      instances.set(taskId, inst);
      return inst;
    }),
    peek: (taskId: string) => instances.get(taskId) ?? null,
    release: vi.fn(async (taskId: string) => instances.delete(taskId)),
    touch: vi.fn(),
    setIdleTimeout: vi.fn(() => true),
    // Step 4 loans: task id → user (the instance lives under the task id meanwhile).
    loans: new Map<string, string>(),
    browserHomeHolder(userId: string) {
      for (const [taskId, owner] of pool.loans) if (owner === userId) return taskId;
      return null;
    },
    peekBrowserHome(userId: string) {
      return instances.get(pool.browserHomeHolder(userId) ?? `bhs_${userId}`) ?? null;
    },
    endBrowserHomeLoan(userId: string) {
      const holder = pool.browserHomeHolder(userId);
      if (holder) pool.loans.delete(holder);
      return holder;
    },
    /** Test helper: what BrowserPool.lendBrowserHome does to the keys. */
    lend(userId: string, taskId: string) {
      const inst = instances.get(`bhs_${userId}`)!;
      instances.delete(`bhs_${userId}`);
      inst.taskId = taskId;
      instances.set(taskId, inst);
      pool.loans.set(taskId, userId);
      return inst;
    },
  };
  return { pool, instances, gotos, loads };
}

function caller(
  userId: string,
  pool: ReturnType<typeof fakePool>['pool'] | null,
  modelDataRegion: 'cn' | 'intl' | null = null,
) {
  const query = {
    from: () => query,
    where: () => query,
    limit: async () => [{ modelDataRegion }],
  };
  return browserHomeRouter.createCaller({
    userId,
    db: { select: () => query },
    logger: pino({ level: 'silent' }),
    browserPool: pool,
  } as unknown as Context);
}

beforeEach(() => {
  appEnv.BROWSER_HOME_ENABLED = true;
  appEnv.BROWSER_HOME_ALLOWLIST = '';
});
afterEach(async () => {
  appEnv.BROWSER_HOME_ENABLED = original.enabled;
  appEnv.BROWSER_HOME_ALLOWLIST = original.allowlist;
  appEnv.MODEL_DATA_REGION_DEFAULT = original.region;
  vi.restoreAllMocks();
});

describe('browserHome router — gate', () => {
  it('flag off: every endpoint refuses and the pool is never touched', async () => {
    appEnv.BROWSER_HOME_ENABLED = false;
    const { pool } = fakePool();
    const c = caller('usr_gate_off', pool);
    await expect(c.open()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(c.nav({ direction: 'reload' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(c.close()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(pool.allocate).not.toHaveBeenCalled();
    expect(pool.release).not.toHaveBeenCalled();
  });

  it('allowlist: only listed users get in', async () => {
    appEnv.BROWSER_HOME_ALLOWLIST = 'usr_listed';
    const { pool } = fakePool();
    await expect(caller('usr_unlisted', pool).open()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(caller('usr_listed', pool).open()).resolves.toMatchObject({
      sessionId: 'bhs_usr_listed',
      url: null,
    });
    await caller('usr_listed', pool).close();
  });

  it('no pool: refuses plainly', async () => {
    await expect(caller('usr_nopool', null).open()).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
    });
  });
});

describe('browserHome router — open / close', () => {
  it('returns the owned instance capability snapshot before and during a task loan', async () => {
    const capabilities = Object.freeze({
      viewportV2: true,
      observationV2: false,
      replayV1: false,
      routingV2: false,
      collaborationV2: true as const,
    });
    const { pool } = fakePool(capabilities);
    const c = caller('usr_snapshot', pool);
    expect(await c.open()).toMatchObject({ capabilities });
    pool.lend('usr_snapshot', 'tsk_snapshot');
    expect(await c.open()).toMatchObject({ sessionId: 'bhs_usr_snapshot', capabilities });
    expect(pool.allocate).toHaveBeenCalledTimes(1);
    await c.close();
  });

  it('open creates once, then reuses; close releases', async () => {
    const { pool } = fakePool();
    const c = caller('usr_life', pool);
    expect(await c.open()).toMatchObject({ sessionId: 'bhs_usr_life', url: null });
    expect(await c.open()).toMatchObject({ sessionId: 'bhs_usr_life', url: null });
    expect(pool.allocate).toHaveBeenCalledTimes(1);
    expect(pool.allocate).toHaveBeenCalledWith('bhs_usr_life', 'usr_life', undefined, {
      targetUrl: null,
      sessionPolicy: 'anonymous',
    });
    expect(pool.setIdleTimeout).toHaveBeenCalledWith('bhs_usr_life', 15 * 60_000);
    expect(await c.close()).toEqual({ released: true });
    expect(pool.release).toHaveBeenCalledWith('bhs_usr_life', 'browser-home-close');
    expect(await c.close()).toEqual({ released: false });
  });

  it('a user can only reach their own session', async () => {
    const { pool } = fakePool();
    await caller('usr_owner', pool).open();
    // Another user's nav / close never reaches the owner's browser.
    expect(await caller('usr_intruder', pool).nav({ direction: 'reload' })).toEqual({
      ok: false,
      reason: 'no_session',
    });
    expect(await caller('usr_intruder', pool).close()).toEqual({ released: false });
    expect(pool.peek('bhs_usr_owner')).not.toBeNull();
    await caller('usr_owner', pool).close();
  });
});

describe('browserHome router — nav', () => {
  it('without an open session nothing happens', async () => {
    const { pool } = fakePool();
    expect(await caller('usr_none', pool).nav({ direction: 'goto', input: 'x.com' })).toEqual({
      ok: false,
      reason: 'no_session',
    });
  });

  it.each([
    ['file:///etc/passwd', 'bad_scheme', '只能访问 http 或 https 网页。'],
    [
      '10.0.0.1',
      'blocked_target',
      '为保护账户与服务器安全，不能访问本机、内网或云服务元数据地址。',
    ],
    [
      'http://169.254.169.254/latest/meta-data',
      'blocked_target',
      '为保护账户与服务器安全，不能访问本机、内网或云服务元数据地址。',
    ],
    [
      'localhost:3000',
      'blocked_target',
      '为保护账户与服务器安全，不能访问本机、内网或云服务元数据地址。',
    ],
    [
      'https://192.168.1.1/',
      'blocked_target',
      '为保护账户与服务器安全，不能访问本机、内网或云服务元数据地址。',
    ],
  ])('refuses %s with the policy message, page untouched', async (input, reason, message) => {
    const { pool, gotos } = fakePool();
    const c = caller('usr_policy', pool);
    await c.open();
    expect(await c.nav({ direction: 'goto', input })).toEqual({ ok: false, reason, message });
    expect(gotos).toEqual([]);
    await c.close();
  });

  it('goes to a public https address and remembers it', async () => {
    const { pool, gotos } = fakePool();
    const c = caller('usr_https', pool);
    await c.open();
    expect(await c.nav({ direction: 'goto', input: 'https://1.1.1.1/page' })).toEqual({
      ok: true,
      url: 'https://1.1.1.1/page',
    });
    expect(gotos).toEqual(['https://1.1.1.1/page']);
    expect(pool.touch).toHaveBeenCalledWith('bhs_usr_https');
    expect(browserHomeSessions.lastUrl('usr_https')).toBe('https://1.1.1.1/page');
    expect(await c.nav({ direction: 'reload' })).toEqual({ ok: true, url: 'https://1.1.1.1/page' });
    expect(await c.nav({ direction: 'back' })).toEqual({ ok: false, reason: 'no_history' });
    expect(await c.nav({ direction: 'goto', input: '  ' })).toEqual({
      ok: false,
      reason: 'missing_url',
    });
    await c.close();
  });

  it('search words go to Baidu (cn) or Google (intl), defaulting to the server region', async () => {
    // Search hosts need DNS; the policy itself is covered above.
    const check = defaultBrowserNetworkPolicy.check.bind(defaultBrowserNetworkPolicy);
    vi.spyOn(defaultBrowserNetworkPolicy, 'check').mockImplementation(async (url) =>
      /^https:\/\/www\.(google|baidu)\.com\//.test(url)
        ? { allowed: true, url, addresses: ['1.1.1.1'] }
        : check(url),
    );
    const { pool, gotos } = fakePool();

    await caller('usr_cn', pool, 'cn').open();
    await caller('usr_cn', pool, 'cn').nav({ direction: 'goto', input: '北京 天气' });
    await caller('usr_intl', pool, 'intl').open();
    await caller('usr_intl', pool, 'intl').nav({ direction: 'goto', input: 'tokyo weather' });
    appEnv.MODEL_DATA_REGION_DEFAULT = 'intl';
    await caller('usr_unset', pool, null).open();
    await caller('usr_unset', pool, null).nav({ direction: 'goto', input: 'hello' });

    expect(gotos).toEqual([
      `https://www.baidu.com/s?wd=${encodeURIComponent('北京 天气')}`,
      'https://www.google.com/search?q=tokyo%20weather',
      'https://www.google.com/search?q=hello',
    ]);
    for (const user of ['usr_cn', 'usr_intl', 'usr_unset']) await caller(user, pool).close();
  });
});

describe('browserHome router — while a task holds the browser (step 4)', () => {
  it('open returns the same browser, nav goes through the task’s control, close ends the session', async () => {
    const { pool, gotos } = fakePool();
    const c = caller('usr_lent', pool);
    await c.open();
    const inst = pool.lend('usr_lent', 'tsk_running');
    const run = browserControlSessions.start(inst);
    try {
      expect(await c.open()).toMatchObject({ sessionId: 'bhs_usr_lent', url: null });
      expect(pool.allocate).toHaveBeenCalledTimes(1);
      expect(await c.nav({ direction: 'goto', input: 'https://1.1.1.1/x' })).toEqual({
        ok: true,
        url: 'https://1.1.1.1/x',
      });
      expect(gotos).toEqual(['https://1.1.1.1/x']);
      expect(pool.touch).toHaveBeenCalledWith('tsk_running');
    } finally {
      run.finish();
    }
    expect(await c.close()).toEqual({ released: true });
    // The task keeps its browser; the session is over.
    expect(pool.release).not.toHaveBeenCalled();
    expect(pool.peek('tsk_running')).toBe(inst);
    expect(pool.browserHomeHolder('usr_lent')).toBeNull();
  });
});

describe('browserHome router — a page that does not load (P1-3)', () => {
  it.each([
    [
      'a TLS error',
      'net::ERR_CERT_AUTHORITY_INVALID at https://1.1.1.1/x',
      '该网站证书有问题，无法安全连接。请确认网址是否正确或换一个站点。',
    ],
    [
      'a refused proxy tunnel',
      'net::ERR_TUNNEL_CONNECTION_FAILED at https://1.1.1.1/x',
      '网页没有打开：这个地址不允许访问，或暂时无法连接。',
    ],
    [
      'a 15 s timeout',
      'page.goto: Timeout 15000ms exceeded.',
      '页面加载超时，可能网络不稳定或站点响应慢，请稍后重试。',
    ],
    ['anything else', 'net::ERR_FAILED', '网页没有打开，请检查网址或稍后重试。'],
  ])('%s: Chinese message, the browser is kept and still usable', async (_name, raw, message) => {
    const { pool, gotos, loads } = fakePool();
    const c = caller('usr_loadfail', pool);
    await c.open();
    const inst = pool.peek('bhs_usr_loadfail')!;
    loads.push(() => ({ url: 'chrome-error://chromewebdata/', error: new Error(raw) }));
    expect(await c.nav({ direction: 'goto', input: 'https://1.1.1.1/x' })).toEqual({
      ok: false,
      reason: 'load_failed',
      message,
    });
    // Kept: not released, not quarantined — the next address opens in the same browser.
    expect(pool.release).not.toHaveBeenCalled();
    expect(pool.peek('bhs_usr_loadfail')).toBe(inst);
    expect(browserControlSessions.openForViewer(inst)?.control.snapshot().error).toBeNull();
    expect(await c.nav({ direction: 'goto', input: 'https://1.1.1.1/y' })).toEqual({
      ok: true,
      url: 'https://1.1.1.1/y',
    });
    expect(gotos).toEqual(['https://1.1.1.1/x', 'https://1.1.1.1/y']);
    await c.close();
  });

  it('a redirect to a refused address never stays on screen: moved to a blank page', async () => {
    const { pool, gotos, loads } = fakePool();
    const c = caller('usr_redirect', pool);
    await c.open();
    const inst = pool.peek('bhs_usr_redirect')!;
    // The egress proxy answers the refused hop with its 403 page; the load itself "succeeds".
    loads.push(() => ({ url: 'http://169.254.169.254/latest/meta-data' }));
    expect(await c.nav({ direction: 'goto', input: 'https://1.1.1.1/r' })).toEqual({
      ok: false,
      reason: 'blocked_redirect',
      message: '这个网页跳转到了本机、内网或云服务元数据地址，为保护安全已停止打开。',
    });
    expect(gotos).toEqual(['https://1.1.1.1/r', 'about:blank']);
    expect((await inst.executor.getPage()).url()).toBe('about:blank');
    expect(browserHomeSessions.lastUrl('usr_redirect')).toBeNull();
    // Same when the refused hop made the load fail (https CONNECT refused).
    loads.push(() => ({
      url: 'https://10.0.0.5/',
      error: new Error('net::ERR_TUNNEL_CONNECTION_FAILED'),
    }));
    expect(await c.nav({ direction: 'goto', input: 'https://1.1.1.1/r2' })).toMatchObject({
      ok: false,
      reason: 'blocked_redirect',
    });
    expect((await inst.executor.getPage()).url()).toBe('about:blank');
    expect(pool.release).not.toHaveBeenCalled();
    expect(pool.peek('bhs_usr_redirect')).toBe(inst);
    await c.close();
  });
});

describe('browserHome router — pages leaving (P2-4)', () => {
  it('another open page keeps the browser; the last one leaving releases it after the grace', async () => {
    vi.useFakeTimers();
    try {
      const { pool } = fakePool();
      const c = caller('usr_tabs', pool);
      await c.open({ viewerId: 'page-a-0001' });
      await c.open({ viewerId: 'page-b-0001' });
      const inst = pool.peek('bhs_usr_tabs');
      expect(await c.close({ viewerId: 'page-a-0001' })).toEqual({ released: false });
      await vi.advanceTimersByTimeAsync(60_000);
      expect(pool.release).not.toHaveBeenCalled();
      expect(pool.peek('bhs_usr_tabs')).toBe(inst);

      // Leave and come back within a few seconds: the same browser.
      await c.close({ viewerId: 'page-b-0001' });
      await vi.advanceTimersByTimeAsync(2_000);
      await c.open({ viewerId: 'page-b-0002' });
      await vi.advanceTimersByTimeAsync(60_000);
      expect(pool.release).not.toHaveBeenCalled();
      expect(pool.allocate).toHaveBeenCalledTimes(1);
      expect(pool.peek('bhs_usr_tabs')).toBe(inst);

      // The last page leaves for good.
      await c.close({ viewerId: 'page-b-0002' });
      await vi.advanceTimersByTimeAsync(4_000);
      expect(pool.release).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1_500);
      expect(pool.release).toHaveBeenCalledWith('bhs_usr_tabs', 'browser-home-close');
      expect(pool.peek('bhs_usr_tabs')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('a remount whose open arrives before the old page’s close keeps the browser', async () => {
    vi.useFakeTimers();
    try {
      const { pool } = fakePool();
      const c = caller('usr_remount', pool);
      await c.open({ viewerId: 'mount-0000001' });
      await Promise.all([
        c.open({ viewerId: 'mount-0000002' }),
        c.close({ viewerId: 'mount-0000001' }),
      ]);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(pool.release).not.toHaveBeenCalled();
      expect(pool.peek('bhs_usr_remount')).not.toBeNull();
      await c.close();
    } finally {
      vi.useRealTimers();
    }
  });
});
