#!/usr/bin/env node
/**
 * Supercar production smoke — 20 real user tasks end-to-end via HTTPS.
 *
 * Runs serially against https://holaday.ai/api/trpc/. For each task:
 *   1. tasks.create
 *   2. poll tasks.detail every 5s until status transitions to terminal
 *      (completed / failed / cancelled) or 10-minute timeout elapses
 *   3. append one JSONL row to results/<ts>.jsonl with per-task stats
 *
 * Fires a 5s cooldown between tasks so concurrent runs never race.
 * On timeout the row still lands — we never abort the whole batch.
 *
 * Final summary (table + stats) is printed to stdout and also written
 * to results/<ts>.md so the run is reproducible without scrollback.
 */

function requireEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required. Set it in your shell; do not commit test credentials.`);
  }
  return value;
}

const BASE = process.env.HOLADAY_BASE ?? 'https://holaday.ai/api/trpc';
const EMAIL = requireEnv('HOLADAY_EMAIL');
const PASSWORD = requireEnv('HOLADAY_PASSWORD');
const POLL_INTERVAL_MS = 5_000;
const TASK_TIMEOUT_MS = 10 * 60 * 1_000; // 10 min per task
const GAP_MS = 5_000; // between tasks

const TASKS = [
  { id: 'T01', intent: '做一份贵州茅台 vs 五粮液的对比分析，包括最新股价、PE、市值、近一年涨幅，给出投资建议' },
  { id: 'T02', intent: '查看今天 A 股半导体板块涨跌情况，列出涨幅前5和跌幅前5的个股' },
  { id: 'T03', intent: '分析比亚迪最近一个季度的财报，重点看营收、净利润、毛利率的同比变化' },
  { id: 'T04', intent: '帮我写一封邮件给团队，通知本周五下午3点在会议室A开产品评审会，要求每个人准备15分钟的进展汇报' },
  { id: 'T05', intent: '帮我调研一下目前市面上主流的 AI Agent 产品，包括 Manus、Claude、Codex、Devin，做一份竞品分析报告' },
  { id: 'T06', intent: "帮我看看抖音上最近关于'AI 办公'话题的热门视频，列出前10个的标题、作者、点赞数" },
  { id: 'T07', intent: "帮我写一篇小红书推荐帖，主题是'上海周末好去处推荐'，要有吸引人的标题、正文和标签" },
  { id: 'T08', intent: "帮我找到抖音上最近一条关于'半导体'的热门视频，把它的文案内容完整抓下来" },
  { id: 'T09', intent: '帮我比较京东和淘宝上 AirPods Pro 2 的价格，哪个更便宜，有没有优惠券' },
  { id: 'T10', intent: "在小红书上搜索'三亚旅游攻略'，帮我整理点赞最多的前5篇帖子的核心内容" },
  { id: 'T11', intent: '查一下2024年以来关于竞业限制补偿金的最新法律规定和典型案例' },
  { id: 'T12', intent: '帮我查一下劳动合同法第四十七条关于经济补偿的具体内容，以及计算方式举例' },
  { id: 'T13', intent: '在 Boss 直聘上搜索上海的 AI 产品经理岗位，月薪 30k-50k，列出前10个' },
  { id: 'T14', intent: '帮我搜索一下猎聘上深圳的前端开发岗位，3年以上经验，看看薪资范围' },
  { id: 'T15', intent: '帮我找到 Resend 的 API 文档页面，整理出发送邮件的 API 接口信息（endpoint、参数、认证方式）' },
  { id: 'T16', intent: '用 Google 搜索 Playwright MCP Server 的最新文档，整理出它支持的所有工具列表' },
  { id: 'T17', intent: '帮我在携程上搜索下周末上海的五星级酒店，价格在800-1500之间，按评分排序列出前5' },
  { id: 'T18', intent: '帮我用 Google 搜索最近一周全球 AI 领域的重大新闻，整理成一份中文简报' },
  { id: 'T19', intent: '帮我查看雪球上贵州茅台的最新讨论，整理出机构和大V们的主要观点' },
  { id: 'T20', intent: '帮我订今天从上海到北京的高铁票，二等座，下午出发' },
];

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = path.join(__dirname, '..', 'results');
fs.mkdirSync(RESULTS_DIR, { recursive: true });
const runId = new Date().toISOString().replace(/[:.]/g, '-');
const JSONL_PATH = path.join(RESULTS_DIR, `supercar-${runId}.jsonl`);
const MD_PATH = path.join(RESULTS_DIR, `supercar-${runId}.md`);

function log(...args) {
  const stamp = new Date().toISOString().slice(11, 19);
  console.log(`[${stamp}]`, ...args);
}

async function login() {
  const r = await fetch(`${BASE}/auth.login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!r.ok) throw new Error(`login ${r.status}: ${await r.text()}`);
  const body = await r.json();
  return body.result.data.accessToken;
}

async function createTask(token, intent) {
  const r = await fetch(`${BASE}/tasks.create`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ intent }),
  });
  if (!r.ok) throw new Error(`tasks.create ${r.status}: ${await r.text()}`);
  const body = await r.json();
  return body.result.data.taskId;
}

