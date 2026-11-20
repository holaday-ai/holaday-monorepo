/**
 * Qwen model services used by the media lanes, built from the model-gateway
 * runtimes tasks.ts already resolves per user/region:
 *   - scriptLlm           — video script / optimize (role `generate`)
 *   - analyzeVideoQuality — sampled-frame QA (role `vision`, served by the
 *                           verifier runtime)
 *   - verifySubject       — locked-subject identity check (same vision role)
 * Replaces the dormant Anthropic `legacyMediaModelClient` in tasks.ts.
 */

import type { ModelRoleRef } from '../../llm/gateway/model-roles.js';
import type { MessagesAdapter } from '../../llm/messages-adapter.js';
import type { VerifySubjectFn } from '../image/image-runner.js';
import { createMessagesSubjectConsistencyVerifier } from '../image/image-subject-verifier.js';
import {
  type VideoQualityAnalyzer,
  createMessagesVideoQualityAnalyzer,
} from './video-quality-verifier.js';
import { type LlmComplete, createMessagesScriptLlm } from './video-script.js';

/** Structural subset of `ModelGatewayRuntime`. */
export type MediaRuntimeResolution =
  | { kind: 'ready'; messages(role?: ModelRoleRef): MessagesAdapter }
  | { kind: 'unavailable' };

export interface MediaModelServices {
  readonly scriptLlm: LlmComplete | null;
  readonly analyzeVideoQuality: VideoQualityAnalyzer | null;
  readonly verifySubject: VerifySubjectFn | null;
}

export function resolveMediaModelServices(input: {
  generate: MediaRuntimeResolution;
  verifier: MediaRuntimeResolution;
}): MediaModelServices {
  const scriptAdapter = input.generate.kind === 'ready' ? input.generate.messages() : null;
  const visionAdapter = input.verifier.kind === 'ready' ? input.verifier.messages('vision') : null;
  return {
    scriptLlm: scriptAdapter ? createMessagesScriptLlm(scriptAdapter) : null,
    analyzeVideoQuality: visionAdapter ? createMessagesVideoQualityAnalyzer(visionAdapter) : null,
    verifySubject: visionAdapter ? createMessagesSubjectConsistencyVerifier(visionAdapter) : null,
  };
}

/** Video lanes need both the script model and the frame verifier. */
export function videoModelServicesReady(services: MediaModelServices): boolean {
  return Boolean(services.scriptLlm && services.analyzeVideoQuality);
}
