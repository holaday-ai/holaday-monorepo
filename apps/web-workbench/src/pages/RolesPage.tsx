import { AlertCircle, Check, Lock } from 'lucide-react';
import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  BASIC_ROLE_PICK_LIMIT,
  ROLE_CHANGES_PER_MONTH,
  type RoleDefinition,
} from '@holaday/shared-types';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import {
  groupRoleCatalogue,
  roleLimitMessage,
  rolePageSummary,
  rolePlanLabel,
  roleRemainingChanges,
} from '@/lib/roles-page-state';
import { supportMailtoHref } from '@/lib/support-links';
import { trpc } from '@/lib/trpc';
import { cn } from '@/lib/utils';
import { PageContainer, PageHeader, Section } from '@/pages/PageShell';

interface ListResponse {
  plan: string;
  selected: string[];
  catalogue: readonly RoleDefinition[];
  pickLimit: number;
  changesThisMonth: number;
  changesLimit: number;
  /**
   * P1-A — true when a Basic-plan user has more entries in
   * selected_roles than the 5-pick limit (legacy state from the
   * skill/role split migration). Drives the warning banner that
   * tells them to trim before saving.
   */
  overLimit?: boolean;
  /**
   * P1-final — true when the server filtered Pro-only ids out of
   * the Basic user's selected_roles before returning. The user
   * was previously locked: Pro-only cards render as disabled on
   * Basic, so they couldn't uncheck the Pro-only ids, so save
   * always failed (`roles.select` rejects ids outside OPEN_POOL).
   * Banner tells them to just hit Save — `selected` is already
   * sanitized so the save will land a clean list.
   */
  needsRoleRepair?: boolean;
}

/**
 * Role selection page. Three states based on plan:
 *
 *   - free  → all cards locked, banner pushes upgrade
 *   - basic → 23 open-pool cards selectable (max 5), 10 pro-only locked
 *   - pro   → all 33 cards shown as enabled, no save button (auto-on)
 *
 * Save = mutation against `roles.select`. Server enforces the same
 * picks (set membership in OPEN_POOL_ROLE_IDS, ≤5, ≤3 changes/month);
 * the SPA-side checks are UX guardrails, not security.
 */
