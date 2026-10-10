import { type BrainEntry, brainLaneModel, selectDefaultBrain } from '../llm/model-catalog.js';
import type { CoreModelLane } from '../llm/model-runtime-policy.js';
import {
  MODEL_TASK_FAILURE_COPY,
  type ModelTaskUnavailableReason,
  type ProductionModelRuntimeWiring,
} from '../llm/model-runtime-wiring.js';
import {
  type QwenPurpose,
  QwenRouteError,
  type QwenRuntimeEnvironment,
  resolveQwenRoute,
} from '../llm/qwen-route.js';

/**
 * Batch 10.1 — 能力自检. One click (or `scripts/self-check.ts`) probes every
 * model lane of the current brain with a 1-token call, media/search
 * credentials without generating anything, the infrastructure, the feature
 * switches and migrations 0059–0065. Each item is ✅/⚠️/❌ with one line of
 * Chinese reason + advice. Keys never appear in items, logs or responses.
 */

export type CheckStatus = 'ok' | 'warn' | 'fail';
export type CheckGroup = 'model' | 'media' | 'infra' | 'flags' | 'migrations';

export interface SelfCheckItem {
  id: string;
  group: CheckGroup;
  label: string;
  status: CheckStatus;
  reason: string;
  advice?: string;
  httpStatus?: number;
  errorCode?: string;
  latencyMs?: number;
}

export interface SelfCheckReport {
  startedAt: string;
  finishedAt: string;
  brainId: string;
  region: 'cn' | 'intl';
  items: SelfCheckItem[];
  summary: Record<CheckStatus, number>;
}

export const SELF_CHECK_LANES = [
  'browser',
  'generate',
  'scrape',
  'plan',
  'suggestions',
  'verifier',
  'vision',
] as const;
export type SelfCheckLane = (typeof SELF_CHECK_LANES)[number];

const LANE_LABEL: Record<SelfCheckLane, string> = {
  browser: '浏览器决策',
  generate: '生成',
  scrape: '搜索抓取',
  plan: '规划',
  suggestions: '下一步建议',
  verifier: '核验',
  vision: '视觉',
};

export interface SelfCheckEnv extends QwenRuntimeEnvironment {
  DASHSCOPE_BASE_URL: string;
  FAL_KEY: string;
  FAL_BASE_URL?: string;
  FIRECRAWL_API_KEY: string;
  FIRECRAWL_BASE_URL: string;
}

