#!/usr/bin/env node
/**
 * Force-browser smoke — run just the 8 tasks that previously timed out
 * on anti-bot sites, with a prompt-injection suffix that forbids
 * web_search. If the Phase 6 fixes (raised stuck thresholds, browser-
 * first prompt, mobile fallback guidance, anti-bot detection)
 * actually work, at least 5/8 should complete via the browser path;
 * the rest should exit with an explicit "all browser paths blocked"
 * message — NOT degrade to search.
 *
 * The suffix is just appended to the user intent. That's prompt
 * injection from inside the same user turn, so it inherits the
 * same trust level as the rest of the intent — no backend API
 * change needed. The text itself is the goal; supercar's system
 * prompt still has the "last-resort web_search" permission, but
 * this overrides it at the task level.
 */

const BASE = process.env.HOLADAY_BASE ?? 'https://holaday.ai/api/trpc';
const EMAIL = process.env.HOLADAY_EMAIL ?? 'yaleiqi716@gmail.com';
const PASSWORD = process.env.HOLADAY_PASSWORD ?? 'ox3gwr95St8uslbxAa1!';
const POLL_INTERVAL_MS = 5_000;
const TASK_TIMEOUT_MS = 10 * 60 * 1_000;
const GAP_MS = 5_000;

// 8 tasks that timed out in the pre-Phase-6 baseline (all anti-bot
// victims from the hand-off doc). IDs preserved so the compare script
// can correlate.
const TASKS = [
  { id: 'T02', intent: '查看今天 A 股半导体板块涨跌情况，列出涨幅前5和跌幅前5的个股' },
  { id: 'T06', intent: "帮我看看抖音上最近关于'AI 办公'话题的热门视频，列出前10个的标题、作者、点赞数" },
  { id: 'T08', intent: "帮我找到抖音上最近一条关于'半导体'的热门视频，把它的文案内容完整抓下来" },
  { id: 'T09', intent: '帮我比较京东和淘宝上 AirPods Pro 2 的价格，哪个更便宜，有没有优惠券' },
  { id: 'T10', intent: "在小红书上搜索'三亚旅游攻略'，帮我整理点赞最多的前5篇帖子的核心内容" },
  { id: 'T13', intent: '在 Boss 直聘上搜索上海的 AI 产品经理岗位，月薪 30k-50k，列出前10个' },
  { id: 'T14', intent: '帮我搜索一下猎聘上深圳的前端开发岗位，3年以上经验，看看薪资范围' },
  { id: 'T17', intent: '帮我在携程上搜索下周末上海的五星级酒店，价格在800-1500之间，按评分排序列出前5' },
];

const FORCE_BROWSER_SUFFIX =
  '\n\n---\n\n**硬性约束（覆盖你的默认工具策略）**：' +
  '\n1. 本次任务**禁止使用 web_search 工具**。' +
  '\n2. 必须通过 computer 工具在真实浏览器里完成所有信息获取。' +
  '\n3. 遇到反爬拦截时，按系统提示里的升级路径逐级尝试（移动版 → 备选站点 → 页面重置 → 热榜页）。' +
  '\n4. 如果所有浏览器路径都失败（至少试过 4 条），直接输出"浏览器访问路径全部被反爬拦截，任务无法完成"+ 已尝试的站点列表，**不要降级到 web_search**。' +
  '\n5. 在最终报告中必须明确标注：信息来源是哪个具体 URL、从哪个页面元素读取的。';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = path.join(__dirname, '..', 'results');
