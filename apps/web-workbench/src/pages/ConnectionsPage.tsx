import {
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
import { trpc } from '@/lib/trpc';
import { PageContainer, PageHeader } from '@/pages/PageShell';

type Category = 'productivity' | 'communication' | 'storage' | 'development' | 'social';

interface UiProvider {
  id: string;
  name: string;
  icon: string;
  description: string;
  category: Category;
  oauthSupported: boolean;
  comingSoon: boolean;
}

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
  const [providers, setProviders] = React.useState<UiProvider[]>([]);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const list = await trpc.connections.list.query();
        if (!cancelled) setProviders(list as UiProvider[]);
      } catch (err) {
        if (!cancelled) {
          toast.show(
            err instanceof Error ? `加载失败：${err.message}` : '加载失败',
            'error',
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [toast]);

  return (
    <PageContainer width="wide">
      <PageHeader
        title="连接器"
        description="申请接入常用工具，让 AI 在授权范围内完成操作"
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
      ) : providers.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border bg-card/40 px-6 py-12 text-center">
          <Plug className="h-8 w-8 text-muted-foreground/40" />
          <div className="text-sm font-medium text-foreground/80">暂无规划连接器</div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {providers.map((p) => {
            const Icon = ICONS[p.icon] ?? Plug;
            return (
              <div
                key={p.id}
                className="flex cursor-default flex-col items-start gap-2 rounded-xl border border-border bg-card/60 p-4 text-left"
                aria-disabled
              >
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                  <Icon className="h-4 w-4" />
                </div>
                <div className="text-sm font-medium text-foreground/80">{p.name}</div>
                <div className="line-clamp-2 text-xs text-muted-foreground">
                  {p.description}
                </div>
                <Button asChild variant="outline" size="sm" className="mt-auto h-7 text-[11px]">
                  <a href={`mailto:support@holaday.ai?subject=申请接入 ${encodeURIComponent(p.name)}`}>
                    <Send className="h-3 w-3" />
                    申请接入
                  </a>
                </Button>
              </div>
            );
          })}
        </div>
      )}
    </PageContainer>
  );
}
