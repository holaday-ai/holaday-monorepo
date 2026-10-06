/**
 * Batch 06 — 学习引擎 · 自进化闭环 panel.
 *
 * Four numbers for the playbook self-evolution loop (window: last 30 days for
 * the rates/savings; path counts are all-time):
 *   路径数        template paths (verified / draft / stale)
 *   通过率        canary replay pass rate
 *   复用命中率    reuse replays that met the goal (incl. locally repaired)
 *   节省模型调用  estimated agent model turns avoided by deterministic replay
 */

import { pageErrorMessage } from '@/lib/page-error-copy';
import { trpc } from '@/lib/trpc';
import * as React from 'react';
import { formatRate, normalizeEvolution } from './admin-learning-evolution-model';
import { formatInteger, useMountedRef } from './admin-shared';

type EvolutionData = Awaited<ReturnType<typeof trpc.admin.learning.evolution.query>>;

export function AdminLearningEvolution(): JSX.Element {
  const mountedRef = useMountedRef();
  const [data, setData] = React.useState<EvolutionData | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    trpc.admin.learning.evolution
      .query({ windowDays: 30 })
      .then((res) => {
        if (mountedRef.current) setData(res);
      })
      .catch((err) => {
        if (mountedRef.current) setError(pageErrorMessage(err));
      });
  }, [mountedRef]);

  const n = normalizeEvolution(data);
  const loaded = data !== null;

  return (
    <section className="mt-6" aria-labelledby="learning-evolution-title">
      <h2 id="learning-evolution-title" className="text-[13px] font-semibold text-foreground">
        自进化闭环
      </h2>
      <p className="mt-0.5 text-[12px] text-muted-foreground">
        成功任务沉淀为路径 → 隔离回放验证 → 确定性复用 · 比率统计最近 {n.windowDays} 天
      </p>
      {error && (
        <div className="mt-2 text-[12px] text-[#FF0061]">学习引擎数据暂不可用：{error}</div>
      )}
      <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label="路径数"
          value={loaded ? formatInteger(n.paths.total) : '—'}
          hint={
            loaded
              ? `已验证 ${n.paths.verified} · 待验证 ${n.paths.draft} · 已失效 ${n.paths.stale}`
              : '加载中…'
          }
        />
        <StatTile
          label="验证通过率"
          value={loaded ? formatRate(n.canary.passRate) : '—'}
          hint={loaded ? `隔离回放 ${formatInteger(n.canary.runs)} 次` : '加载中…'}
        />
        <StatTile
          label="复用命中率"
          value={loaded ? formatRate(n.reuse.hitRate) : '—'}
          hint={
            loaded
              ? `复用 ${formatInteger(n.reuse.attempts)} 次 · 命中 ${formatInteger(n.reuse.hits)}（含局部修复 ${formatInteger(n.reuse.repaired)}）`
              : '加载中…'
          }
        />
        <StatTile
          label="节省模型调用"
          value={loaded ? formatInteger(n.modelCallsSaved) : '—'}
          hint="估算：每步一次模型调用 − 实际调用"
        />
      </div>
    </section>
  );
}

function StatTile({
  label,
  value,
  hint,
}: { label: string; value: string; hint: string }): JSX.Element {
  return (
    <div className="min-w-0 rounded-[8px] border border-[#DCDDDD] bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
      <div className="text-[11px] uppercase text-muted-foreground">{label}</div>
      <div className="mt-2 text-2xl font-semibold tabular-nums text-foreground">{value}</div>
      <div className="mt-1 truncate text-[11px] text-muted-foreground" title={hint}>
        {hint}
      </div>
    </div>
  );
}