export interface SelfCheckDeps {
  env: SelfCheckEnv;
  /** Feature switches to display, name → raw env value (already allowlisted). */
  flags: Readonly<Record<string, string | undefined>>;
  fetchImpl: typeof fetch;
  now: () => number;
  catalog: () => readonly BrainEntry[];
  wiring: ProductionModelRuntimeWiring;
  region: 'cn' | 'intl';
  actorExternalId: string;
  mysqlQuery: (sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
  redisPing: () => Promise<string>;
  launchChromium: () => Promise<void>;
  skip?: { models?: boolean; media?: boolean };
  timeoutMs?: number;
}

// ---------------------------------------------------------------------------
// Error classification
// ---------------------------------------------------------------------------

export type ProbeResult =
  | { kind: 'http'; status: number; code?: string; message?: string; latencyMs: number }
  | { kind: 'timeout'; latencyMs: number }
  | { kind: 'network'; latencyMs: number };

type Verdict = Pick<SelfCheckItem, 'status' | 'reason' | 'advice'>;

/** Maps a provider answer to ✅/⚠️/❌ with Chinese copy. Pure; unit tested. */
export function classifyModelProbe(probe: ProbeResult): Verdict {
  if (probe.kind === 'timeout')
    return {
      status: 'warn',
      reason: '网络超时，没有在规定时间内收到模型服务的响应',
      advice: '检查服务器到百炼对应区域（新加坡 / 北京）的出网连通性，稍后再试',
    };
  if (probe.kind === 'network')
    return {
      status: 'fail',
      reason: '无法连接模型服务（连接被拒绝、DNS 或 TLS 失败）',
      advice: '检查服务器的网络、DNS 和代理设置，以及接入地址是否正确',
    };
  const text = `${probe.code ?? ''} ${probe.message ?? ''}`;
  if (probe.status >= 200 && probe.status < 300) return { status: 'ok', reason: '可用' };
  if (/FreeTier|free tier|free quota/i.test(text))
    return {
      status: 'fail',
      reason: '免费额度已用完，账号处于"仅使用免费额度"模式（403 FreeTierOnly）',
      advice: '在百炼控制台完成实名 / 手机验证，并关闭"仅使用免费额度"后开通付费调用',
    };
  if (/Arrearage|overdue|欠费|insufficient.?balance/i.test(text))
    return {
      status: 'fail',
      reason: '账号欠费，模型调用被停用',
      advice: '到阿里云费用中心充值，结清欠费后几分钟内自动恢复',
    };
  if (probe.status === 401 || /InvalidApiKey|invalid.?api.?key|Unauthorized/i.test(text))
    return {
      status: 'fail',
      reason: 'API Key 无效或已被删除（401）',
      advice: '在百炼控制台重新生成 API Key，并更新服务器环境变量',
    };
  if (
    probe.status === 404 ||
    /ModelNotFound|model.?not.?found|does not exist|not.?activated|ModelNotOpen|Model\.AccessDenied/i.test(
      text,
    )
  )
    return {
      status: 'fail',
      reason: '模型未开通，或模型名称在该区域不存在',
      advice: '在百炼控制台开通该模型，或在"模型管理"里把这个通道换成已开通的模型',
    };
  if (probe.status === 429 || /Throttling|RateQuota|rate.?limit/i.test(text))
    return {
      status: 'warn',
      reason: '被限流（429），当前请求过多',
      advice: '稍后重试；长期出现时在百炼控制台提高该模型的限流额度（QPM/TPM）',
    };
  if (probe.status === 403)
    return {
      status: 'fail',
      reason: '无权访问（403）',
      advice: '检查业务空间（workspace）和子账号权限，确认该模型已授权给这个 API Key',
    };
  if (probe.status >= 500)
    return {
      status: 'warn',
      reason: `模型服务暂时异常（${probe.status}）`,
      advice: '一般是服务端临时故障，稍后重试；持续出现请查看阿里云服务状态',
    };
  return {
    status: 'warn',
    reason: `请求被拒绝（${probe.status}）`,
    advice: '查看错误码；如果是参数问题，请联系开发检查该通道的模型配置',
  };
}

const SECRET_RE = /(sk-[A-Za-z0-9_-]{8,}|Bearer\s+\S+|Key\s+[A-Za-z0-9:_-]{8,})/g;

/** Provider messages may echo request details: strip anything key-shaped and cap the length. */
export function scrubMessage(message: string | undefined, secrets: readonly string[]): string {
  if (!message) return '';
  let out = message;
  for (const secret of secrets)
    if (secret && secret.length >= 6) out = out.split(secret).join('***');
  return out.replace(SECRET_RE, '***').slice(0, 160);
}

async function timedFetch(
  deps: SelfCheckDeps,
  url: string,
  init: RequestInit,
  secrets: readonly string[],
): Promise<ProbeResult> {
  const started = deps.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? 15_000);
  try {
    const res = await deps.fetchImpl(url, {
      ...init,
      signal: controller.signal,
      redirect: 'manual',
    });
    let code: string | undefined;
    let message: string | undefined;
    if (res.status >= 300) {
      const body = await res.text().catch(() => '');
      try {
        const json = JSON.parse(body) as Record<string, unknown>;
        const error = (json.error ?? {}) as Record<string, unknown>;
        const rawCode = error.code ?? json.code ?? error.type;
        code = typeof rawCode === 'string' ? rawCode.slice(0, 80) : undefined;
        const rawMessage = error.message ?? json.message;
        message = typeof rawMessage === 'string' ? rawMessage : undefined;
      } catch {
        message = body;
      }
    } else {
      await res.body?.cancel().catch(() => {});
    }
    return {
      kind: 'http',
      status: res.status,
      ...(code ? { code } : {}),
      ...(message ? { message: scrubMessage(message, secrets) } : {}),
      latencyMs: deps.now() - started,
    };
  } catch {
    return controller.signal.aborted
      ? { kind: 'timeout', latencyMs: deps.now() - started }
      : { kind: 'network', latencyMs: deps.now() - started };
  } finally {
    clearTimeout(timer);
  }
}

function item(
  base: Pick<SelfCheckItem, 'id' | 'group' | 'label'>,
  verdict: Verdict,
  probe?: ProbeResult,
): SelfCheckItem {
  return {
    ...base,
    ...verdict,
    ...(probe?.kind === 'http' ? { httpStatus: probe.status } : {}),
    ...(probe?.kind === 'http' && probe.code ? { errorCode: probe.code } : {}),
    ...(probe ? { latencyMs: probe.latencyMs } : {}),
  };
}

