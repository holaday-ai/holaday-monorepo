import { describe, expect, it, vi } from 'vitest';
import { BUILTIN_MODEL_CATALOG } from '../llm/model-catalog.js';
import { createProductionModelRuntimeWiring } from '../llm/model-runtime-wiring.js';
import { createSelfCheckService, readSelfCheckFlags } from './self-check-service.js';
import {
  MIGRATION_MARKERS,
  type SelfCheckDeps,
  checkMedia,
  checkMigrations,
  checkModelLanes,
  classifyModelProbe,
  runSelfCheck,
  scrubMessage,
} from './self-check.js';

const INTL_KEY = 'sk-intl-secret-0123456789';
const FAL_KEY = 'fal-id:fal-secret-0123456789';
const FIRECRAWL_KEY = 'fc-secret-0123456789';

const ENV = {
  NODE_ENV: 'test' as const,
  MODEL_RUNTIME_POLICY: 'qwen_only' as const,
  QWEN_CORE_ROLLOUT_MODE: 'all' as const,
  QWEN_CORE_ENABLED_LANES: '',
  QWEN_CORE_ALLOWLIST: '',
  QWEN_MESSAGES_ADAPTER_ENABLED: true,
  QWEN_RESPONSES_ADAPTER_ENABLED: true,
  DASHSCOPE_API_KEY: '',
  DASHSCOPE_WORKSPACE_ID: '',
  DASHSCOPE_BASE_URL: 'https://dashscope-intl.aliyuncs.com',
  DASHSCOPE_INTL_API_KEY: INTL_KEY,
  DASHSCOPE_INTL_ANTHROPIC_BASE_URL: 'https://dashscope-intl.aliyuncs.com/apps/anthropic',
  DASHSCOPE_INTL_RESPONSES_BASE_URL: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
  DASHSCOPE_INTL_WORKSPACE_ID: '',
  DASHSCOPE_CN_API_KEY: '',
  DASHSCOPE_CN_ANTHROPIC_BASE_URL: 'https://dashscope.aliyuncs.com/apps/anthropic',
  DASHSCOPE_CN_RESPONSES_BASE_URL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  DASHSCOPE_CN_WORKSPACE_ID: '',
  QWEN_REASONING_MODEL: 'qwen3.8-max',
  QWEN_STANDARD_MODEL: 'qwen3.7-plus',
  QWEN_FAST_MODEL: 'qwen3.8-flash',
  QWEN_CODING_MODEL: 'qwen3-coder-plus',
  QWEN_VERIFIER_MODEL: 'qwen3.8-flash',
  QWEN_VERIFY_FAST_MODEL: 'qwen3.8-flash',
  QWEN_VERIFY_STRICT_MODEL: 'qwen3.8-max',
  QWEN_VISION_MODEL: 'qwen3.8-max',
  FAL_KEY,
  FIRECRAWL_API_KEY: FIRECRAWL_KEY,
  FIRECRAWL_BASE_URL: 'https://api.firecrawl.dev',
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function deps(
  fetchImpl: (url: string, init?: RequestInit) => Promise<Response>,
  overrides: Partial<SelfCheckDeps> = {},
): SelfCheckDeps {
  return {
    env: ENV as never,
    flags: { BROWSER_EXECUTOR: 'legacy' },
    fetchImpl: vi.fn(fetchImpl) as unknown as typeof fetch,
    now: Date.now,
    catalog: () => BUILTIN_MODEL_CATALOG,
    wiring: createProductionModelRuntimeWiring(ENV as never),
    region: 'intl',
    actorExternalId: 'usr_admin',
    mysqlQuery: async (sql) =>
      sql.includes('information_schema')
        ? MIGRATION_MARKERS.map((marker) => ({ t: marker.table, c: marker.column ?? 'id' }))
        : [{ ok: 1 }],
    redisPing: async () => 'PONG',
    launchChromium: async () => {},
    timeoutMs: 2_000,
    ...overrides,
  };
}

describe('classifyModelProbe', () => {
  it.each([
    [
      { kind: 'http', status: 403, code: 'AccessDenied', message: 'free tier exhausted' },
      'fail',
      /免费额度/,
    ],
    [{ kind: 'http', status: 403, code: 'AllocationQuota.FreeTierOnly' }, 'fail', /免费额度/],
    [{ kind: 'http', status: 400, code: 'Arrearage' }, 'fail', /欠费/],
    [{ kind: 'http', status: 401, code: 'InvalidApiKey' }, 'fail', /API Key 无效/],
    [{ kind: 'http', status: 404, code: 'ModelNotFound' }, 'fail', /模型未开通/],
    [{ kind: 'http', status: 400, message: 'Model not activated' }, 'fail', /模型未开通/],
    [{ kind: 'http', status: 429, code: 'Throttling.RateQuota' }, 'warn', /限流/],
    [{ kind: 'http', status: 403, code: 'AccessDenied' }, 'fail', /无权访问/],
    [{ kind: 'http', status: 503 }, 'warn', /暂时异常/],
    [{ kind: 'timeout' }, 'warn', /网络超时/],
    [{ kind: 'network' }, 'fail', /无法连接/],
    [{ kind: 'http', status: 200 }, 'ok', /可用/],
  ] as const)('%j → %s', (probe, status, reason) => {
    const verdict = classifyModelProbe({ latencyMs: 1, ...probe } as never);
    expect(verdict.status).toBe(status);
    expect(verdict.reason).toMatch(reason);
    if (status !== 'ok') expect(verdict.advice).toBeTruthy();
  });

  it('scrubs key-shaped strings from provider messages', () => {
    expect(scrubMessage(`bad key ${INTL_KEY} Bearer abcdefghijkl`, [INTL_KEY])).not.toMatch(
      /secret|abcdefghijkl/,
    );
  });
});

describe('checkModelLanes', () => {
  it('probes each distinct model once, maps FreeTierOnly, and never returns the key', async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { model: string; max_tokens: number };
      expect(body.max_tokens).toBeLessThanOrEqual(8);
      return body.model === 'qwen3.8-max'
        ? json(403, {
            type: 'error',
            error: {
              type: 'AllocationQuota.FreeTierOnly',
              message: `The free tier of the model has been exhausted (key ${INTL_KEY})`,
            },
          })
        : json(200, { content: [{ type: 'text', text: 'pong' }] });
    });
    const d = deps(fetchImpl);
    const { items } = await checkModelLanes(d);
    expect(items.map((entry) => entry.id)).toEqual([
      'model.browser',
      'model.generate',
      'model.scrape',
      'model.plan',
      'model.suggestions',
      'model.verifier',
      'model.vision',
    ]);
    const models = new Set(
      fetchImpl.mock.calls.map(([, init]) => JSON.parse(String(init?.body)).model),
    );
    expect(fetchImpl).toHaveBeenCalledTimes(models.size);
    const failed = items.filter((entry) => entry.status === 'fail');
    expect(failed.length).toBeGreaterThan(0);
    expect(failed[0]).toMatchObject({ httpStatus: 403, errorCode: 'AllocationQuota.FreeTierOnly' });
    expect(failed[0]?.reason).toMatch(/免费额度/);
    expect(JSON.stringify(items)).not.toContain(INTL_KEY);
  });

  it('reports lanes the rollout keeps closed without calling the model', async () => {
    const fetchImpl = vi.fn(async () => json(200, {}));
    const d = deps(fetchImpl, {
      wiring: createProductionModelRuntimeWiring({
        ...ENV,
        QWEN_CORE_ROLLOUT_MODE: 'off',
      } as never),
    });
    const { items } = await checkModelLanes(d);
    expect(items.find((entry) => entry.id === 'model.generate')).toMatchObject({
      status: 'warn',
    });
    // Only the vision lane (outside the core rollout) still probes.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('classifies a hung provider as a network timeout', async () => {
    const d = deps(
      (_url, init) =>
        new Promise((_resolve, reject) =>
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))),
        ),
      { timeoutMs: 20 },
    );
    const { items } = await checkModelLanes(d);
    expect(items[0]).toMatchObject({ status: 'warn', reason: expect.stringMatching(/超时/) });
  });
});

