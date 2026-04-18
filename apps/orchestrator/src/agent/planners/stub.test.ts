import { describe, expect, it } from 'vitest';
import { StubPlanner } from './stub.js';

describe('StubPlanner', () => {
  it('returns a two-step default plan', async () => {
    const planner = new StubPlanner();
    const plan = await planner.plan({ intent: 'hello' });
    expect(plan).toHaveLength(2);
    expect(plan[0]?.kind).toBe('goto');
    expect(plan[1]?.kind).toBe('screenshot');
    expect(plan[0]?.id).toMatch(/^stp_/);
  });

  it('returns the injected fixture plan verbatim', async () => {
    const fixture = [
      { id: 'stp_fx1', kind: 'wait' as const, risk: 'low' as const },
      { id: 'stp_fx2', kind: 'screenshot' as const, risk: 'low' as const },
    ];
    const plan = await new StubPlanner(fixture).plan({ intent: 'x' });
    expect(plan).toEqual(fixture);
  });
});
