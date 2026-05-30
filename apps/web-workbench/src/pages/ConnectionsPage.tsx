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
import { pageActionError, pageErrorMessage } from '@/lib/page-error-copy';
import { supportMailtoHref } from '@/lib/support-links';
import { trpc } from '@/lib/trpc';
import { PageContainer, PageHeader, PageLoadingPanel } from '@/pages/PageShell';
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
  const requestIdRef = React.useRef(0);
  const [providers, setProviders] = React.useState<ConnectionProviderView[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState<string | null>(null);

  const refresh = React.useCallback(
    async (options: { silent?: boolean } = {}) => {
      const requestId = ++requestIdRef.current;
      setLoading(true);
      setLoadError(null);
      try {
        const list = normalizeConnectionProviders(await trpc.connections.list.query());
        if (!mountedRef.current || requestId !== requestIdRef.current) return;
        setProviders(list);
      } catch (err) {
        if (!mountedRef.current || requestId !== requestIdRef.current) return;
        const message = pageErrorMessage(err);
        setLoadError(message);
        if (!options.silent) {
          toast.show(pageActionError('连接器加载失败', err), 'error');
        }
      } finally {
        if (mountedRef.current && requestId === requestIdRef.current) setLoading(false);
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
      requestIdRef.current += 1;
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
          <div className="inline-flex items-center rounded-full border border-[#DCDDDD] bg-white px-3 py-1 text-[12px] font-medium text-[#595757] shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
            {summary}
          </div>
        }
      />
      <div className="mb-5 flex items-start gap-3 rounded-[8px] border border-[#DCDDDD] border-l-[#57479C] bg-white px-4 py-3 text-[13px] text-foreground shadow-[0_1px_2px_rgba(15,23,42,0.03)] animate-fade-in motion-reduce:animate-none [border-left-width:3px]">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-[#DCDDDD] bg-white text-[#57479C]">
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
        <PageLoadingPanel label="连接器加载中" description="正在同步可申请的服务" />
      ) : loadError ? (
        <div className="flex flex-col items-center gap-3 rounded-[8px] border border-[#DCDDDD] bg-white px-6 py-12 text-center animate-fade-in motion-reduce:animate-none">
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
        <div className="flex flex-col items-center gap-3 rounded-[8px] border border-dashed border-[#DCDDDD] bg-white px-6 py-12 text-center animate-fade-in motion-reduce:animate-none">
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
              <div className="mb-3 flex items-center justify-between gap-3 border-b border-[#EFEFEF] pb-2">
                <h2 className="text-[11px] font-semibold uppercase tracking-wide text-[#595757]">
                  {group.label}
                </h2>
                <div className="rounded-full border border-[#DCDDDD] bg-white px-2 py-0.5 text-[11px] text-[#595757]">
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
        'group flex min-h-[176px] flex-col items-start gap-2 rounded-[8px] border bg-white p-4 text-left shadow-[0_1px_2px_rgba(15,23,42,0.03)] transition-[transform,border-color,box-shadow] duration-150 animate-fade-in motion-reduce:animate-none motion-reduce:transition-none motion-reduce:hover:translate-y-0',
        tone === 'ready'
          ? 'border-[#DCDDDD] hover:-translate-y-px hover:border-[#ADADAD] hover:shadow-[0_5px_16px_rgba(15,23,42,0.055)]'
          : tone === 'preparing'
            ? 'border-[#DCDDDD] hover:-translate-y-px hover:border-[#ADADAD] hover:shadow-[0_5px_16px_rgba(15,23,42,0.055)]'
            : 'border-[#DCDDDD] hover:-translate-y-px hover:border-[#ADADAD] hover:shadow-[0_5px_16px_rgba(15,23,42,0.055)]',
      )}
    >
      <div className="flex w-full items-start justify-between gap-3">
        <div
          className={cn(
            'flex h-9 w-9 items-center justify-center rounded-md border bg-white transition-colors',
            tone === 'ready'
              ? 'border-[#42C0EF]/45 text-[#217EA0]'
              : tone === 'preparing'
                ? 'border-[#57479C]/35 text-[#57479C]'
                : 'border-[#DCDDDD] text-[#595757] group-hover:border-[#ADADAD]',
          )}
        >
          <Icon className="h-4 w-4" aria-hidden />
        </div>
        <span
          className={cn(
            'rounded-full border px-2 py-0.5 text-[10px] font-medium',
            tone === 'ready'
              ? 'border-[#42C0EF]/45 bg-white text-[#217EA0]'
              : tone === 'preparing'
                ? 'border-[#57479C]/35 bg-white text-[#57479C]'
                : 'border-[#DCDDDD] bg-white text-[#595757]',
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
        className="mt-auto h-7 border-[#DCDDDD] bg-white text-[11px] text-[#595757] transition-colors hover:border-[#ADADAD] hover:bg-white hover:text-[#EA1F59]"
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