// ---------------------------------------------------------------------------
// Model lanes
// ---------------------------------------------------------------------------

const UNAVAILABLE_STATUS: Record<ModelTaskUnavailableReason, CheckStatus> = {
  MODEL_DATA_REGION_UNASSIGNED: 'fail',
  REGION_SERVICE_NOT_CONFIGURED: 'fail',
  MODEL_MIGRATION_IN_PROGRESS: 'warn',
  MODEL_ROLLOUT_NOT_ALLOWED: 'warn',
  MODEL_PROVIDER_NOT_CONFIGURED: 'fail',
};

export async function checkModelLanes(deps: SelfCheckDeps): Promise<{
  brain: BrainEntry;
  items: SelfCheckItem[];
}> {
  const brain = selectDefaultBrain(deps.catalog());
  const items: SelfCheckItem[] = [];
  // Lanes that share a model share one probe: at most one paid token per model.
  const probes = new Map<string, Promise<ProbeResult>>();

  for (const lane of SELF_CHECK_LANES) {
    const base = {
      id: `model.${lane}`,
      group: 'model' as const,
      label: `${LANE_LABEL[lane]}通道（${brain.label}）`,
    };
    if (lane !== 'vision') {
      const runtime = deps.wiring.resolveCore({
        actorExternalId: deps.actorExternalId,
        lane: lane as CoreModelLane,
        ownership: { scope: 'personal', userRegion: deps.region },
        brain,
      });
      if (runtime.kind === 'unavailable') {
        items.push(
          item(base, {
            status: UNAVAILABLE_STATUS[runtime.reasonCode],
            reason: `${MODEL_TASK_FAILURE_COPY[runtime.reasonCode]}（${runtime.reasonCode}）`,
            advice: '检查 QWEN_CORE_ROLLOUT_MODE / QWEN_CORE_ENABLED_LANES 和对应区域的密钥配置',
          }),
        );
        continue;
      }
      if (brain.provider !== 'alibaba-model-studio') {
        items.push(await probeExternal(deps, base, runtime.messages('fast')));
        continue;
      }
    } else if (brain.provider !== 'alibaba-model-studio') {
      items.push(
        item(base, { status: 'ok', reason: '视觉由当前大脑的模型处理，已随生成通道检查' }),
      );
      continue;
    }

    const purpose: QwenPurpose = lane === 'vision' || lane === 'browser' ? 'vision' : 'standard';
    let route: ReturnType<typeof resolveQwenRoute>;
    try {
      route = resolveQwenRoute(deps.env, deps.region, purpose, 'messages');
    } catch (error) {
      items.push(
        item(base, {
          status: 'fail',
          reason:
            error instanceof QwenRouteError && error.code === 'MISSING_REGION_CREDENTIALS'
              ? `${deps.region === 'cn' ? '国内' : '国际'}区域没有配置百炼 API Key`
              : '百炼接入配置无效',
          advice: '检查 DASHSCOPE_*_API_KEY 和接入地址',
        }),
      );
      continue;
    }
    // Same precedence as the runtime: the catalog's lane model, else the env route default.
    const laneModel = brainLaneModel(brain, lane) ?? route.model;
    const key = `${route.baseURL}|${laneModel}`;
    if (!probes.has(key)) {
      probes.set(
        key,
        timedFetch(
          deps,
          `${route.baseURL}/v1/messages`,
          {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'anthropic-version': '2023-06-01',
              'x-api-key': route.apiKey,
              ...(route.workspaceId ? { 'x-dashscope-workspace': route.workspaceId } : {}),
            },
            body: JSON.stringify({
              model: laneModel,
              max_tokens: 8,
              thinking: { type: 'disabled' },
              messages: [{ role: 'user', content: 'ping' }],
            }),
          },
          [route.apiKey],
        ),
      );
    }
    const probe = await (probes.get(key) as Promise<ProbeResult>);
    const verdict = classifyModelProbe(probe);
    items.push(
      item(
        { ...base, label: `${base.label} · ${laneModel}` },
        verdict.status === 'ok'
          ? { status: 'ok', reason: `可用（${probe.latencyMs} ms）` }
          : {
              ...verdict,
              reason:
                probe.kind === 'http' && probe.message
                  ? `${verdict.reason}；服务端说明：${probe.message}`
                  : verdict.reason,
            },
        probe,
      ),
    );
  }
  return { brain, items };
}

