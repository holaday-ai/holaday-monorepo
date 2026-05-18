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
  Table,
  Twitter,
} from 'lucide-react';
import * as React from 'react';
import { useToast } from '@/components/ui/toast';
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
 * P2.6 — connector roadmap page. Demoted from a top-level nav entry
 * to a roadmap surface: cards are non-interactive, no toast theatre,
 * the title says what it is ("即将支持的连接器"). Once OAuth and the
 * actual MCP wiring land, this page graduates to interactive again
 * and the sidebar entry comes back. Until then this is the honest
 * "here is what's on the way" view.
 *
 * Search/filter chrome removed alongside the click target — there's
 * nothing to act on yet, so an idle filter is just chrome.
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
        description="把你常用的工具接入 HOLA DAY，让 AI 直接操作"
      />
      {/* BOSS feedback — every card was greyed-out with "即将上线"
          and no timeline. A single banner up top sets expectations
          so users see WHY everything is gated and roughly WHEN it
          opens up. */}
      <div className="mb-5 flex items-start gap-2.5 rounded-md border border-primary/30 bg-primary/5 px-3.5 py-2.5 text-[13px] text-foreground">
        <Plug className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
        <div className="min-w-0">
          <div className="font-medium">连接器功能正在开发中</div>
          <div className="mt-0.5 text-[12px] text-muted-foreground">
            预计 6 月上线。下方为规划中的服务，先睹为快。
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
                <span className="mt-auto rounded-md border border-border px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                  即将上线
                </span>
              </div>
            );
          })}
        </div>
      )}
    </PageContainer>
  );
}
