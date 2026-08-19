/**
 * Phase 26B — notification service.
 *
 * Single entry point — `notify(deps, input)` — that:
 *   1. Writes a row to the `notifications` table (in-app inbox)
 *   2. Reads the user's enabled `notification_channels`
 *   3. Fan-outs the webhook via Promise.allSettled (no channel can
 *      block the others; failures log + continue)
 *
 * The service is called from the scheduled-task runner on every
 * dispatch attempt. It NEVER throws — the runner's correctness
 * depends on the dispatch path continuing regardless of notification
 * outcomes.
 *
 * Dependencies are injected so tests can stub the DB + sender
 * without spinning up MySQL.
 */

import { eq, and } from 'drizzle-orm';
import { newExternalId } from '@holaday/shared-types';
import type { Logger } from 'pino';
import {
  notificationChannels,
  notifications,
} from '../db/schema/notifications.js';
import {
  sendWebhook,
  type NotificationPlatform,
  type NotificationType,
  type WebhookContext,
  type SendResult,
} from './webhook-sender.js';

export interface NotifyInput {
  /** Internal users.id (bigint) — same shape used elsewhere in the
   *  orchestrator. The router translates externalId → internal at
   *  the edge. */
  userInternalId: number;
  type: NotificationType;
  title: string;
  message: string;
  /** Internal scheduled_tasks.id (bigint), or null for non-task
   *  notifications. */
  scheduledTaskInternalId?: number | null;
  /** Internal planned_tasks.id for a planned-task detail deep link. */
  plannedTaskInternalId?: number | null;
  /** Stock-risk alerts are deliberately inbox-only until users have
   *  explicit per-topic external-channel controls. */
  delivery?: 'all' | 'in_app_only';
  /** Optional task label that flows into the webhook context's
   *  `taskName` placeholder. */
  taskName?: string;
}

export interface NotifyResult {
  /** The external_id of the newly-written notifications row. */
  notificationId: string;
  /** Whether the in-app inbox row was durably written. */
  inAppStored: boolean;
  /** Outcome of every channel fan-out attempt. Always present, may
   *  be empty when the user has no enabled channels. */
  channelResults: Array<{ channelExternalId: string; result: SendResult }>;
}

export interface NotifyDeps {
  db: Pick<typeof import('../db/client.js').db, 'insert' | 'select'>;
  logger?: Pick<Logger, 'info' | 'warn' | 'error'>;
  /** Override for tests — defaults to the real sendWebhook. */
  send?: typeof sendWebhook;
}

/**
 * Map a NotificationType to the WebhookContext.status field used by
 * the templating layer. Status drives the visual "状态：失败" suffix
 * in preset messages + the `{{status}}` placeholder in custom
 * templates.
 */
function typeToStatus(type: NotificationType): WebhookContext['status'] {
  if (type === 'task_started') return 'started';
  if (type === 'task_failed') return 'failed';
  if (type === 'task_skipped') return 'skipped';
  if (type === 'task_reminder') return 'reminder';
  return 'success';
}

/**
 * Write the inbox row + fire any enabled webhooks. Never throws.
 *
 * Implementation notes:
 *   - The inbox INSERT happens first so a webhook failure doesn't
 *     swallow the user-visible record.
 *   - Channel fan-out is parallel via Promise.allSettled.
 *   - sendWebhook itself never throws — it returns {ok:false,
 *     error} on any failure. The allSettled wrap is belt-and-braces
 *     in case a future sender misbehaves.
 */
export async function notify(
  deps: NotifyDeps,
  input: NotifyInput,
): Promise<NotifyResult> {
  const send = deps.send ?? sendWebhook;
  const externalId = newExternalId('notification');

  // 1. Inbox row.
  try {
    await deps.db.insert(notifications).values({
      externalId,
      userId: input.userInternalId,
      type: input.type,
      title: input.title,
      message: input.message,
      scheduledTaskId: input.scheduledTaskInternalId ?? null,
      plannedTaskId: input.plannedTaskInternalId ?? null,
      isRead: false,
    });
  } catch (err) {
    deps.logger?.error(
      {
        err: err instanceof Error ? err.message : String(err),
        userInternalId: input.userInternalId,
      },
      'notify: inbox insert failed',
    );
    // Without an inbox row, channel fan-out would still be useful,
    // but a DB failure here usually means everything is broken —
    // bail. The runner's dispatch path is unaffected.
    return { notificationId: externalId, inAppStored: false, channelResults: [] };
  }

  if (input.delivery === 'in_app_only') {
    return { notificationId: externalId, inAppStored: true, channelResults: [] };
  }

  // 2. Enumerate enabled channels.
  let channels: Array<{
    externalId: string;
    platform: string;
    webhookUrl: string;
    customTemplate: unknown;
  }>;
  try {
    channels = await deps.db
      .select({
        externalId: notificationChannels.externalId,
        platform: notificationChannels.platform,
        webhookUrl: notificationChannels.webhookUrl,
        customTemplate: notificationChannels.customTemplate,
      })
      .from(notificationChannels)
      .where(
        and(
          eq(notificationChannels.userId, input.userInternalId),
          eq(notificationChannels.enabled, true),
        ),
      );
  } catch (err) {
    deps.logger?.warn(
      {
        err: err instanceof Error ? err.message : String(err),
        userInternalId: input.userInternalId,
      },
      'notify: channel select failed; inbox row stands',
    );
    return { notificationId: externalId, inAppStored: true, channelResults: [] };
  }

  if (channels.length === 0) {
    return { notificationId: externalId, inAppStored: true, channelResults: [] };
  }

  // 3. Fan-out.
  const ctx: WebhookContext = {
    title: input.title,
    message: input.message,
    status: typeToStatus(input.type),
    taskName: input.taskName ?? '',
  };
  const settled = await Promise.allSettled(
    channels.map((c) =>
      send(
        {
          platform: c.platform as NotificationPlatform,
          webhookUrl: c.webhookUrl,
          customTemplate: c.customTemplate ?? undefined,
        },
        ctx,
        { logger: deps.logger },
      ),
    ),
  );
  const channelResults = settled.map((s, i) => {
    const ch = channels[i];
    if (!ch) throw new Error(`notify: missing channel result at index ${i}`);
    if (s.status === 'fulfilled') {
      return { channelExternalId: ch.externalId, result: s.value };
    }
    // sendWebhook shouldn't reject; if a future change introduces a
    // throw, surface it as a structured failure so callers can log.
    return {
      channelExternalId: ch.externalId,
      result: {
        ok: false,
        attempt: 0,
        error: s.reason instanceof Error ? s.reason.message : String(s.reason),
      } satisfies SendResult,
    };
  });
  const okCount = channelResults.filter((c) => c.result.ok).length;
  deps.logger?.info(
    {
      userInternalId: input.userInternalId,
      total: channels.length,
      ok: okCount,
      notificationId: externalId,
    },
    'notify: fan-out complete',
  );
  return { notificationId: externalId, inAppStored: true, channelResults };
}
