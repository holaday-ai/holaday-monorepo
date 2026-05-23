/**
 * Phase 26B — add / edit notification channel modal.
 *
 * Four-card platform picker (企业微信 / 飞书 / 钉钉 / 自定义),
 * webhook URL input, custom-template JSON textarea (custom only),
 * "发送测试消息" button that calls notificationChannel.test, and
 * 保存 / 取消 actions.
 *
 * `initial` carries an existing channel when editing; null when
 * adding. The modal owns its own draft state and resets on each
 * open so closing + reopening doesn't keep a stale form.
 */

import { CheckCircle2, Loader2, X, XCircle } from 'lucide-react';
import * as React from 'react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import {
  NOTIFICATION_PLATFORM_LABEL,
  type NotificationPlatform,
} from '@/lib/notification-channel-copy';
import { cn } from '@/lib/utils';
import { trpc } from '@/lib/trpc';

export interface ChannelDraft {
  platform: NotificationPlatform;
  webhookUrl: string;
  /** Only meaningful when platform='custom'; the server ignores it
   *  for preset platforms. */
  customTemplate?: unknown;
}

interface Props {
  open: boolean;
  initial: {
    channelId: string;
    platform: ChannelDraft['platform'];
    webhookUrl: string;
    customTemplate: unknown;
  } | null;
  onClose: () => void;
  onSave: (draft: ChannelDraft) => Promise<void>;
}

const PLATFORM_CARDS: ReadonlyArray<{
  value: ChannelDraft['platform'];
  label: string;
  hint: string;
}> = [
  {
    value: 'wecom',
    label: NOTIFICATION_PLATFORM_LABEL.wecom,
    hint: 'qyapi.weixin.qq.com',
  },
  {
    value: 'feishu',
    label: NOTIFICATION_PLATFORM_LABEL.feishu,
    hint: 'open.feishu.cn / lark',
  },
  {
    value: 'dingtalk',
    label: NOTIFICATION_PLATFORM_LABEL.dingtalk,
    hint: 'oapi.dingtalk.com',
  },
  {
    value: 'custom',
    label: NOTIFICATION_PLATFORM_LABEL.custom,
    hint: '任意 HTTP webhook + 模板',
  },
];

const DEFAULT_CUSTOM_TEMPLATE = `{
  "text": "{{title}}\\n{{message}}"
}`;

