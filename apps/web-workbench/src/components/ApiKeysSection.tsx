import { AlertCircle, Copy, Eye, EyeOff, Key, Plus, Trash2 } from 'lucide-react';
import * as React from 'react';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import {
  apiKeySettingsErrorMessage,
  normalizeApiKeyRows,
  normalizeFreshApiKey,
  type ApiKeyRowView,
  type FreshApiKeyView,
} from '@/lib/api-key-settings-state';
import { copyTextToClipboard } from '@/lib/copy-text';
import { trpc } from '@/lib/trpc';
import { webhookCurlExample } from '@/lib/webhook-docs-copy';
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

export function ApiKeysSection(): JSX.Element {
  const toast = useToast();
  const mountedRef = React.useRef(false);
  const requestIdRef = React.useRef(0);
  const [rows, setRows] = React.useState<ApiKeyRowView[] | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [newName, setNewName] = React.useState('');
  const [fresh, setFresh] = React.useState<FreshApiKeyView | null>(null);
  const [reveal, setReveal] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  // Revocation is high-risk on a settings page — every deployed
  // webhook starts 401-ing the moment we hit the endpoint. Surface
  // the key's name + prefix + last-used time in a product-internal
  // ConfirmDialog so the user can verify what they're killing.
  const [pendingRevoke, setPendingRevoke] = React.useState<ApiKeyRowView | null>(null);

  const reload = React.useCallback(async (options: { silent?: boolean } = {}): Promise<void> => {
    const requestId = ++requestIdRef.current;
    try {
      const list = await trpc.apiKeys.list.query();
      if (!mountedRef.current || requestId !== requestIdRef.current) return;
      setRows(normalizeApiKeyRows(list));
      setLoadError(null);
    } catch (err) {
      if (!mountedRef.current || requestId !== requestIdRef.current) return;
      const message = apiKeySettingsErrorMessage(
        err,
        'API Key 暂时无法加载，请稍后重试。',
      );
      setLoadError(message);
      if (!options.silent) toast.show(`加载失败：${message}`, 'error');
      setRows((current) => current ?? []);
    }
  }, [toast]);

  React.useEffect(() => {
    mountedRef.current = true;
    void reload({ silent: true });
    return () => {
      mountedRef.current = false;
      requestIdRef.current += 1;
    };
  }, [reload]);

  const submit = async (): Promise<void> => {
    if (submitting) return;
    const trimmed = newName.trim();
    if (!trimmed) {
      toast.show('请填写名称', 'error');
      return;
    }
    setSubmitting(true);
    try {
      const result = await trpc.apiKeys.create.mutate({ name: trimmed });
      if (!mountedRef.current) return;
      setFresh(normalizeFreshApiKey(result, trimmed));
      setReveal(false);
      setCreating(false);
      setNewName('');
      await reload();
    } catch (err) {
      if (!mountedRef.current) return;
      toast.show(apiKeySettingsErrorMessage(err, '创建失败'), 'error');
    } finally {
      if (mountedRef.current) setSubmitting(false);
    }
  };

  const performRevoke = async (key: ApiKeyRowView): Promise<void> => {
    try {
      await trpc.apiKeys.revoke.mutate({ apiKeyId: key.apiKeyId });
      if (!mountedRef.current) return;
      toast.show('已撤销');
      await reload();
    } catch (err) {
      if (!mountedRef.current) return;
      toast.show(apiKeySettingsErrorMessage(err, '撤销失败'), 'error');
    }
  };

  const copyPlaintext = async (): Promise<void> => {
    if (!fresh) return;
    const copied = await copyTextToClipboard(fresh.plaintext);
    if (!mountedRef.current) return;
    if (copied) {
      toast.show('已复制 API Key');
    } else {
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
        <div className="mb-4 flex flex-col gap-2 rounded-md border border-border bg-card/60 px-3 py-2 sm:flex-row sm:items-center">
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
          <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center">
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
        </div>
      )}

      <div className="rounded-md border border-border">
        {rows == null ? (
          <div className="flex h-20 items-center justify-center text-xs text-muted-foreground">
            加载中…
          </div>
        ) : loadError && activeRows.length === 0 && revokedRows.length === 0 ? (
          <ApiKeyLoadError message={loadError} onRetry={() => void reload()} />
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
              <ApiKeyRow key={k.apiKeyId} row={k} onRevoke={() => setPendingRevoke(k)} />
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

      <WebhookDocs />

      <ConfirmDialog
        open={pendingRevoke !== null}
        title="撤销这个 API Key？"
        description={
          pendingRevoke
            ? `${pendingRevoke.name} · ${pendingRevoke.keyPrefix}…\n上次使用：${pendingRevoke.lastUsedAt ? fmtDate(pendingRevoke.lastUsedAt) : '从未'}\n撤销后，已部署的 Zapier / webhook 调用会立即开始返回 401。`
            : ''
        }
        confirmLabel="撤销 API Key"
        destructive
        onClose={() => setPendingRevoke(null)}
        onConfirm={async () => {
          const k = pendingRevoke;
          if (!k) return;
          await performRevoke(k);
          if (mountedRef.current) setPendingRevoke(null);
        }}
      />
    </Section>
  );
}

function ApiKeyLoadError({
  message,
  onRetry,
}: {
  message: string;
  onRetry(): void;
}): JSX.Element {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
      <AlertCircle className="h-6 w-6 text-primary" aria-hidden />
      <div className="text-sm font-medium text-foreground/85">API Key 加载失败</div>
      <div className="max-w-md text-xs leading-5 text-muted-foreground">
        {message}
      </div>
      <Button type="button" size="sm" className="mt-1" onClick={onRetry}>
        重试
      </Button>
    </div>
  );
}

