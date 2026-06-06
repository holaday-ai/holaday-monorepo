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

import { Loader2, MessageSquare, Pencil, Plus, Trash2 } from 'lucide-react';
import * as React from 'react';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import {
  maskWebhookUrl,
  NOTIFICATION_PLATFORM_LABEL,
  notificationChannelDeleteDescription,
} from '@/lib/notification-channel-copy';
import {
  normalizeNotificationChannels,
  notificationChannelsLoadErrorCopy,
  notificationChannelsLoadErrorMessage,
  type NotificationChannelRow,
} from '@/lib/notification-channel-state';
import { pageActionError } from '@/lib/page-error-copy';
import { cn } from '@/lib/utils';
import { trpc } from '@/lib/trpc';
import { Row, Section } from '@/pages/PageShell';
import { AddChannelModal, type ChannelDraft } from './AddChannelModal';

export function NotificationsSection(): JSX.Element {
  const toast = useToast();
  const mountedRef = React.useRef(false);
  const requestIdRef = React.useRef(0);
  const [channels, setChannels] = React.useState<NotificationChannelRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [modalOpen, setModalOpen] = React.useState(false);
  const [editingChannel, setEditingChannel] =
    React.useState<NotificationChannelRow | null>(null);
  const [confirmDelete, setConfirmDelete] = React.useState<string | null>(null);
  const [pendingChannelId, setPendingChannelId] = React.useState<string | null>(null);

  const refresh = React.useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setLoadError(null);
    try {
      const res = await trpc.notificationChannels.list.query();
      if (!mountedRef.current || requestId !== requestIdRef.current) return;
      setChannels(normalizeNotificationChannels(res));
    } catch (err) {
      if (!mountedRef.current || requestId !== requestIdRef.current) return;
      const message = notificationChannelsLoadErrorMessage(err);
      setLoadError(message);
      toast.show('通知渠道暂时无法加载', 'error');
    } finally {
      if (mountedRef.current && requestId === requestIdRef.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    mountedRef.current = true;
    void refresh();
    return () => {
      mountedRef.current = false;
      requestIdRef.current += 1;
    };
  }, [refresh]);

  const handleToggle = async (row: NotificationChannelRow): Promise<void> => {
    if (pendingChannelId === row.channelId) return;
    const next = !row.enabled;
    setPendingChannelId(row.channelId);
    setChannels((prev) =>
      prev.map((c) => (c.channelId === row.channelId ? { ...c, enabled: next } : c)),
    );
    try {
      await trpc.notificationChannels.update.mutate({
        channelId: row.channelId,
        enabled: next,
      });
    } catch (err) {
      if (!mountedRef.current) return;
      // Revert on failure
      setChannels((prev) =>
        prev.map((c) =>
          c.channelId === row.channelId ? { ...c, enabled: row.enabled } : c,
        ),
      );
      toast.show(pageActionError('操作失败', err), 'error');
    } finally {
      if (mountedRef.current) setPendingChannelId(null);
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
        if (!mountedRef.current) return;
        toast.show('已更新通知渠道', 'info');
      } else {
        await trpc.notificationChannels.create.mutate({
          platform: draft.platform,
          webhookUrl: draft.webhookUrl,
          ...(draft.platform === 'custom'
            ? { customTemplate: draft.customTemplate }
            : {}),
        });
        if (!mountedRef.current) return;
        toast.show('已添加通知渠道', 'info');
      }
      setModalOpen(false);
      setEditingChannel(null);
      await refresh();
    } catch (err) {
      if (!mountedRef.current) return;
      toast.show(pageActionError('保存失败', err), 'error');
    }
  };

  const handleDelete = async (channelId: string): Promise<void> => {
    setPendingChannelId(channelId);
    try {
      await trpc.notificationChannels.delete.mutate({ channelId });
      if (!mountedRef.current) return;
      toast.show('已删除通知渠道', 'info');
      setConfirmDelete(null);
      await refresh();
    } catch (err) {
      if (!mountedRef.current) return;
      toast.show(pageActionError('删除失败', err), 'error');
    } finally {
      if (mountedRef.current) setPendingChannelId(null);
    }
  };

  const pendingDeleteChannel =
    confirmDelete === null
      ? null
      : channels.find((row) => row.channelId === confirmDelete) ?? null;

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
          {loadError && !loading && (
            <div className="mx-4 mb-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-[#EA1F59]/25 bg-[#EA1F59]/5 px-3 py-2 text-xs text-muted-foreground">
              <span className="min-w-0 flex-1">
                <span className="block font-medium text-[#EA1F59]">
                  {notificationChannelsLoadErrorCopy(loadError).title}
                </span>
                <span className="mt-1 block">{loadError}</span>
              </span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void refresh()}
              >
                重试
              </Button>
            </div>
          )}
          {loading ? (
            <div className="px-4 pb-4 text-xs text-muted-foreground">
              <Loader2 className="mr-1 inline h-3 w-3 animate-spin" />
              加载中…
            </div>
          ) : channels.length === 0 ? (
            <div className="mx-4 mb-2 rounded-md border border-dashed border-[#DCDDDD] bg-white px-4 py-3 text-xs text-muted-foreground dark:border-white/10 dark:bg-card/85">
              还没有外部通知渠道。
            </div>
          ) : (
            <ul className="space-y-2 px-4 pb-2">
              {channels.map((row) => {
                const rowPending = pendingChannelId === row.channelId;
                return (
                <li
                  key={row.channelId}
                  className="flex items-center gap-3 rounded-md border border-[#DCDDDD] bg-white px-3 py-2 shadow-[0_1px_3px_rgba(17,24,39,0.05)] dark:border-white/10 dark:bg-card/85"
                >
                  <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md border border-[#DCDDDD] bg-[#EFEFEF]/55 text-[#595757] dark:border-white/10 dark:bg-white/10 dark:text-foreground">
                    <MessageSquare className="h-3.5 w-3.5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">
                        {NOTIFICATION_PLATFORM_LABEL[row.platform]}
                      </span>
                      {!row.enabled && (
                        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                          已禁用
                        </span>
                      )}
                    </div>
                    <div
                      className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground"
                      title={maskWebhookUrl(row.webhookUrl)}
                    >
                      {maskWebhookUrl(row.webhookUrl)}
                    </div>
                  </div>
                  <label
                    className={cn(
                      'flex h-8 w-12 cursor-pointer items-center rounded-full p-1 transition-colors',
                      rowPending && 'cursor-wait opacity-70',
                      row.enabled ? 'bg-[#EA1F59]' : 'bg-muted-foreground/40',
                    )}
                    title={rowPending ? '正在更新' : row.enabled ? '禁用' : '启用'}
                  >
                    <input
                      type="checkbox"
                      className="sr-only"
                      checked={row.enabled}
                      disabled={rowPending}
                      aria-label={`${row.enabled ? '禁用' : '启用'}${NOTIFICATION_PLATFORM_LABEL[row.platform]}通知渠道`}
                      onChange={() => void handleToggle(row)}
                    />
                    <span
                      className={cn(
                        'h-6 w-6 rounded-full bg-white transition-transform',
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
                    disabled={rowPending}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-[#EFEFEF]/70 hover:text-foreground disabled:pointer-events-none disabled:opacity-40 dark:hover:bg-white/10"
                    aria-label={`编辑${NOTIFICATION_PLATFORM_LABEL[row.platform]}通知渠道`}
                    title={rowPending ? '正在更新' : '编辑'}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(row.channelId)}
                    disabled={rowPending}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-[#EA1F59]/10 hover:text-[#EA1F59] disabled:pointer-events-none disabled:opacity-40"
                    aria-label="删除渠道"
                    title={rowPending ? '正在更新' : '删除'}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </li>
                );
              })}
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
        description={
          pendingDeleteChannel
            ? notificationChannelDeleteDescription(pendingDeleteChannel)
            : '删除后该渠道将不再收到任何通知。已发出的通知不受影响。'
        }
        confirmLabel="删除"
        destructive
        onClose={() => setConfirmDelete(null)}
        onConfirm={async () => {
          if (confirmDelete) await handleDelete(confirmDelete);
        }}
      />
    </>
  );
}
