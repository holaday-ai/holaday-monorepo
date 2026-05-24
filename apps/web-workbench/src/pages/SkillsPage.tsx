import {
  AlertCircle,
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
import { useOutletContext } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import {
  groupSkillsByCategory,
  skillCardBadge,
  skillLimitMessage,
  skillPageSummary,
} from '@/lib/skills-page-state';
import { supportMailtoHref } from '@/lib/support-links';
import { trpc } from '@/lib/trpc';
import { cn } from '@/lib/utils';
import { PageContainer, PageHeader } from '@/pages/PageShell';
import type { UiSkill } from '@/types/task';

/** Per-plan skill caps. Mirrors PLAN_CATALOGUE.rolesAllowed in shared-types. */
const SKILL_CAPS: Record<string, number> = {
  free: 0,
  basic: 5,
  pro: 33,
};

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
  const mountedRef = React.useRef(false);
  // BOSS feedback — surface plan-bound cap. AppShell exposes `me`
  // via OutletContext; we only need .plan here. Default to 'free'
  // when the shell hasn't bootstrapped yet (e.g. cold deep link).
  const outletCtx = useOutletContext<
    { me?: { plan?: string } | null } | null
  >();
  const planId = (outletCtx?.me?.plan ?? 'free') as keyof typeof SKILL_CAPS;
  const cap = SKILL_CAPS[planId] ?? 0;
  const [skills, setSkills] = React.useState<UiSkill[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [pendingId, setPendingId] = React.useState<string | null>(null);
  const enabledCount = React.useMemo(
    () => skills.reduce((n, s) => (s.enabled ? n + 1 : n), 0),
    [skills],
  );
  const atLimit = cap > 0 && enabledCount >= cap;

  const refresh = React.useCallback(
    async (options: { silent?: boolean } = {}) => {
      setLoading(true);
      setLoadError(null);
      try {
        const list = await trpc.skills.list.query();
        if (!mountedRef.current) return;
        setSkills(list as UiSkill[]);
      } catch (err) {
        if (!mountedRef.current) return;
        const message = err instanceof Error ? err.message : '请稍后重试';
        setLoadError(message);
        if (!options.silent) {
          toast.show(
            err instanceof Error ? `技能加载失败：${err.message}` : '技能加载失败',
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

  const grouped = React.useMemo(() => groupSkillsByCategory(skills), [skills]);
  const summary = skillPageSummary({
    loading,
    error: loadError,
    totalCount: skills.length,
    enabledCount,
    cap,
    planId,
  });

  async function onToggle(skill: UiSkill): Promise<void> {
    if (pendingId) return;
    // BOSS feedback — UI-side cap. Server doesn't enforce a hard
    // limit today; this is just a guard against accidental over-
    // enablement and a clear upgrade prompt for Basic users.
    if (!skill.enabled && cap > 0 && enabledCount >= cap) {
      toast.show(skillLimitMessage({ cap, planId }), 'error');
      return;
    }
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
        action={
          <div
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[12px] font-medium',
              atLimit && !loadError && !loading
                ? 'border-amber-300/60 bg-amber-50 text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/15 dark:text-amber-200'
                : 'border-border bg-card text-foreground',
            )}
          >
            {summary}
          </div>
        }
      />
      {/* Upgrade nudge when Basic user hits the cap. Inline banner
          so the action sits adjacent to the skill grid the user is
          interacting with. */}
      {atLimit && planId !== 'pro' && (
        <div className="mb-5 rounded-md border border-amber-300/60 bg-amber-50/60 px-3.5 py-2.5 text-[13px] text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
          <div className="font-medium">已达到 {cap} 个技能上限</div>
          <div className="mt-0.5 text-[12px] opacity-80">
            升级到专业版可使用全部 33 个技能。
          </div>
        </div>
      )}
      {loading ? (
        <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
          加载中…
        </div>
      ) : loadError ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-border bg-card/40 px-6 py-12 text-center">
          <AlertCircle className="h-8 w-8 text-primary" aria-hidden />
          <div className="text-sm font-medium text-foreground/80">技能加载失败</div>
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
                  subject: '专家技能列表加载失败',
                  body: '专家技能列表加载失败，请协助排查。\n\n注册邮箱：\n出现时间：',
                })}
              >
                联系支持
              </a>
            </Button>
          </div>
        </div>
      ) : grouped.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border bg-card/40 px-6 py-12 text-center">
          <Sparkles className="h-8 w-8 text-muted-foreground/40" />
          <div className="text-sm font-medium text-foreground/80">暂无可用技能</div>
          <div className="max-w-md text-xs leading-5 text-muted-foreground">
            当前技能目录为空。你可以联系支持，让我们确认套餐和技能配置。
          </div>
          <Button asChild variant="outline" size="sm" className="mt-1">
            <a
              href={supportMailtoHref({
                subject: '专家技能目录为空',
                body: '专家技能目录为空，请协助确认。\n\n注册邮箱：',
              })}
            >
              联系支持
            </a>
          </Button>
        </div>
      ) : (
        <div className="space-y-8">
          {grouped.map(({ category, items }) => (
            <section key={category}>
              <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className="text-xs font-semibold tracking-wider text-muted-foreground">
                  {category}
                </h2>
                <div className="text-[11px] text-muted-foreground">
                  {items.length} 个
                </div>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {items.map((s) => (
                  <SkillCard
                    key={s.id}
                    skill={s}
                    pending={pendingId === s.id}
                    blocked={pendingId !== null && pendingId !== s.id}
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
  blocked,
  onToggle,
}: {
  skill: UiSkill;
  pending: boolean;
  blocked: boolean;
  onToggle: () => void;
}): JSX.Element {
  const Icon = ICONS[skill.icon] ?? Sparkles;
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={pending || blocked}
      aria-pressed={skill.enabled}
      aria-busy={pending}
      className={cn(
        'group relative flex flex-col items-start gap-2 rounded-xl border p-4 text-left transition-all',
        skill.enabled
          ? 'border-primary/60 bg-primary/5 shadow-sm dark:border-primary/40 dark:bg-primary/10'
          : 'border-border bg-card hover:border-foreground/20 hover:bg-foreground/[0.02]',
        (pending || blocked) && 'opacity-60',
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
          pending
            ? 'border border-border bg-background text-muted-foreground'
            : skill.enabled
              ? 'bg-primary text-primary-foreground'
              : 'border border-border text-muted-foreground',
        )}
      >
        {skillCardBadge({ enabled: skill.enabled, pending })}
      </span>
    </button>
  );
}
