import { AsyncLocalStorage } from 'node:async_hooks';
import type { MediaUsage } from '../llm/model-pricing.js';
import type { LlmCallRecord, LlmCallRecorder } from './llm-call-recorder.js';
const context = new AsyncLocalStorage<{
  recorder: LlmCallRecorder;
  userExternalId: string;
  taskExternalId: string;
}>();
export function withMediaCallContext<T>(
  scope: { recorder: LlmCallRecorder; userExternalId: string; taskExternalId: string },
  action: () => Promise<T>,
): Promise<T> {
  return context.run(scope, action);
}
export function dashscopeCostRegion(baseUrl: string | undefined): 'cn' | 'intl' | undefined {
  try {
    const host = new URL(baseUrl ?? 'https://dashscope-intl.aliyuncs.com').hostname;
    if (host === 'dashscope.aliyuncs.com') return 'cn';
    if (host === 'dashscope-intl.aliyuncs.com') return 'intl';
  } catch {
    /* Unknown endpoint must never inherit a regional list price. */
  }
  return undefined;
}
export async function recordMediaUsage(call: {
  provider: string;
  model: string;
  purpose: 'media.image' | 'media.video' | 'media.tts';
  region?: string;
  providerRequestId?: string;
  latencyMs: number;
  status: 'ok' | 'error';
  mediaUsage?: MediaUsage;
}): Promise<void> {
  const scope = context.getStore();
  if (!scope) return;
  // No URLs, prompts, keys or input data enter accounting metadata.
  try {
    await scope.recorder.record({
      ...call,
      userExternalId: scope.userExternalId,
      taskExternalId: scope.taskExternalId,
      inputTokens: null,
      outputTokens: null,
    } satisfies LlmCallRecord);
  } catch {
    /* Accounting failure must not resubmit a paid generation. */
  }
}
export async function observeMediaCall<T>(
  call: {
    provider: string;
    model: string;
    purpose: 'media.image' | 'media.video' | 'media.tts';
    region?: string;
  },
  action: () => Promise<T>,
  usage: (result: T) => { mediaUsage?: MediaUsage; providerRequestId?: string },
): Promise<T> {
  const start = Date.now();
  let result: T;
  try {
    result = await action();
  } catch (error) {
    await recordMediaUsage({ ...call, status: 'error', latencyMs: Date.now() - start });
    throw error;
  }
  let units: ReturnType<typeof usage> = {};
  try {
    units = usage(result);
  } catch {
    /* A malformed receipt must not repeat a successful paid job. */
  }
  await recordMediaUsage({ ...call, ...units, latencyMs: Date.now() - start, status: 'ok' });
  return result;
}

/** Non-browser core adapters share the task scope; browser already has its own recorder. */
export async function recordScopedModelCall(
  call: Omit<LlmCallRecord, 'userExternalId' | 'taskExternalId'>,
): Promise<void> {
  const scope = context.getStore();
  if (!scope) return;
  try {
    await scope.recorder.record({
      ...call,
      userExternalId: scope.userExternalId,
      taskExternalId: scope.taskExternalId,
    });
  } catch {
    /* Never reissue a paid call on a ledger failure. */
  }
}
