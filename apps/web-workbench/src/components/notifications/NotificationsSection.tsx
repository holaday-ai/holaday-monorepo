/**
 * Phase 26B — settings/notifications block.
 *
 * Renders inside /settings between 记忆 and 账号. Two sub-sections:
 *
 *   1. 站内通知 — placeholder row that mirrors the future master
 *      toggle. Right now the inbox is always-on (mirroring what the
 *      runner already writes); we surface the row so the layout
 *      doesn't shift when Phase 26B+ wires a real opt-out.
 *
 *   2. 外部通知渠道 — list of webhook configs with platform icon,
 *      masked URL, enabled toggle, edit / delete buttons, and a
 *      "添加渠道" CTA that opens AddChannelModal.
 */

import { Loader2, Plus, Trash2, MessageSquare } from 'lucide-react';
import * as React from 'react';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';
import { trpc } from '@/lib/trpc';
import { Row, Section } from '@/pages/PageShell';
import { AddChannelModal, type ChannelDraft } from './AddChannelModal';

interface ChannelRow {
  channelId: string;
  platform: 'wecom' | 'feishu' | 'dingtalk' | 'custom';
  webhookUrl: string;
  customTemplate: unknown;
  enabled: boolean;
  createdAt: string | Date;
}

const PLATFORM_LABEL: Record<ChannelRow['platform'], string> = {
  wecom: '企业微信',
  feishu: '飞书',
  dingtalk: '钉钉',
  custom: '自定义',
};

