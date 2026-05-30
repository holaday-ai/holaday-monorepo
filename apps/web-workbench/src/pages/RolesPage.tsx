import { AlertCircle, Check, Crown, Lock, Sparkles } from 'lucide-react';
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
  normalizeRoleListResponse,
  normalizeRoleSelectResponse,
  roleLimitMessage,
  rolePageSummary,
  rolePlanLabel,
  roleRemainingChanges,
  type RoleListSnapshot,
} from '@/lib/roles-page-state';
import { pageActionError, pageErrorMessage } from '@/lib/page-error-copy';
import { supportMailtoHref } from '@/lib/support-links';
import { trpc } from '@/lib/trpc';
import { cn } from '@/lib/utils';
import { PageContainer, PageHeader } from '@/pages/PageShell';

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
  const requestIdRef = React.useRef(0);
  const [data, setData] = React.useState<RoleListSnapshot | null>(null);
  const [draft, setDraft] = React.useState<string[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);

  const refresh = React.useCallback(
    async (options: { silent?: boolean } = {}) => {
      const requestId = ++requestIdRef.current;
      setLoading(true);
      setLoadError(null);
      try {
        const res = normalizeRoleListResponse(await trpc.roles.list.query());
        if (!mountedRef.current || requestId !== requestIdRef.current) return;
        setData(res);
        setDraft([...res.selected]);
      } catch (err) {
        if (!mountedRef.current || requestId !== requestIdRef.current) return;
        const message = pageErrorMessage(err);
        setLoadError(message);
        if (!options.silent) {
          toast.show(pageActionError('角色加载失败', err), 'error');
        }
      } finally {
        if (mountedRef.current && requestId === requestIdRef.current) setLoading(false);
      }
    },
    [toast],
  );

  React.useEffect(() => {
    mountedRef.current = true;
    void refresh({ silent: true });
    return () => {
      mountedRef.current = false;
      requestIdRef.current += 1;
    };
  }, [refresh]);

  const isPro = data?.plan === 'pro';
  const isBasic = data?.plan === 'basic';
  const isFree = data?.plan === 'free' || (!isPro && !isBasic);
  const currentPickLimit = data?.pickLimit ?? BASIC_ROLE_PICK_LIMIT;
  const currentChangesLimit = data?.changesLimit ?? ROLE_CHANGES_PER_MONTH;

  const toggle = React.useCallback(
    (id: string) => {
      if (!isBasic) return;
      setDraft((prev) => {
        if (prev.includes(id)) {
          return prev.filter((x) => x !== id);
        }
        if (prev.length >= currentPickLimit) {
          toast.show(roleLimitMessage(currentPickLimit), 'error');
          return prev;
        }
        return [...prev, id];
      });
    },
    [currentPickLimit, isBasic, toast],
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
    if (!data || saving || !dirty || draft.length > currentPickLimit) return;
    setSaving(true);
    try {
      const res = normalizeRoleSelectResponse(
        await trpc.roles.select.mutate({ roleIds: draft }),
        {
          selected: draft,
          changesThisMonth: data.changesThisMonth,
          changesLimit: data.changesLimit,
        },
      );
      setData((prev) =>
        prev
          ? {
              ...prev,
              selected: [...res.selected],
              changesThisMonth: res.changesThisMonth,
              changesLimit: res.changesLimit,
              // Save persisted the sanitized list — the DB row is
              // now clean, so drop the repair banner immediately.
              needsRoleRepair: false,
            }
          : prev,
      );
      toast.show('已保存');
    } catch (err) {
      toast.show(pageActionError('保存失败', err), 'error');
    } finally {
      setSaving(false);
    }
  }, [currentPickLimit, data, dirty, draft, saving, toast]);

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
    pickLimit: currentPickLimit,
  });

  if (loading || loadError || !data) {
    return (
      <PageContainer width="wide">
        <PageHeader
          title="专业角色"
          description="挑选 AI 在工作时使用的视角"
          action={
            <div className="inline-flex items-center rounded-full border border-[#DCDDDD] bg-white px-3 py-1 text-[12px] font-medium text-[#595757] shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
              {summary}
            </div>
          }
        />
        {loadError ? (
          <div className="flex flex-col items-center gap-3 rounded-[8px] border border-[#DCDDDD] bg-white px-6 py-12 text-center animate-fade-in motion-reduce:animate-none">
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
              'inline-flex items-center rounded-full border bg-white px-3 py-1 text-[12px] font-medium text-[#595757] shadow-[0_1px_2px_rgba(15,23,42,0.03)]',
              isBasic && draft.length > BASIC_ROLE_PICK_LIMIT
                ? 'border-[#FFC910]/65'
                : isPro
                  ? 'border-[#57479C]/25'
                  : 'border-[#DCDDDD]',
            )}
          >
            {summary}
          </div>
        }
      />
      {isFree && (
        <div className="mb-6 flex items-start gap-3 rounded-[8px] border border-[#DCDDDD] border-l-[#FFC910] bg-white px-4 py-3 text-sm text-foreground shadow-[0_1px_2px_rgba(15,23,42,0.03)] animate-fade-in motion-reduce:animate-none [border-left-width:3px]">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-[#DCDDDD] bg-white text-[#595757]">
            <Crown className="h-4 w-4" aria-hidden />
          </div>
          <div className="min-w-0">
            免费版没有角色权限。
            <button
              type="button"
              onClick={() => navigate('/plan')}
              className="ml-1 inline-flex font-medium underline underline-offset-2 hover:text-[#EA1F59]"
            >
              升级到基础版
            </button>
            解锁 5 个自选角色，专业版解锁全部 33 个。
          </div>
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
        <div className="mb-4 rounded-[8px] border border-[#DCDDDD] border-l-[#EA1F59] bg-white px-4 py-3 text-sm text-foreground shadow-[0_1px_2px_rgba(15,23,42,0.03)] animate-fade-in motion-reduce:animate-none [border-left-width:3px]">
          {draft.length > BASIC_ROLE_PICK_LIMIT ? (
            <>
              检测到不适用于当前套餐的角色已被自动移除。请先取消勾选至
              <span className="font-semibold"> {currentPickLimit} 个以内 </span>
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

      {isBasic && !data.needsRoleRepair && draft.length > currentPickLimit && (
        <div className="mb-4 rounded-[8px] border border-[#DCDDDD] border-l-[#FFC910] bg-white px-4 py-3 text-sm text-foreground shadow-[0_1px_2px_rgba(15,23,42,0.03)] animate-fade-in motion-reduce:animate-none [border-left-width:3px]">
          你当前选择 <span className="font-semibold">{draft.length}</span> 个角色，
          超出基础版 {currentPickLimit} 个上限。请取消勾选至 {currentPickLimit} 个以内
          再保存，否则新任务将无法创建。
        </div>
      )}

      {isBasic && (
        <div className="mb-6 flex flex-col gap-3 rounded-[8px] border border-[#DCDDDD] bg-white px-4 py-3 shadow-[0_1px_2px_rgba(15,23,42,0.03)] animate-fade-in motion-reduce:animate-none sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-[220px] flex-1 text-xs text-muted-foreground">
            <span
              className={cn(
                'text-sm font-medium',
                draft.length > currentPickLimit
                  ? 'text-[#EA1F59]'
                  : 'text-foreground',
              )}
            >
              已选 {draft.length} / {currentPickLimit}
            </span>
            <span>
              本月可切换 {roleRemainingChanges(data.changesThisMonth, currentChangesLimit)} 次（共
              {currentChangesLimit} 次）
            </span>
            <div className="mt-2 h-1 overflow-hidden rounded-full bg-[#EFEFEF]">
              <div
                className={cn(
                  'h-full rounded-full transition-[width] duration-300',
                  draft.length > currentPickLimit ? 'bg-[#FFC910]' : 'bg-[#EA1F59]',
                )}
                style={{
                  width: `${Math.min(100, Math.round((draft.length / currentPickLimit) * 100))}%`,
                }}
              />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
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
              disabled={!dirty || saving || draft.length > currentPickLimit}
              onClick={() => void save()}
            >
              {saving ? '保存中…' : dirty ? '保存' : '已保存'}
            </Button>
          </div>
        </div>
      )}

      {isPro && (
        <div className="mb-6 flex items-start gap-3 rounded-[8px] border border-[#DCDDDD] border-l-[#57479C] bg-white px-4 py-3 text-sm text-foreground shadow-[0_1px_2px_rgba(15,23,42,0.03)] animate-fade-in motion-reduce:animate-none [border-left-width:3px]">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-[#DCDDDD] bg-white text-[#57479C]">
            <Sparkles className="h-4 w-4" aria-hidden />
          </div>
          <div className="min-w-0 text-muted-foreground">
            {rolePlanLabel(data.plan)}默认开启全部 {data.catalogue.length} 个角色，AI 会根据任务自动匹配最合适的视角。
          </div>
        </div>
      )}

      <div className="space-y-8">
        {grouped.map((group) => (
          <section key={group.key}>
            <div className="mb-3 flex items-center justify-between gap-3 border-b border-[#EFEFEF] pb-2">
              <h2 className="text-[11px] font-semibold uppercase tracking-wide text-[#595757]">
                {group.nameZh}
              </h2>
              <div className="rounded-full border border-[#DCDDDD] bg-white px-2 py-0.5 text-[11px] text-[#595757]">
                {group.items.length} 个
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
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
          </section>
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
        'group relative flex min-h-[128px] flex-col gap-2 rounded-[8px] border bg-white p-4 text-left shadow-[0_1px_2px_rgba(15,23,42,0.03)] transition-[transform,border-color,box-shadow] duration-150 animate-fade-in motion-reduce:animate-none motion-reduce:transition-none motion-reduce:hover:translate-y-0',
        onClick &&
          'hover:-translate-y-px hover:border-[#ADADAD] hover:shadow-[0_5px_16px_rgba(15,23,42,0.055)]',
        checked && !locked
          ? 'border-[#DCDDDD]'
          : 'border-[#DCDDDD]',
        locked && 'border-[#DCDDDD]',
        disabled && !onClick && 'cursor-default',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-sm font-medium leading-tight">{role.nameZh}</span>
        {locked ? (
          <span
            className="inline-flex items-center gap-1 rounded-full border border-[#57479C]/30 bg-white px-1.5 py-0.5 text-[10px] font-medium text-[#57479C]"
            title="升级到专业版解锁"
          >
            <Lock className="h-2.5 w-2.5" />
            专业版
          </span>
        ) : checked ? (
          <span className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-[#EA1F59] bg-white text-[#EA1F59]">
            <Check className="h-2.5 w-2.5" />
          </span>
        ) : (
          <span className="inline-block h-4 w-4 rounded-full border border-[#DCDDDD] bg-white group-hover:border-[#ADADAD]" />
        )}
      </div>
      <p className="text-[11px] leading-snug text-muted-foreground">{role.descriptionZh}</p>
    </Tag>
  );
}
