import { AsyncLocalStorage } from 'node:async_hooks';
import { z } from 'zod';
import type { MessagesAdapter } from './messages-adapter.js';

export const BROWSER_BRAIN_ROLES = ['planning', 'execution', 'verification'] as const;
export type BrowserBrainRole = (typeof BROWSER_BRAIN_ROLES)[number];
const modelSchema = z
  .object({
    provider: z.enum(['alibaba-model-studio', 'anthropic', 'openai']),
    model: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/),
  })
  .strict();
export const browserBrainRequestSchema = z
  .object({
    planning: modelSchema.optional(),
    execution: modelSchema.optional(),
    verification: modelSchema.optional(),
  })
  .strict();
export type BrowserBrainModel = z.infer<typeof modelSchema>;
export type BrowserBrainSelection = z.infer<typeof browserBrainRequestSchema>;
export interface BrowserBrainEnvironment {
  BROWSER_BRAIN_CANARY?: string;
  BROWSER_BRAIN_PLANNING?: string;
  BROWSER_BRAIN_EXECUTION?: string;
  BROWSER_BRAIN_VERIFICATION?: string;
  BROWSER_BRAIN_CLAUDE_ENABLED?: boolean;
  BROWSER_BRAIN_OPENAI_ENABLED?: boolean;
}
export interface BrowserBrainRoles {
  planning: MessagesAdapter;
  verification: MessagesAdapter;
}
const context = new AsyncLocalStorage<BrowserBrainSelection>();
export function withBrowserBrain<T>(selection: BrowserBrainSelection, action: () => T): T {
  return context.run(selection, action);
}
export function currentBrowserBrain(): BrowserBrainSelection | undefined {
  return context.getStore();
}
export function assertBrowserProviderEnabled(
  environment: BrowserBrainEnvironment,
  model: BrowserBrainModel,
): void {
  if (
    (model.provider === 'anthropic' && environment.BROWSER_BRAIN_CLAUDE_ENABLED !== true) ||
    (model.provider === 'openai' && environment.BROWSER_BRAIN_OPENAI_ENABLED !== true)
  ) {
    throw new Error('该浏览器模型供应商默认关闭，需渠道开放后由管理员启用。');
  }
  if (model.provider === 'alibaba-model-studio' && !/^qwen(?:[0-9._-]|$)/i.test(model.model)) {
    throw new Error('浏览器百炼通道仅允许千问模型。');
  }
}
export function resolveBrowserBrainSelection(
  environment: BrowserBrainEnvironment,
  actor: string,
  requested?: BrowserBrainSelection,
): BrowserBrainSelection {
  if (
    requested &&
    Object.keys(requested).length &&
    !new Set(
      (environment.BROWSER_BRAIN_CANARY ?? '')
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean),
    ).has(actor)
  ) {
    throw new Error('当前账号不在浏览器大脑灰度名单内。');
  }
  const selection: BrowserBrainSelection = {};
  for (const role of BROWSER_BRAIN_ROLES) {
    const raw = environment[`BROWSER_BRAIN_${role.toUpperCase()}` as keyof BrowserBrainEnvironment];
    if (typeof raw === 'string' && raw.trim()) {
      const [provider, model, ...extra] = raw.trim().split(':');
      if (extra.length) throw new Error('浏览器角色模型配置格式无效。');
      selection[role] = modelSchema.parse({ provider, model });
    }
  }
  Object.assign(selection, browserBrainRequestSchema.parse(requested ?? {}));
  for (const model of Object.values(selection)) assertBrowserProviderEnabled(environment, model);
  return selection;
}
