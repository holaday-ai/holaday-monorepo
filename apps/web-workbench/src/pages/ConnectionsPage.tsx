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
import { PageShell } from '@/pages/PageShell';

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
    <PageShell
      title="即将支持的连接器"
      subtitle="OAuth 与 MCP 集成正在路上 — 这里展示了规划中的服务"
      width="5xl"
    >
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
    </PageShell>
  );
}