export function AddChannelModal({
  open,
  initial,
  onClose,
  onSave,
}: Props): JSX.Element | null {
  const toast = useToast();
  const [platform, setPlatform] = React.useState<ChannelDraft['platform']>(
    initial?.platform ?? 'wecom',
  );
  const [webhookUrl, setWebhookUrl] = React.useState(initial?.webhookUrl ?? '');
  const [templateJson, setTemplateJson] = React.useState(() => {
    if (initial?.customTemplate) {
      try {
        return JSON.stringify(initial.customTemplate, null, 2);
      } catch {
        return DEFAULT_CUSTOM_TEMPLATE;
      }
    }
    return DEFAULT_CUSTOM_TEMPLATE;
  });
  const [testing, setTesting] = React.useState(false);
  const [testResult, setTestResult] = React.useState<
    { ok: boolean; message: string } | null
  >(null);
  const [saving, setSaving] = React.useState(false);

  const updateDraft = React.useCallback((fn: () => void) => {
    fn();
    setTestResult(null);
  }, []);

  const requestClose = React.useCallback(() => {
    if (saving || testing) return;
    onClose();
  }, [onClose, saving, testing]);

  // Reset draft state every time the modal opens. Without this, a
  // user who cancels + reopens sees their previous unsaved edits.
  React.useEffect(() => {
    if (!open) return;
    setPlatform(initial?.platform ?? 'wecom');
    setWebhookUrl(initial?.webhookUrl ?? '');
    setTemplateJson(
      initial?.customTemplate
        ? safeStringify(initial.customTemplate)
        : DEFAULT_CUSTOM_TEMPLATE,
    );
    setTestResult(null);
    setSaving(false);
  }, [open, initial]);

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') requestClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, requestClose]);

  if (!open) return null;

  const buildDraft = (): ChannelDraft | { error: string } => {
    if (!webhookUrl.trim()) return { error: '请填写 webhook URL' };
    try {
      new URL(webhookUrl.trim());
    } catch {
      return { error: 'webhook URL 格式不正确' };
    }
    if (platform === 'custom') {
      try {
        const parsed = JSON.parse(templateJson) as unknown;
        return {
          platform,
          webhookUrl: webhookUrl.trim(),
          customTemplate: parsed,
        };
      } catch (err) {
        return {
          error: `自定义模板不是合法 JSON：${err instanceof Error ? err.message : String(err)}`,
        };
      }
    }
    return { platform, webhookUrl: webhookUrl.trim() };
  };

  const handleTest = async (): Promise<void> => {
    const draft = buildDraft();
    if ('error' in draft) {
      setTestResult({ ok: false, message: draft.error });
      return;
    }
    setTesting(true);
    setTestResult(null);
    try {
      const res = await trpc.notificationChannels.test.mutate({
        platform: draft.platform,
        webhookUrl: draft.webhookUrl,
        ...(draft.platform === 'custom'
          ? { customTemplate: draft.customTemplate }
          : {}),
      });
      if (res.ok) {
        setTestResult({
          ok: true,
          message: `发送成功（HTTP ${res.status ?? 200}）`,
        });
      } else {
        setTestResult({
          ok: false,
          message: res.error ?? `发送失败（HTTP ${res.status ?? 0}）`,
        });
      }
    } catch (err) {
      setTestResult({
        ok: false,
        message: `测试请求失败：${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      setTesting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    const draft = buildDraft();
    if ('error' in draft) {
      toast.show(draft.error, 'error');
      return;
    }
    setSaving(true);
    try {
      await onSave(draft);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) requestClose();
      }}
    >
      <div className="hd-popover-enter w-full max-w-[520px] rounded-lg border border-border bg-popover shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h3 className="text-sm font-semibold">
            {initial ? '编辑通知渠道' : '添加通知渠道'}
          </h3>
          <button
            type="button"
            onClick={requestClose}
            disabled={saving || testing}
            className="text-muted-foreground hover:text-foreground"
            aria-label="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <form
          onSubmit={(e) => void handleSubmit(e)}
          className="space-y-4 px-4 py-4"
        >
          <div>
            <label className="mb-2 block text-xs font-medium text-muted-foreground">
              平台
            </label>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {PLATFORM_CARDS.map((p) => (
                <button
                  type="button"
                  key={p.value}
                  disabled={saving || testing}
                  onClick={() => {
                    updateDraft(() => setPlatform(p.value));
                  }}
                  className={cn(
                    'rounded-md border px-2 py-2 text-left transition-colors',
                    platform === p.value
                      ? 'border-[#EA1F59] bg-[#EA1F59]/10'
                      : 'border-border bg-card hover:border-[#EA1F59]/50',
                  )}
                >
                  <div
                    className={cn(
                      'text-sm font-medium',
                      platform === p.value ? 'text-[#EA1F59]' : 'text-foreground',
                    )}
                  >
                    {p.label}
                  </div>
                  <div className="mt-0.5 text-[10px] text-muted-foreground">
                    {p.hint}
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div>
            <label
              htmlFor="webhookUrl"
              className="mb-1 block text-xs font-medium text-muted-foreground"
            >
              Webhook URL
            </label>
            <input
              id="webhookUrl"
              type="url"
              value={webhookUrl}
              onChange={(e) => {
                const next = e.target.value;
                updateDraft(() => setWebhookUrl(next));
              }}
              placeholder="https://..."
              disabled={saving || testing}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-[#EA1F59]"
              maxLength={2000}
              autoFocus
            />
          </div>

          {platform === 'custom' && (
            <div>
              <label
                htmlFor="customTemplate"
                className="mb-1 block text-xs font-medium text-muted-foreground"
              >
                自定义 JSON 模板（占位符：{'{{title}}'} {'{{message}}'} {'{{status}}'} {'{{taskName}}'}）
              </label>
              <textarea
                id="customTemplate"
                value={templateJson}
                onChange={(e) => {
                  const next = e.target.value;
                  updateDraft(() => setTemplateJson(next));
                }}
                rows={6}
                disabled={saving || testing}
                className="w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-xs outline-none focus:border-[#EA1F59]"
              />
            </div>
          )}

          <div className="flex items-center gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => void handleTest()}
              disabled={testing || saving}
            >
              {testing ? (
                <Loader2 className="mr-1 h-3 w-3 animate-spin" />
              ) : null}
              发送测试消息
            </Button>
            {testResult && (
              <span
                className={cn(
                  'flex items-center gap-1 text-xs',
                  testResult.ok ? 'text-cyan-600 dark:text-cyan-300' : 'text-red-600',
                )}
              >
                {testResult.ok ? (
                  <CheckCircle2 className="h-3.5 w-3.5" />
                ) : (
                  <XCircle className="h-3.5 w-3.5" />
                )}
                {testResult.message}
              </span>
            )}
          </div>

          <div className="flex justify-end gap-2 border-t border-border pt-3">
            <Button
              type="button"
              variant="ghost"
              onClick={requestClose}
              disabled={saving || testing}
            >
              取消
            </Button>
            <Button
              type="submit"
              disabled={saving || testing}
              style={{ backgroundColor: '#EA1F59', borderColor: '#EA1F59' }}
              className="text-white hover:opacity-90"
            >
              {saving ? (
                <Loader2 className="mr-1 h-3 w-3 animate-spin" />
              ) : null}
              {initial ? '保存' : '添加'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return DEFAULT_CUSTOM_TEMPLATE;
  }
}
