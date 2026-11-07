import { REPLAY_NOW, replayClient } from '../src/agent/a-share/ashare-eval-replay.client.js';
import {
  ashareMessagesAdapter,
  createAshareModelCallers,
} from '../src/agent/a-share/ashare-model-callers.js';
import { resolveAshareInContext } from '../src/agent/a-share/ashare-qa-matcher.js';
import { runAsharePanorama } from '../src/agent/a-share/ashare-qa-runner.js';
/**
 * Batch 10 — ⑦ 分析师视角千问真机冒烟（BOSS 批准 ≤3 次真实调用）.
 *
 *   pnpm exec tsx --env-file=<env> scripts/ashare-panorama-smoke.ts [--no-judge] [--region intl|cn]
 *
 * 行情用回放固化数据（迪生力 E19 样本，不请求真实行情）；模型走生产模型目录的
 * generate 通道（千问 standard 档）。硬上限 3 次模型调用，超出直接抛错。只打印调用
 * 次数 / 模型 / 耗时 / 闸门判定和 ⑦ 段落，不打印任何 key 或请求头。
 */
import { env as appEnv } from '../src/config/env.js';
import type { MessagesAdapter } from '../src/llm/messages-adapter.js';
import { createProductionModelRuntimeWiring } from '../src/llm/model-runtime-wiring.js';

const MAX_CALLS = 3;
const args = process.argv.slice(2);
const region = (args[args.indexOf('--region') + 1] === 'cn' ? 'cn' : 'intl') as 'cn' | 'intl';
const judgeEnabled = !args.includes('--no-judge');

async function main(): Promise<number> {
  const runtime = createProductionModelRuntimeWiring(appEnv).resolveCore({
    actorExternalId: 'smoke',
    lane: 'generate',
    ownership: { scope: 'personal', userRegion: region },
  });
  const base = ashareMessagesAdapter(runtime);
  if (!base) {
    console.log(
      `generate 通道不可用：${runtime.kind === 'unavailable' ? runtime.reasonCode : '?'}`,
    );
    return 2;
  }
  let calls = 0;
  const adapter: MessagesAdapter = {
    metadata: base.metadata,
    async create(request, options) {
      calls += 1;
      if (calls > MAX_CALLS) throw new Error(`超过 ${MAX_CALLS} 次调用上限`);
      const kind = request.temperature === 0 ? 'judge' : 'interpret';
      const started = Date.now();
      try {
        const response = await base.create(request, options);
        console.log(
          `call ${calls}: ${kind} model=${base.metadata.model} ok ${Date.now() - started}ms`,
        );
        return response;
      } catch (error) {
        const code = (error as { code?: string }).code ?? 'UNKNOWN';
        console.log(
          `call ${calls}: ${kind} model=${base.metadata.model} error=${code} ${Date.now() - started}ms`,
        );
        throw error;
      }
    },
  };

  const { match } = await resolveAshareInContext(
    { intent: '详细分析迪生力(603335)', watchlist: [], now: REPLAY_NOW },
    async () => [{ symbol: '603335', displayName: '迪生力' }],
  );
  if (!match?.deep) {
    console.log('路由未进入七维全景');
    return 2;
  }
  const result = await runAsharePanorama(
    {
      client: replayClient(),
      skillMarkdown: '你是严谨的 A股信息分析助手。',
      ...createAshareModelCallers(adapter, { judgeEnabled }),
      logger: { info: () => {}, warn: () => {} },
      now: REPLAY_NOW,
    },
    match,
  );
  const section7 = result.answer.includes('⑦')
    ? result.answer.slice(result.answer.indexOf('## ⑦')).slice(0, 900)
    : '(无 ⑦ 段落)';
  console.log(
    `\n判定：interpreted=${result.interpreted} degraded=${result.degraded} reason=${result.reason ?? '-'} 调用=${calls}`,
  );
  console.log(`\n${section7}`);
  return 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error('冒烟失败：', error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
