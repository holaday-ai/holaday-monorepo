import { describe, expect, it } from 'vitest';
import { closureRestorationTarget } from './immediate-effects.js';

describe('account closure effect restoration policy', () => {
  it('restores only reversible resources to their recorded stable state', () => {
    expect(
      closureRestorationTarget({
        resourceType: 'planned_task',
        previousState: 'active',
        closureAppliedState: 'paused',
      }),
    ).toBe('active');
    expect(
      closureRestorationTarget({
        resourceType: 'scheduled_task',
        previousState: 'active',
        closureAppliedState: 'paused',
      }),
    ).toBe('active');
    expect(
      closureRestorationTarget({
        resourceType: 'notification_channel',
        previousState: 'enabled',
        closureAppliedState: 'disabled',
      }),
    ).toBe('enabled');
    expect(
      closureRestorationTarget({
        resourceType: 'task',
        previousState: 'executing',
        closureAppliedState: 'cancelled',
      }),
    ).toBeNull();
  });

  it('refuses unknown or mismatched state pairs instead of guessing a restoration', () => {
    expect(
      closureRestorationTarget({
        resourceType: 'planned_task',
        previousState: 'paused',
        closureAppliedState: 'paused',
      }),
    ).toBeNull();
    expect(
      closureRestorationTarget({
        resourceType: 'notification_channel',
        previousState: 'disabled',
        closureAppliedState: 'disabled',
      }),
    ).toBeNull();
    expect(
      closureRestorationTarget({
        resourceType: 'unknown',
        previousState: 'active',
        closureAppliedState: 'paused',
      }),
    ).toBeNull();
  });
});
