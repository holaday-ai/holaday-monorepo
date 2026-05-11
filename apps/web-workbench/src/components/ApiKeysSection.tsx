import { Copy, Eye, EyeOff, Key, Plus, Trash2 } from 'lucide-react';
import * as React from 'react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { trpc } from '@/lib/trpc';
import { Section } from '@/pages/PageShell';

/**
 * Phase 5d — API keys management section on the settings page.
 *
 * Flow:
 *   1. User clicks "新建 API Key", picks a name in a small inline form
 *   2. Server responds with `{ apiKeyId, plaintext, keyPrefix, name }`
 *   3. We show the plaintext in a one-time-reveal panel with copy
 *      buttons and a clear "this is shown only once" warning
 *   4. After the user dismisses the panel, the plaintext is gone —
 *      list only shows the prefix + name + last-used.
 *
 * Revocation is one-click with a confirm dialog; soft-deletes the
 * key (row stays for audit, lookups stop matching).
 */

interface UiApiKey {
  apiKeyId: string;
  name: string;
  keyPrefix: string;
  lastUsedAt: string | Date | null;
  expiresAt: string | Date | null;
  revokedAt: string | Date | null;
  createdAt: string | Date;
}

/** State of the freshly-minted key currently being shown one-time. */
interface FreshKeyState {
  apiKeyId: string;
  plaintext: string;
  name: string;
}

export function ApiKeysSection(): JSX.Element {
  const toast = useToast();
  const [rows, setRows] = React.useState<UiApiKey[] | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [newName, setNewName] = React.useState('');
  const [fresh, setFresh] = React.useState<FreshKeyState | null>(null);
  const [reveal, setReveal] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);

  const reload = React.useCallback(async (): Promise<void> => {
    try {
      const list = await trpc.apiKeys.list.query();
      setRows(list as UiApiKey[]);
    } catch (err) {
      toast.show(err instanceof Error ? `加载失败：${err.message}` : '加载失败', 'error');
      setRows([]);
    }
  }, [toast]);

  React.useEffect(() => {
    void reload();
  }, [reload]);

  const submit = async (): Promise<void> => {
    const trimmed = newName.trim();
    if (!trimmed) {
      toast.show('请填写名称', 'error');
      return;
    }
    setSubmitting(true);
    try {
      const result = await trpc.apiKeys.create.mutate({ name: trimmed });
      setFresh({
        apiKeyId: result.apiKeyId,
        plaintext: result.plaintext,
        name: result.name,
      });
      setReveal(false);
      setCreating(false);
      setNewName('');
      await reload();
    } catch (err) {
      toast.show(err instanceof Error ? err.message : '创建失败', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRevoke = async (key: UiApiKey): Promise<void> => {
    if (!window.confirm(`确认撤销 "${key.name}"？已部署的 webhook 调用会立即开始 401。`)) {
      return;
    }
    try {
      await trpc.apiKeys.revoke.mutate({ apiKeyId: key.apiKeyId });
      toast.show('已撤销');
      await reload();
    } catch (err) {
      toast.show(err instanceof Error ? err.message : '撤销失败', 'error');
    }
  };

  const copyPlaintext = async (): Promise<void> => {
    if (!fresh) return;
    try {
      await navigator.clipboard.writeText(fresh.plaintext);
      toast.show('已复制 API Key');
    } catch {
      toast.show('复制失败', 'error');
    }
  };

  const activeRows = rows?.filter((r) => !r.revokedAt) ?? [];
  const revokedRows = rows?.filter((r) => r.revokedAt) ?? [];

  return (
    <Section
      title="API Key"
      description="通过 webhook 触发任务。每个 Key 关联到你的账号，调用 webhook 时使用 Bearer 认证。"
    >
      {fresh && (
        <div className="mb-4 rounded-lg border border-primary/40 bg-primary/5 p-4">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/15 text-primary">
              <Key className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-foreground">
                新 Key 已创建 · {fresh.name}
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                这串字符只显示一次，关闭后我们无法再展示。请立即复制并妥善保管。
              </p>
              <div className="mt-3 flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 font-mono text-[12px]">
                <span className="min-w-0 flex-1 break-all">
                  {reveal ? fresh.plaintext : maskPlaintext(fresh.plaintext)}
                </span>
                <button
                  type="button"
                  onClick={() => setReveal((v) => !v)}
                  className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
                  aria-label={reveal ? '隐藏' : '显示'}
                  title={reveal ? '隐藏' : '显示'}
                >
                  {reveal ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
                <button
                  type="button"
                  onClick={() => void copyPlaintext()}
                  className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
                  aria-label="复制"
                  title="复制"
                >
                  <Copy className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="mt-3 flex justify-end">
                <button
                  type="button"
                  onClick={() => {
                    setFresh(null);
                    setReveal(false);
                  }}
                  className="rounded-md px-3 py-1 text-xs text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
                >
                  我已保存，关闭
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="mb-3 flex items-center justify-between">
        <div className="text-xs text-muted-foreground">
          {rows == null
            ? '加载中…'
            : activeRows.length === 0
              ? '尚无 API Key'
              : `${activeRows.length} 个有效 Key${revokedRows.length > 0 ? ` · ${revokedRows.length} 个已撤销` : ''}`}
        </div>
        {!creating && (
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="mr-1 h-3.5 w-3.5" />
            新建 API Key
          </Button>
        )}
      </div>

      {creating && (
        <div className="mb-4 flex items-center gap-2 rounded-md border border-border bg-card/60 px-3 py-2">
          <input
            type="text"
            value={newName}
            maxLength={100}
            placeholder="例如：Zapier 集成 / 内部脚本"
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                void submit();
              } else if (e.key === 'Escape') {
                setCreating(false);
                setNewName('');
              }
            }}
            className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1 text-sm focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
            ref={(el) => {
              // Focus on mount — equivalent to autoFocus but bypasses
              // the lint rule we don't have configured here.
              if (el && document.activeElement !== el) el.focus();
            }}
          />
          <Button size="sm" onClick={() => void submit()} disabled={submitting}>
            {submitting ? '创建中…' : '创建'}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setCreating(false);
              setNewName('');
            }}
            disabled={submitting}
          >
            取消
          </Button>
        </div>
      )}

      <div className="rounded-md border border-border">
        {rows == null ? (
          <div className="flex h-20 items-center justify-center text-xs text-muted-foreground">
            加载中…
          </div>
        ) : activeRows.length === 0 && revokedRows.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
            <Key className="h-6 w-6 text-muted-foreground/60" />
            <div className="text-xs text-muted-foreground">
              还没有 API Key。新建一个用于 webhook 调用。
            </div>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {activeRows.map((k) => (
              <ApiKeyRow key={k.apiKeyId} row={k} onRevoke={() => void handleRevoke(k)} />
            ))}
            {revokedRows.length > 0 && (
              <li className="bg-muted/30 px-4 py-2 text-[10px] uppercase tracking-wider text-muted-foreground">
                已撤销
              </li>
            )}
            {revokedRows.map((k) => (
              <ApiKeyRow key={k.apiKeyId} row={k} muted />
            ))}
          </ul>
        )}
      </div>

      <div className="mt-4 rounded-md border border-dashed border-border bg-card/40 p-3 text-[11px] text-muted-foreground">
        <div className="font-medium text-foreground/80">如何调用 webhook</div>
        <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-all rounded bg-background p-2 font-mono text-[10px]">
{`curl -X POST https://holaday.ai/api/webhooks/tasks \\
  -H "Authorization: Bearer hd_live_xxxxxxxxxxxxxxxxxxxxxxxx" \\
  -H "Content-Type: application/json" \\
  -d '{"prompt":"帮我查一下今天的科技新闻"}'`}
        </pre>
      </div>
    </Section>
  );
}

