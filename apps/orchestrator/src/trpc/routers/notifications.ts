/**
 * Phase 26B — notification + notification-channel tRPC routers.
 *
 * Notifications (per-user inbox):
 *   - list          paginated + unreadOnly filter
 *   - unreadCount   cheap COUNT(*) for the bell badge poll
 *   - markRead      single row by externalId
 *   - markAllRead   user-scoped bulk
 *
 * Notification channels (per-user external webhooks):
 *   - list, create, update, delete
 *   - test          fires one preview message; surfaces ok / error
 *                   so the user can verify the URL before saving.
 *                   `test` is intentionally NOT gated by `enabled` —
 *                   a disabled channel can still be tested before
 *                   re-enabling.
 *
 * Every mutation re-validates the user's ownership of the row via
 * the same `requireUserId` helper used by other routers.
 */

import { newExternalId } from '@holaday/shared-types';
import { TRPCError } from '@trpc/server';
import { and, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  notificationChannels,
  notifications,
} from '../../db/schema/notifications.js';
import { users } from '../../db/schema/users.js';
import {
  buildPayload,
  sendWebhook,
  type NotificationPlatform,
  type WebhookContext,
} from '../../notifications/webhook-sender.js';
import { protectedProcedure, router } from '../trpc.js';

const PLATFORMS = ['wecom', 'feishu', 'dingtalk', 'custom'] as const;

async function requireUserId(
  ctx: { db: typeof import('../../db/client.js').db; userId: string },
): Promise<number> {
  const [row] = await ctx.db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.externalId, ctx.userId))
    .limit(1);
  if (!row) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'unknown user' });
  }
  return row.id;
}

/**
 * Validate that `custom` channels carry a serialisable template
 * object. Other platforms must NOT carry a template (we hard-code
 * their preset shape). Returns the cleaned template (or undefined).
 */
function normaliseTemplate(
  platform: NotificationPlatform,
  template: unknown,
): unknown {
  if (platform === 'custom') {
    if (template === undefined || template === null) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: '自定义平台必须提供 JSON 模板',
      });
    }
    return template;
  }
  // Preset platforms ignore any template the caller sent — null it
  // out so the column doesn't get polluted with stale data.
  return null;
}

