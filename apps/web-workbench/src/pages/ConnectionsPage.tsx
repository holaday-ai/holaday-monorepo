import {
  AlertCircle,
  BookOpen,
  Box,
  Calendar,
  Github,
  HardDrive,
  Kanban,
  type LucideIcon,
  Mail,
  MessageSquare,
  Plug,
  Send,
  Table,
  Twitter,
} from 'lucide-react';
import * as React from 'react';
import { useToast } from '@/components/ui/toast';
import { Button } from '@/components/ui/button';
import {
  connectionAccessMailBody,
  connectionPageSummary,
  connectionProviderStatus,
  groupConnectionProviders,
  normalizeConnectionProviders,
  type ConnectionProviderView,
} from '@/lib/connection-page-state';
import { supportMailtoHref } from '@/lib/support-links';
import { trpc } from '@/lib/trpc';
import { PageContainer, PageHeader } from '@/pages/PageShell';
import { cn } from '@/lib/utils';

const ICONS: Record<string, LucideIcon> = {
  Calendar,
  BookOpen,
  Table,
  Mail,
  MessageSquare,
  HardDrive,
  Box,
  Github,
  Kanban,
  Twitter,
};

/**
 * P2.6 — connector planning page. Cards remain non-interactive until
 * OAuth and MCP wiring land, but every provider now has a concrete
 * "request access" action instead of a dead coming-soon badge.
 */
export function ConnectionsPage(): JSX.Element {
  const toast = useToast();
  const mountedRef = React.useRef(false);
  const [providers, setProviders] = React.useState<ConnectionProviderView[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState<string | null>(null);

  const refresh = React.useCallback(
    async (options: { silent?: boolean } = {}) => {
      setLoading(true);
      setLoadError(null);
      try {
        const list = normalizeConnectionProviders(await trpc.connections.list.query());
        if (!mountedRef.current) return;
        setProviders(list);
      } catch (err) {
        if (!mountedRef.current) return;
        const message = err instanceof Error ? err.message : '请稍后重试';
        setLoadError(message);
        if (!options.silent) {
          toast.show(
            err instanceof Error ? `连接器加载失败：${err.message}` : '连接器加载失败',
            'error',
          );
        }
      } finally {
        if (mountedRef.current) setLoading(false);
      }
    },
    [toast],
  );

  React.useEffect(() => {
    mountedRef.current = true;
    void (async () => {
      await refresh({ silent: true });
    })();
    return () => {
      mountedRef.current = false;
    };
  }, [refresh]);

  const providerGroups = React.useMemo(
    () => groupConnectionProviders(providers),
    [providers],
  );
  const summary = connectionPageSummary({
    count: providers.length,
    categoryCount: providerGroups.length,
    loading,
    error: loadError,
  });

  return (
    <PageContainer width="wide">
      <PageHeader
        title="连接器"
        description="申请接入常用工具，让 AI 在授权范围内完成操作"
        action={
          <div className="inline-flex items-center rounded-full border border-border bg-card px-3 py-1 text-[12px] font-medium text-foreground">
            {summary}
          </div>
        }
      />
      <div className="mb-5 flex items-start gap-2.5 rounded-md border border-primary/30 bg-primary/5 px-3.5 py-2.5 text-[13px] text-foreground">
        <Plug className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
        <div className="min-w-0">
          <div className="font-medium">连接器按需开通</div>
          <div className="mt-0.5 text-[12px] text-muted-foreground">
            选择需要的服务，我们会优先处理高频请求并通知你开通进度。
          </div>
        </div>
      </div>
      {loading ? (
        <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
          加载中…
        </div>
      ) : loadError ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-border bg-card/40 px-6 py-12 text-center">
          <AlertCircle className="h-8 w-8 text-primary" aria-hidden />
          <div className="text-sm font-medium text-foreground/80">连接器加载失败</div>
          <div className="max-w-md text-xs leading-5 text-muted-foreground">
            {loadError}
          </div>
          <div className="mt-1 flex flex-wrap justify-center gap-2">
            <Button type="button" size="sm" onClick={() => void refresh()}>
              重试
            </Button>
            <Button asChild variant="outline" size="sm">
              <a
                href={supportMailtoHref({
                  subject: '连接器列表加载失败',
                  body: '连接器列表加载失败，请协助排查。\n\n注册邮箱：\n出现时间：',
                })}
              >
                联系支持
              </a>
            </Button>
          </div>
        </div>
      ) : providers.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border bg-card/40 px-6 py-12 text-center">
          <Plug className="h-8 w-8 text-muted-foreground/40" />
          <div className="text-sm font-medium text-foreground/80">暂无规划连接器</div>
          <div className="max-w-md text-xs leading-5 text-muted-foreground">
            告诉我们你最需要接入的工具，我们会优先整理高频需求。
          </div>
          <Button asChild variant="outline" size="sm" className="mt-1">
            <a
              href={supportMailtoHref({
                subject: '申请新增连接器',
                body: '我想申请新增连接器。\n\n工具名称：\n注册邮箱：\n使用场景：',
              })}
            >
              <Send className="h-3 w-3" />
              申请新增
            </a>
          </Button>
        </div>
      ) : (
        <div className="space-y-8">
          {providerGroups.map((group) => (
            <section key={group.category}>
              <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className="text-xs font-semibold tracking-wider text-muted-foreground">
                  {group.label}
                </h2>
                <div className="text-[11px] text-muted-foreground">
                  {group.items.length} 个
                </div>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {group.items.map((provider) => (
                  <ConnectionProviderCard key={provider.id} provider={provider} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </PageContainer>
  );
}

function ConnectionProviderCard({ provider }: { provider: ConnectionProviderView }): JSX.Element {
  const Icon = ICONS[provider.icon] ?? Plug;
  const status = connectionProviderStatus(provider);

  return (
    <article className="flex min-h-44 flex-col items-start gap-2 rounded-xl border border-border bg-card/60 p-4 text-left transition-colors hover:border-foreground/20 hover:bg-foreground/[0.02]">
      <div className="flex w-full items-start justify-between gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <Icon className="h-4 w-4" aria-hidden />
        </div>
        <span
          className={cn(
            'rounded-md border px-2 py-0.5 text-[10px] font-medium',
            status === '可连接'
              ? 'border-cyan-300/60 bg-cyan-50 text-cyan-800 dark:border-cyan-500/30 dark:bg-cyan-500/10 dark:text-cyan-200'
              : 'border-border bg-background text-muted-foreground',
          )}
        >
          {status}
        </span>
      </div>
      <div className="text-sm font-medium text-foreground/80">{provider.name}</div>
      <div className="line-clamp-2 text-xs leading-5 text-muted-foreground">
        {provider.description}
      </div>
      <Button asChild variant="outline" size="sm" className="mt-auto h-7 text-[11px]">
        <a
          href={supportMailtoHref({
            subject: `申请接入 ${provider.name}`,
            body: connectionAccessMailBody(provider.name),
          })}
        >
          <Send className="h-3 w-3" />
          申请接入
        </a>
      </Button>
    </article>
  );
}
