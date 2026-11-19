import { z } from 'zod';
import type { BrowserLaunchTarget } from './browser-launch-journal.js';

const tabId = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const origin = z
  .string()
  .url()
  .max(2048)
  .refine((value) => {
    try {
      const url = new URL(value);
      return /^https?:$/.test(url.protocol) && url.origin === value;
    } catch {
      return false;
    }
  });
const loadingFields = {
  taskTabCreated: z.literal(true),
  preparationId: z.string().uuid(),
  sourceTabId: tabId,
  sourceOrigin: origin,
  tabId,
  launchBrowserSessionId: z.string().uuid().optional(),
};
const separatePage = (value: { sourceTabId: number; tabId: number }) =>
  value.sourceTabId !== value.tabId;

/** A created page is still loading. It carries no selection/action authority. */
export const taskTabLoadingReceiptSchema = z
  .object({
    ...loadingFields,
    taskTabStatus: z.literal('loading'),
    selectedSessionVersion: z.literal(1).optional(),
  })
  .strict()
  .refine(separatePage);
export type TaskTabLoadingReceipt = z.infer<typeof taskTabLoadingReceiptSchema>;

const hostLoadingSchema = z
  .object({
    ...loadingFields,
    preparationState: z.literal('loading'),
    extensionClientId: z.string().min(1).max(128),
  })
  .strict()
  .refine(separatePage);
export type BrowserTaskPreparationLoading = z.infer<typeof hostLoadingSchema>;
export type BrowserTaskPreparationReply =
  | BrowserLaunchTarget
  | BrowserTaskPreparationLoading
  | { preparationState: 'unsupported' };

const readyFields = {
  extensionClientId: z.string().min(1).max(128),
  tabId,
  expectedUrl: origin,
  selectionId: z.string().uuid(),
  launchBrowserSessionId: z.string().uuid().optional(),
};
const readySchema = z.object(readyFields);
const sourceSchema = readySchema.extend({ preparationReadiness: z.boolean().optional() });
const unsupportedSchema = z.object({ preparationState: z.literal('unsupported') }).strict();
const uncheckedReceipt = () => new Error('网页准备回执尚未核实，请保留输入并先核对。');

export class BrowserTaskPreparationPendingError extends Error {
  constructor() {
    super('独立页面仍在加载，输入和页面已保留。请稍后继续核对。');
    this.name = 'BrowserTaskPreparationPendingError';
  }
}

/** Client-only bounded observation. Only an acknowledged loading result retries. */
export async function pollBrowserTaskPreparation(input: {
  source: BrowserLaunchTarget;
  preparationId: string;
  prepare(target: BrowserLaunchTarget, preparationId: string): Promise<unknown>;
  current(): void | Promise<void>;
  onLoading?(state: BrowserTaskPreparationLoading): void;
  wait?(milliseconds: number): Promise<void>;
}): Promise<BrowserLaunchTarget> {
  const sourceResult = sourceSchema.safeParse(input.source);
  if (!sourceResult.success || !z.string().uuid().safeParse(input.preparationId).success)
    throw uncheckedReceipt();
  const source = Object.freeze(sourceResult.data);
  const preparationId = input.preparationId;
  const wait =
    input.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  for (let check = 0; check < 3; check++) {
    await input.current();
    const reply = await input.prepare(source, preparationId);
    await input.current();
    if (reply && typeof reply === 'object' && 'preparationState' in reply) {
      if (reply.preparationState === 'unsupported') {
        if (!unsupportedSchema.safeParse(reply).success) throw uncheckedReceipt();
        throw new Error('请更新并重新连接 HOLADAY Chrome 插件后继续。');
      }
      const parsed = hostLoadingSchema.safeParse(reply);
      if (!parsed.success) throw uncheckedReceipt();
      const loading = parsed.data;
      if (
        loading.preparationId !== preparationId ||
        loading.sourceTabId !== source.tabId ||
        loading.sourceOrigin !== source.expectedUrl ||
        loading.extensionClientId !== source.extensionClientId ||
        loading.launchBrowserSessionId !== source.launchBrowserSessionId
      )
        throw uncheckedReceipt();
      input.onLoading?.(loading);
      if (check === 2) throw new BrowserTaskPreparationPendingError();
      await wait(1000);
      continue;
    }
    if (reply && typeof reply === 'object' && 'taskTabStatus' in reply) throw uncheckedReceipt();
    const parsed = readySchema.safeParse(reply);
    if (
      !parsed.success ||
      parsed.data.extensionClientId !== source.extensionClientId ||
      parsed.data.expectedUrl !== source.expectedUrl ||
      parsed.data.launchBrowserSessionId !== source.launchBrowserSessionId
    )
      throw uncheckedReceipt();
    return parsed.data;
  }
  throw new BrowserTaskPreparationPendingError();
}
