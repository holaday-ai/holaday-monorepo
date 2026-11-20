import type { CoreModelLane } from '../model-runtime-policy.js';
import type { QwenPurpose } from '../qwen-route.js';

/**
 * REBUILD-2 — what a model call is for. Business code asks the gateway for a role; which
 * model serves it is configuration (see role-models.ts), never a literal at the call site.
 */
export const MODEL_ROLES = [
  'brain',
  'vision',
  'verifier',
  'plan',
  'judge',
  'generate',
  'scrape',
  'suggestions',
  'video_edit_planner',
  'search',
] as const;
export type ModelRole = (typeof MODEL_ROLES)[number];

/** The lane + purpose a call site resolved before the gateway existed. */
export interface LegacyModelBinding {
  lane: CoreModelLane;
  purpose: QwenPurpose;
}

/**
 * Role → the exact lane/purpose its call sites used (read from the code at 8ea5cb70). With
 * LLM_GATEWAY_V2 off the gateway resolves exactly this binding, so nothing observable changes.
 */
export const MODEL_ROLE_LEGACY_BINDINGS: Readonly<Record<ModelRole, LegacyModelBinding>> =
  Object.freeze({
    // Unified browser loop / preflight (tasks.ts messages('vision')) + browserBrain roles.
    brain: { lane: 'browser', purpose: 'vision' },
    // Media QA: video quality + subject consistency verifiers (verifier lane, vision purpose).
    vision: { lane: 'verifier', purpose: 'vision' },
    // Generate / scrape / core-task answer verifier (llm-verifier, semantic adapter).
    verifier: { lane: 'verifier', purpose: 'verify_strict' },
    // core-task-plan + supercar first-frame plan (plan-provider).
    plan: { lane: 'plan', purpose: 'standard' },
    // Small judgements: scrape asked-field judge borrows the plan lane for its small model.
    judge: { lane: 'plan', purpose: 'fast' },
    // generate-runner, template fill, A-share interpret/judge, video script, playbook generalize.
    generate: { lane: 'generate', purpose: 'standard' },
    scrape: { lane: 'scrape', purpose: 'standard' },
    suggestions: { lane: 'suggestions', purpose: 'fast' },
    video_edit_planner: { lane: 'video_edit_planner', purpose: 'fast' },
    // createResponsesWebSearch on the browser lane (Responses, built-in web_search).
    search: { lane: 'browser', purpose: 'fast' },
  });

/**
 * Call sites that belong to a role but resolved a different purpose of the same lane. They are
 * kept as variants so the legacy path stays byte-identical; with the gateway on they use the
 * model of their role.
 */
export const MODEL_ROLE_VARIANTS = Object.freeze({
  /** OTA user-browser readonly runner: browser lane, standard purpose. */
  'brain.text': { role: 'brain', lane: 'browser', purpose: 'standard' },
  /** Playbook model-assist (path matcher / step repair) and memory extraction. */
  'generate.fast': { role: 'generate', lane: 'generate', purpose: 'fast' },
} as const satisfies Record<string, LegacyModelBinding & { role: ModelRole }>);
export type ModelRoleVariant = keyof typeof MODEL_ROLE_VARIANTS;

/** What a call site passes to the gateway: a role, or one of the role variants above. */
export type ModelRoleRef = ModelRole | ModelRoleVariant;

export function isModelRole(value: unknown): value is ModelRole {
  return typeof value === 'string' && (MODEL_ROLES as readonly string[]).includes(value);
}

/** The role whose model a role ref uses. */
export function baseModelRole(ref: ModelRoleRef): ModelRole {
  return isModelRole(ref) ? ref : MODEL_ROLE_VARIANTS[ref].role;
}

/** The lane/purpose the legacy path resolved for this role ref. */
export function legacyModelBinding(ref: ModelRoleRef): LegacyModelBinding {
  if (isModelRole(ref)) return MODEL_ROLE_LEGACY_BINDINGS[ref];
  const { lane, purpose } = MODEL_ROLE_VARIANTS[ref];
  return { lane, purpose };
}

/**
 * Inside one lane every purpose belongs to exactly one role (asserted by the role-table test),
 * so a runtime resolved for one lane can name the role of each adapter it hands out.
 */
export function roleForLanePurpose(lane: CoreModelLane, purpose: QwenPurpose): ModelRole | null {
  for (const role of MODEL_ROLES) {
    const binding = MODEL_ROLE_LEGACY_BINDINGS[role];
    if (binding.lane === lane && binding.purpose === purpose) return role;
  }
  for (const variant of Object.values(MODEL_ROLE_VARIANTS)) {
    if (variant.lane === lane && variant.purpose === purpose) return variant.role;
  }
  return null;
}

/** The `llm_calls.purpose` value recorded for a role while the gateway is on. */
export type ModelRoleCallPurpose = `role:${ModelRole}`;
export function modelRoleCallPurpose(role: ModelRole): ModelRoleCallPurpose {
  return `role:${role}`;
}