/**
 * Phase 5d follow-up — webhook docs panel.
 *
 * Two changes vs. the original:
 *   1. URL is dynamic: `${window.location.origin}/api/webhooks/tasks`
 *      so a user on hd-app.orangebench.tech sees that exact host
 *      instead of a hardcoded holaday.ai. The original "holaday.ai"
 *      placeholder was wrong for every non-production environment.
 *   2. Includes Zapier configuration steps + a curl example with
 *      Idempotency-Key so users see the retry-safe shape immediately.
 */
function WebhookDocs(): JSX.Element {
  const toast = useToast();
  // Origin is captured once on mount — SSR-safe via the typeof check;
  // window is always present in the SPA bundle but the type guard
  // keeps strict-mode bundlers happy.
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const webhookUrl = `${origin}/api/webhooks/tasks`;
  const curlExample = webhookCurlExample(webhookUrl);
  const copyUrl = async (): Promise<void> => {
    if (await copyTextToClipboard(webhookUrl)) {
      toast.show('已复制 Webhook URL');
    } else {
      toast.show('复制失败', 'error');
    }
  };
  const copyCurl = async (): Promise<void> => {
    if (await copyTextToClipboard(curlExample)) {
      toast.show('已复制 curl 示例');
    } else {
      toast.show('复制失败', 'error');
    }
  };
  return (
    <div className="mt-4 space-y-3">
      {/* URL row with one-click copy. */}
      <div className="rounded-md border border-dashed border-border bg-card/40 p-3">
        <div className="text-xs font-medium text-foreground/80">Webhook URL</div>
        <div className="mt-1.5 flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 font-mono text-[11px]">
          <span className="min-w-0 flex-1 break-all">{webhookUrl}</span>
          <button
            type="button"
            onClick={() => void copyUrl()}
            className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
            aria-label="复制 URL"
            title="复制"
          >
            <Copy className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Zapier steps. */}
      <details className="rounded-md border border-dashed border-border bg-card/40 p-3 text-[11px] text-muted-foreground">
        <summary className="cursor-pointer text-xs font-medium text-foreground/80">
          在 Zapier 里配置（5 步）
        </summary>
        <ol className="mt-2 list-decimal space-y-1 pl-4">
          <li>新建 Zap，选触发器（Email / Slack / RSS / 任意）</li>
          <li>添加 Action：搜 <span className="font-mono">Webhooks by Zapier</span> → POST</li>
          <li>URL 填上方 Webhook URL；Method = POST；Data Pass-Through = No</li>
          <li>
            Headers 加两条：
            <div className="mt-1 rounded bg-background p-2 font-mono">
              Authorization: Bearer hd_live_xxxxxxxxxxxxxxxxxxxxxxxx<br />
              Idempotency-Key: &#123;&#123;zap_meta_id&#125;&#125;
            </div>
            <p className="mt-1 leading-relaxed">
              <span className="font-medium text-foreground/80">用稳定 ID</span>：
              <span className="font-mono">zap_meta_id</span>{' '}
              是 Zapier 自动重试同一动作时保持不变的标识；也可用触发数据自身的稳定字段（邮件
              Message-ID、RSS GUID、Slack message ts 等）。
              <span className="font-medium text-foreground/80">避免</span>使用时间戳变量（如
              <span className="font-mono"> zap_meta_human_now</span>）—— 重试时时间会变，
              会被当成新 key 重复建任务。
            </p>
          </li>
          <li>
            Body 选 JSON，填：
            <div className="mt-1 rounded bg-background p-2 font-mono">
              &#123;"prompt": "&#123;&#123;trigger_field&#125;&#125;"&#125;
            </div>
          </li>
        </ol>
      </details>

      {/* curl example with Idempotency-Key. */}
      <div className="rounded-md border border-dashed border-border bg-card/40 p-3 text-[11px] text-muted-foreground">
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs font-medium text-foreground/80">curl 示例</div>
          <button
            type="button"
            onClick={() => void copyCurl()}
            className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
            aria-label="复制 curl 示例"
            title="复制 curl"
          >
            <Copy className="h-3.5 w-3.5" />
          </button>
        </div>
        <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-all rounded bg-background p-2 font-mono text-[10px]">
          {curlExample}
        </pre>
        <p className="mt-2">
          带 <span className="font-mono">Idempotency-Key</span> 的重复请求 24h 内会返回相同
          taskId；同 key 但不同 body 会返回 <span className="font-mono">409</span>。
        </p>
      </div>
    </div>
  );
}

function ApiKeyRow({
  row,
  onRevoke,
  muted,
}: {
  row: ApiKeyRowView;
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