async function probeExternal(
  deps: SelfCheckDeps,
  base: Pick<SelfCheckItem, 'id' | 'group' | 'label'>,
  adapter: { create: (request: never, options?: never) => Promise<unknown> },
): Promise<SelfCheckItem> {
  const started = deps.now();
  try {
    await adapter.create(
      { maxTokens: 8, messages: [{ role: 'user', content: 'ping' }] } as never,
      { timeoutMs: deps.timeoutMs ?? 15_000 } as never,
    );
    return item(base, { status: 'ok', reason: `可用（${deps.now() - started} ms）` });
  } catch (error) {
    const code = (error as { code?: string }).code;
    return item(base, {
      status: code === 'REQUEST_TIMEOUT' ? 'warn' : 'fail',
      reason: code === 'REQUEST_TIMEOUT' ? '网络超时' : `调用失败（${code ?? 'UNKNOWN'}）`,
      advice: '检查该供应商的 API Key、余额和网络连通性',
    });
  }
}

// ---------------------------------------------------------------------------
// Media + search (credentials and reachability only — never generates)
// ---------------------------------------------------------------------------

export async function checkMedia(deps: SelfCheckDeps): Promise<SelfCheckItem[]> {
  const items: SelfCheckItem[] = [];
  const dashKey = deps.env.DASHSCOPE_API_KEY || deps.env.DASHSCOPE_INTL_API_KEY;
  const dashBase = { id: 'media.dashscope', group: 'media' as const, label: '百炼图片 / 视频' };
  if (!dashKey) {
    items.push(
      item(dashBase, {
        status: 'fail',
        reason: '没有配置百炼 API Key，图片和视频生成不可用',
        advice: '配置 DASHSCOPE_API_KEY 或 DASHSCOPE_INTL_API_KEY',
      }),
    );
  } else {
    // Querying a task id that does not exist only authenticates; nothing is generated.
    const base = (deps.env.DASHSCOPE_BASE_URL || 'https://dashscope-intl.aliyuncs.com').replace(
      /\/+$/,
      '',
    );
    const probe = await timedFetch(
      deps,
      `${base}/api/v1/tasks/00000000-0000-0000-0000-000000000000`,
      { method: 'GET', headers: { authorization: `Bearer ${dashKey}` } },
      [dashKey],
    );
    const accepted =
      probe.kind === 'http' && (probe.status < 300 || probe.status === 400 || probe.status === 404);
    items.push(
      item(
        dashBase,
        accepted
          ? { status: 'ok', reason: `凭证有效，服务可连通（${probe.latencyMs} ms）` }
          : classifyModelProbe(probe),
        probe,
      ),
    );
  }

  const falBase = { id: 'media.fal', group: 'media' as const, label: 'fal（Nano Banana / Veo）' };
  if (!deps.env.FAL_KEY) {
    items.push(
      item(falBase, {
        status: 'warn',
        reason: '没有配置 FAL_KEY，Nano Banana 2 和 Veo 不可用（其他媒体不受影响）',
      }),
    );
  } else {
    const queue = (deps.env.FAL_BASE_URL || 'https://queue.fal.run').replace(/\/+$/, '');
    const probe = await timedFetch(
      deps,
      `${queue}/fal-ai/nano-banana/requests/00000000-0000-0000-0000-000000000000/status`,
      { method: 'GET', headers: { authorization: `Key ${deps.env.FAL_KEY}` } },
      [deps.env.FAL_KEY],
    );
    if (probe.kind === 'http' && (probe.status === 401 || probe.status === 403)) {
      items.push(
        item(
          falBase,
          {
            status: 'fail',
            reason: `fal 凭证被拒绝（${probe.status}）`,
            advice: '在 fal 控制台检查 Key 是否有效、余额是否充足',
          },
          probe,
        ),
      );
    } else if (probe.kind !== 'http') {
      items.push(item(falBase, classifyModelProbe(probe), probe));
    } else {
      items.push(
        item(
          falBase,
          { status: 'ok', reason: `凭证已被接受，队列服务可连通（${probe.latencyMs} ms）` },
          probe,
        ),
      );
    }
    // Generated files are served from the fal CDN; it has been unreachable before.
    const cdn = await timedFetch(deps, 'https://v3.fal.media/', { method: 'HEAD' }, []);
    items.push(
      item(
        { id: 'media.fal_cdn', group: 'media', label: 'fal 文件下载（CDN）' },
        cdn.kind === 'http'
          ? { status: 'ok', reason: `可连通（${cdn.latencyMs} ms）` }
          : {
              status: 'warn',
              reason: 'fal CDN 不可达，生成的图片或视频可能下载失败',
              advice: '检查服务器到 v3.fal.media 的出网连通性',
            },
        cdn,
      ),
    );
  }

  const fcBase = { id: 'search.firecrawl', group: 'media' as const, label: 'Firecrawl 搜索抓取' };
  if (!deps.env.FIRECRAWL_API_KEY) {
    items.push(
      item(fcBase, {
        status: 'warn',
        reason: '没有配置 FIRECRAWL_API_KEY，联网搜索失败时无法降级，抓取模式不可用',
      }),
    );
  } else {
    const base = deps.env.FIRECRAWL_BASE_URL.replace(/\/+$/, '');
    const probe = await timedFetch(
      deps,
      `${base}/v1/team/credit-usage`,
      { method: 'GET', headers: { authorization: `Bearer ${deps.env.FIRECRAWL_API_KEY}` } },
      [deps.env.FIRECRAWL_API_KEY],
    );
    items.push(
      item(
        fcBase,
        probe.kind === 'http' && probe.status < 300
          ? { status: 'ok', reason: `凭证有效（${probe.latencyMs} ms）` }
          : probe.kind === 'http' && probe.status === 402
            ? {
                status: 'fail',
                reason: 'Firecrawl 额度已用完（402）',
                advice: '在 Firecrawl 控制台充值或升级套餐',
              }
            : classifyModelProbe(probe),
        probe,
      ),
    );
  }
  return items;
}

