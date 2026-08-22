import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import {
  MEMORY_CATEGORY_LABELS,
  type MemoryRowView,
  formatMemoryDate,
  memoryCategoryLabel,
  memoryLoadErrorCopy,
  memoryLoadErrorMessage,
  normalizeMemoryRows,
} from '@/lib/memory-settings-state';
import { pageActionError } from '@/lib/page-error-copy';
import { trpc } from '@/lib/trpc';
import { cn } from '@/lib/utils';
import { Section } from '@/pages/PageShell';
import { AlertCircle, ChevronDown, ChevronUp, Loader2, Search, X } from 'lucide-react';
import * as React from 'react';

interface CategoryOption {
  readonly id: string;
  readonly label: string;
  readonly count: number;
}

const KNOWN_CATEGORY_ORDER = Object.keys(MEMORY_CATEGORY_LABELS);

function buildCategoryOptions(memories: readonly MemoryRowView[]): CategoryOption[] {
  const counts = new Map<string, number>();
  for (const memory of memories) {
    counts.set(memory.category, (counts.get(memory.category) ?? 0) + 1);
  }
  const categories = [
    ...KNOWN_CATEGORY_ORDER.filter((category) => counts.has(category)),
    ...[...counts.keys()].filter((category) => !KNOWN_CATEGORY_ORDER.includes(category)).sort(),
  ];
  return [
    { id: 'all', label: '全部', count: memories.length },
    ...categories.map((category) => ({
      id: category,
      label: memoryCategoryLabel(category),
      count: counts.get(category) ?? 0,
    })),
  ];
}

function filterMemories(
  memories: readonly MemoryRowView[],
  activeCategory: string,
  query: string,
): MemoryRowView[] {
  const normalizedQuery = query.trim().toLocaleLowerCase('zh-CN');
  return memories.filter((memory) => {
    if (activeCategory !== 'all' && memory.category !== activeCategory) return false;
    if (!normalizedQuery) return true;
    return [memory.keyName, memory.value, memoryCategoryLabel(memory.category)].some((field) =>
      field.toLocaleLowerCase('zh-CN').includes(normalizedQuery),
    );
  });
}

/**
 * AI-managed memory library. Users can browse, filter, inspect and remove
 * accumulated context; creation remains agent-owned.
 */