function ApiKeyRow({
  row,
  onRevoke,
  muted,
}: {
  row: UiApiKey;
  onRevoke?: () => void;
  muted?: boolean;
}): JSX.Element {
  return (
    <li
      className={`flex items-start gap-3 px-4 py-3 ${muted ? 'opacity-60' : ''}`}
    >
      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
        <Key className="h-3.5 w-3.5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium" title={row.name}>
          {row.name}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
          <span className="font-mono">{row.keyPrefix}…</span>
          <span>
            上次使用 {row.lastUsedAt ? fmtDate(row.lastUsedAt) : '从未'}
          </span>
          <span>创建 {fmtDate(row.createdAt)}</span>
          {row.expiresAt && <span>过期 {fmtDate(row.expiresAt)}</span>}
          {row.revokedAt && <span>已撤销 {fmtDate(row.revokedAt)}</span>}
        </div>
      </div>
      {onRevoke && !row.revokedAt && (
        <button
          type="button"
          onClick={onRevoke}
          aria-label="撤销"
          title="撤销"
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      )}
    </li>
  );
}

function maskPlaintext(plaintext: string): string {
  // Show prefix + 4 visible chars, then dots.
  if (plaintext.length <= 12) return plaintext;
  return `${plaintext.slice(0, 12)}${'•'.repeat(20)}`;
}

function fmtDate(input: string | Date | null | undefined): string {
  if (!input) return '—';
  try {
    const d = typeof input === 'string' ? new Date(input) : input;
    if (Number.isNaN(d.getTime())) return String(input);
    return d.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  } catch {
    return String(input);
  }
}
