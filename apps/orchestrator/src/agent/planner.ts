import type { PlannedStep } from './task-controller.js';

export interface PlannerContext {
  intent: string;
  userId?: string;
  occupation?: string | null;
  /** Slugs of skills the user has access to. Commander is free to ignore. */
  skillSlugs?: readonly string[];
}

export interface Planner {
  plan(ctx: PlannerContext): Promise<PlannedStep[]>;
}
