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
  connectionProviderActionLabel,
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
          <div className="inline-flex items-center rounded-full border border-[#57479C]/20 bg-[#57479C]/[0.045] px-3 py-1 text-[12px] font-medium text-foreground shadow-sm">
            {summary}
          </div>
        }
      />
      <div className="mb-5 flex items-start gap-3 rounded-[8px] border border-[#57479C]/20 bg-[#57479C]/[0.045] px-4 py-3 text-[13px] text-foreground shadow-sm animate-fade-in motion-reduce:animate-none">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[#57479C] text-white shadow-sm">
          <Plug className="h-4 w-4" aria-hidden />
        </div>
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
        <div className="flex flex-col items-center gap-3 rounded-[8px] border border-border bg-card/40 px-6 py-12 text-center animate-fade-in motion-reduce:animate-none">
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
        <div className="flex flex-col items-center gap-3 rounded-[8px] border border-dashed border-border bg-card/40 px-6 py-12 text-center animate-fade-in motion-reduce:animate-none">
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
              <div className="mb-3 flex items-center justify-between gap-3 border-b border-border/70 pb-2">
                <h2 className="text-[11px] font-semibold uppercase tracking-wide text-foreground/70">
                  {group.label}
                </h2>
                <div className="rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[11px] text-muted-foreground">
                  {group.items.length} 个
                </div>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
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
  const tone = provider.oauthSupported
    ? provider.comingSoon
      ? 'preparing'
      : 'ready'
    : 'request';

  return (
    <article
      className={cn(
        'group flex min-h-[176px] flex-col items-start gap-2 rounded-[8px] border bg-card/80 p-4 text-left shadow-sm transition-[transform,border-color,box-shadow,background-color] duration-150 animate-fade-in motion-reduce:animate-none motion-reduce:transition-none motion-reduce:hover:translate-y-0',
        tone === 'ready'
          ? 'border-[#42C0EF]/35 hover:-translate-y-0.5 hover:border-[#42C0EF]/60 hover:bg-[#42C0EF]/[0.035] hover:shadow-md'
          : tone === 'preparing'
            ? 'border-[#57479C]/28 hover:-translate-y-0.5 hover:border-[#57479C]/55 hover:bg-[#57479C]/[0.035] hover:shadow-md'
            : 'border-border hover:-translate-y-0.5 hover:border-[#EA1F59]/35 hover:bg-[#EA1F59]/[0.025] hover:shadow-md',
      )}
    >
      <div className="flex w-full items-start justify-between gap-3">
        <div
          className={cn(
            'flex h-9 w-9 items-center justify-center rounded-md border transition-colors',
            tone === 'ready'
              ? 'border-[#42C0EF]/35 bg-[#42C0EF]/10 text-cyan-700 dark:text-cyan-200'
              : tone === 'preparing'
                ? 'border-[#57479C]/35 bg-[#57479C]/10 text-[#57479C] dark:text-purple-200'
                : 'border-border bg-background text-muted-foreground group-hover:border-[#EA1F59]/30 group-hover:text-[#EA1F59]',
          )}
        >
          <Icon className="h-4 w-4" aria-hidden />
        </div>
        <span
          className={cn(
            'rounded-full border px-2 py-0.5 text-[10px] font-medium',
            tone === 'ready'
              ? 'border-[#42C0EF]/45 bg-[#42C0EF]/10 text-cyan-700 dark:text-cyan-200'
              : tone === 'preparing'
                ? 'border-[#57479C]/35 bg-[#57479C]/10 text-[#57479C] dark:text-purple-200'
                : 'border-border bg-background text-muted-foreground',
          )}
        >
          {status}
        </span>
      </div>
      <div className="min-w-0 pr-2 text-sm font-medium leading-5 text-foreground">
        {provider.name}
      </div>
      <div className="line-clamp-2 text-xs leading-5 text-muted-foreground">
        {provider.description}
      </div>
      <Button
        asChild
        variant="outline"
        size="sm"
        className="mt-auto h-7 border-border bg-background text-[11px] transition-colors hover:border-[#EA1F59]/35 hover:bg-[#EA1F59]/[0.035] hover:text-foreground"
      >
        <a
          href={supportMailtoHref({
            subject: `申请接入 ${provider.name}`,
            body: connectionAccessMailBody(provider.name),
          })}
        >
          <Send className="h-3 w-3" />
          {connectionProviderActionLabel(provider)}
        </a>
      </Button>
    </article>
  );
}
