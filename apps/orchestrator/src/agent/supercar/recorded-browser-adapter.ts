import {
  type MessagesAdapter,
  MessagesAdapterError,
  type NeutralMessagesResponse,
} from '../../llm/messages-adapter.js';
import { safeProviderDiagnostics } from '../../llm/provider-error-diagnostics.js';
import type { LlmCallRecord, LlmCallRecorder } from '../llm-call-recorder.js';

/** Record at the actual adapter boundary, even when the loop discards a stale response. */
export function recordedBrowserAdapter(
  adapter: MessagesAdapter,
  context: {
    recorder?: LlmCallRecorder;
    userExternalId?: string;
    taskId: string;
    iteration: number;
    role?: import('../../llm/browser-brain.js').BrowserBrainRole;
    onRecordError: () => void;
  },
): MessagesAdapter {
  if (!context.recorder || !context.userExternalId) return adapter;
  const { recorder, userExternalId } = context;
  const persist = async (call: LlmCallRecord) => {
    try {
      await recorder.record(call);
    } catch {
      context.onRecordError();
    }
  };
  return {
    metadata: adapter.metadata,
    ...(adapter.browserBrain
      ? {
          browserBrain: {
            planning: recordedBrowserAdapter(adapter.browserBrain.planning, {
              ...context,
              role: 'planning',
            }),
            verification: recordedBrowserAdapter(adapter.browserBrain.verification, {
              ...context,
              role: 'verification',
            }),
          },
        }
      : {}),
    async create(request, options) {
      const start = Date.now();
      const base = {
        userExternalId,
        taskExternalId: context.taskId,
        provider: adapter.metadata.provider,
        model: adapter.metadata.model,
        region: 'region' in adapter.metadata ? adapter.metadata.region : undefined,
        purpose:
          context.role === 'planning'
            ? ('browser.planning' as const)
            : context.role === 'verification'
              ? ('browser.verification' as const)
              : ('supercar.turn' as const),
        requestMeta: {
          iteration: context.iteration,
          protocol: 'messages',
          lane: 'browser',
          role: context.role ?? 'execution',
        },
      };
      let result: NeutralMessagesResponse;
      try {
        result = await adapter.create(request, options);
      } catch (error) {
        await persist({
          ...base,
          inputTokens: null,
          outputTokens: null,
          cacheReadInputTokens: null,
          cacheCreationInputTokens: null,
          latencyMs: Date.now() - start,
          status: 'error',
          // No provider bodies, credentials, prompts or URLs in the accounting record.
          errorMessage: error instanceof MessagesAdapterError ? error.code : 'PROVIDER_ERROR',
          ...(error instanceof MessagesAdapterError
            ? {
                providerRequestId: error.diagnostics.requestId ?? undefined,
                requestMeta: {
                  ...base.requestMeta,
                  providerError: safeProviderDiagnostics(error.diagnostics),
                },
              }
            : {}),
        });
        throw error;
      }
      await persist({
        ...base,
        ...result.usage,
        providerRequestId: result.id,
        latencyMs: Date.now() - start,
        status: 'ok',
      });
      return result;
    },
  };
}
