import { randomUUID } from 'node:crypto';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
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
  };
});

export async function assertLocalChromeSelection(
  userId: string,
  selection: z.infer<typeof localChromeSelectionSchema>,
) {
  const { extensionClientId, ...target } = selection;
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
