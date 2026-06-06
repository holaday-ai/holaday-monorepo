import { AlertCircle, ChevronRight, Loader2, Monitor, Moon, Sun, X } from 'lucide-react';
import * as React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ApiKeysSection } from '@/components/ApiKeysSection';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { NotificationsSection } from '@/components/notifications/NotificationsSection';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { supportMailtoHref } from '@/lib/support-links';
import {
  memoryCategoryLabel,
  memoryLoadErrorCopy,
  memoryLoadErrorMessage,
  normalizeMemoryRows,
  type MemoryRowView,
} from '@/lib/memory-settings-state';
import { pageActionError } from '@/lib/page-error-copy';
import {
  SETTINGS_SECTIONS,
  normaliseSettingsHash,
  settingsSectionHref,
  type SettingsSectionId,
} from '@/lib/settings-sections';
import { cn } from '@/lib/utils';
import { trpc } from '@/lib/trpc';
import { PageContainer, PageHeader, Row, Section } from '@/pages/PageShell';
import { type ThemeMode, useTheme } from '@/stores/theme-store';

/**
 * Settings page — only the rows that actually persist server-side,
 * route to a real support action, or affect runtime behaviour. P2.4
 * audit removed two sections that were UI theatre:
 *   - 语言偏好: no i18n bundle wired, the toggle was a localStorage
 *     write nothing else read.
 *   - 默认交互模式: not connected to the live `browserInteractive`
 *     store; R19 already set the right default (off), so the entry
 *     was duplicate plumbing.
 * If/when those land we re-introduce the sections.
 */
export function SettingsPage(): JSX.Element {
  const { mode, setMode } = useTheme();
  const location = useLocation();
  const [deleteDialogOpen, setDeleteDialogOpen] = React.useState(false);
  const activeSection = normaliseSettingsHash(location.hash) ?? 'appearance';

  React.useEffect(() => {
    const sectionId = normaliseSettingsHash(location.hash);
    if (!sectionId) return;

    const scrollToSection = (): void => {
      document.getElementById(sectionId)?.scrollIntoView({ block: 'start' });
    };

    const frame = window.requestAnimationFrame(scrollToSection);
    const timer = window.setTimeout(scrollToSection, 350);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [location.hash]);

  // Section order (Sweep P2 fix): API Key region was buried below
  // MemorySection which can hold dozens of rows on power-user
  // accounts. Codex pass moved Developer ABOVE Memory so a 3-second
  // scan from the top of /settings reaches the API key controls.
  // Memory drops to the bottom (above 账号) since it's read-only
  // curation; users don't need it on every visit.
  return (
    <PageContainer width="form">
      <PageHeader title="设置" description="外观、角色、开发者、记忆与账号" />
      <SettingsSectionNav active={activeSection} />
      <div className="space-y-6">
        <Section id="appearance" title="外观">
          <Row
            label="主题"
            description="跟随系统、浅色或深色。立即生效，记到本地。"
          >
            <ThemeSwitcher mode={mode} onChange={setMode} />
          </Row>
        </Section>

        <Section id="roles" title="AI 视角">
          <Link
            to="/settings/roles"
            className="-mx-4 flex items-center justify-between gap-4 rounded-md px-4 py-3 transition-colors hover:bg-foreground/[0.04]"
          >
            <div>
              <div className="text-sm font-medium">专业角色</div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                挑选 AI 处理任务时使用的视角（基础版自选 5 个 / 专业版全部 33 个）
              </p>
            </div>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </Link>
        </Section>

        <div id="api-keys" className="scroll-mt-24">
          <ApiKeysSection />
        </div>

        <MemorySection />

        <div id="notifications" className="scroll-mt-24">
          <NotificationsSection />
        </div>

        <Section id="account" title="账号">
          <Row
            label="删除账号"
            description="删除会清除任务记录、浏览器数据和订阅信息；需要先通过支持渠道确认身份"
          >
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDeleteDialogOpen(true)}
              className="text-red-600 hover:text-red-700"
            >
              申请删除
            </Button>
          </Row>
        </Section>
      </div>

      <ConfirmDialog
        open={deleteDialogOpen}
        title="申请删除账号？"
        description={
          '账号删除不可撤销。我们会通过邮件确认身份、处理订阅和数据删除，再完成账号关闭。'
        }
        confirmLabel="发送删除申请"
        destructive
        onClose={() => setDeleteDialogOpen(false)}
        onConfirm={() => {
          window.location.href = supportMailtoHref({
            subject: '删除 HOLA DAY 账号',
            body: '请协助删除我的 HOLA DAY 账号。\n\n注册邮箱：\n删除原因（选填）：',
          });
          setDeleteDialogOpen(false);
        }}
      />
    </PageContainer>
  );
}