export function MemorySection(): JSX.Element {
  const toast = useToast();
  const mountedRef = React.useRef(false);
  const requestIdRef = React.useRef(0);
  const memoriesRef = React.useRef<MemoryRowView[]>([]);
  const activeCategoryRef = React.useRef('all');
  const [memories, setMemories] = React.useState<MemoryRowView[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [confirming, setConfirming] = React.useState(false);
  const [activeCategory, setActiveCategory] = React.useState('all');
  const [query, setQuery] = React.useState('');
  const [expandedIds, setExpandedIds] = React.useState<ReadonlySet<string>>(() => new Set());
  const [deletingIds, setDeletingIds] = React.useState<ReadonlySet<string>>(() => new Set());

  const refresh = React.useCallback(
    async (options: { silent?: boolean } = {}) => {
      const requestId = ++requestIdRef.current;
      setLoading(true);
      try {
        const response = await trpc.memory.list.query();
        if (!mountedRef.current || requestId !== requestIdRef.current) return;
        const nextMemories = normalizeMemoryRows(response);
        memoriesRef.current = nextMemories;
        setMemories(nextMemories);
        setLoadError(null);
      } catch (error) {
        if (!mountedRef.current || requestId !== requestIdRef.current) return;
        setLoadError(memoryLoadErrorMessage(error));
        if (!options.silent) toast.show('AI 记忆暂时无法加载', 'error');
        memoriesRef.current = [];
        setMemories([]);
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

  const selectCategory = (category: string): void => {
    activeCategoryRef.current = category;
    setActiveCategory(category);
  };

  const handleDelete = async (externalId: string): Promise<void> => {
    if (deletingIds.has(externalId)) return;
    setDeletingIds((previous) => new Set(previous).add(externalId));
    try {
      await trpc.memory.delete.mutate({ externalId });
      if (!mountedRef.current) return;
      const nextMemories = memoriesRef.current.filter((memory) => memory.externalId !== externalId);
      memoriesRef.current = nextMemories;
      setMemories(nextMemories);
      const selectedCategory = activeCategoryRef.current;
      if (
        selectedCategory !== 'all' &&
        !nextMemories.some((memory) => memory.category === selectedCategory)
      ) {
        selectCategory('all');
      }
      toast.show('已删除记忆', 'info');
    } catch (error) {
      if (!mountedRef.current) return;
      toast.show(pageActionError('删除失败', error), 'error');
    } finally {
      if (mountedRef.current) {
        setDeletingIds((previous) => {
          const next = new Set(previous);
          next.delete(externalId);
          return next;
        });
      }
    }
  };

  const handleClear = async (): Promise<void> => {
    try {
      await trpc.memory.clear.mutate();
      if (!mountedRef.current) return;
      memoriesRef.current = [];
      setMemories([]);
      setConfirming(false);
      selectCategory('all');
      setQuery('');
      toast.show('已清空 AI 记忆', 'info');
    } catch (error) {
      if (!mountedRef.current) return;
      toast.show(pageActionError('清空失败', error), 'error');
    }
  };

  const loadErrorCopy = memoryLoadErrorCopy(loadError);
  const categoryOptions = buildCategoryOptions(memories);
  const visibleMemories = filterMemories(memories, activeCategory, query);
  const categoryCount = categoryOptions.length - 1;

  return (
    <Section id="memory" title="AI 记忆">
      <div className="space-y-4">
        {!loading && !loadError && memories.length > 0 ? (
          <div className="grid gap-2 sm:grid-cols-3" aria-label="AI 记忆概览">
            <div className="rounded-[8px] border border-[#E6DDF6] bg-[#F7F2FF] px-3 py-2.5">
              <div className="text-sm font-semibold text-foreground">{memories.length} 条记忆</div>
              <div className="mt-0.5 text-[11px] text-muted-foreground">当前由你管理</div>
            </div>
            <div className="rounded-[8px] border border-[#D8EDF5] bg-[#F0FAFD] px-3 py-2.5">
              <div className="text-sm font-semibold text-foreground">{categoryCount} 类信息</div>
              <div className="mt-0.5 text-[11px] text-muted-foreground">偏好、经验与历史</div>
            </div>
            <div className="rounded-[8px] border border-[#F2E4C4] bg-[#FFF9E9] px-3 py-2.5">
              <div className="text-sm font-semibold text-foreground">相关任务中按需使用</div>
              <div className="mt-0.5 text-[11px] text-muted-foreground">不会替代你的当前指令</div>
            </div>
          </div>
        ) : null}

        <p className="text-sm leading-relaxed text-muted-foreground">
          HOLA DAY
          会保留对后续任务有帮助的偏好、网站经验和任务里程碑。只在相关任务中按需使用，你的新指令始终优先。
        </p>

        {!loading && !loadError && memories.length > 0 ? (
          <div className="space-y-2.5">
            <label className="relative block">
              <span className="sr-only">搜索 AI 记忆</span>
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <input
                type="search"
                aria-label="搜索 AI 记忆"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索标题或记忆内容"
                className="h-10 w-full rounded-md border border-border bg-background pl-9 pr-3 text-sm outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary/40 focus:ring-2 focus:ring-primary/10"
              />
            </label>
            <fieldset className="flex min-w-0 flex-wrap gap-1.5" aria-label="按类别筛选 AI 记忆">
              {categoryOptions.map((category) => {
                const active = activeCategory === category.id;
                return (
                  <button
                    key={category.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => selectCategory(category.id)}
                    className={cn(
                      'inline-flex h-9 items-center rounded-md border px-3 text-xs font-medium transition-colors',
                      active
                        ? 'border-primary/25 bg-primary/10 text-primary'
                        : 'border-border bg-background text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground',
                    )}
                  >
                    {category.label} {category.count}
                  </button>
                );
              })}
            </fieldset>
          </div>
        ) : null}

        {loading ? (
          <div className="text-xs text-muted-foreground">加载中…</div>
        ) : loadError ? (
          <div className="rounded-md border border-border bg-card/40 px-3 py-4 text-center">
            <AlertCircle className="mx-auto h-6 w-6 text-primary" aria-hidden />
            <div className="mt-2 text-sm font-medium text-foreground/85">{loadErrorCopy.title}</div>
            <div className="mx-auto mt-1 max-w-md text-xs leading-5 text-muted-foreground">
              {loadErrorCopy.body}
            </div>
            <Button type="button" size="sm" className="mt-3" onClick={() => void refresh()}>
              重试
            </Button>
          </div>
        ) : memories.length === 0 ? (
          <div className="rounded-md border border-dashed border-border bg-card/40 px-3 py-3 text-xs text-muted-foreground">
            还没有记忆。完成一些任务后这里会逐步填充。
          </div>
        ) : visibleMemories.length === 0 ? (
          <div className="rounded-md border border-dashed border-border bg-card/40 px-3 py-4 text-center text-xs text-muted-foreground">
            没有符合条件的记忆。
          </div>
        ) : (
          <ul className="space-y-2">
            {visibleMemories.map((memory) => {
              const deleting = deletingIds.has(memory.externalId);
              const expanded = expandedIds.has(memory.externalId);
              const canExpand = memory.value.length > 48;
              const updatedLabel = formatMemoryDate(memory.updatedAt);
              const expiresLabel = memory.expiresAt ? formatMemoryDate(memory.expiresAt) : null;
              return (
                <li
                  key={memory.externalId}
                  className="rounded-md border border-border bg-card px-3 py-2.5 text-sm"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-muted-foreground">
                          {memoryCategoryLabel(memory.category)}
                        </span>
                        <span className="truncate text-sm font-medium text-foreground">
                          {memory.keyName}
                        </span>
                      </div>
                      <p
                        className={cn(
                          'mt-1 text-xs leading-relaxed text-muted-foreground',
                          canExpand && !expanded && 'line-clamp-2',
                        )}
                      >
                        {memory.value}
                      </p>
                      {canExpand ? (
                        <button
                          type="button"
                          aria-expanded={expanded}
                          aria-label={`${expanded ? '收起' : '展开'} ${memory.keyName}`}
                          title={`${expanded ? '收起' : '展开'} ${memory.keyName}`}
                          onClick={() =>
                            setExpandedIds((previous) => {
                              const next = new Set(previous);
                              if (expanded) next.delete(memory.externalId);
                              else next.add(memory.externalId);
                              return next;
                            })
                          }
                          className="mt-1 inline-flex h-7 items-center gap-0.5 rounded px-1 text-[11px] font-medium text-primary transition-colors hover:bg-primary/[0.06]"
                        >
                          {expanded ? '收起' : '展开'}
                          {expanded ? (
                            <ChevronUp className="h-3 w-3" aria-hidden />
                          ) : (
                            <ChevronDown className="h-3 w-3" aria-hidden />
                          )}
                        </button>
                      ) : null}
                      <div className="mt-1.5 flex flex-wrap gap-x-2 gap-y-0.5 text-[10px] text-muted-foreground/80">
                        <span>{updatedLabel ? `${updatedLabel}更新` : '更新时间未知'}</span>
                        <span aria-hidden>·</span>
                        <span>
                          {memory.expiresAt
                            ? expiresLabel
                              ? `有效至 ${expiresLabel}`
                              : '有效期未知'
                            : '长期保留'}
                        </span>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleDelete(memory.externalId)}
                      disabled={deleting}
                      aria-label={`删除记忆：${memory.keyName}`}
                      title={deleting ? '删除中' : `删除记忆：${memory.keyName}`}
                      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-red-950/25 dark:hover:text-red-400"
                    >
                      {deleting ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                      ) : (
                        <X className="h-3.5 w-3.5" aria-hidden />
                      )}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {!loading && !loadError && memories.length > 0 ? (
          <div
            aria-label="AI 记忆危险操作"
            className="flex items-center justify-between gap-4 rounded-md border border-red-200/70 bg-red-50/35 px-3 py-2.5 dark:border-red-900/50 dark:bg-red-950/10"
          >
            <div>
              <div className="text-xs font-medium text-foreground">危险操作</div>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                清空后无法恢复，也不会影响当前任务。
              </p>
            </div>
            <button
              type="button"
              onClick={() => setConfirming(true)}
              disabled={loading}
              title="清空全部记忆"
              className="inline-flex h-9 shrink-0 items-center rounded-md border border-red-200 bg-background px-3 text-xs font-medium text-red-600 transition-colors hover:bg-red-50 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-900/70 dark:text-red-400 dark:hover:bg-red-950/25"
            >
              清空全部记忆
            </button>
          </div>
        ) : null}

        {confirming ? (
          <ConfirmDialog
            open
            title="清空全部 AI 记忆？"
            description="删除后 HOLA DAY 不再记得你的偏好、网站经验等历史信息。无法撤销。"
            confirmLabel="清空全部"
            destructive
            onClose={() => setConfirming(false)}
            onConfirm={handleClear}
          />
        ) : null}
      </div>
    </Section>
  );
}