describe('checkMedia', () => {
  it('only authenticates: no generation endpoint is called and no key is echoed', async () => {
    const urls: string[] = [];
    const d = deps(async (url) => {
      urls.push(url);
      if (url.includes('/api/v1/tasks/')) return json(200, { output: { task_status: 'UNKNOWN' } });
      if (url.includes('queue.fal.run')) return json(404, { detail: 'not found' });
      if (url.includes('firecrawl')) return json(402, { error: 'Payment required' });
      return new Response(null, { status: 200 });
    });
    const items = await checkMedia(d);
    expect(
      urls.some((url) => /text2image|video-synthesis|image-generation|\/fal-ai\/[^/]+$/.test(url)),
    ).toBe(false);
    expect(items.find((entry) => entry.id === 'media.dashscope')?.status).toBe('ok');
    expect(items.find((entry) => entry.id === 'media.fal')?.status).toBe('ok');
    expect(items.find((entry) => entry.id === 'search.firecrawl')).toMatchObject({
      status: 'fail',
      reason: expect.stringMatching(/额度/),
    });
    const serialized = JSON.stringify(items);
    for (const secret of [INTL_KEY, FAL_KEY, FIRECRAWL_KEY])
      expect(serialized).not.toContain(secret);
  });

  it('flags a rejected fal key and missing optional providers', async () => {
    const d = deps(async (url) =>
      url.includes('queue.fal.run') ? json(401, {}) : new Response(null, { status: 200 }),
    );
    const items = await checkMedia(d);
    expect(items.find((entry) => entry.id === 'media.fal')?.status).toBe('fail');

    const none = await checkMedia(
      deps(async () => json(200, {}), {
        env: { ...ENV, FAL_KEY: '', FIRECRAWL_API_KEY: '' } as never,
      }),
    );
    expect(none.find((entry) => entry.id === 'media.fal')?.status).toBe('warn');
    expect(none.find((entry) => entry.id === 'search.firecrawl')?.status).toBe('warn');
  });
});