function SettingsSectionNav({ active }: { active: SettingsSectionId }): JSX.Element {
  return (
    <nav
      aria-label="设置分区"
      className="sticky top-3 z-10 mb-5 rounded-lg border border-border bg-background/90 p-1 shadow-sm backdrop-blur"
    >
      <div className="grid grid-cols-3 gap-1 sm:grid-cols-6">
        {SETTINGS_SECTIONS.map((section) => (
          <Link
            key={section.id}
            to={settingsSectionHref(section.id)}
            aria-current={active === section.id ? 'true' : undefined}
            className={cn(
              'flex h-8 items-center justify-center rounded-md px-2.5 text-center text-xs font-medium transition-colors',
              active === section.id
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground',
            )}
          >
            {section.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}

function ThemeSwitcher({
  mode,
  onChange,
}: {
  mode: ThemeMode;
  onChange(m: ThemeMode): void;
}): JSX.Element {
  return (
    <div className="inline-grid grid-cols-3 gap-1 rounded-md bg-muted p-0.5">
      <ThemeOption
        active={mode === 'light'}
        onClick={() => onChange('light')}
        label="浅色"
      >
        <Sun className="h-3.5 w-3.5" />
      </ThemeOption>
      <ThemeOption
        active={mode === 'dark'}
        onClick={() => onChange('dark')}
        label="深色"
      >
        <Moon className="h-3.5 w-3.5" />
      </ThemeOption>
      <ThemeOption
        active={mode === 'system'}
        onClick={() => onChange('system')}
        label="跟随系统"
      >
        <Monitor className="h-3.5 w-3.5" />
      </ThemeOption>
    </div>
  );
}

function ThemeOption({
  active,
  onClick,
  label,
  children,
}: {
  active: boolean;
  onClick(): void;
  label: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={label}
      className={cn(
        'flex h-8 items-center justify-center gap-1 rounded px-3 text-xs transition-colors',
        active
          ? 'bg-background text-foreground shadow-sm'
          : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {children}
      <span>{label}</span>
    </button>
  );
}

/**
 * Phase 13 Dim 5 — AI memory management.
 *
 * Reads the agent's accumulated memory bank and lets the user
 * delete entries (single or all). Read + delete only — there's no
 * create flow because the agent populates this; users curating
 * what the agent remembers is the polish, not the entry method.
 */
function MemorySection(): JSX.Element {
  const toast = useToast();
  const mountedRef = React.useRef(false);
  const requestIdRef = React.useRef(0);
  const [memories, setMemories] = React.useState<MemoryRowView[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [confirming, setConfirming] = React.useState(false);
  const [deletingIds, setDeletingIds] = React.useState<ReadonlySet<string>>(
    () => new Set(),
  );

  const refresh = React.useCallback(async (options: { silent?: boolean } = {}) => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    try {
      const res = await trpc.memory.list.query();
      if (!mountedRef.current || requestId !== requestIdRef.current) return;
      setMemories(normalizeMemoryRows(res));
      setLoadError(null);
    } catch (err) {
      if (!mountedRef.current || requestId !== requestIdRef.current) return;
      const message = memoryLoadErrorMessage(err);
      setLoadError(message);
      if (!options.silent) toast.show('AI 记忆暂时无法加载', 'error');
      setMemories([]);
    } finally {
      if (mountedRef.current && requestId === requestIdRef.current) setLoading(false);
    }
  }, [toast]);

  React.useEffect(() => {
    mountedRef.current = true;
    void refresh({ silent: true });
    return () => {
      mountedRef.current = false;
      requestIdRef.current += 1;
    };
  }, [refresh]);

  const handleDelete = async (externalId: string): Promise<void> => {
    if (deletingIds.has(externalId)) return;
    setDeletingIds((prev) => new Set(prev).add(externalId));
    try {
      await trpc.memory.delete.mutate({ externalId });
      if (!mountedRef.current) return;
      setMemories((prev) => prev.filter((m) => m.externalId !== externalId));
      toast.show('已删除记忆', 'info');
    } catch (err) {
      if (!mountedRef.current) return;
      toast.show(pageActionError('删除失败', err), 'error');
    } finally {
      if (mountedRef.current) {
        setDeletingIds((prev) => {
          const next = new Set(prev);
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
      setMemories([]);
      setConfirming(false);
      toast.show('已清空 AI 记忆', 'info');
    } catch (err) {
      if (!mountedRef.current) return;
      toast.show(pageActionError('清空失败', err), 'error');
    }
  };
  const loadErrorCopy = memoryLoadErrorCopy(loadError);

  return (
    <Section id="memory" title="AI 记忆">
      <div className="space-y-3">
        <div className="flex items-start justify-between gap-3 text-sm text-muted-foreground">
          <p className="leading-relaxed">
            HOLA DAY 在任务结束后会自动记下值得保留的信息（你的偏好、网站经验、任务里程碑）。下次任务开始时，相关记忆会自动带入执行上下文。
          </p>
          {memories.length > 0 && (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              disabled={loading}
              title="清空全部 AI 记忆"
              className="inline-flex h-8 shrink-0 items-center rounded-md px-2 text-xs font-medium text-red-600 transition-colors hover:bg-red-50 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-50 dark:text-red-400 dark:hover:bg-red-950/25"
            >
              清空全部
            </button>
          )}
        </div>

        {loading ? (
          <div className="text-xs text-muted-foreground">加载中…</div>
        ) : loadError ? (
          <div className="rounded-md border border-border bg-card/40 px-3 py-4 text-center">
            <AlertCircle className="mx-auto h-6 w-6 text-primary" aria-hidden />
            <div className="mt-2 text-sm font-medium text-foreground/85">
              {loadErrorCopy.title}
            </div>
            <div className="mx-auto mt-1 max-w-md text-xs leading-5 text-muted-foreground">
              {loadErrorCopy.body}
            </div>
            <Button
              type="button"
              size="sm"
              className="mt-3"
              onClick={() => void refresh()}
            >
              重试
            </Button>
          </div>
        ) : memories.length === 0 ? (
          <div className="rounded-md border border-dashed border-border bg-card/40 px-3 py-3 text-xs text-muted-foreground">
            还没有记忆。完成一些任务后这里会逐步填充。
          </div>
        ) : (
          <ul className="space-y-2">
            {memories.map((m) => {
              const deleting = deletingIds.has(m.externalId);
              return (
                <li
                  key={m.externalId}
                  className="rounded-md border border-border bg-card px-3 py-2 text-sm"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                          {memoryCategoryLabel(m.category)}
                        </span>
                        <span className="truncate text-sm font-medium text-foreground">
                          {m.keyName}
                        </span>
                      </div>
                      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                        {m.value}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleDelete(m.externalId)}
                      disabled={deleting}
                      aria-label="删除记忆"
                      title={deleting ? '删除中' : '删除'}
                      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-red-950/25 dark:hover:text-red-400"
                    >
                      {deleting ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <X className="h-3.5 w-3.5" />
                      )}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {confirming && (
          <ConfirmDialog
            open
            title="清空全部 AI 记忆？"
            description="删除后 HOLA DAY 不再记得你的偏好、网站经验等历史信息。无法撤销。"
            confirmLabel="清空全部"
            destructive
            onClose={() => setConfirming(false)}
            onConfirm={handleClear}
          />
        )}
      </div>
    </Section>
  );
}
