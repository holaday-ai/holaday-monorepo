/**
 * Offline route audit (FIX-INTENT-ROUTE-BROWSER). No network, no model, no
 * database: runs every browser test task through the same decisions
 * tasks.create makes — execution-mode classification, identity routing and
 * the session policy — and fails when any of them would not reach an
 * anonymous browser. Scrape controls guard against over-routing.
 *
 *   pnpm route:audit [--json <path>]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pino from 'pino';
import { explainExecutionMode } from '../src/agent/intent-classifier.js';
import {
  classifyIdentityNeed,
  decideUserBrowserRoute,
  deriveTaskSessionPolicy,
} from '../src/agent/supercar/user-browser-routing.js';

interface SuiteTask {
  id: string;
  startUrl: string;
  instruction: string;
}
interface Row {
  group: string;
  id: string;
  intent: string;
  expected: 'browser' | 'scrape';
  mode: string;
  source: string;
  match?: string;
  identityRequired: boolean;
  identityReason: string;
  routeFlagOff: string;
  routeFlagOn: string;
  sessionPolicy: string;
  pass: boolean;
}

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const suite = JSON.parse(readFileSync(here('./browser-eval/production-suite.json'), 'utf8')) as {
  core: SuiteTask[];
  extended: SuiteTask[];
};
const corpus = JSON.parse(readFileSync(here('./browser-eval/route-audit-corpus.json'), 'utf8')) as {
  bench1Prefix: string;
  bench1Core: string[];
  scrapeControls: string[];
};
const logger = pino({ level: 'silent' });

async function audit(
  group: string,
  id: string,
  intent: string,
  expected: Row['expected'],
): Promise<Row> {
  const decision = await explainExecutionMode({ intent, logger });
  const identity = classifyIdentityNeed(intent);
  const route = (enabled: boolean) =>
    decideUserBrowserRoute({
      enabled,
      intent,
      extensionOnline: false,
      legacyCookieSyncRetired: true,
    });
  const off = route(false);
  const on = route(true);
  const policies = [off, on].map((r) =>
    deriveTaskSessionPolicy({
      identityRequired: identity.required,
      publicCloudRequested: false,
      route: r,
    }),
  );
  const sessionPolicy = policies.every((p) => p === 'anonymous') ? 'anonymous' : policies.join('/');
  const pass =
    expected === 'browser'
      ? decision.mode === 'browser' &&
        !identity.required &&
        off.lane !== 'awaiting_user' &&
        on.lane !== 'awaiting_user' &&
        sessionPolicy === 'anonymous'
      : decision.mode === 'scrape';
  return {
    group,
    id,
    intent,
    expected,
    mode: decision.mode,
    source: decision.source,
    ...(decision.match ? { match: decision.match } : {}),
    identityRequired: identity.required,
    identityReason: identity.reason,
    routeFlagOff: `${off.lane}/${off.reason}`,
    routeFlagOn: `${on.lane}/${on.reason}`,
    sessionPolicy,
    pass,
  };
}

const rows: Row[] = [];
for (const [group, tasks] of [
  ['suite-core', suite.core],
  ['suite-extended', suite.extended],
] as const)
  for (const task of tasks)
    rows.push(
      await audit(group, task.id, `${task.instruction}\n（起始页面：${task.startUrl}）`, 'browser'),
    );
for (const [i, sentence] of corpus.bench1Core.entries())
  rows.push(
    await audit(
      'bench1-core',
      `bench1-${String(i + 1).padStart(2, '0')}`,
      `${corpus.bench1Prefix}${sentence}`,
      'browser',
    ),
  );
for (const [i, sentence] of corpus.scrapeControls.entries())
  rows.push(
    await audit('scrape-control', `control-${String(i + 1).padStart(2, '0')}`, sentence, 'scrape'),
  );

const cell = (text: string) => text.replace(/\|/g, '\\|').replace(/\n/g, ' ');
console.log('| 组 | 编号 | 期望 | mode | 理由 | 身份 | 路由(flag关/开) | 会话策略 | 结果 |');
console.log('|---|---|---|---|---|---|---|---|---|');
for (const r of rows)
  console.log(
    `| ${r.group} | ${r.id} | ${r.expected} | ${r.mode} | ${cell(`${r.source}${r.match ? ` (${r.match})` : ''}`)} | ${r.identityRequired ? '需要' : '不需要'} | ${r.routeFlagOff} / ${r.routeFlagOn} | ${r.sessionPolicy} | ${r.pass ? '✅' : '❌'} |`,
  );
const failed = rows.filter((r) => !r.pass);
const browserRows = rows.filter((r) => r.expected === 'browser');
const controlRows = rows.filter((r) => r.expected === 'scrape');
console.log(
  `\nbrowser 测试项 ${browserRows.filter((r) => r.pass).length}/${browserRows.length} 通过；scrape 对照 ${controlRows.filter((r) => r.pass).length}/${controlRows.length} 通过。`,
);
const jsonArg = process.argv.indexOf('--json');
if (jsonArg > 0 && process.argv[jsonArg + 1])
  writeFileSync(process.argv[jsonArg + 1] as string, JSON.stringify(rows, null, 1));
if (failed.length > 0) {
  console.error(`route:audit 失败 ${failed.length} 项：${failed.map((r) => r.id).join(', ')}`);
  process.exitCode = 1;
}
