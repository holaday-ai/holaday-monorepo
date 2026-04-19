import type { ResilientSelector } from '@holaday/shared-types';
import type { PlannedStep } from './task-controller.js';

/**
 * A single catalogue entry the commander sees when planning. We intentionally
 * send only slug + one-line description — not the full SKILL.md — to keep
 * the system prompt cacheable and cheap. The commander can route by slug;
 * SkillLoader fetches the body on demand (v0.2 §5.5 lazy-load model).
 */
export interface SkillCatalogueEntry {
  slug: string;
  description: string;
  occupationTag?: string | null;
}

export interface PlannerContext {
  intent: string;
  userId?: string;
  occupation?: string | null;
  /**
   * Skills available to the user, slug + one-line description. Commander
   * may ignore or name one by slug in its plan. Full SKILL.md body is NOT
   * sent — fetched on demand when the commander or planner asks for it.
   */
  skills?: readonly SkillCatalogueEntry[];
}

/**
 * One selector attempt the driver already tried and rejected. Fed back
 * to the planner during self-heal so it can see why each guess missed
 * and not repeat itself.
 */
export interface StrategyFailureTrace {
  kind: string;
  selector: string;
  reason: string;
}

/**
 * Everything the commander needs to rewrite a single selector on a
 * SELECTOR_NOT_FOUND failure. `screenshot` is a raw base64 PNG of the
 * viewport at the moment the driver gave up — the model uses that plus
 * the URL/title to infer real DOM structure, not a hallucinated one.
 */
export interface SelfHealContext {
  userId?: string;
  /** Original user intent, so the model can remember what it's aiming at. */
  intent?: string;
  /** The step that failed — verb + selector the driver rejected + payload. */
  originalStep: PlannedStep;
  /** Live page state at the moment of failure. */
  diagnostic: {
    url: string;
    title: string;
    strategies: StrategyFailureTrace[];
    /** Raw base64 PNG (no data: prefix). May be absent on pages where capture fails. */
    screenshot?: string;
  };
}

export interface Planner {
  /** Build the initial plan from the user's intent. */
  plan(ctx: PlannerContext): Promise<PlannedStep[]>;
  /**
   * On SELECTOR_NOT_FOUND, rewrite a single selector from the failure
   * diagnostic. Returns the replacement ResilientSelector, or null to
   * decline (caller then falls through to the normal retry-exhausted
   * path). MUST NOT throw — a heal that can't produce a useful
   * selector should just return null.
   */
  healSelector(ctx: SelfHealContext): Promise<ResilientSelector | null>;
}