fs.mkdirSync(RESULTS_DIR, { recursive: true });
const runId = new Date().toISOString().replace(/[:.]/g, '-');
const JSONL_PATH = path.join(RESULTS_DIR, `force-browser-${runId}.jsonl`);
const MD_PATH = path.join(RESULTS_DIR, `force-browser-${runId}.md`);

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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function runOne(token, task, index, total) {
  const started = Date.now();
  const fullIntent = task.intent + FORCE_BROWSER_SUFFIX;
  log(`(${index}/${total}) ${task.id} create (force-browser)`);
  let taskId;
  try {
    taskId = await createTask(token, fullIntent);
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
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    try {
      detail = await getDetail(token, taskId);
    } catch {
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
  }
  // Classify the completion path by inspecting the tools used + summary
  // for the "no web_search" guarantee. The compare table flags every
  // row that slipped past the injection suffix.
  const usedWebSearch = toolsSet.has('web_search');
  const usedComputer = toolsSet.has('computer');
  let pathLabel;
  if (!detail || (detail.status !== 'completed' && detail.status !== 'failed' && detail.status !== 'cancelled')) {
    pathLabel = 'timeout';
  } else if (detail.status === 'failed' || detail.status === 'cancelled') {
    pathLabel = detail.status;
  } else if (usedWebSearch && !usedComputer) {
    pathLabel = 'web_search-only (cheated)';
  } else if (usedWebSearch && usedComputer) {
    pathLabel = 'mixed (browser + search)';
  } else if (usedComputer) {
    pathLabel = 'browser-only ✓';
  } else {
    pathLabel = 'no-tool (text only)';
  }
  const row = {
    id: task.id,
    intent: task.intent,
    taskId,
    status: detail?.status ?? 'timeout',
    path: pathLabel,
    usedComputer,
    usedWebSearch,
    iterations: steps.length,
    durationMs: duration,
    toolsUsed: [...toolsSet],
    summaryPreview: summary.slice(0, 300),
    errorCode: detail?.errorCode ?? null,
  };
  fs.appendFileSync(JSONL_PATH, JSON.stringify(row) + '\n');
  log(`       done status=${row.status} path=${row.path} iter=${row.iterations} ${Math.round(duration / 1000)}s`);
  return row;
}

function truncForTable(s, n) {
  const clean = (s ?? '').replace(/\s+/g, ' ').trim();
  return clean.length > n ? clean.slice(0, n - 1) + '…' : clean;
}

function renderReport(rows) {
  const lines = [];
  lines.push(`# Supercar force-browser smoke — ${runId}`);
  lines.push('');
  lines.push(`Base: ${BASE}`);
  lines.push(`Injected suffix forbids \`web_search\`.`);
  lines.push(`Ran ${rows.length} tasks (the 8 that timed out in the pre-Phase-6 baseline).`);
  lines.push('');
  lines.push('| # | 任务 | 状态 | 路径 | 用到的工具 | 迭代 | 耗时 | 摘要 |');
  lines.push('|---|------|------|------|-----------|-----:|-----:|------|');
  for (const r of rows) {
    lines.push(
      `| ${r.id} | ${truncForTable(r.intent, 28)} | ${r.status} | ${r.path} | ${(r.toolsUsed ?? []).join(',') || '—'} | ${r.iterations} | ${(r.durationMs / 1000).toFixed(0)}s | ${truncForTable(r.summaryPreview, 60)} |`,
    );
  }
  lines.push('');

  const browserOnly = rows.filter((r) => r.status === 'completed' && r.usedComputer && !r.usedWebSearch).length;
  const mixed = rows.filter((r) => r.status === 'completed' && r.usedComputer && r.usedWebSearch).length;
  const cheated = rows.filter((r) => r.status === 'completed' && !r.usedComputer && r.usedWebSearch).length;
  const failed = rows.filter((r) => r.status === 'failed' || r.status === 'cancelled').length;
  const timedOut = rows.filter((r) => !['completed', 'failed', 'cancelled'].includes(r.status)).length;

  lines.push('## Stats');
  lines.push('');
  lines.push(`- ✅ Browser-only (the goal): **${browserOnly}/${rows.length}**`);
  lines.push(`- 🔀 Mixed (browser + search): ${mixed}/${rows.length}`);
  lines.push(`- 🚨 Cheated (search-only, ignored suffix): ${cheated}/${rows.length}`);
  lines.push(`- ❌ Failed / cancelled: ${failed}/${rows.length}`);
  lines.push(`- ⏱ Timed out: ${timedOut}/${rows.length}`);
  lines.push('');
  lines.push(`**Target: browser-only ≥ 5/8**`);
  return lines.join('\n');
}

(async () => {
  log(`Run ID ${runId}`);
  log(`Results: ${JSONL_PATH}`);
  const token = await login();
  log(`Token acquired`);
  const rows = [];
  for (let i = 0; i < TASKS.length; i += 1) {
    const t = TASKS[i];
    const row = await runOne(token, t, i + 1, TASKS.length);
    rows.push(row);
    if (i < TASKS.length - 1) await sleep(GAP_MS);
  }
  const md = renderReport(rows);
  fs.writeFileSync(MD_PATH, md);
  console.log('\n' + md);
  log(`Report saved to ${MD_PATH}`);
})().catch((err) => {
  console.error('FATAL', err);
  process.exit(1);
});
