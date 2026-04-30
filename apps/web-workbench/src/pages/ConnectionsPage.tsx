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
  Search,
  Table,
  Twitter,
} from 'lucide-react';
import * as React from 'react';
import { useToast } from '@/components/ui/toast';
import { trpc } from '@/lib/trpc';
import { cn } from '@/lib/utils';
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

const CATEGORY_LABELS: Record<Category | 'all', string> = {
  all: '全部',
  productivity: '效率',
  communication: '沟通',
  storage: '存储',
  development: '开发',
  social: '社交',
};

const CATEGORIES: ReadonlyArray<Category | 'all'> = [
  'all',
  'productivity',
  'communication',
  'storage',
  'development',
  'social',
];

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
 * Phase 16b — MCP connections page. Display-only: all cards show
 * "即将上线" + click toasts a "stay tuned" message. Real OAuth
 * lands in a future batch.
 */
export function ConnectionsPage(): JSX.Element {
  const toast = useToast();
  const [providers, setProviders] = React.useState<UiProvider[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [category, setCategory] = React.useState<Category | 'all'>('all');
  const [q, setQ] = React.useState('');

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

  const filtered = React.useMemo(() => {
    return providers.filter((p) => {
      if (category !== 'all' && p.category !== category) return false;
      if (q.trim() && !p.name.toLowerCase().includes(q.trim().toLowerCase())) {
        return false;
      }
      return true;
    });
  }, [providers, category, q]);

  return (
    <PageShell
      title="连接器"
      subtitle="连接外部服务，增强 HOLA DAY 能力"
      width="5xl"
    >
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-1">
          {CATEGORIES.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCategory(c)}
              className={cn(
                'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                category === c
                  ? 'bg-foreground text-background'
                  : 'text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground',
              )}
            >
              {CATEGORY_LABELS[c]}
            </button>
          ))}
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜索连接器…"
            className="w-full rounded-md border border-input bg-background py-1.5 pl-8 pr-3 text-sm focus-visible:border-foreground/30 focus-visible:outline-none sm:w-56"
          />
        </div>
      </div>

      {loading ? (
        <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
          加载中…
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border bg-card/40 px-6 py-12 text-center">
          <Plug className="h-8 w-8 text-muted-foreground/40" />
          <div className="text-sm font-medium text-foreground/80">没有找到连接器</div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((p) => {
            const Icon = ICONS[p.icon] ?? Plug;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => toast.show(`「${p.name}」即将上线，敬请期待`)}
                className="group flex flex-col items-start gap-2 rounded-xl border border-border bg-card p-4 text-left transition-colors hover:border-foreground/20 hover:bg-foreground/[0.02]"
              >
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted text-muted-foreground group-hover:bg-foreground/10">
                  <Icon className="h-4 w-4" />
                </div>
                <div className="text-sm font-medium text-foreground">{p.name}</div>
                <div className="line-clamp-2 text-xs text-muted-foreground">
                  {p.description}
                </div>
                <span className="mt-auto rounded-md border border-border px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                  即将上线
                </span>
              </button>
            );
          })}
        </div>
      )}
    </PageShell>
  );
}
