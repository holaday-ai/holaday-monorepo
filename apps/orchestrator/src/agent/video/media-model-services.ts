/**
 * Qwen model services used by the media lanes, built from the model-catalog
 * runtimes tasks.ts already resolves per user/region:
 *   - scriptLlm           — video script / optimize (generate lane, 'standard')
 *   - analyzeVideoQuality — sampled-frame QA (verifier lane, 'vision' →
 *                           QWEN_VISION_MODEL, default qwen3.8-max)
 *   - verifySubject       — locked-subject identity check (same vision route)
 * Replaces the dormant Anthropic `legacyMediaModelClient` in tasks.ts.
 */

import type { MessagesAdapter } from '../../llm/messages-adapter.js';
import type { QwenPurpose } from '../../llm/qwen-route.js';
import type { VerifySubjectFn } from '../image/image-runner.js';
import { createMessagesSubjectConsistencyVerifier } from '../image/image-subject-verifier.js';
import {
  type VideoQualityAnalyzer,
  createMessagesVideoQualityAnalyzer,
} from './video-quality-verifier.js';
import { type LlmComplete, createMessagesScriptLlm } from './video-script.js';

/** Structural subset of `ProductionModelRuntimeResolution`. */
export type MediaRuntimeResolution =
  | { kind: 'ready'; messages(purpose: QwenPurpose): MessagesAdapter }
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
  const scriptAdapter =
    input.generate.kind === 'ready' ? input.generate.messages('standard') : null;
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