export function NotificationsSection(): JSX.Element {
  const toast = useToast();
  const [channels, setChannels] = React.useState<ChannelRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [modalOpen, setModalOpen] = React.useState(false);
  const [editingChannel, setEditingChannel] = React.useState<ChannelRow | null>(null);
  const [confirmDelete, setConfirmDelete] = React.useState<string | null>(null);

  const refresh = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await trpc.notificationChannels.list.query();
      setChannels(res as ChannelRow[]);
    } catch (err) {
      toast.show(
        `加载失败：${err instanceof Error ? err.message : String(err)}`,
        'error',
      );
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleToggle = async (row: ChannelRow): Promise<void> => {
    const next = !row.enabled;
    setChannels((prev) =>
      prev.map((c) => (c.channelId === row.channelId ? { ...c, enabled: next } : c)),
    );
    try {
      await trpc.notificationChannels.update.mutate({
        channelId: row.channelId,
        enabled: next,
      });
    } catch (err) {
      // Revert on failure
      setChannels((prev) =>
        prev.map((c) =>
          c.channelId === row.channelId ? { ...c, enabled: row.enabled } : c,
        ),
      );
      toast.show(
        `操作失败：${err instanceof Error ? err.message : String(err)}`,
        'error',
      );
    }
  };

  const handleSave = async (draft: ChannelDraft): Promise<void> => {
    try {
      if (editingChannel) {
        await trpc.notificationChannels.update.mutate({
          channelId: editingChannel.channelId,
          platform: draft.platform,
          webhookUrl: draft.webhookUrl,
          ...(draft.platform === 'custom'
            ? { customTemplate: draft.customTemplate }
            : {}),
        });
        toast.show('已更新通知渠道', 'info');
      } else {
        await trpc.notificationChannels.create.mutate({
          platform: draft.platform,
          webhookUrl: draft.webhookUrl,
          ...(draft.platform === 'custom'
            ? { customTemplate: draft.customTemplate }
            : {}),
        });
        toast.show('已添加通知渠道', 'info');
      }
      setModalOpen(false);
      setEditingChannel(null);
      await refresh();
    } catch (err) {
      toast.show(
        `保存失败：${err instanceof Error ? err.message : String(err)}`,
        'error',
      );
    }
  };

  const handleDelete = async (channelId: string): Promise<void> => {
    try {
      await trpc.notificationChannels.delete.mutate({ channelId });
      toast.show('已删除通知渠道', 'info');
      setConfirmDelete(null);
      await refresh();
    } catch (err) {
      toast.show(
        `删除失败：${err instanceof Error ? err.message : String(err)}`,
        'error',
      );
    }
  };

  return (
    <>
      <Section title="通知设置">
        <Row
          label="站内通知"
          description="任务开始、提前提醒、完成或失败时在右上角铃铛收到通知。"
        >
          <span className="text-xs text-muted-foreground">默认开启</span>
        </Row>
        <div className="-mx-4 mt-3 border-t border-border/50">
          <div className="flex items-center justify-between px-4 py-3">
            <div>
              <div className="text-sm font-medium">外部通知渠道</div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                同步推送任务开始、提前提醒、完成和失败事件
              </p>
            </div>
            <Button
              type="button"
              size="sm"
              onClick={() => {
                setEditingChannel(null);
                setModalOpen(true);
              }}
            >
              <Plus className="mr-1 h-3 w-3" />
              添加渠道
            </Button>
          </div>
          {loading ? (
            <div className="px-4 pb-4 text-xs text-muted-foreground">
              <Loader2 className="mr-1 inline h-3 w-3 animate-spin" />
              加载中…
            </div>
          ) : channels.length === 0 ? (
            <div className="rounded-md border border-dashed border-border bg-card/40 px-4 py-3 text-xs text-muted-foreground mx-4 mb-2">
              还没有外部通知渠道。
            </div>
          ) : (
            <ul className="space-y-2 px-4 pb-2">
              {channels.map((row) => (
                <li
                  key={row.channelId}
                  className="flex items-center gap-3 rounded-md border border-border bg-card px-3 py-2"
                >
                  <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded bg-muted text-foreground">
                    <MessageSquare className="h-3.5 w-3.5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">
                        {PLATFORM_LABEL[row.platform]}
                      </span>
                      {!row.enabled && (
                        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                          已禁用
                        </span>
                      )}
                    </div>
                    <div
                      className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground"
                      title={row.webhookUrl}
                    >
                      {maskUrl(row.webhookUrl)}
                    </div>
                  </div>
                  <label
                    className={cn(
                      'flex h-5 w-9 cursor-pointer items-center rounded-full p-0.5 transition-colors',
                      row.enabled ? 'bg-[#E50B6B]' : 'bg-muted-foreground/40',
                    )}
                    title={row.enabled ? '禁用' : '启用'}
                  >
                    <input
                      type="checkbox"
                      className="sr-only"
                      checked={row.enabled}
                      onChange={() => void handleToggle(row)}
                    />
                    <span
                      className={cn(
                        'h-4 w-4 rounded-full bg-white transition-transform',
                        row.enabled && 'translate-x-4',
                      )}
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingChannel(row);
                      setModalOpen(true);
                    }}
                    className="text-xs text-muted-foreground hover:text-foreground"
                  >
                    编辑
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(row.channelId)}
                    className="text-muted-foreground hover:text-red-600"
                    aria-label="删除渠道"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Section>

      <AddChannelModal
        open={modalOpen}
        initial={editingChannel}
        onClose={() => {
          setModalOpen(false);
          setEditingChannel(null);
        }}
        onSave={handleSave}
      />
      <ConfirmDialog
        open={confirmDelete !== null}
        title="删除通知渠道？"
        description="删除后该渠道将不再收到任何通知。已发出的通知不受影响。"
        confirmLabel="删除"
        destructive
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => {
          if (confirmDelete) void handleDelete(confirmDelete);
        }}
      />
    </>
  );
}

/**
 * Mask a webhook URL for the settings list. Mirrors the server's
 * `maskWebhookUrl` shape so the user sees the same masked form
 * whether they're looking at the saved config or a recent test
 * result.
 */
function maskUrl(url: string): string {
  try {
    const u = new URL(url);
    const tail = url.length > 6 ? url.slice(-6) : url;
    return `${u.host}/...${tail}`;
  } catch {
    if (url.length <= 12) return url;
    return `${url.slice(0, 6)}...${url.slice(-6)}`;
  }
}
