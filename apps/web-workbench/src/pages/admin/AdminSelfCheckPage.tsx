import { pageErrorMessage } from '@/lib/page-error-copy';
import { trpc } from '@/lib/trpc';
import { cn } from '@/lib/utils';
/**
 * 系统自检 — one click checks every model lane, media / search credentials,
 * infrastructure, switches and migrations. Results are cached for 5 minutes
 * server-side; "重新检查" forces a fresh run.
 */
import { Loader2 } from 'lucide-react';
import * as React from 'react';
import { formatDateTime, useMountedRef } from './admin-shared';

type CheckResult = NonNullable<Awaited<ReturnType<typeof trpc.selfCheck.latest.query>>>;
type CheckItem = CheckResult['report']['items'][number];

const GROUPS: ReadonlyArray<{ id: CheckItem['group']; label: string }> = [
  { id: 'model', label: '模型通道' },
  { id: 'media', label: '媒体与搜索' },
  { id: 'infra', label: '基础设施' },
  { id: 'migrations', label: '数据库迁移' },
  { id: 'flags', label: '开关' },
];

const STATUS_ICON: Record<CheckItem['status'], string> = { ok: '✅', warn: '⚠️', fail: '❌' };

export function AdminSelfCheckPage(): JSX.Element {
  const mountedRef = useMountedRef();
  const [result, setResult] = React.useState<CheckResult | null>(null);
  const [running, setRunning] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    trpc.selfCheck.latest
      .query()
      .then((latest) => {
        if (mountedRef.current && latest) setResult(latest);
      })
      .catch(() => {});
  }, [mountedRef]);

  const run = async (force: boolean) => {
    setRunning(true);
    setError(null);
    try {
      const next = await trpc.selfCheck.run.mutate(force ? { force: true } : {});
      if (mountedRef.current) setResult(next);
    } catch (err) {
      if (mountedRef.current) setError(pageErrorMessage(err, '自检失败'));
    } finally {
      if (mountedRef.current) setRunning(false);
    }
  };

  const report = result?.report;

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5 p-4 sm:p-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-[20px] font-semibold text-foreground">系统自检</h1>
          <p className="mt-1 text-[13px] text-muted-foreground">
            逐项检查模型通道、媒体与搜索、基础设施、开关和数据库迁移。模型每个通道只发一次极小调用，媒体只验证凭证、不生成内容。结果缓存
            5 分钟。
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            disabled={running}
            onClick={() => void run(false)}
            className="rounded-[6px] bg-[#EA1F59] px-3 py-1.5 text-[13px] text-white disabled:opacity-50"
          >
            {running ? <Loader2 className="inline h-4 w-4 animate-spin" /> : '开始自检'}
          </button>
          {report ? (
            <button
              type="button"
              disabled={running}
              onClick={() => void run(true)}
              className="rounded-[6px] border border-[#DCDDDD] px-3 py-1.5 text-[13px] hover:bg-[#EFEFEF] disabled:opacity-50"
            >
              重新检查
            </button>
          ) : null}
        </div>
      </header>

      {error ? <div className="text-[13px] text-[#EA1F59]">{error}</div> : null}

      {report ? (
        <>
          <div className="flex flex-wrap items-center gap-3 rounded-[10px] border border-[#EFEFEF] bg-white px-4 py-3 text-[13px]">
            <span>✅ {report.summary.ok}</span>
            <span>⚠️ {report.summary.warn}</span>
            <span>❌ {report.summary.fail}</span>
            <span className="text-muted-foreground">
              大脑 {report.brainId} · 区域 {report.region === 'cn' ? '国内' : '国际'} ·{' '}
              {result.cached ? '缓存结果，' : ''}检查于 {formatDateTime(result.cachedAt)}
            </span>
          </div>
          {GROUPS.map((group) => {
            const items = report.items.filter((entry) => entry.group === group.id);
            if (items.length === 0) return null;
            return (
              <section
                key={group.id}
                aria-label={group.label}
                className="rounded-[10px] border border-[#EFEFEF] bg-white"
              >
                <h2 className="border-b border-[#EFEFEF] px-4 py-2.5 text-[14px] font-semibold text-foreground">
                  {group.label}
                </h2>
                <ul className="divide-y divide-[#EFEFEF]">
                  {items.map((entry) => (
                    <li key={entry.id} className="flex gap-3 px-4 py-2.5 text-[13px]">
                      <span aria-label={entry.status} className="shrink-0">
                        {STATUS_ICON[entry.status]}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-baseline gap-x-2">
                          <span className="font-medium text-foreground">{entry.label}</span>
                          {entry.httpStatus || entry.errorCode ? (
                            <span className="text-[11px] text-muted-foreground">
                              {[entry.httpStatus, entry.errorCode].filter(Boolean).join(' · ')}
                            </span>
                          ) : null}
                        </div>
                        <div
                          className={cn(
                            'break-words',
                            entry.status === 'ok' ? 'text-muted-foreground' : 'text-foreground',
                          )}
                        >
                          {entry.reason}
                        </div>
                        {entry.advice && entry.status !== 'ok' ? (
                          <div className="mt-0.5 break-words text-[12px] text-[#57479C]">
                            建议：{entry.advice}
                          </div>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </>
      ) : running ? (
        <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> 正在逐项检查，通常需要 10–30 秒…
        </div>
      ) : (
        <div className="text-[13px] text-muted-foreground">还没有自检结果，点"开始自检"。</div>
      )}
    </div>
  );
}