describe('checkMigrations', () => {
  it('names each missing migration', async () => {
    const items = await checkMigrations(
      deps(async () => json(200, {}), {
        mysqlQuery: async () => [
          { t: 'tasks', c: 'execution_id' },
          { t: 'model_catalog', c: 'id' },
        ],
      }),
    );
    expect(items.filter((entry) => entry.status === 'ok').map((entry) => entry.id)).toEqual([
      'migration.0059_core_execution_identity',
      'migration.0061_model_catalog',
    ]);
    expect(items.find((entry) => entry.id.includes('0064'))?.reason).toMatch(
      /model_catalog_settings/,
    );
  });
});

describe('runSelfCheck + service', () => {
  it('summarises every group and reports infrastructure failures', async () => {
    const report = await runSelfCheck(
      deps(async () => json(200, {}), {
        redisPing: async () => {
          throw new Error('ECONNREFUSED');
        },
        skip: { models: true, media: true },
      }),
    );
    expect(report.items.find((entry) => entry.id === 'infra.redis')?.status).toBe('fail');
    expect(report.items.find((entry) => entry.id === 'flag.BROWSER_EXECUTOR')?.reason).toBe(
      '当前值：legacy',
    );
    expect(report.summary.fail).toBe(1);
  });

  it('caches for 5 minutes, shares one in-flight run, and audits without secrets', async () => {
    let time = 0;
    const info = vi.fn();
    const run = vi.fn(async () => ({
      startedAt: '',
      finishedAt: '',
      brainId: 'qwen',
      region: 'intl' as const,
      items: [
        {
          id: 'model.generate',
          group: 'model' as const,
          label: 'x',
          status: 'fail' as const,
          reason: 'r',
        },
      ],
      summary: { ok: 0, warn: 0, fail: 1 },
    }));
    const service = createSelfCheckService({ logger: { info }, now: () => time, run });
    const d = deps(async () => json(200, {}));
    const [a, b] = await Promise.all([
      service.check({ deps: d, actorExternalId: 'usr_admin', source: 'admin' }),
      service.check({ deps: d, actorExternalId: 'usr_admin', source: 'admin' }),
    ]);
    expect(run).toHaveBeenCalledTimes(1);
    expect(a.cached || b.cached).toBe(false);
    time = 4 * 60_000;
    expect((await service.check({ deps: d, actorExternalId: 'u', source: 'admin' })).cached).toBe(
      true,
    );
    expect(service.latest('intl')?.cached).toBe(true);
    time = 6 * 60_000;
    expect(service.latest('intl')).toBeNull();
    await service.check({ deps: d, actorExternalId: 'u', source: 'admin' });
    await service.check({ deps: d, actorExternalId: 'u', source: 'admin', force: true });
    expect(run).toHaveBeenCalledTimes(3);
    const audit = info.mock.calls.find(([entry]) => entry.failed)?.[0];
    expect(audit).toMatchObject({ event: 'admin.self_check', failed: ['model.generate'] });
    expect(JSON.stringify(info.mock.calls)).not.toContain(INTL_KEY);
  });

  it('reads only allowlisted switches', () => {
    const flags = readSelfCheckFlags({ BROWSER_EXECUTOR: 'unified', DASHSCOPE_API_KEY: INTL_KEY });
    expect(flags.BROWSER_EXECUTOR).toBe('unified');
    expect(JSON.stringify(flags)).not.toContain(INTL_KEY);
  });
});