async function getDetail(token, taskId) {
  const qs = encodeURIComponent(JSON.stringify({ taskId }));
  const r = await fetch(`${BASE}/tasks.detail?input=${qs}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!r.ok) throw new Error(`tasks.detail ${r.status}: ${await r.text()}`);
  const body = await r.json();
  return body.result.data;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function runOne(token, task, index, total) {
  const started = Date.now();
  log(`(${index}/${total}) ${task.id} create`);
  let taskId;
  try {
    taskId = await createTask(token, task.intent);
  } catch (err) {
    const row = {
      id: task.id,
      intent: task.intent,
      status: 'create_failed',
      iterations: 0,
      durationMs: Date.now() - started,
      toolsUsed: [],
      summaryPreview: '',
      error: String(err?.message ?? err),
    };
    fs.appendFileSync(JSONL_PATH, JSON.stringify(row) + '\n');
    return row;
  }
  log(`       -> ${taskId}, polling`);
  const deadline = started + TASK_TIMEOUT_MS;
  let detail = null;
  let pollErrors = 0;
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    try {
      detail = await getDetail(token, taskId);
    } catch (err) {
      pollErrors += 1;
      if (pollErrors > 10) {
        log(`       !! too many poll errors, abandoning poll`);
        break;
      }
      continue;
    }
    if (
      detail.status === 'completed' ||
      detail.status === 'failed' ||
      detail.status === 'cancelled'
    ) {
      break;
    }
  }
  const duration = Date.now() - started;
  const summary =
    detail?.result?.summary ??
    detail?.result?.reason ??
    detail?.errorMessage ??
    '';
  const toolsSet = new Set();
  const steps = detail?.steps ?? [];
  for (const s of steps) {
    const t = s.output?.tools;
    if (Array.isArray(t)) for (const x of t) if (typeof x === 'string') toolsSet.add(x);
    if (s.kind) toolsSet.add(s.kind);
  }
  const row = {
    id: task.id,
    intent: task.intent,
    taskId,
    status: detail?.status ?? 'timeout',
    iterations: steps.length,
    durationMs: duration,
    toolsUsed: [...toolsSet],
    summaryPreview: summary.slice(0, 200),
    errorCode: detail?.errorCode ?? null,
  };
  fs.appendFileSync(JSONL_PATH, JSON.stringify(row) + '\n');
  log(
    `       done status=${row.status} iter=${row.iterations} ${Math.round(duration / 1000)}s`,
  );
  return row;
}

function summaryPreview50(s) {
  const clean = (s ?? '').replace(/\s+/g, ' ').trim();
  return clean.length > 50 ? clean.slice(0, 50) + '…' : clean;
}

function truncForTable(s, n) {
  const clean = (s ?? '').replace(/\s+/g, ' ').trim();
  return clean.length > n ? clean.slice(0, n - 1) + '…' : clean;
}

function renderReport(rows) {
  const lines = [];
  lines.push(`# Supercar production smoke — ${runId}`);
  lines.push('');
  lines.push(`Base: ${BASE}`);
  lines.push(`User: ${EMAIL}`);
  lines.push(`Ran ${rows.length}/${TASKS.length} tasks`);
  lines.push('');
  lines.push('| # | Task | Status | Iter | Duration | Tools | Summary (preview) |');
  lines.push('|---|------|--------|------|---------:|-------|-------------------|');
  for (const r of rows) {
    lines.push(
      `| ${r.id} | ${truncForTable(r.intent, 30)} | ${r.status} | ${r.iterations} | ${(r.durationMs / 1000).toFixed(1)}s | ${(r.toolsUsed || []).join(',')} | ${summaryPreview50(r.summaryPreview)} |`,
    );
  }
  lines.push('');
  // Stats.
  const completed = rows.filter((r) => r.status === 'completed');
  const failed = rows.filter((r) => r.status === 'failed');
  const timedOut = rows.filter((r) => r.status === 'timeout');
  const other = rows.filter(
    (r) =>
      !['completed', 'failed', 'timeout'].includes(r.status),
  );
  const avgIter = rows.reduce((a, r) => a + r.iterations, 0) / Math.max(1, rows.length);
  const avgDur = rows.reduce((a, r) => a + r.durationMs, 0) / Math.max(1, rows.length);
  const toolCount = new Map();
  for (const r of rows) for (const t of r.toolsUsed || []) toolCount.set(t, (toolCount.get(t) ?? 0) + 1);
  const topTools = [...toolCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);

  lines.push('## Stats');
  lines.push('');
  lines.push(`- Completed: ${completed.length}/${rows.length}`);
  lines.push(`- Failed:    ${failed.length}/${rows.length}`);
  lines.push(`- Timeouts:  ${timedOut.length}/${rows.length}`);
  if (other.length) lines.push(`- Other:     ${other.length}/${rows.length} (${other.map((r) => r.status).join(', ')})`);
  lines.push(`- Avg iterations: ${avgIter.toFixed(1)}`);
  lines.push(`- Avg duration:   ${(avgDur / 1000).toFixed(1)}s`);
  lines.push(`- Top tools:      ${topTools.map(([t, n]) => `${t}×${n}`).join(', ')}`);
  lines.push('');
  lines.push('## Failures (errorCode)');
  for (const r of rows.filter((x) => x.status !== 'completed')) {
    lines.push(`- **${r.id}** (${r.status}) \`${r.errorCode ?? ''}\` — ${truncForTable(r.summaryPreview || r.error || '', 120)}`);
  }
  return lines.join('\n');
}

(async () => {
  log(`Run ID ${runId}`);
  log(`Results: ${JSONL_PATH}`);
  log(`Login as ${EMAIL}`);
  const token = await login();
  log(`Token acquired (${token.length} chars)`);
  const rows = [];
  for (let i = 0; i < TASKS.length; i += 1) {
    const t = TASKS[i];
    const row = await runOne(token, t, i + 1, TASKS.length);
    rows.push(row);
    if (i < TASKS.length - 1) {
      await sleep(GAP_MS);
    }
  }
  const md = renderReport(rows);
  fs.writeFileSync(MD_PATH, md);
  console.log('\n' + md);
  log(`Report saved to ${MD_PATH}`);
})().catch((err) => {
  console.error('FATAL', err);
  process.exit(1);
});
