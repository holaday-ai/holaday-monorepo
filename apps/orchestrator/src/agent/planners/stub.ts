import { newExternalId } from '@holaday/shared-types';
import type { Planner, PlannerContext } from '../planner.js';
import type { PlannedStep } from '../task-controller.js';

/**
 * Deterministic planner for tests and offline development.
 * Emits a fixed plan, or the plan passed into the constructor.
 */
export class StubPlanner implements Planner {
  constructor(private readonly fixture?: PlannedStep[]) {}

  async plan(_ctx: PlannerContext): Promise<PlannedStep[]> {
    if (this.fixture) return this.fixture;
    return [
      {
        id: newExternalId('taskStep'),
        kind: 'goto',
        risk: 'low',
        payload: { url: 'about:blank' },
      },
      {
        id: newExternalId('taskStep'),
        kind: 'screenshot',
        risk: 'low',
      },
    ];
  }

  /**
   * Stub self-heal: always declines with zero-cost metrics. Only
   * consumer is the offline dev path (about:blank) where
   * SELECTOR_NOT_FOUND shouldn't happen anyway.
   */
  async healSelector(): Promise<{
    selector: null;
    elapsedMs: number;
    inputTokens: number;
    outputTokens: number;
  }> {
    return { selector: null, elapsedMs: 0, inputTokens: 0, outputTokens: 0 };
  }
}
