import { describe, expect, it } from 'vitest';
import {
  MODEL_ROLES,
  MODEL_ROLE_LEGACY_BINDINGS,
  MODEL_ROLE_VARIANTS,
  baseModelRole,
  legacyModelBinding,
  modelRoleCallPurpose,
  roleForLanePurpose,
} from './model-roles.js';

/**
 * Read from the call sites at 8ea5cb70 (before the gateway): which lane each one resolved and
 * which purpose it then asked the runtime for.
 */
const CALL_SITES_BEFORE = {
  // tasks.ts preflight messages('vision') / unified browser loop messages('vision')
  brain: { lane: 'browser', purpose: 'vision' },
  // media-model-services verifier.messages('vision')
  vision: { lane: 'verifier', purpose: 'vision' },
  // tasks.ts / tasks-core-create / tasks-core-reply verifier messages('verify_strict')
  verifier: { lane: 'verifier', purpose: 'verify_strict' },
  // core-task-plan + plan-provider messages('standard')
  plan: { lane: 'plan', purpose: 'standard' },
  // scrape asked-field judge: plan lane, messages('fast')
  judge: { lane: 'plan', purpose: 'fast' },
  // generate-runner / template fill responses('standard'); A-share, video script, generalize
  generate: { lane: 'generate', purpose: 'standard' },
  // scrape-runner responses('standard')
  scrape: { lane: 'scrape', purpose: 'standard' },
  // core-task-suggestions + suggestions-provider messages('fast')
  suggestions: { lane: 'suggestions', purpose: 'fast' },
  // video-editing planner messages('fast')
  video_edit_planner: { lane: 'video_edit_planner', purpose: 'fast' },
  // createResponsesWebSearch(browser runtime responses('fast'))
  search: { lane: 'browser', purpose: 'fast' },
} as const;

describe('model role table', () => {
  it('maps every role to the lane/purpose its call sites used before', () => {
    expect(MODEL_ROLE_LEGACY_BINDINGS).toEqual(CALL_SITES_BEFORE);
    expect([...MODEL_ROLES].sort()).toEqual(Object.keys(CALL_SITES_BEFORE).sort());
  });

  it('keeps the two variant call sites on their own legacy purpose', () => {
    // OTA readonly runner: browser runtime messages('standard').
    expect(legacyModelBinding('brain.text')).toEqual({ lane: 'browser', purpose: 'standard' });
    // resolveUserGenerateAdapter (model-assist, memory extraction): generate messages('fast').
    expect(legacyModelBinding('generate.fast')).toEqual({ lane: 'generate', purpose: 'fast' });
    expect(baseModelRole('brain.text')).toBe('brain');
    expect(baseModelRole('generate.fast')).toBe('generate');
    expect(Object.keys(MODEL_ROLE_VARIANTS).sort()).toEqual(['brain.text', 'generate.fast']);
  });

  it('gives every lane purpose exactly one role', () => {
    const seen = new Map<string, string>();
    const entries: Array<[string, { lane: string; purpose: string }]> = [
      ...Object.entries(MODEL_ROLE_LEGACY_BINDINGS),
      ...Object.entries(MODEL_ROLE_VARIANTS),
    ];
    for (const [ref, binding] of entries) {
      const key = `${binding.lane}/${binding.purpose}`;
      expect(seen.has(key), `${ref} collides with ${seen.get(key)}`).toBe(false);
      seen.set(key, ref);
    }
    expect(roleForLanePurpose('browser', 'fast')).toBe('search');
    expect(roleForLanePurpose('browser', 'standard')).toBe('brain');
    expect(roleForLanePurpose('verifier', 'vision')).toBe('vision');
    expect(roleForLanePurpose('generate', 'fast')).toBe('generate');
    expect(roleForLanePurpose('scrape', 'fast')).toBeNull();
  });

  it('labels gateway calls as role:<role> within the llm_calls purpose column', () => {
    for (const role of MODEL_ROLES) {
      expect(modelRoleCallPurpose(role)).toBe(`role:${role}`);
      expect(modelRoleCallPurpose(role).length).toBeLessThanOrEqual(32);
    }
  });
});
