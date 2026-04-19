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
   * Stub self-heal: always declines. The only consumer is the smoke
   * test / offline dev path where SELECTOR_NOT_FOUND shouldn't happen
   * against about:blank.
   */
  async healSelector(): Promise<null> {
    return null;
  }
}
