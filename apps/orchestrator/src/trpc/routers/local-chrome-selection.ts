import { randomUUID } from 'node:crypto';
import { userBrowserProtocolSchema } from '@holaday/shared-types';
import { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { browserCapabilities } from '../../config/browser-capabilities.js';
import { env } from '../../config/env.js';
import { tasks } from '../../db/schema/tasks.js';
import { users } from '../../db/schema/users.js';
import { webhookIdempotency } from '../../db/schema/webhook-idempotency.js';
import { getConnectedExtensionClientIds, sendExtensionToolCall } from '../../ws/server.js';
import { protectedProcedure } from '../trpc.js';

const httpUrl = z
  .string()
  .url()
  .max(2048)
  .regex(/^https?:\/\//);
export const localChromeSelectionSchema = z
  .object({
    extensionClientId: z.string().min(1).max(128),
    tabId: z.number().int().nonnegative(),
    expectedUrl: httpUrl,
    selectionId: z.string().uuid(),
  })
  .strict();
const tabsSchema = z.object({
  selectedSessionVersion: z.literal(1),
  tabs: z
    .array(
      z.object({
        tabId: z.number().int().nonnegative(),
        selectionId: z.string().uuid(),
        title: z.string().max(512),
        url: httpUrl,
      }),
    )
    .max(100),
  truncated: z.boolean(),
});

export function backgroundTaskTabsEnabled(userId: string): boolean {
  const configured = process.env.BROWSER_TASK_TABS_ENABLED;
  return (
    (configured === undefined ? env.BROWSER_TASK_TABS_ENABLED : configured === 'true') &&
    browserCapabilities(userId).routingV2
  );
}

function supportsTaskTabStart(raw: unknown): boolean {
  const protocol = userBrowserProtocolSchema.safeParse(raw);
  return protocol.success && protocol.data.capabilities.includes('task_tab_start');
}
export function launchRecoveryEnabled(userId: string): boolean {
  const configured = process.env.BROWSER_LAUNCH_RECOVERY_ENABLED;
  return (
    backgroundTaskTabsEnabled(userId) &&
    (configured === undefined ? env.BROWSER_LAUNCH_RECOVERY_ENABLED : configured === 'true')
  );
}
function supportsRecovery(raw: unknown): boolean {
  const parsed = userBrowserProtocolSchema.safeParse(raw);
  return parsed.success && parsed.data.capabilities.includes('task_tab_recovery_v1');
}

/** UI rollout hint only: opening the sidepanel never enumerates other pages. */
export const localChromeLaunchOptionsProcedure = protectedProcedure.query(({ ctx }) => ({
  backgroundTaskTabs: backgroundTaskTabsEnabled(ctx.userId),
  ...(launchRecoveryEnabled(ctx.userId) ? { launchRecovery: true } : {}),
}));

/** A receipt lookup does not require the old socket/selection and never starts work. */
export const localChromeLaunchReceiptProcedure = protectedProcedure
  .input(z.object({ clientRequestId: z.string().uuid() }).strict())
  .query(async ({ ctx, input }) => {
    if (!launchRecoveryEnabled(ctx.userId))
      throw new TRPCError({ code: 'PRECONDITION_FAILED', message: '任务续接尚未启用。' });
    const [owner] = await ctx.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.externalId, ctx.userId))
      .limit(1);
    if (!owner) throw new TRPCError({ code: 'UNAUTHORIZED' });
    const [receipt] = await ctx.db
      .select({ taskId: webhookIdempotency.taskId, expiresAt: webhookIdempotency.expiresAt })
      .from(webhookIdempotency)
      .where(
        and(
          eq(webhookIdempotency.userId, owner.id),
          eq(webhookIdempotency.idempotencyKey, `spa_task:${input.clientRequestId}`),
        ),
      )
      .limit(1);
    if (!receipt) return { state: 'absent' as const };
    if (receipt.expiresAt.getTime() <= Date.now()) return { state: 'unknown' as const };
    if (!receipt.taskId) return { state: 'pending' as const };
    const [task] = await ctx.db
      .select({ status: tasks.status })
      .from(tasks)
      .where(
        and(
          eq(tasks.externalId, receipt.taskId),
          eq(tasks.userId, owner.id),
          eq(tasks.origin, ctx.taskOrigin),
        ),
      )
      .limit(1);
    if (!task) return { state: 'unknown' as const };
    return { state: 'created' as const, taskId: receipt.taskId, status: task.status };
  });