export function RolesPage(): JSX.Element {
  const navigate = useNavigate();
  const toast = useToast();
  const mountedRef = React.useRef(false);
  const [data, setData] = React.useState<ListResponse | null>(null);
  const [draft, setDraft] = React.useState<string[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);

  const refresh = React.useCallback(
    async (options: { silent?: boolean } = {}) => {
      setLoading(true);
      setLoadError(null);
      try {
        const res = await trpc.roles.list.query();
        if (!mountedRef.current) return;
        setData(res as ListResponse);
        setDraft((res as ListResponse).selected);
      } catch (err) {
        if (!mountedRef.current) return;
        const message = err instanceof Error ? err.message : '请稍后重试';
        setLoadError(message);
        if (!options.silent) {
          toast.show(
            err instanceof Error ? `角色加载失败：${err.message}` : '角色加载失败',
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
    void refresh({ silent: true });
    return () => {
      mountedRef.current = false;
    };
  }, [refresh]);

  const isPro = data?.plan === 'pro';
  const isBasic = data?.plan === 'basic';
  const isFree = data?.plan === 'free' || (!isPro && !isBasic);

  const toggle = React.useCallback(
    (id: string) => {
      if (!isBasic) return;
      setDraft((prev) => {
        if (prev.includes(id)) {
          return prev.filter((x) => x !== id);
        }
        if (prev.length >= BASIC_ROLE_PICK_LIMIT) {
          toast.show(roleLimitMessage(BASIC_ROLE_PICK_LIMIT), 'error');
          return prev;
        }
        return [...prev, id];
      });
    },
    [isBasic, toast],
  );

  const dirty = React.useMemo(() => {
    if (!data) return false;
    // P1-final — force-enable save when the server pre-sanitised
    // the selection (Pro-only ids stripped out). draft and selected
    // both reflect the post-sanitize list, so the structural diff
    // would say "no change", but the DB row still has the Pro-only
    // contamination — the user MUST hit Save to rewrite it. Dirty
    // resets to natural-diff after the save call updates data.selected.
    if (data.needsRoleRepair) return true;
    if (data.selected.length !== draft.length) return true;
    const a = new Set(data.selected);
    return draft.some((x) => !a.has(x));
  }, [data, draft]);

  const save = React.useCallback(async () => {
    if (!data) return;
    setSaving(true);
    try {
      const res = await trpc.roles.select.mutate({ roleIds: draft });
      setData((prev) =>
        prev
          ? {
              ...prev,
              selected: res.selected,
              changesThisMonth: res.changesThisMonth,
              // Save persisted the sanitized list — the DB row is
              // now clean, so drop the repair banner immediately.
              needsRoleRepair: false,
            }
          : prev,
      );
      toast.show('已保存');
    } catch (err) {
      const msg = err instanceof Error ? err.message : '保存失败';
      toast.show(msg, 'error');
    } finally {
      setSaving(false);
    }
  }, [data, draft, toast]);

  const grouped = React.useMemo(
    () => (data ? groupRoleCatalogue(data.catalogue) : []),
    [data],
  );
  const summary = rolePageSummary({
    loading,
    error: loadError,
    plan: data?.plan,
    selectedCount: draft.length,
    totalCount: data?.catalogue.length ?? 0,
    pickLimit: data?.pickLimit ?? BASIC_ROLE_PICK_LIMIT,
  });

  if (loading || loadError || !data) {
    return (
      <PageContainer width="wide">
        <PageHeader
          title="专业角色"
          description="挑选 AI 在工作时使用的视角"
          action={
            <div className="inline-flex items-center rounded-full border border-border bg-card px-3 py-1 text-[12px] font-medium text-foreground">
              {summary}
            </div>
          }
        />
        {loadError ? (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-border bg-card/40 px-6 py-12 text-center">
            <AlertCircle className="h-8 w-8 text-primary" aria-hidden />
            <div className="text-sm font-medium text-foreground/80">角色加载失败</div>
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
                    subject: '专业角色列表加载失败',
                    body: '专业角色列表加载失败，请协助排查。\n\n注册邮箱：\n出现时间：',
                  })}
                >
                  联系支持
                </a>
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
            读取中…
          </div>
        )}
      </PageContainer>
    );
  }

  return (
    <PageContainer width="wide">
      <PageHeader
        title="专业角色"
        description="挑选 AI 在工作时使用的视角"
        action={
          <div
            className={cn(
              'inline-flex items-center rounded-full border px-3 py-1 text-[12px] font-medium',
              isBasic && draft.length > BASIC_ROLE_PICK_LIMIT
                ? 'border-amber-300/60 bg-amber-50 text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/15 dark:text-amber-200'
                : 'border-border bg-card text-foreground',
            )}
          >
            {summary}
          </div>
        }
      />
      {isFree && (
        <div className="mb-6 rounded-lg border border-amber-300/40 bg-amber-50/50 px-4 py-3 text-sm text-amber-900 dark:border-amber-700/40 dark:bg-amber-950/30 dark:text-amber-200">
          免费版没有角色权限。
          <button
            type="button"
            onClick={() => navigate('/plan')}
            className="ml-1 inline-flex underline underline-offset-2 hover:text-amber-700 dark:hover:text-amber-100"
          >
            升级到基础版
          </button>
          解锁 5 个自选角色，专业版解锁全部 33 个。
        </div>
      )}

      {/*
        Item 2 — banners react to draft, not the snapshot from the
        initial roles.list call. Without this, unchecking 3 of 8 to
        get back to 5/5 still rendered "超出上限" amber until next
        page refresh. Two states only show one banner at a time:
          - needsRoleRepair (server cleaned Pro-only ids; copy switches
            with draft over/at-limit)
          - draftOverLimit (no server-side issue, user just has too
            many draft picks)
      */}
      {isBasic && data.needsRoleRepair && (
        <div className="mb-4 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-sm text-foreground dark:border-primary/40 dark:bg-primary/15">
          {draft.length > BASIC_ROLE_PICK_LIMIT ? (
            <>
              检测到不适用于当前套餐的角色已被自动移除。请先取消勾选至
              <span className="font-semibold"> {BASIC_ROLE_PICK_LIMIT} 个以内 </span>
              再保存。
            </>
          ) : (
            <>
              检测到不适用于当前套餐的角色已被自动移除。请直接点
              <span className="font-semibold">「保存」</span>
              以修复你的角色设置；之后即可正常创建新任务。
            </>
          )}
        </div>
      )}

      {isBasic && !data.needsRoleRepair && draft.length > BASIC_ROLE_PICK_LIMIT && (
        <div className="mb-4 rounded-lg border border-amber-300/40 bg-amber-50/50 px-4 py-3 text-sm text-amber-900 dark:border-amber-700/40 dark:bg-amber-950/30 dark:text-amber-200">
          你当前选择 <span className="font-semibold">{draft.length}</span> 个角色，
          超出基础版 {BASIC_ROLE_PICK_LIMIT} 个上限。请取消勾选至 {BASIC_ROLE_PICK_LIMIT} 个以内
          再保存，否则新任务将无法创建。
        </div>
      )}

      {isBasic && (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3">
          <div className="flex flex-col text-xs text-muted-foreground">
            <span
              className={cn(
                'text-sm font-medium',
                draft.length > BASIC_ROLE_PICK_LIMIT
                  ? 'text-red-600 dark:text-red-400'
                  : 'text-foreground',
              )}
            >
              已选 {draft.length} / {BASIC_ROLE_PICK_LIMIT}
            </span>
            <span>
              本月可切换 {roleRemainingChanges(data.changesThisMonth, ROLE_CHANGES_PER_MONTH)} 次（共
              {ROLE_CHANGES_PER_MONTH} 次）
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => navigate('/plan')}
            >
              升级解锁全部 33 个
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={!dirty || saving || draft.length > BASIC_ROLE_PICK_LIMIT}
              onClick={() => void save()}
            >
              {saving ? '保存中…' : dirty ? '保存' : '已保存'}
            </Button>
          </div>
        </div>
      )}

      {isPro && (
        <div className="mb-6 rounded-lg border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
          {rolePlanLabel(data.plan)}默认开启全部 {data.catalogue.length} 个角色，AI 会根据任务自动匹配最合适的视角。
        </div>
      )}

      <div className="space-y-8">
        {grouped.map((group) => (
          <Section key={group.key} title={`${group.nameZh} · ${group.items.length} 个`}>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {group.items.map((role) => {
                const checked = draft.includes(role.id);
                const lockedForBasic = role.tier === 'pro' && !isPro;
                const disabled = isFree || (isBasic && lockedForBasic) || isPro;
                const interactive = isBasic && !lockedForBasic;
                return (
                  <RoleCard
                    key={role.id}
                    role={role}
                    checked={checked || isPro}
                    locked={lockedForBasic && !isPro}
                    disabled={disabled}
                    onClick={interactive ? () => toggle(role.id) : undefined}
                  />
                );
              })}
            </div>
          </Section>
        ))}
      </div>
    </PageContainer>
  );
}

