/**
 * Batch 10.1 — 系统自检, command-line version. Run on the server after a deploy:
 *
 *   pnpm self-check                      # all checks, region from available keys
 *   pnpm self-check --region cn          # probe the mainland region
 *   pnpm self-check --skip-models        # no model calls (infra / media / flags / migrations)
 *   pnpm self-check --skip-media --json  # machine-readable output
 *
 * Model lanes cost at most one 8-token call per distinct model. Media is never
 * generated. Keys are never printed. Exit code 1 when any item fails.
 */
import { pool } from '../src/db/client.js';
import { redis } from '../src/redis.js';
import {
  createProductionSelfCheckDeps,
  defaultSelfCheckRegion,
} from '../src/self-check/production-deps.js';
import { createSelfCheckService } from '../src/self-check/self-check-service.js';
import type { SelfCheckItem } from '../src/self-check/self-check.js';

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const value = (name: string) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};

const ICON: Record<SelfCheckItem['status'], string> = { ok: '✅', warn: '⚠️ ', fail: '❌' };
const GROUP: Record<SelfCheckItem['group'], string> = {
  model: '模型通道',
  media: '媒体与搜索',
  infra: '基础设施',
  migrations: '数据库迁移',
  flags: '开关',
};

async function main(): Promise<number> {
  const requested = value('--region');
  if (requested && requested !== 'cn' && requested !== 'intl') {
    console.error('--region 只能是 cn 或 intl');
    return 2;
  }
  const region = defaultSelfCheckRegion(requested ?? null);
  const service = createSelfCheckService({
    logger: { info: (obj: object) => process.stderr.write(`${JSON.stringify(obj)}\n`) } as never,
  });
  const { report } = await service.check({
    deps: createProductionSelfCheckDeps({
      actorExternalId: 'cli',
      region,
      skip: { models: flag('--skip-models'), media: flag('--skip-media') },
    }),
    actorExternalId: 'cli',
    source: 'cli',
    force: true,
  });

  if (flag('--json')) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`系统自检  大脑=${report.brainId}  区域=${report.region}  ${report.finishedAt}`);
    let group = '';
    for (const entry of report.items) {
      if (entry.group !== group) {
        group = entry.group;
        console.log(`\n【${GROUP[entry.group]}】`);
      }
      const code = [entry.httpStatus, entry.errorCode].filter(Boolean).join(' ');
      console.log(
        `${ICON[entry.status]} ${entry.label}：${entry.reason}${code ? `  [${code}]` : ''}`,
      );
      if (entry.advice && entry.status !== 'ok') console.log(`    → ${entry.advice}`);
    }
    const { ok, warn, fail } = report.summary;
    console.log(`\n合计：✅ ${ok}  ⚠️ ${warn}  ❌ ${fail}`);
  }
  return report.summary.fail > 0 ? 1 : 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error('自检脚本出错：', error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  })
  .finally(async () => {
    redis.disconnect();
    await pool.end().catch(() => {});
  });
