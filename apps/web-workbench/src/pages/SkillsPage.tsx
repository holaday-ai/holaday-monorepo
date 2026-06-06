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
import { useNavigate, useOutletContext } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import {
  groupSkillsByCategory,
  normalizeSkillRows,
  normalizeSkillToggleResponse,
  skillCardBadge,
  skillCardUsageHint,
  skillLimitBannerCopy,
  skillLimitMessage,
  skillLoadErrorCopy,
  skillPageSummary,
  skillTaskDraft,
} from '@/lib/skills-page-state';
import { pageActionError, pageErrorMessage } from '@/lib/page-error-copy';
import { supportMailtoHref } from '@/lib/support-links';
import { trpc } from '@/lib/trpc';
import { cn } from '@/lib/utils';
import { PageContainer, PageHeader, PageLoadingPanel } from '@/pages/PageShell';
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
  const navigate = useNavigate();
  const mountedRef = React.useRef(false);
  const requestIdRef = React.useRef(0);
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
      const requestId = ++requestIdRef.current;
      setLoading(true);
      setLoadError(null);
      try {
        const list = normalizeSkillRows(await trpc.skills.list.query());
        if (!mountedRef.current || requestId !== requestIdRef.current) return;
        setSkills(list);
      } catch (err) {
        if (!mountedRef.current || requestId !== requestIdRef.current) return;
        const message = pageErrorMessage(err);
        setLoadError(message);
        if (!options.silent) {
          toast.show('技能暂时无法加载', 'error');
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

  const grouped = React.useMemo(() => groupSkillsByCategory(skills), [skills]);
  const summary = skillPageSummary({
    loading,
    error: loadError,
    totalCount: skills.length,
    enabledCount,
    cap,
    planId,
  });
  const loadErrorCopy = skillLoadErrorCopy(loadError);
  const limitBanner = atLimit
    ? skillLimitBannerCopy({ cap, enabledCount, planId })
    : null;

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
      const res = normalizeSkillToggleResponse(
        await trpc.skills.toggle.mutate({ skillId: skill.id }),
        next,
      );
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
        pageActionError('切换失败', err),
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
              'inline-flex items-center gap-1.5 rounded-full border bg-white px-3 py-1 text-[12px] font-medium text-[#595757] shadow-[0_1px_2px_rgba(15,23,42,0.03)]',
              atLimit && !loadError && !loading
                ? 'border-[#FFC910]/65'
                : 'border-[#DCDDDD]',
            )}
          >
            {summary}
          </div>
        }
      />
      {!loading && !loadError && grouped.length > 0 && (
        <div className="mb-5 flex flex-col gap-3 rounded-[8px] border border-[#DCDDDD] bg-white px-4 py-3 text-[13px] text-foreground shadow-[0_1px_2px_rgba(15,23,42,0.03)] sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="font-medium">如何使用专家技能</div>
            <div className="mt-0.5 text-[12px] leading-5 text-muted-foreground">
              启用后，新任务会自动匹配相关专家；也可以在技能卡上点“用此专家”直接开始。
            </div>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="shrink-0"
            onClick={() => navigate('/app')}
          >
            开始新任务
          </Button>
        </div>
      )}
      {/* Upgrade nudge when Basic user hits the cap. Inline banner
          so the action sits adjacent to the skill grid the user is
          interacting with. */}
      {limitBanner && planId !== 'pro' && (
        <div className="mb-5 flex flex-col gap-3 rounded-[8px] border border-[#DCDDDD] border-l-[#FFC910] bg-white px-4 py-3 text-[13px] text-foreground shadow-[0_1px_2px_rgba(15,23,42,0.03)] [border-left-width:3px] sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="font-medium">{limitBanner.title}</div>
            <div className="mt-0.5 text-[12px] text-muted-foreground">
              {limitBanner.body}
            </div>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="shrink-0"
            onClick={() => navigate('/plan')}
          >
            查看套餐
          </Button>
        </div>
      )}
      {loading ? (
        <PageLoadingPanel label="技能加载中" description="正在同步专家技能目录" />
      ) : loadError ? (
        <div className="flex flex-col items-center gap-3 rounded-[8px] border border-[#DCDDDD] bg-white px-6 py-12 text-center">
          <AlertCircle className="h-8 w-8 text-primary" aria-hidden />
          <div className="text-sm font-medium text-foreground/80">{loadErrorCopy.title}</div>
          <div className="max-w-md text-xs leading-5 text-muted-foreground">
            {loadErrorCopy.body}
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
        <div className="flex flex-col items-center gap-3 rounded-[8px] border border-dashed border-[#DCDDDD] bg-white px-6 py-12 text-center">
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
              <div className="mb-3 flex items-center justify-between gap-3 border-b border-[#EFEFEF] pb-2">
                <h2 className="text-[11px] font-semibold uppercase tracking-wide text-[#595757]">
                  {category}
                </h2>
                <div className="rounded-full border border-[#DCDDDD] bg-white px-2 py-0.5 text-[11px] text-[#595757]">
                  {items.length} 个
                </div>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {items.map((s) => (
                  <SkillCard
                    key={s.id}
                    skill={s}
                    pending={pendingId === s.id}
                    blocked={pendingId !== null && pendingId !== s.id}
                    onToggle={() => void onToggle(s)}
                    onUse={() => {
                      navigate('/', {
                        state: {
                          newTask: true,
                          skillTaskDraft: skillTaskDraft(s),
                        },
                      });
                    }}
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
  onUse,
}: {
  skill: UiSkill;
  pending: boolean;
  blocked: boolean;
  onToggle: () => void;
  onUse: () => void;
}): JSX.Element {
  const Icon = ICONS[skill.icon] ?? Sparkles;
  return (
    <article
      className={cn(
        'group relative flex min-h-[124px] flex-col items-start gap-2 rounded-[8px] border bg-white p-4 text-left shadow-[0_1px_2px_rgba(15,23,42,0.03)] transition-[border-color,box-shadow] duration-150',
        skill.enabled
          ? 'border-[#DCDDDD]'
          : 'border-[#DCDDDD] hover:border-[#ADADAD] hover:shadow-[0_4px_14px_rgba(15,23,42,0.05)]',
        (pending || blocked) && 'opacity-60',
      )}
    >
      <div
        className={cn(
          'flex h-9 w-9 items-center justify-center rounded-md border bg-white transition-colors',
          skill.enabled
            ? 'border-[#EA1F59]/30 text-[#EA1F59]'
            : 'border-[#DCDDDD] text-[#595757] group-hover:border-[#ADADAD]',
        )}
      >
        <Icon className="h-4 w-4" aria-hidden />
      </div>
      <div className="min-w-0 pr-14 text-sm font-medium leading-5 text-foreground">
        {skill.name}
      </div>
      <div className="line-clamp-2 text-xs leading-5 text-muted-foreground">
        {skill.description}
      </div>
      <div className="mt-auto flex w-full items-center justify-between gap-2 border-t border-[#EFEFEF] pt-2">
        <div className="min-w-0 text-[11px] leading-4 text-muted-foreground">
          {skillCardUsageHint({ enabled: skill.enabled, pending })}
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 shrink-0 rounded-[7px] px-2 text-[11px]"
          disabled={!skill.enabled || pending || blocked}
          title={skill.enabled ? `用${skill.name}创建任务` : '启用后可用此专家创建任务'}
          onClick={onUse}
        >
          用此专家
        </Button>
      </div>
      <button
        type="button"
        onClick={onToggle}
        disabled={pending || blocked}
        aria-pressed={skill.enabled}
        aria-busy={pending}
        aria-label={`${skill.enabled ? '停用' : '启用'}${skill.name}`}
        title={`${skill.enabled ? '停用' : '启用'}${skill.name}`}
        className={cn(
          'absolute right-3 top-3 rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#57479C]/20',
          pending
            ? 'border border-[#42C0EF]/45 bg-white text-[#217EA0]'
            : skill.enabled
              ? 'border border-[#EA1F59]/35 bg-white text-[#EA1F59]'
              : 'border border-[#DCDDDD] bg-white text-[#595757]',
        )}
      >
        {skillCardBadge({ enabled: skill.enabled, pending })}
      </button>
    </article>
  );
}
