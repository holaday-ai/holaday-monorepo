#!/usr/bin/env node
/**
 * Batch 11.0 — paired legacy/unified comparison from one or more paired CSVs
 * (run.ts --paired). A task counts only when BOTH runs exist on the same model
 * and neither failed at the model layer or the environment.
 *
 *   node scripts/browser-eval/paired-report.mjs results/b11/smoke-paired.csv results/b11/full-paired.csv
 */
import { readFileSync } from 'node:fs';

function parseCsv(path) {
  const [header, ...lines] = readFileSync(path, 'utf8').trim().split('\n');
  const cols = header.split(',');
  return lines.map((line) => {
    // reason is the only quoted field and sits before an optional attempts column
    const match = line.match(/^(.*?),"(.*)"(?:,(\d+))?$/);
    const head = (match ? match[1] : line).split(',');
    const row = Object.fromEntries(cols.slice(0, head.length).map((c, i) => [c, head[i]]));
    row.reason = match ? match[2] : '';
    row.source = path.split('/').pop();
    return row;
  });
}

const rows = process.argv.slice(2).flatMap(parseCsv);
const pairs = new Map();
for (const row of rows) {
  const key = `${row.source}|${row.id}`;
  const pair = pairs.get(key) ?? { id: row.id, category: row.category, source: row.source };
  pair[row.executor] = row;
  pairs.set(key, pair);
}
const excluded = (run) => !run || run.failureClass === 'model_layer' || run.failureClass === 'environment';
const all = [...pairs.values()];
const comparable = all.filter((p) => p.legacy && p.unified && p.legacy.model === p.unified.model && !excluded(p.legacy) && !excluded(p.unified));

const byCat = new Map();
for (const p of comparable) {
  const c = byCat.get(p.category) ?? { n: 0, legacy: 0, unified: 0 };
  c.n += 1;
  if (p.legacy.success === 'true') c.legacy += 1;
  if (p.unified.success === 'true') c.unified += 1;
  byCat.set(p.category, c);
}
const pct = (a, n) => (n ? `${a}/${n}（${Math.round((a / n) * 100)}%）` : '—');
const models = [...new Set(comparable.map((p) => p.legacy.model))].join('、') || '—';
const tot = [...byCat.values()].reduce((a, c) => ({ n: a.n + c.n, legacy: a.legacy + c.legacy, unified: a.unified + c.unified }), { n: 0, legacy: 0, unified: 0 });
const tokens = (kind) => comparable.reduce((s, p) => s + Number(p[kind].inputTokens) + Number(p[kind].outputTokens), 0);

console.log(`成对记录 ${all.length} 对，可对比 ${comparable.length} 对（模型：${models}）\n`);
console.log('| 类别 | 可对比对数 | legacy 成功 | unified 成功 |');
console.log('|---|---|---|---|');
for (const [cat, c] of [...byCat.entries()].sort()) console.log(`| ${cat} | ${c.n} | ${pct(c.legacy, c.n)} | ${pct(c.unified, c.n)} |`);
console.log(`| **合计** | ${tot.n} | ${pct(tot.legacy, tot.n)} | ${pct(tot.unified, tot.n)} |`);
console.log(`\n可对比任务的 token 合计：legacy ${tokens('legacy')}，unified ${tokens('unified')}\n`);
console.log('| 任务 | 类别 | 模型 | legacy | unified | 是否计入 |');
console.log('|---|---|---|---|---|---|');
const cell = (r) => (r ? `${r.success === 'true' ? '✅' : '❌'} ${r.failureClass}${r.reason ? ` · ${r.reason.slice(0, 40)}` : ''}` : '未运行');
for (const p of all.sort((a, b) => (a.source + a.id).localeCompare(b.source + b.id))) {
  const counted = comparable.includes(p) ? '计入' : '不计入';
  console.log(`| ${p.id}（${p.source.replace('.csv', '')}） | ${p.category} | ${(p.legacy ?? p.unified)?.model ?? ''} | ${cell(p.legacy)} | ${cell(p.unified)} | ${counted} |`);
}
