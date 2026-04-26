import { Check, Lock } from 'lucide-react';
import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  BASIC_ROLE_PICK_LIMIT,
  ROLE_CHANGES_PER_MONTH,
  type RoleDefinition,
} from '@holaday/shared-types';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { trpc } from '@/lib/trpc';
import { cn } from '@/lib/utils';
import { PageShell, Section } from '@/pages/PageShell';

interface ListResponse {
  plan: string;
  selected: string[];
  catalogue: readonly RoleDefinition[];
  pickLimit: number;
  changesThisMonth: number;
  changesLimit: number;
}

const CATEGORY_ORDER: Array<{ key: RoleDefinition['category']; nameZh: string }> = [
  { key: 'marketing', nameZh: '营销 & 内容' },
  { key: 'ecommerce', nameZh: '电商 & 运营' },
  { key: 'product', nameZh: '产品 & 项目' },
  { key: 'data', nameZh: '数据 & 分析' },
  { key: 'support', nameZh: '支持 & 合规' },
  { key: 'hr', nameZh: 'HR & 供应链' },
  { key: 'specialty', nameZh: '专项' },
];

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
  const [data, setData] = React.useState<ListResponse | null>(null);
  const [draft, setDraft] = React.useState<string[]>([]);
  const [saving, setSaving] = React.useState(false);

  const refresh = React.useCallback(() => {
    trpc.roles.list.query().then(
      (res) => {
        setData(res as ListResponse);
        setDraft((res as ListResponse).selected);
      },
      () => {
        toast.show('读取角色列表失败');
      },
    );
  }, [toast]);

  React.useEffect(() => {
    refresh();
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
          toast.show(`最多选择 ${BASIC_ROLE_PICK_LIMIT} 个角色`);
          return prev;
        }
        return [...prev, id];
      });
    },
    [isBasic, toast],
  );

  const dirty = React.useMemo(() => {
    if (!data) return false;
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
            }
          : prev,
      );
      toast.show('已保存');
    } catch (err) {
      const msg = err instanceof Error ? err.message : '保存失败';
      toast.show(msg);
    } finally {
      setSaving(false);
    }
  }, [data, draft, toast]);

  if (!data) {
    return (
      <PageShell title="专业角色" subtitle="挑选 AI 在工作时使用的视角" backTo="/settings">
        <div className="text-sm text-muted-foreground">读取中…</div>
      </PageShell>
    );
  }

  const grouped = CATEGORY_ORDER.map((cat) => ({
    ...cat,
    items: data.catalogue.filter((r) => r.category === cat.key),
  }));

  return (
    <PageShell
      title="专业角色"
      subtitle="挑选 AI 在工作时使用的视角"
      backTo="/settings"
      width="6xl"
    >
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

      {isBasic && (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3">
          <div className="flex flex-col text-xs text-muted-foreground">
            <span className="text-sm font-medium text-foreground">
              已选 {draft.length} / {BASIC_ROLE_PICK_LIMIT}
            </span>
            <span>
              本月可切换 {Math.max(0, ROLE_CHANGES_PER_MONTH - data.changesThisMonth)} 次（共
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
              disabled={!dirty || saving}
              onClick={() => void save()}
            >
              {saving ? '保存中…' : dirty ? '保存' : '已保存'}
            </Button>
          </div>
        </div>
      )}

      {isPro && (
        <div className="mb-6 rounded-lg border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
          专业版默认开启全部 33 个角色，AI 会根据任务自动匹配最合适的视角。
        </div>
      )}

      <div className="space-y-8">
        {grouped.map((group) => (
          <Section key={group.key} title={group.nameZh}>
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
    </PageShell>
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
