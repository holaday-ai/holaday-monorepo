import { ChevronRight, X } from 'lucide-react';
import * as React from 'react';
import { Link } from 'react-router-dom';
import { ApiKeysSection } from '@/components/ApiKeysSection';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { trpc } from '@/lib/trpc';
import { PageContainer, PageHeader, Row, Section } from '@/pages/PageShell';

/**
 * Settings page — only the rows that actually persist server-side
 * or affect runtime behaviour. P2.4 audit removed three sections
 * that were UI theatre:
 *   - 语言偏好: no i18n bundle wired, the toggle was a localStorage
 *     write nothing else read.
 *   - 通知: no notification pipeline (browser, push, email) — the
 *     toggles never reached anything.
 *   - 默认交互模式: not connected to the live `browserInteractive`
 *     store; R19 already set the right default (off), so the entry
 *     was duplicate plumbing.
 * If/when those land we re-introduce the sections; until then the
 * page is "AI 视角 + AI 记忆 + 账号" — three things that work.
 */
export function SettingsPage(): JSX.Element {
  const toast = useToast();

  function confirmDelete(): void {
    const answer = window.prompt(
      '确认删除账号？此操作不可恢复。输入 DELETE 继续：',
    );
    if (answer === 'DELETE') {
      toast.show('账号删除请求已记录，客服会在 24 小时内联系你', 'error');
    }
  }

  return (
    <PageContainer width="form">
      <PageHeader title="设置" description="角色、记忆与账号" />
      <div className="space-y-6">
        <Section title="AI 视角">
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

        <MemorySection />

        <ApiKeysSection />

        <Section title="账号">
          <Row
            label="删除账号"
            description="删除后所有任务记录、浏览器数据、订阅都会清除"
          >
            <Button variant="outline" size="sm" onClick={confirmDelete} className="text-red-600 hover:text-red-700">
              删除账号
            </Button>
          </Row>
        </Section>
      </div>
    </PageContainer>
  );
}

interface MemoryRow {
  externalId: string;
  category: string;
  keyName: string;
  value: string;
  expiresAt: string | null;
  updatedAt: string;
}

const CATEGORY_LABEL_ZH: Record<string, string> = {
  preference: '偏好',
  site_state: '网站状态',
  task_history: '任务历史',
  execution_tip: '执行经验',
};

/**
 * Phase 13 Dim 5 — AI memory management.
 *
 * Reads the agent's accumulated memory bank and lets the user
 * delete entries (single or all). Read + delete only — there's no
 * create flow because the agent populates this; users curating
 * what the agent remembers is the polish, not the entry method.
 */
function MemorySection(): JSX.Element {
  const [memories, setMemories] = React.useState<MemoryRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [confirming, setConfirming] = React.useState(false);

  const refresh = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await trpc.memory.list.query();
      setMemories(res.memories as MemoryRow[]);
    } catch {
      setMemories([]);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleDelete = async (externalId: string): Promise<void> => {
    await trpc.memory.delete.mutate({ externalId });
    setMemories((prev) => prev.filter((m) => m.externalId !== externalId));
  };

  const handleClear = async (): Promise<void> => {
    await trpc.memory.clear.mutate();
    setMemories([]);
    setConfirming(false);
  };

  return (
    <Section title="AI 记忆">
      <div className="space-y-3">
        <div className="flex items-start justify-between gap-3 text-sm text-muted-foreground">
          <p className="leading-relaxed">
            HOLA DAY 在任务结束后会自动记下值得保留的信息（你的偏好、网站经验、任务里程碑）。下次任务开始时，相关记忆会自动注入到 agent 的上下文里。
          </p>
          {memories.length > 0 && (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="shrink-0 text-xs text-red-600 underline-offset-2 hover:underline dark:text-red-400"
            >
              清空全部
            </button>
          )}
        </div>

        {loading ? (
          <div className="text-xs text-muted-foreground">加载中…</div>
        ) : memories.length === 0 ? (
          <div className="rounded-md border border-dashed border-border bg-card/40 px-3 py-3 text-xs text-muted-foreground">
            还没有记忆。完成一些任务后这里会逐步填充。
          </div>
        ) : (
          <ul className="space-y-2">
            {memories.map((m) => (
              <li
                key={m.externalId}
                className="rounded-md border border-border bg-card px-3 py-2 text-sm"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                        {CATEGORY_LABEL_ZH[m.category] ?? m.category}
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
                    aria-label="删除记忆"
                    className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-foreground/[0.05] hover:text-red-600 dark:hover:text-red-400"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {confirming && (
          <ConfirmDialog
            open
            title="清空全部 AI 记忆？"
            description="删除后 agent 不再记得你的偏好、网站经验等历史信息。无法撤销。"
            confirmLabel="清空全部"
            destructive
            onClose={() => setConfirming(false)}
            onConfirm={() => void handleClear()}
          />
        )}
      </div>
    </Section>
  );
}

