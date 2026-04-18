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

export interface Planner {
  plan(ctx: PlannerContext): Promise<PlannedStep[]>;
}
