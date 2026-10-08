/**
 * FIX-BATCH-A — compare two `run.ts --pipeline` runs (before / after) with the
 * same scorer: success = delivered status `completed` AND the delivered list
 * passes `scoreListWithSources`. A false pass is `completed` while the
 * delivered list misses per-item sources or key fields (acceptance A2).
 *
 *   pnpm exec tsx scripts/browser-eval/pipeline-report.ts results/fixA/before results/fixA/after
 */
import { readFileSync } from 'node:fs';
import { type BrowserEvalTask, type ListWithSourcesSpec, scoreListWithSources } from './score.js';

const suite = JSON.parse(readFileSync(new URL('./tasks.json', import.meta.url), 'utf8')) as {
  tasks: BrowserEvalTask[];
};

interface Row {
  id: string;
  status: string;
  success: boolean;
  falsePass: boolean;
  problems: string[];
  inputTokens: number;
  outputTokens: number;
  modelCalls: number;
  steps: number;
  seconds: number;
  links: string;
}

function load(prefix: string): Map<string, Row> {
  const csv = readFileSync(`${prefix}.csv`, 'utf8').trim().split('\n');
  const header = (csv[0] ?? '').split(',');
  const col = (name: string) => header.indexOf(name);
  const runs = new Map<string, Record<string, unknown>>();
  for (const line of readFileSync(`${prefix}.pipeline.jsonl`, 'utf8').trim().split('\n')) {
    const record = JSON.parse(line) as Record<string, unknown>;
    runs.set(String(record.id), record);
  }
  const rows = new Map<string, Row>();
  for (const line of csv.slice(1)) {
    const cells = line.split(',');
    const id = cells[col('id')] ?? '';
    const run = runs.get(id) ?? {};
    const task = suite.tasks.find((candidate) => candidate.id === id);
    const spec = task?.success as ListWithSourcesSpec | undefined;
    const status = String(run.status ?? cells[col('status')]);
    const delivered = String(run.deliveredText ?? '');
    const scored =
      spec?.type === 'list_with_sources'
        ? scoreListWithSources(delivered, spec)
        : { ok: false, problems: ['not a list task'] };
    const links = (run.links as Array<{ status: number | string }> | undefined) ?? [];
    rows.set(id, {
      id,
      status,
      success: status === 'completed' && scored.ok,
      falsePass: status === 'completed' && !scored.ok,
      problems: status === 'completed' ? scored.problems : [String(run.failureSummary ?? status)],
      inputTokens: Number(cells[col('inputTokens')]),
      outputTokens: Number(cells[col('outputTokens')]),
      modelCalls: Number(cells[col('modelCalls')]),
      steps: Number(cells[col('steps')]),
      seconds: Math.round(Number(cells[col('durationMs')]) / 1000),
      links: links.map((link) => link.status).join('/') || '—',
    });
  }
  return rows;
}

const [beforePrefix, afterPrefix] = process.argv.slice(2);
if (!beforePrefix || !afterPrefix) throw new Error('usage: pipeline-report.ts <before> <after>');
const before = load(beforePrefix);
const after = load(afterPrefix);
const ids = [...new Set([...before.keys(), ...after.keys()])].sort();
const cell = (row: Row | undefined) =>
  row
    ? `${row.success ? '✅' : row.falsePass ? '❌ 假通过' : '❌'} ${row.status}${row.problems.length > 0 ? `（${row.problems.slice(0, 2).join('；')}）` : ''}`
    : '—';
const tokens = (row: Row | undefined) =>
  row ? `${(row.inputTokens / 1000).toFixed(1)}k / ${row.outputTokens} / ${row.modelCalls} 次` : '—';
const lines = [
  '| 任务 | 修复前 | 修复后 | 输入 token / 输出 token / 调用（前 → 后） | 链接 HTTP（后） |',
  '|---|---|---|---|---|',
  ...ids.map(
    (id) =>
      `| ${id} | ${cell(before.get(id))} | ${cell(after.get(id))} | ${tokens(before.get(id))} → ${tokens(after.get(id))} | ${after.get(id)?.links ?? '—'} |`,
  ),
];
const total = (rows: Map<string, Row>) => {
  const list = [...rows.values()];
  return {
    success: list.filter((row) => row.success).length,
    falsePass: list.filter((row) => row.falsePass).length,
    count: list.length,
    inputTokens: list.reduce((sum, row) => sum + row.inputTokens, 0),
    outputTokens: list.reduce((sum, row) => sum + row.outputTokens, 0),
    modelCalls: list.reduce((sum, row) => sum + row.modelCalls, 0),
  };
};
const b = total(before);
const a = total(after);
lines.push(
  '',
  `成功：修复前 ${b.success}/${b.count}，修复后 ${a.success}/${a.count}；假通过（completed 但缺逐条来源/字段）：${b.falsePass} → ${a.falsePass}`,
  `token：输入 ${b.inputTokens} → ${a.inputTokens}，输出 ${b.outputTokens} → ${a.outputTokens}，模型调用 ${b.modelCalls} → ${a.modelCalls}`,
);
process.stdout.write(`${lines.join('\n')}\n`);