export const notificationsRouter = router({
  list: protectedProcedure
    .input(
      z
        .object({
          unreadOnly: z.boolean().optional(),
          limit: z.number().int().positive().max(100).default(50),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const userId = await requireUserId(ctx);
      const limit = input?.limit ?? 50;
      const whereClause =
        input?.unreadOnly === true
          ? and(eq(notifications.userId, userId), eq(notifications.isRead, false))
          : eq(notifications.userId, userId);
      const rows = await ctx.db
        .select({
          externalId: notifications.externalId,
          type: notifications.type,
          title: notifications.title,
          message: notifications.message,
          isRead: notifications.isRead,
          createdAt: notifications.createdAt,
          scheduledTaskId: notifications.scheduledTaskId,
        })
        .from(notifications)
        .where(whereClause)
        .orderBy(desc(notifications.createdAt))
        .limit(limit);
      return rows.map((r) => ({
        notificationId: r.externalId,
        type: r.type,
        title: r.title,
        message: r.message,
        isRead: r.isRead,
        createdAt: r.createdAt,
        scheduledTaskInternalId: r.scheduledTaskId,
      }));
    }),

  unreadCount: protectedProcedure.query(async ({ ctx }) => {
    const userId = await requireUserId(ctx);
    // COUNT(*) over the (userId, isRead) composite index — bell
    // badge polling stays cheap even with thousands of rows.
    const [row] = await ctx.db
      .select({ c: sql<number>`COUNT(*)` })
      .from(notifications)
      .where(and(eq(notifications.userId, userId), eq(notifications.isRead, false)));
    return { count: Number(row?.c ?? 0) };
  }),

  markRead: protectedProcedure
    .input(z.object({ notificationId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const userId = await requireUserId(ctx);
      await ctx.db
        .update(notifications)
        .set({ isRead: true })
        .where(
          and(
            eq(notifications.externalId, input.notificationId),
            eq(notifications.userId, userId),
          ),
        );
      return { ok: true as const };
    }),

  markAllRead: protectedProcedure.mutation(async ({ ctx }) => {
    const userId = await requireUserId(ctx);
    await ctx.db
      .update(notifications)
      .set({ isRead: true })
      .where(
        and(eq(notifications.userId, userId), eq(notifications.isRead, false)),
      );
    return { ok: true as const };
  }),
});

export const notificationChannelsRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    const userId = await requireUserId(ctx);
    const rows = await ctx.db
      .select({
        externalId: notificationChannels.externalId,
        platform: notificationChannels.platform,
        webhookUrl: notificationChannels.webhookUrl,
        customTemplate: notificationChannels.customTemplate,
        enabled: notificationChannels.enabled,
        createdAt: notificationChannels.createdAt,
      })
      .from(notificationChannels)
      .where(eq(notificationChannels.userId, userId))
      .orderBy(desc(notificationChannels.createdAt));
    return rows.map((r) => ({
      channelId: r.externalId,
      platform: r.platform,
      webhookUrl: r.webhookUrl,
      customTemplate: r.customTemplate,
      enabled: r.enabled,
      createdAt: r.createdAt,
    }));
  }),

  create: protectedProcedure
    .input(
      z.object({
        platform: z.enum(PLATFORMS),
        webhookUrl: z.string().url().max(2000),
        customTemplate: z.unknown().optional(),
        enabled: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = await requireUserId(ctx);
      const template = normaliseTemplate(input.platform, input.customTemplate);
      const externalId = newExternalId('notificationChannel');
      await ctx.db.insert(notificationChannels).values({
        externalId,
        userId,
        platform: input.platform,
        webhookUrl: input.webhookUrl,
        // drizzle JSON column accepts null to clear; preset platforms
        // get null per normaliseTemplate.
        customTemplate: template as Record<string, unknown> | null,
        enabled: input.enabled ?? true,
      });
      return { channelId: externalId };
    }),

  update: protectedProcedure
    .input(
      z.object({
        channelId: z.string().min(1),
        platform: z.enum(PLATFORMS).optional(),
        webhookUrl: z.string().url().max(2000).optional(),
        customTemplate: z.unknown().optional(),
        enabled: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = await requireUserId(ctx);
      const [row] = await ctx.db
        .select({
          platform: notificationChannels.platform,
        })
        .from(notificationChannels)
        .where(
          and(
            eq(notificationChannels.externalId, input.channelId),
            eq(notificationChannels.userId, userId),
          ),
        )
        .limit(1);
      if (!row) {
        throw new TRPCError({ code: 'NOT_FOUND', message: '通知渠道不存在' });
      }
      const updates: Partial<typeof notificationChannels.$inferInsert> = {};
      const effectivePlatform = (input.platform ?? row.platform) as NotificationPlatform;
      if (input.platform !== undefined) updates.platform = input.platform;
      if (input.webhookUrl !== undefined) updates.webhookUrl = input.webhookUrl;
      if (input.customTemplate !== undefined) {
        updates.customTemplate = normaliseTemplate(
          effectivePlatform,
          input.customTemplate,
        ) as Record<string, unknown> | null;
      } else if (input.platform !== undefined && input.platform !== 'custom') {
        // Switching to a preset platform — clear any leftover
        // template so the wire shape isn't ambiguous.
        updates.customTemplate = null;
      }
      if (input.enabled !== undefined) updates.enabled = input.enabled;
      if (Object.keys(updates).length === 0) {
        return { ok: true as const, noop: true as const };
      }
      await ctx.db
        .update(notificationChannels)
        .set(updates)
        .where(
          and(
            eq(notificationChannels.externalId, input.channelId),
            eq(notificationChannels.userId, userId),
          ),
        );
      return { ok: true as const };
    }),

  delete: protectedProcedure
    .input(z.object({ channelId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const userId = await requireUserId(ctx);
      const result = await ctx.db
        .delete(notificationChannels)
        .where(
          and(
            eq(notificationChannels.externalId, input.channelId),
            eq(notificationChannels.userId, userId),
          ),
        );
      const affected =
        (result as unknown as { affectedRows?: number }).affectedRows ?? 0;
      if (affected === 0) {
        throw new TRPCError({ code: 'NOT_FOUND', message: '通知渠道不存在' });
      }
      return { ok: true as const };
    }),

  /**
   * Fire one preview message at the channel's webhook. Used by the
   * SPA's "发送测试消息" button so the user can verify the URL
   * before saving (or after editing).
   *
   * Two shapes accepted:
   *   - `channelId`: test an already-saved channel by id
   *   - inline draft: { platform, webhookUrl, customTemplate? } —
   *     lets the user test BEFORE saving
   *
   * Returns the full SendResult so the SPA can surface status +
   * error text on failure.
   */
  test: protectedProcedure
    .input(
      z.union([
        z.object({ channelId: z.string().min(1) }),
        z.object({
          platform: z.enum(PLATFORMS),
          webhookUrl: z.string().url().max(2000),
          customTemplate: z.unknown().optional(),
        }),
      ]),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = await requireUserId(ctx);
      let platform: NotificationPlatform;
      let webhookUrl: string;
      let customTemplate: unknown;
      if ('channelId' in input) {
        const [row] = await ctx.db
          .select({
            platform: notificationChannels.platform,
            webhookUrl: notificationChannels.webhookUrl,
            customTemplate: notificationChannels.customTemplate,
          })
          .from(notificationChannels)
          .where(
            and(
              eq(notificationChannels.externalId, input.channelId),
              eq(notificationChannels.userId, userId),
            ),
          )
          .limit(1);
        if (!row) {
          throw new TRPCError({ code: 'NOT_FOUND', message: '通知渠道不存在' });
        }
        platform = row.platform as NotificationPlatform;
        webhookUrl = row.webhookUrl;
        customTemplate = row.customTemplate;
      } else {
        platform = input.platform;
        webhookUrl = input.webhookUrl;
        // For inline tests with platform='custom' we let buildPayload
        // surface the "must include template" error via SendResult.
        customTemplate = input.customTemplate;
      }
      const ctxBody: WebhookContext = {
        title: 'HOLA DAY 测试消息',
        message: '这是一条来自 HOLA DAY 的测试消息，证明你的 webhook 配置可用。',
        status: 'success',
        taskName: '测试',
      };
      // Validate payload buildable before HTTP so a custom template
      // typo surfaces immediately (sendWebhook would also catch it
      // but the error message is clearer this way).
      try {
        buildPayload({ platform, webhookUrl, customTemplate }, ctxBody);
      } catch (err) {
        return {
          ok: false as const,
          error: err instanceof Error ? err.message : String(err),
          attempt: 0,
        };
      }
      const result = await sendWebhook(
        { platform, webhookUrl, customTemplate },
        ctxBody,
      );
      return result;
    }),
});