export const localChromeTabsProcedure = protectedProcedure.query(async ({ ctx }) => {
  const connections = getConnectedExtensionClientIds(ctx.userId);
  const results = await Promise.all(
    connections.map(async (extensionClientId) => {
      const reply = await sendExtensionToolCall(ctx.userId, {
        taskId: `tabs-${randomUUID()}`,
        kind: 'tabs',
        extensionClientId,
        timeoutMs: 5000,
      });
      const parsed = tabsSchema.safeParse(reply.result);
      if (
        browserCapabilities(ctx.userId).routingV2 &&
        reply.ok &&
        !userBrowserProtocolSchema.safeParse(
          (reply.result as Record<string, unknown>)?.userBrowserProtocol,
        ).success
      )
        return { tabs: [], unavailable: true, needsUpdate: true };
      if (!reply.ok || reply.extensionClientId !== extensionClientId || !parsed.success)
        return {
          tabs: [],
          unavailable: true,
          needsUpdate:
            reply.ok &&
            !z.object({ selectedSessionVersion: z.literal(1) }).safeParse(reply.result).success,
        };
      return {
        tabs: parsed.data.tabs.map(({ url, ...tab }) => ({
          ...tab,
          expectedUrl: url,
          extensionClientId,
          ...(backgroundTaskTabsEnabled(ctx.userId)
            ? {
                backgroundTaskTabs: true,
                taskTabStart:
                  supportsTaskTabStart(
                    (reply.result as Record<string, unknown>)?.userBrowserProtocol,
                  ) &&
                  (!launchRecoveryEnabled(ctx.userId) ||
                    supportsRecovery(
                      (reply.result as Record<string, unknown>)?.userBrowserProtocol,
                    )),
              }
            : {}),
        })),
        unavailable: false,
        needsUpdate: false,
      };
    }),
  );
  return {
    tabs: results.flatMap((result) => result.tabs),
    connected: connections.length > 0,
    unavailable: results.some((result) => result.unavailable),
    needsUpdate: results.some((result) => result.needsUpdate),
    routingV2: browserCapabilities(ctx.userId).routingV2,
    ...(backgroundTaskTabsEnabled(ctx.userId) ? { backgroundTaskTabs: true } : {}),
  };
});

export async function assertLocalChromeSelection(
  userId: string,
  selection: z.infer<typeof localChromeSelectionSchema>,
) {
  const { extensionClientId, ...target } = selection;
  if (browserCapabilities(userId).routingV2) {
    // Capability handshake contains tab metadata only, before reading page content.
    const handshake = await sendExtensionToolCall(userId, {
      taskId: `capabilities-${randomUUID()}`,
      kind: 'tabs',
      extensionClientId,
      timeoutMs: 5000,
    });
    if (
      !handshake.ok ||
      !userBrowserProtocolSchema.safeParse(
        (handshake.result as Record<string, unknown>)?.userBrowserProtocol,
      ).success
    )
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message:
          'capability_missing：请安装、更新并重新连接 HOLADAY Chrome 扩展，保持电脑在线。未扣除额度。',
      });
  }
  const reply = await sendExtensionToolCall(userId, {
    taskId: `preflight-${randomUUID()}`,
    kind: 'read',
    extensionClientId,
    args: { target },
    timeoutMs: 5000,
  });
  const parsed = z.object({ tabId: z.number(), finalUrl: httpUrl }).safeParse(reply.result);
  if (
    reply.ok &&
    reply.extensionClientId === extensionClientId &&
    !z.object({ selectedSessionVersion: z.literal(1) }).safeParse(reply.result).success
  ) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: '请更新并重新连接 HOLADAY Chrome 扩展后再执行任务。未扣除额度。',
    });
  }
  if (
    !reply.ok ||
    reply.extensionClientId !== extensionClientId ||
    !parsed.success ||
    parsed.data.tabId !== target.tabId ||
    parsed.data.finalUrl !== target.expectedUrl
  ) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'Chrome 页面已变化或连接不可用，请重新选择页面。未扣除额度。',
    });
  }
}

/** Prepare only the user's chosen site in an inactive tab; no original-page DOM is read. */
export const localChromeTaskTabProcedure = protectedProcedure
  .input(
    z.object({ selection: localChromeSelectionSchema, preparationId: z.string().uuid() }).strict(),
  )
  .mutation(async ({ ctx, input }) => {
    if (!backgroundTaskTabsEnabled(ctx.userId))
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: '独立任务标签页暂未开放。未创建任务或扣除额度。',
      });
    const { extensionClientId, ...target } = input.selection;
    if (!getConnectedExtensionClientIds(ctx.userId).includes(extensionClientId))
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: '所选 Chrome 连接已断开，请重新连接。未扣除额度。',
      });
    const handshake = await sendExtensionToolCall(ctx.userId, {
      taskId: `prepare-${input.preparationId}`,
      kind: 'tabs',
      extensionClientId,
      timeoutMs: 5000,
    });
    if (
      !handshake.ok ||
      handshake.extensionClientId !== extensionClientId ||
      !supportsTaskTabStart((handshake.result as Record<string, unknown>)?.userBrowserProtocol) ||
      (launchRecoveryEnabled(ctx.userId) &&
        !supportsRecovery((handshake.result as Record<string, unknown>)?.userBrowserProtocol))
    )
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: '请更新并重新连接 HOLADAY Chrome 插件后使用独立任务页。未扣除额度。',
      });
    const reply = await sendExtensionToolCall(ctx.userId, {
      taskId: `prepare-${input.preparationId}`,
      kind: 'task_tab',
      extensionClientId,
      args: {
        target,
        preparationId: input.preparationId,
        ...(launchRecoveryEnabled(ctx.userId) ? { recoverable: true } : {}),
      },
      timeoutMs: 15000,
    });
    const parsed = z
      .object({
        taskTabCreated: z.literal(true),
        tabId: z.number().int().nonnegative(),
        selectionId: z.string().uuid(),
        url: httpUrl,
        title: z.string().max(512),
      })
      .safeParse(reply.result);
    if (
      !reply.ok ||
      reply.extensionClientId !== extensionClientId ||
      !parsed.success ||
      parsed.data.tabId === target.tabId ||
      parsed.data.url !== new URL(target.expectedUrl).origin
    )
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: '独立任务页尚未准备好，请重试；不会操作原页面。未扣除额度。',
      });
    return {
      extensionClientId,
      tabId: parsed.data.tabId,
      selectionId: parsed.data.selectionId,
      expectedUrl: parsed.data.url,
      title: parsed.data.title,
    };
  });
