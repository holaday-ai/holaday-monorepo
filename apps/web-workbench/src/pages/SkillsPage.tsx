import { AlertCircle, Check, Loader2, LockKeyhole, Plus, Search, Sparkles } from 'lucide-react';
import * as React from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { SkillLogo } from '@/components/SkillLogo';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import {
  groupSkillsByCategory,
  normalizeSkillRows,
  normalizeSkillToggleResponse,
  skillCardBadge,
  skillLimitBannerCopy,
  skillLimitMessage,
  skillLoadErrorCopy,
  skillPageSummary,
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
 * Skills selection page. Lists every skill in the
 * orchestrator's catalogue grouped by category, with each card
 * acting as a one-tap toggle. Persists via skills.toggle which
 * writes to users.selected_skills.
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
  const [query, setQuery] = React.useState('');
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [pendingId, setPendingId] = React.useState<string | null>(null);
  const enabledCount = React.useMemo(
    () => skills.reduce((n, s) => (s.enabled ? n + 1 : n), 0),
    [skills],
  );
  const atLimit = enabledCount >= cap;

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

  const enabledSkills = React.useMemo(
    () => skills.filter((skill) => skill.enabled),
    [skills],
  );
  const filteredSkills = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return skills;
    return skills.filter((skill) =>
      [skill.name, skill.id, skill.description, ...skill.aliases].some((value) =>
        value.toLowerCase().includes(q),
      ),
    );
  }, [query, skills]);
  const grouped = React.useMemo(() => groupSkillsByCategory(filteredSkills), [filteredSkills]);
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
    if (!skill.enabled && enabledCount >= cap) {
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
        title="技能"
        description="启用常用技能，并在任务中用 @ 调用"
      />
      <div className="mb-5">
        <label className="relative block">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#ADADAD]"
            aria-hidden
          />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索技能"
            className="h-10 w-full rounded-full border border-[#DCDDDD] bg-white px-10 text-sm text-foreground shadow-[0_1px_2px_rgba(15,23,42,0.03)] outline-none transition-colors placeholder:text-[#ADADAD] focus:border-[#EA1F59]/45 focus:ring-2 focus:ring-[#EA1F59]/10"
          />
        </label>
        <div
          className={cn(
            'mt-3 inline-flex items-center gap-1.5 rounded-full border bg-white px-3 py-1 text-[12px] font-medium text-[#595757] shadow-[0_1px_2px_rgba(15,23,42,0.03)]',
            atLimit && !loadError && !loading
              ? 'border-[#FFC910]/65'
              : 'border-[#DCDDDD]',
          )}
        >
          {summary}
        </div>
      </div>
      {!loading && !loadError && enabledSkills.length > 0 && (
        <div className="mb-5 flex items-center gap-3 pb-2">
          <div className="shrink-0 text-[13px] font-medium text-foreground">已启用</div>
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {enabledSkills.map((skill) => (
              <SkillLogo
                key={skill.id}
                logoId={skill.logoId}
                label={skill.name}
                size="sm"
              />
            ))}
          </div>
        </div>
      )}
      {/* Upgrade nudge when Basic user hits the cap. Inline banner
          so the action sits adjacent to the skill grid the user is
          interacting with. */}
      {limitBanner && planId !== 'pro' && (
        <div className="mb-5 flex flex-col gap-3 border-y border-[#EFEFEF] py-3 text-[13px] text-foreground sm:flex-row sm:items-center sm:justify-between">
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
        <PageLoadingPanel label="技能加载中" description="正在同步技能目录" />
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
                  subject: '技能列表加载失败',
                  body: '技能列表加载失败，请协助排查。\n\n注册邮箱：\n出现时间：',
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
                subject: '技能目录为空',
                body: '技能目录为空，请协助确认。\n\n注册邮箱：',
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
              <div className="mb-1 flex items-center justify-between gap-3">
                <h2 className="text-[13px] font-medium text-foreground">
                  {category}
                </h2>
                <div className="text-[12px] text-muted-foreground">{items.length} 个</div>
              </div>
              <div className="grid grid-cols-1 gap-x-16 gap-y-1 lg:grid-cols-2">
                {items.map((s) => (
                  <SkillListRow
                    key={s.id}
                    skill={s}
                    pending={pendingId === s.id}
                    blocked={pendingId !== null && pendingId !== s.id}
                    limitBlocked={atLimit && !s.enabled}
                    cap={cap}
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

function SkillListRow({
  skill,
  pending,
  blocked,
  limitBlocked,
  cap,
  onToggle,
}: {
  skill: UiSkill;
  pending: boolean;
  blocked: boolean;
  limitBlocked: boolean;
  cap: number;
  onToggle: () => void;
}): JSX.Element {
  const toggleDisabled = pending || blocked || limitBlocked;
  const toggleTitle = limitBlocked
    ? cap <= 0
      ? '当前套餐暂不支持启用技能'
      : '已达到技能上限，先停用一个已启用技能'
    : `${skill.enabled ? '停用' : '启用'}${skill.name}`;
  return (
    <div
      className={cn(
        'group flex min-h-[74px] items-center gap-3 rounded-[8px] px-2 py-2.5 text-left transition-[background-color,opacity]',
        (pending || blocked) && 'opacity-60',
        !(pending || blocked) && 'hover:bg-[#F8F7F9]',
      )}
    >
      <SkillLogo logoId={skill.logoId} label={skill.name} className="shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium leading-5 text-foreground">
          {skill.name}
        </div>
        <div className="mt-0.5 truncate text-[12px] leading-5 text-muted-foreground">
          {skill.description}
        </div>
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={onToggle}
          disabled={toggleDisabled}
          aria-pressed={skill.enabled}
          aria-busy={pending}
          aria-label={toggleTitle}
          title={toggleTitle}
          className={cn(
            'flex h-7 w-7 items-center justify-center rounded-full border border-transparent bg-transparent transition-[background-color,color,opacity] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#57479C]/20',
            pending
              ? 'text-[#42C0EF]'
              : skill.enabled
                ? 'text-[#EA1F59]/70 hover:bg-[#FFF5F8] hover:text-[#EA1F59]'
                : limitBlocked
                  ? 'text-[#C99A1A] hover:bg-[#FFF9E8]'
                  : 'text-[#ADADAD] opacity-70 hover:bg-[#FFF5F8] hover:text-[#EA1F59] hover:opacity-100 group-hover:opacity-100',
          )}
        >
          {pending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          ) : limitBlocked ? (
            <LockKeyhole className="h-3.5 w-3.5" aria-hidden />
          ) : skill.enabled ? (
            <Check className="h-4 w-4" aria-hidden />
          ) : (
            <Plus className="h-4 w-4" aria-hidden />
          )}
          <span className="sr-only">
            {skillCardBadge({ enabled: skill.enabled, pending, limitBlocked, cap })}
          </span>
        </button>
      </div>
    </div>
  );
}
