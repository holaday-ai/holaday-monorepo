import type { ModelDataRegion } from './model-data-region.js';
import {
  type QwenPurpose,
  type QwenRoute,
  type QwenRuntimeEnvironment,
  resolveQwenRoute,
  toSafeQwenRouteMetadata,
} from './qwen-route.js';

export interface QwenShadowEnvironment extends QwenRuntimeEnvironment {
  QWEN_SHADOW_EVAL_ENABLED: boolean;
}

export interface QwenSyntheticEvaluation {
  caseId: string;
  dataClass: unknown;
  region: ModelDataRegion;
  purpose: QwenPurpose;
  messages: ReadonlyArray<{ role: 'user' | 'assistant'; content: string }>;
  maxTokens: number;
}

export interface QwenShadowClient {
  messages: {
    create(input: {
      model: string;
      max_tokens: number;
      messages: ReadonlyArray<{ role: 'user' | 'assistant'; content: string }>;
    }): Promise<{
      content: ReadonlyArray<{ type: string; text?: string }>;
      usage?: { input_tokens?: number; output_tokens?: number };
    }>;
  };
}

export type QwenShadowClientFactory = (route: QwenRoute) => QwenShadowClient;

export type QwenShadowEvaluationResult =
  | { status: 'disabled' }
  | { status: 'rejected'; reason: 'synthetic_only' }
  | {
      status: 'completed';
      caseId: string;
      route: ReturnType<typeof toSafeQwenRouteMetadata>;
      responseText: string;
      usage: { inputTokens: number; outputTokens: number };
    }
  | {
      status: 'failed';
      caseId: string;
      reason: 'route_unavailable' | 'provider_error' | 'invalid_response';
    };

/**
 * Runs only explicitly labelled synthetic evaluation cases. This module is not
 * imported by the production task graph, and its result can never replace a
 * user-visible response.
 */
export async function runQwenSyntheticShadowEvaluation(input: {
  environment: QwenShadowEnvironment;
  evaluation: QwenSyntheticEvaluation;
  clientFactory: QwenShadowClientFactory;
}): Promise<QwenShadowEvaluationResult> {
  if (!input.environment.QWEN_SHADOW_EVAL_ENABLED) return { status: 'disabled' };
  if (input.evaluation.dataClass !== 'synthetic') {
    return { status: 'rejected', reason: 'synthetic_only' };
  }

  let route: QwenRoute;
  try {
    route = resolveQwenRoute(input.environment, input.evaluation.region, input.evaluation.purpose);
  } catch {
    return {
      status: 'failed',
      caseId: input.evaluation.caseId,
      reason: 'route_unavailable',
    };
  }

  try {
    const response = await input.clientFactory(route).messages.create({
      model: route.model,
      max_tokens: input.evaluation.maxTokens,
      messages: input.evaluation.messages,
    });
    const responseText = response.content
      .filter((block) => block.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text)
      .join('')
      .trim();
    if (!responseText) {
      return {
        status: 'failed',
        caseId: input.evaluation.caseId,
        reason: 'invalid_response',
      };
    }

    return {
      status: 'completed',
      caseId: input.evaluation.caseId,
      route: toSafeQwenRouteMetadata(route),
      responseText,
      usage: {
        inputTokens: response.usage?.input_tokens ?? 0,
        outputTokens: response.usage?.output_tokens ?? 0,
      },
    };
  } catch {
    return {
      status: 'failed',
      caseId: input.evaluation.caseId,
      reason: 'provider_error',
    };
  }
}
