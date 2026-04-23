#!/usr/bin/env node
/**
 * Diff a new supercar JSONL against the baseline from the hand-off doc.
 *
 * Usage:  node scripts/compare-supercar-runs.mjs <new-run.jsonl>
 *
 * Prints a markdown table comparing each task's new status + iterations
 * against the baseline, flags regressions (was completed, now timeout),
 * and surfaces wins (was timeout, now completed). Writes the same
 * table to results/compare-<ts>.md next to the JSONL.
 */

import fs from 'node:fs';
import path from 'node:path';

// Baseline from the iteration hand-off doc. Do not mutate — this is
// the frozen "before" state to measure the anti-crawl fallback and
// role library against.
const BASELINE = {
  T01: { status: 'completed', score: 4 },
  T02: { status: 'timeout', score: 1 },
  T03: { status: 'completed', score: 4 },
  T04: { status: 'completed', score: 5 },
  T05: { status: 'completed', score: 4 },
  T06: { status: 'timeout', score: 1 },
  T07: { status: 'completed', score: 5 },
  T08: { status: 'timeout', score: 1 },
  T09: { status: 'timeout', score: 1 },
  T10: { status: 'timeout', score: 1 },
  T11: { status: 'completed', score: 5 },
  T12: { status: 'completed', score: 5 },
  T13: { status: 'timeout', score: 1 },
  T14: { status: 'timeout', score: 1 },
  T15: { status: 'completed', score: 5 },
  T16: { status: 'completed', score: 4 },
  T17: { status: 'timeout', score: 1 },
  T18: { status: 'completed', score: 4 },
  T19: { status: 'completed', score: 4 },
  T20: { status: 'completed', score: 4 },
};

const TASK_LABEL = {
  T01: '茅台 vs 五粮液',
  T02: '半导体板块涨跌',
  T03: '比亚迪财报',
  T04: '团队会议邮件',
  T05: 'AI Agent 竞品分析',
  T06: '抖音 AI 办公热门',
  T07: '小红书推荐帖',
  T08: '抖音半导体文案',
  T09: '京东淘宝比价',
  T10: '小红书三亚攻略',
  T11: '竞业限制法规',
  T12: '劳动合同法47条',
  T13: 'Boss直聘 AI PM',
  T14: '猎聘前端岗位',
  T15: 'Resend API 文档',
  T16: 'Playwright MCP',
  T17: '携程五星酒店',
  T18: 'AI 新闻简报',
  T19: '雪球茅台讨论',
  T20: '高铁票',
};

function loadJsonl(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const out = {};
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line);
      out[row.id] = row;
    } catch {
      /* skip malformed */
    }
  }
  return out;
}

function statusEmoji(s) {
  if (s === 'completed') return '✅';
  if (s === 'timeout' || s === 'executing') return '⏱';
  if (s === 'failed') return '❌';
  if (s === 'cancelled') return '🚫';
  return '❓';
}

/**
 * Canonicalise status for outcome comparison. The benchmark script
 * polls tasks.detail until status is terminal (completed/failed/
 * cancelled) OR the 10-minute wall clock expires — in the latter case
 * the last-observed status is "executing", not "timeout". Treating
 * both as "stuck" avoids false-positive "partial-win" labels when a
 * task just hit the outer poll timeout without completing.
 */
function canonical(status) {
  if (status === 'executing') return 'timeout';
  return status;
}

function outcomeDelta(oldStatus, newStatus) {
  const a = canonical(oldStatus);
  const b = canonical(newStatus);
  if (a === b) return 'no-change';
  if (a !== 'completed' && b === 'completed') return 'win';
  if (a === 'completed' && b !== 'completed') return 'regression';
  return 'other';
}

function main() {
  const [, , jsonlPath] = process.argv;
  if (!jsonlPath) {
    console.error('usage: compare-supercar-runs.mjs <jsonl-path>');
    process.exit(2);
  }
  const rows = loadJsonl(path.resolve(jsonlPath));
  const ids = Object.keys(BASELINE).sort();

  let wins = 0;
  let regressions = 0;
  let stable = 0;

  const lines = [];
  lines.push(`# Supercar Benchmark Comparison`);
  lines.push('');
  lines.push(`New run: \`${jsonlPath}\``);
  lines.push('');
  lines.push('| # | 任务 | 之前 | 现在 | Δ | 迭代 | 耗时 | 摘要预览 |');
  lines.push('|---|------|------|------|---|-----:|-----:|----------|');

  for (const id of ids) {
    const base = BASELINE[id];
    const row = rows[id];
    if (!row) {
      lines.push(`| ${id} | ${TASK_LABEL[id]} | ${statusEmoji(base.status)} ${base.status} | — | skipped | — | — | (no row in new run) |`);
      continue;
    }
    const delta = outcomeDelta(base.status, row.status);
    if (delta === 'win') wins++;
    else if (delta === 'regression') regressions++;
    else stable++;

    const deltaGlyph = delta === 'win' ? '🎉' : delta === 'regression' ? '⚠️' : '—';

    const preview = (row.summaryPreview || '').replace(/\s+/g, ' ').slice(0, 50);
    const secs = (row.durationMs / 1000).toFixed(0);
    lines.push(
      `| ${id} | ${TASK_LABEL[id]} | ${statusEmoji(base.status)} ${base.status} | ${statusEmoji(row.status)} ${row.status} | ${deltaGlyph} | ${row.iterations} | ${secs}s | ${preview} |`,
    );
  }

  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(`- 🎉 Wins (was non-completed, now completed): **${wins}**`);
  lines.push(`- ⚠️  Regressions (was completed, now non-completed): **${regressions}**`);
  lines.push(`- ➖ Stable (no outcome change): **${stable}**`);
  lines.push('');

  const completedNow = Object.values(rows).filter((r) => r.status === 'completed').length;
  const completedBefore = Object.values(BASELINE).filter((b) => b.status === 'completed').length;
  lines.push(`- Completion rate: ${completedBefore}/20 → **${completedNow}/20**`);

  const report = lines.join('\n');
  console.log(report);

  // Save report next to the JSONL.
  const dir = path.dirname(jsonlPath);
  const outPath = path.join(dir, `compare-${path.basename(jsonlPath, '.jsonl')}.md`);
  fs.writeFileSync(outPath, report);
  console.log(`\nReport saved to ${outPath}`);
}

main();