// ---------------------------------------------------------------------------
// Infrastructure, switches, migrations
// ---------------------------------------------------------------------------

async function timed<T>(
  deps: SelfCheckDeps,
  fn: () => Promise<T>,
): Promise<{ ok: true; value: T; ms: number } | { ok: false; ms: number; timedOut: boolean }> {
  const started = deps.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const value = await Promise.race([
      fn(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('self-check timeout')), deps.timeoutMs ?? 20_000);
      }),
    ]);
    return { ok: true, value, ms: deps.now() - started };
  } catch (error) {
    return {
      ok: false,
      ms: deps.now() - started,
      timedOut: error instanceof Error && error.message === 'self-check timeout',
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Same-host stock adapter liveness. Root PM2 online is checked by the deployment gate. */
export async function checkAkshare(deps: SelfCheckDeps): Promise<SelfCheckItem> {
  let available = false;
  try {
    const response = await deps.fetchImpl('http://127.0.0.1:8848/health', {
      redirect: 'error', signal: AbortSignal.timeout(deps.timeoutMs ?? 5_000),
    });
    if (response.status === 200) {
      const body = await response.json() as { status?: unknown; adapter_ready?: unknown };
      available = body?.status === 'ok' && body?.adapter_ready === true;
    }
  } catch { /* Never expose adapter errors or environment values. */ }
  return item({ id: 'infra.akshare', group: 'infra', label: '股票数据服务（AkShare）' },
    available ? { status: 'ok', reason: 'loopback 8848 健康，适配器就绪' }
      : { status: 'fail', reason: 'loopback 8848 不可用或适配器未就绪',
          advice: '由运维核对 akshare-mcp-http 原配置与状态；不要自动重启其他服务' });
}

export async function checkInfrastructure(deps: SelfCheckDeps): Promise<SelfCheckItem[]> {
  const [mysql, redis, chromium, akshare] = await Promise.all([
    timed(deps, () => deps.mysqlQuery('SELECT 1 AS ok')),
    timed(deps, () => deps.redisPing()),
    timed(deps, () => deps.launchChromium()),
    checkAkshare(deps),
  ]);
  return [
    akshare,
    item(
      { id: 'infra.mysql', group: 'infra', label: 'MySQL 数据库' },
      mysql.ok
        ? { status: 'ok', reason: `可连接（${mysql.ms} ms）` }
        : {
            status: 'fail',
            reason: mysql.timedOut ? '连接超时' : '无法连接或查询失败',
            advice: '检查 DATABASE_URL、数据库进程和连接数',
          },
    ),
    item(
      { id: 'infra.redis', group: 'infra', label: 'Redis' },
      redis.ok && redis.value === 'PONG'
        ? { status: 'ok', reason: `可连接（${redis.ms} ms）` }
        : {
            status: 'fail',
            reason: redis.ok ? 'PING 返回异常' : redis.timedOut ? '连接超时' : '无法连接',
            advice: '检查 REDIS_URL 和 Redis 进程；队列和定时任务依赖它',
          },
    ),
    item(
      { id: 'infra.chromium', group: 'infra', label: '浏览器池（Chromium）' },
      chromium.ok
        ? { status: 'ok', reason: `可以启动（${chromium.ms} ms）` }
        : {
            status: 'fail',
            reason: chromium.timedOut ? 'Chromium 启动超时' : 'Chromium 无法启动',
            advice:
              '在服务器上执行 npx playwright install chromium，并安装系统依赖（install-deps）',
          },
    ),
  ];
}

/** name → { expected value when on, label }. Values only — never secrets. */
const SAFE_FLAG_VALUE = /^[A-Za-z0-9_,.\-:]{0,64}$/;

export function checkFlags(flags: SelfCheckDeps['flags']): SelfCheckItem[] {
  return Object.entries(flags).map(([name, value]) =>
    item(
      { id: `flag.${name}`, group: 'flags', label: name },
      {
        status: 'ok',
        reason:
          value === undefined || value === ''
            ? '未设置（使用默认值）'
            : SAFE_FLAG_VALUE.test(value)
              ? `当前值：${value}`
              : '已设置',
      },
    ),
  );
}

/** Each migration's marker: a table it creates or a column it adds. */
export const MIGRATION_MARKERS: ReadonlyArray<{
  id: string;
  table: string;
  column?: string;
}> = [
  { id: '0059_core_execution_identity', table: 'tasks', column: 'execution_id' },
  { id: '0060_llm_usage_accounting', table: 'llm_calls', column: 'cost_status' },
  { id: '0061_model_catalog', table: 'model_catalog' },
  { id: '0062_playbook_self_evolution', table: 'task_action_captures', column: 'replay_json' },
  { id: '0063_quota_refunds', table: 'quota_refunds' },
  { id: '0064_model_catalog_settings', table: 'model_catalog_settings' },
  {
    id: '0065_task_outcome_notifications',
    table: 'scheduled_tasks',
    column: 'consecutive_failures',
  },
];

export async function checkMigrations(deps: SelfCheckDeps): Promise<SelfCheckItem[]> {
  let rows: Record<string, unknown>[];
  try {
    rows = await deps.mysqlQuery(
      `SELECT TABLE_NAME AS t, COLUMN_NAME AS c FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (${MIGRATION_MARKERS.map(() => '?').join(',')})`,
      MIGRATION_MARKERS.map((marker) => marker.table),
    );
  } catch {
    return [
      item(
        { id: 'migrations', group: 'migrations', label: '迁移 0059–0065' },
        { status: 'fail', reason: '无法读取数据库结构', advice: '先修复 MySQL 连接' },
      ),
    ];
  }
  const present = new Set(rows.map((row) => `${String(row.t)}.${String(row.c)}`));
  const tables = new Set(rows.map((row) => String(row.t)));
  return MIGRATION_MARKERS.map((marker) => {
    const applied = marker.column
      ? present.has(`${marker.table}.${marker.column}`)
      : tables.has(marker.table);
    return item(
      { id: `migration.${marker.id}`, group: 'migrations', label: `迁移 ${marker.id}` },
      applied
        ? { status: 'ok', reason: '已执行' }
        : {
            status: 'fail',
            reason: `未执行（缺少 ${marker.column ? `${marker.table}.${marker.column}` : `表 ${marker.table}`}）`,
            advice: '按部署清单先执行 migration，再重启服务',
          },
    );
  });
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

export async function runSelfCheck(deps: SelfCheckDeps): Promise<SelfCheckReport> {
  const startedAt = new Date(deps.now()).toISOString();
  const [models, media, infra, migrations] = await Promise.all([
    deps.skip?.models
      ? Promise.resolve({ brain: selectDefaultBrain(deps.catalog()), items: [] })
      : checkModelLanes(deps),
    deps.skip?.media ? Promise.resolve([]) : checkMedia(deps),
    checkInfrastructure(deps),
    checkMigrations(deps),
  ]);
  const items = [...models.items, ...media, ...infra, ...migrations, ...checkFlags(deps.flags)];
  const summary: Record<CheckStatus, number> = { ok: 0, warn: 0, fail: 0 };
  for (const entry of items) summary[entry.status] += 1;
  return {
    startedAt,
    finishedAt: new Date(deps.now()).toISOString(),
    brainId: models.brain.id,
    region: deps.region,
    items,
    summary,
  };
}
