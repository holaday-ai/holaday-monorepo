import { Clock } from 'lucide-react';
import { PageShell } from '@/pages/PageShell';

/**
 * Scheduled tasks demoted to a roadmap placeholder. The orchestrator's
 * cron-dispatch path is still a stub (logs but doesn't actually run the
 * task), so allowing users to create / pause / delete triggers misled
 * them into thinking work would happen at the scheduled time when
 * nothing fires. Page kept reachable by direct URL so the in-flight
 * /scheduled link surface (sidebar removed, but route preserved)
 * doesn't 404 mid-rollout. Becomes interactive again once dispatch
 * lands.
 */
export function ScheduledPage(): JSX.Element {
  return (
    <PageShell
      title="定时任务"
      subtitle="按计划自动执行任务的能力正在开发中"
      width="2xl"
    >
      <div className="flex flex-col items-center gap-4 rounded-xl border border-dashed border-border bg-card/40 px-6 py-12 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Clock className="h-5 w-5" />
        </div>
        <div className="space-y-1">
          <div className="text-base font-medium text-foreground/85">即将推出</div>
          <div className="max-w-md text-sm text-muted-foreground">
            把每天的早报、每周的周报、每月的对账这种重复任务交给定时器。
            后端调度路径仍在打磨中，开放后会第一时间放回侧边栏。
          </div>
        </div>
        <span className="rounded-md border border-border px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
          Beta · 功能开发中
        </span>
      </div>
    </PageShell>
  );
}