interface CardProps {
  role: RoleDefinition;
  checked: boolean;
  locked: boolean;
  disabled: boolean;
  onClick?: () => void;
}

function RoleCard({ role, checked, locked, disabled, onClick }: CardProps): JSX.Element {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={cn(
        'group relative flex flex-col gap-1 rounded-lg border bg-card p-3 text-left transition-colors',
        onClick && 'hover:border-foreground/30 hover:bg-foreground/[0.03]',
        checked && !locked
          ? 'border-foreground/60 ring-1 ring-foreground/30'
          : 'border-border',
        locked && 'opacity-60',
        disabled && !onClick && 'cursor-default',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-sm font-medium leading-tight">{role.nameZh}</span>
        {locked ? (
          <span
            className="inline-flex items-center gap-1 rounded-full border border-border px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
            title="升级到专业版解锁"
          >
            <Lock className="h-2.5 w-2.5" />
            专业版
          </span>
        ) : checked ? (
          <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-foreground text-background">
            <Check className="h-2.5 w-2.5" />
          </span>
        ) : (
          <span className="inline-block h-4 w-4 rounded-full border border-border" />
        )}
      </div>
      <p className="text-[11px] leading-snug text-muted-foreground">{role.descriptionZh}</p>
    </Tag>
  );
}
