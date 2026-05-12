import {
  BarChart3,
  BookOpen,
  Calculator,
  ClipboardList,
  Compass,
  DollarSign,
  FileCheck,
  FileText,
  Globe,
  Headphones,
  Heart,
  Image,
  Kanban,
  Languages,
  Layers,
  type LucideIcon,
  Mail,
  MessageCircle,
  MessageSquare,
  Palette,
  PenTool,
  Presentation,
  Scale,
  Share2,
  Shield,
  ShoppingBag,
  Sparkles,
  Target,
  Truck,
  TrendingUp,
  UserCheck,
  UserPlus,
  Users,
  Video,
} from 'lucide-react';
import * as React from 'react';
import { useToast } from '@/components/ui/toast';
import { trpc } from '@/lib/trpc';
import { cn } from '@/lib/utils';
import { PageContainer, PageHeader } from '@/pages/PageShell';
import type { UiSkill } from '@/types/task';

type Category = UiSkill['category'];

// Phase 20b — full 9-category set + '其他' fallback. Anything not in
// this list is silently dropped from the page; all categories used in
// `agent/skills/skill-meta.ts` MUST appear here.
const CATEGORY_ORDER: readonly Category[] = [
  '运营',
  '内容',
  '商业分析',
  '产品',
  '法律',
  '人力',
  '行政',
  '财务',
  '翻译',
  '其他',
];

/**
 * Static lookup of the lucide icons referenced by the backend's
 * skill-meta. Keeping this client-side avoids dynamic imports and
 * keeps the card render synchronous. New skill icons must be added
 * to BOTH this map and `agent/skills/skill-meta.ts`.
 */
const ICONS: Record<string, LucideIcon> = {
  Heart,
  Video,
  MessageSquare,
  ShoppingBag,
  Scale,
  TrendingUp,
  BarChart3,
  Layers,
  Mail,
  BookOpen,
  // Phase 20b — icons for the 25 new specialist roles
  Users,
  Globe,
  Share2,
  PenTool,
  Shield,
  Palette,
  Image,
  Compass,
  MessageCircle,
  DollarSign,
  Truck,
  Kanban,
  FileCheck,
  UserPlus,
  UserCheck,
  Target,
  ClipboardList,
  FileText,
  Presentation,
  Headphones,
  Calculator,
  Languages,
};

/**
 * Phase 16 — 专家技能 selection page. Lists every skill in the
 * orchestrator's catalogue grouped by category, with each card
 * acting as a one-tap toggle. Persists via skills.toggle which
 * writes to users.selected_roles (the same storage Pro-tier role
 * gating already uses).
 */
export function SkillsPage(): JSX.Element {
  const toast = useToast();
  const [skills, setSkills] = React.useState<UiSkill[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [pendingId, setPendingId] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const list = await trpc.skills.list.query();
        if (!cancelled) setSkills(list as UiSkill[]);
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

  const grouped = React.useMemo(() => {
    const m = new Map<Category, UiSkill[]>();
    for (const s of skills) {
      const arr = m.get(s.category) ?? [];
      arr.push(s);
      m.set(s.category, arr);
    }
    return CATEGORY_ORDER.map((c) => ({ category: c, items: m.get(c) ?? [] })).filter(
      (g) => g.items.length > 0,
    );
  }, [skills]);

  async function onToggle(skill: UiSkill): Promise<void> {
    if (pendingId) return;
    setPendingId(skill.id);
    // Optimistic flip.
    const next = !skill.enabled;
    setSkills((prev) => prev.map((s) => (s.id === skill.id ? { ...s, enabled: next } : s)));
    try {
      const res = await trpc.skills.toggle.mutate({ skillId: skill.id });
      // Server is the source of truth — sync if it returned a different value.
      if (res.enabled !== next) {
        setSkills((prev) =>
          prev.map((s) => (s.id === skill.id ? { ...s, enabled: res.enabled } : s)),
        );
      }
      toast.show(res.enabled ? `已启用「${skill.name}」` : `已停用「${skill.name}」`);
    } catch (err) {
      // Revert on failure.
      setSkills((prev) =>
        prev.map((s) => (s.id === skill.id ? { ...s, enabled: skill.enabled } : s)),
      );
      toast.show(
        err instanceof Error ? `切换失败：${err.message}` : '切换失败',
        'error',
      );
    } finally {
      setPendingId(null);
    }
  }

  return (
    <PageContainer width="wide">
      <PageHeader
        title="专家技能"
        description="选择你常用的技能，HOLA DAY 会自动识别并调用专业工作流"
      />
      {loading ? (
        <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
          加载中…
        </div>
      ) : grouped.length === 0 ? (
        <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
          暂无可用技能
        </div>
      ) : (
        <div className="space-y-8">
          {grouped.map(({ category, items }) => (
            <section key={category}>
              <h2 className="mb-3 text-xs font-semibold tracking-wider text-muted-foreground">
                {category}
              </h2>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {items.map((s) => (
                  <SkillCard
                    key={s.id}
                    skill={s}
                    pending={pendingId === s.id}
                    onToggle={() => void onToggle(s)}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </PageContainer>
  );
}

function SkillCard({
  skill,
  pending,
  onToggle,
}: {
  skill: UiSkill;
  pending: boolean;
  onToggle: () => void;
}): JSX.Element {
  const Icon = ICONS[skill.icon] ?? Sparkles;
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={pending}
      aria-pressed={skill.enabled}
      className={cn(
        'group relative flex flex-col items-start gap-2 rounded-xl border p-4 text-left transition-all',
        skill.enabled
          ? 'border-primary/60 bg-primary/5 shadow-sm dark:border-primary/40 dark:bg-primary/10'
          : 'border-border bg-card hover:border-foreground/20 hover:bg-foreground/[0.02]',
        pending && 'opacity-60',
      )}
    >
      <div
        className={cn(
          'flex h-9 w-9 items-center justify-center rounded-lg transition-colors',
          skill.enabled
            ? 'bg-primary text-primary-foreground'
            : 'bg-muted text-muted-foreground group-hover:bg-foreground/10',
        )}
      >
        <Icon className="h-4 w-4" aria-hidden />
      </div>
      <div className="text-sm font-medium text-foreground">{skill.name}</div>
      <div className="line-clamp-2 text-xs text-muted-foreground">{skill.description}</div>
      <span
        className={cn(
          'absolute right-3 top-3 rounded-md px-2 py-0.5 text-[10px] font-medium',
          skill.enabled
            ? 'bg-primary text-primary-foreground'
            : 'border border-border text-muted-foreground',
        )}
      >
        {skill.enabled ? '已启用' : '启用'}
      </span>
    </button>
  );
}
