import { beforeAll, describe, expect, it } from 'vitest';
import type { A11yAction } from './actions-a11y.js';
import type { VisionAction } from './actions.js';
import type {
  AccessibilityDecision,
  AccessibilityLoopContext,
  VisionDecision,
  VisionLoopCommander,
  VisionLoopContext,
  VisionObservation,
} from './commander.js';
import {
  type AccessibilityObservation,
  type ActionResult,
  VisionLoopRunner,
  translateToRealSpace,
} from './runner.js';

beforeAll(() => {
  process.env.JWT_SECRET ??= 'test-secret-must-be-at-least-32-characters-long-yes';
  process.env.DATABASE_URL ??= 'mysql://test:test@127.0.0.1:3306/test';
  process.env.REDIS_URL ??= 'redis://127.0.0.1:6379/0';
});

/**
 * Unit tests for the VisionLoopRunner. No network, no real DB, no real
 * commander. The runner is exercised against:
 *
 *   - a ScriptedCommander that replays a canned sequence of VisionActions
 *   - a recording actionFn that accepts every action and logs it
 *   - a synthetic screenshotFn that fabricates VisionObservations
 *
 * Coverage:
 *   - happy path ends with task_done → status 'completed'
 *   - task_give_up → status 'failed'
 *   - maxSteps cap → status 'paused'
 *   - cancel() mid-loop → status 'cancelled'
 *   - two consecutive driver failures → status 'failed'
 *   - model-space click coords translated to real viewport via scale
 *   - history is accumulated and passed back to the commander each tick
 *   - events fire in order
 */

function makeObservation(tickIndex: number): VisionObservation {
  // JPEG is irrelevant here — the commander is faked, it won't
  // actually send the image anywhere.
  return {
    screenshotBase64: 'AA==',
    viewportWidth: 1280,
    viewportHeight: 800,
    url: `https://example.com/page-${tickIndex}`,
    title: `Page ${tickIndex}`,
    tickIndex,
  };
}

interface DecisionScript {
  /** Default: passthrough scale (1×). Set to simulate a resized image. */
  image?: { scaleX: number; scaleY: number };
  toolUseId?: string;
}

class ScriptedCommander implements VisionLoopCommander {
  private readonly actions: Array<{ action: VisionAction; opts?: DecisionScript }>;
  private idx = 0;
  /**
   * Per-tick snapshots of the history the commander saw. We snapshot
   * because the runner mutates the same array reference on subsequent
   * ticks; without snapshots every entry would see the final state.
   */
  public readonly seenContexts: Array<{ history: VisionLoopContext['history'] }> = [];

  constructor(actions: Array<{ action: VisionAction; opts?: DecisionScript }>) {
    this.actions = actions;
  }

  async decideNextAction(ctx: VisionLoopContext): Promise<VisionDecision> {
    this.seenContexts.push({ history: [...ctx.history] });
    const next = this.actions[this.idx++];
    if (!next) throw new Error('ScriptedCommander ran out of actions');
    const img = next.opts?.image ?? { scaleX: 1, scaleY: 1 };
    return {
      action: next.action,
      image: {
        base64: 'AA==',
        originalWidth: ctx.observation.viewportWidth,
        originalHeight: ctx.observation.viewportHeight,
        resizedWidth: Math.round(ctx.observation.viewportWidth * img.scaleX),
        resizedHeight: Math.round(ctx.observation.viewportHeight * img.scaleY),
        scaleX: img.scaleX,
        scaleY: img.scaleY,
      },
      ...(next.opts?.toolUseId ? { toolUseId: next.opts.toolUseId } : {}),
      elapsedMs: 10,
      inputTokens: 100,
      outputTokens: 20,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
    };
  }
}

function recordingActionFn(results: ActionResult[] = []): {
  actionFn: (tickIndex: number, a: VisionAction) => Promise<ActionResult>;
  calls: VisionAction[];
} {
  const calls: VisionAction[] = [];
  let i = 0;
  return {
    calls,
    actionFn: async (_tickIndex, a) => {
      calls.push(a);
      const r = results[i++];
      return r ?? { ok: true };
    },
  };
}

describe('VisionLoopRunner.run', () => {
  it('happy path: click → type → task_done → status=completed', async () => {
    const commander = new ScriptedCommander([
      { action: { kind: 'click', x: 100, y: 200 } },
      { action: { kind: 'type', text: 'HOLA DAY' } },
      { action: { kind: 'done', summary: 'Submitted the form.' } },
    ]);
    const { actionFn, calls } = recordingActionFn();
    const runner = new VisionLoopRunner({
      commander,
      screenshotFn: async (tick) => makeObservation(tick),
      actionFn,
    });

    const outcome = await runner.run('submit the form');

    expect(outcome.status).toBe('completed');
    if (outcome.status === 'completed') {
      expect(outcome.summary).toBe('Submitted the form.');
      // Click + type — task_done is terminal, driver never sees it.
      expect(outcome.history).toHaveLength(3);
      expect(outcome.history[2]?.action.kind).toBe('done');
    }
    expect(calls).toHaveLength(2);
    expect(calls[0]?.kind).toBe('click');
    expect(calls[1]?.kind).toBe('type');
  });

  it('task_give_up → status=failed with reason', async () => {
    const commander = new ScriptedCommander([
      { action: { kind: 'give_up', reason: 'login wall detected' } },
    ]);
    const { actionFn, calls } = recordingActionFn();
    const runner = new VisionLoopRunner({
      commander,
      screenshotFn: async (t) => makeObservation(t),
      actionFn,
    });
    const outcome = await runner.run('post a comment');
    expect(outcome.status).toBe('failed');
    if (outcome.status === 'failed') expect(outcome.reason).toMatch(/login wall/);
    expect(calls).toHaveLength(0);
  });

  it('maxSteps cap → status=paused with history preserved', async () => {
    const commander = new ScriptedCommander([
      { action: { kind: 'click', x: 1, y: 1 } },
      { action: { kind: 'click', x: 2, y: 2 } },
      { action: { kind: 'click', x: 3, y: 3 } },
    ]);
    const { actionFn } = recordingActionFn();
    const runner = new VisionLoopRunner({
      commander,
      screenshotFn: async (t) => makeObservation(t),
      actionFn,
      maxSteps: 3,
    });
    const outcome = await runner.run('click forever');
    expect(outcome.status).toBe('paused');
    if (outcome.status === 'paused') {
      expect(outcome.reason).toMatch(/max_steps_reached/);
      expect(outcome.history).toHaveLength(3);
    }
  });

  it('translates model-space click to real viewport via image.scaleX/Y', async () => {
    // Model-space 800×500 on a real 1600×1000 viewport (scale 0.5).
    // Click at model (200, 300) → real (400, 600).
    const commander = new ScriptedCommander([
      {
        action: { kind: 'click', x: 200, y: 300 },
        opts: { image: { scaleX: 0.5, scaleY: 0.5 } },
      },
      { action: { kind: 'done', summary: 'ok' } },
    ]);
    const { actionFn, calls } = recordingActionFn();
    const runner = new VisionLoopRunner({
      commander,
      screenshotFn: async (t) => ({
        ...makeObservation(t),
        viewportWidth: 1600,
        viewportHeight: 1000,
      }),
      actionFn,
    });
    const outcome = await runner.run('click a button');
    expect(outcome.status).toBe('completed');
    expect(calls[0]).toEqual({ kind: 'click', x: 400, y: 600 });
  });

  it('history is passed to the commander on each tick', async () => {
    const commander = new ScriptedCommander([
      { action: { kind: 'click', x: 1, y: 1 }, opts: { toolUseId: 'tu_1' } },
      { action: { kind: 'type', text: 'hi' }, opts: { toolUseId: 'tu_2' } },
      { action: { kind: 'done', summary: 'ok' } },
    ]);
    const { actionFn } = recordingActionFn();
    const runner = new VisionLoopRunner({
      commander,
      screenshotFn: async (t) => makeObservation(t),
      actionFn,
    });
    await runner.run('test');
    expect(commander.seenContexts[0]?.history).toHaveLength(0);
    expect(commander.seenContexts[1]?.history).toHaveLength(1);
    expect(commander.seenContexts[1]?.history[0]?.toolUseId).toBe('tu_1');
    expect(commander.seenContexts[2]?.history).toHaveLength(2);
    expect(commander.seenContexts[2]?.history[1]?.toolUseId).toBe('tu_2');
  });

  it('two consecutive driver failures → status=failed', async () => {
    const commander = new ScriptedCommander([
      { action: { kind: 'click', x: 1, y: 1 } },
      { action: { kind: 'click', x: 2, y: 2 } },
      { action: { kind: 'click', x: 3, y: 3 } }, // never reached
    ]);
    const { actionFn } = recordingActionFn([
      { ok: false, message: 'tab closed' },
      { ok: false, message: 'tab still closed' },
    ]);
    const runner = new VisionLoopRunner({
      commander,
      screenshotFn: async (t) => makeObservation(t),
      actionFn,
    });
    const outcome = await runner.run('test');
    expect(outcome.status).toBe('failed');
    if (outcome.status === 'failed') expect(outcome.reason).toMatch(/driver failed twice/);
    expect(outcome.history).toHaveLength(2);
  });

  it('cancel() before next tick → status=cancelled', async () => {
    const commander = new ScriptedCommander([
      { action: { kind: 'click', x: 1, y: 1 } },
      { action: { kind: 'click', x: 2, y: 2 } }, // never reached if cancel lands first
    ]);
    const { actionFn } = recordingActionFn();
    const runner = new VisionLoopRunner({
      commander,
      screenshotFn: async (t) => makeObservation(t),
      actionFn,
    });
    runner.on('turn', () => runner.cancel());
    const outcome = await runner.run('test');
    expect(outcome.status).toBe('cancelled');
    expect(outcome.history).toHaveLength(1);
  });

  it('emits events in order: tick → decision → acted → turn', async () => {
    const commander = new ScriptedCommander([
      { action: { kind: 'click', x: 10, y: 20 } },
      { action: { kind: 'done', summary: 'ok' } },
    ]);
    const { actionFn } = recordingActionFn();
    const runner = new VisionLoopRunner({
      commander,
      screenshotFn: async (t) => makeObservation(t),
      actionFn,
    });
    const eventLog: string[] = [];
    runner.on('tick', () => eventLog.push('tick'));
    runner.on('decision', () => eventLog.push('decision'));
    runner.on('acted', () => eventLog.push('acted'));
    runner.on('turn', () => eventLog.push('turn'));
    runner.on('outcome', () => eventLog.push('outcome'));

    await runner.run('test');
    // tick0, decision0, acted0, turn0 (click), tick1, decision1, turn1 (done — no acted), outcome
    expect(eventLog).toEqual([
      'tick',
      'decision',
      'acted',
      'turn',
      'tick',
      'decision',
      'turn',
      'outcome',
    ]);
  });
});

describe('translateToRealSpace', () => {
  it('click gets scaled', () => {
    const out = translateToRealSpace(
      { kind: 'click', x: 100, y: 200 },
      { scaleX: 0.5, scaleY: 0.5 },
    );
    expect(out).toEqual({ kind: 'click', x: 200, y: 400 });
  });

  it('non-click actions pass through unchanged', () => {
    const type: VisionAction = { kind: 'type', text: 'hi' };
    expect(translateToRealSpace(type, { scaleX: 0.5, scaleY: 0.5 })).toBe(type);
    const done: VisionAction = { kind: 'done', summary: 'ok' };
    expect(translateToRealSpace(done, { scaleX: 0.5, scaleY: 0.5 })).toBe(done);
  });
});

// ---------------------------------------------------------------------------
// Dual-mode runner tests (E3)
// ---------------------------------------------------------------------------

class DualModeScriptedCommander implements VisionLoopCommander {
  private visionIdx = 0;
  private a11yIdx = 0;
  public readonly visionCalls: Array<{ historyLen: number }> = [];
  public readonly a11yCalls: Array<{ historyLen: number; snapshot: string }> = [];
  constructor(
    private readonly visionScript: VisionAction[],
    private readonly a11yScript: A11yAction[],
  ) {}
  async decideNextAction(ctx: VisionLoopContext): Promise<VisionDecision> {
    this.visionCalls.push({ historyLen: ctx.history.length });
    const action = this.visionScript[this.visionIdx++];
    if (!action) throw new Error('vision script exhausted');
    return {
      action,
      image: {
        base64: 'AA==',
        originalWidth: ctx.observation.viewportWidth,
        originalHeight: ctx.observation.viewportHeight,
        resizedWidth: ctx.observation.viewportWidth,
        resizedHeight: ctx.observation.viewportHeight,
        scaleX: 1,
        scaleY: 1,
      },
      elapsedMs: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
    };
  }
  async decideNextActionAccessibility(
    ctx: AccessibilityLoopContext,
  ): Promise<AccessibilityDecision> {
    this.a11yCalls.push({ historyLen: ctx.history.length, snapshot: ctx.snapshot });
    const action = this.a11yScript[this.a11yIdx++];
    if (!action) throw new Error('a11y script exhausted');
    return {
      action,
      elapsedMs: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
    };
  }
}

function a11yObs(refCount: number): AccessibilityObservation {
  return {
    snapshot: Array.from({ length: refCount }, (_, i) => `- button "b${i}" [ref=e${i + 1}]`).join(
      '\n',
    ),
    refs: Array.from({ length: refCount }, (_, i) => ({
      ref: `e${i + 1}`,
      role: 'button',
      name: `b${i}`,
    })),
    url: 'https://example.com/',
    title: 'Example',
  };
}

describe('VisionLoopRunner — dual-mode (E3)', () => {
  it('explicit accessibility mode: calls decideNextActionAccessibility, dispatches via a11yActionFn', async () => {
    const commander = new DualModeScriptedCommander(
      [],
      [
        { kind: 'click_ref', ref: 'e1' },
        { kind: 'done', summary: '完成' },
      ],
    );
    const a11yCalls: A11yAction[] = [];
    const runner = new VisionLoopRunner({
      commander,
      visionModeEnv: 'accessibility',
      screenshotFn: async () => makeObservation(0),
      actionFn: async () => ({ ok: true }),
      accessibilityFn: async () => a11yObs(10),
      a11yActionFn: async (_tick, action) => {
        a11yCalls.push(action);
        return { ok: true };
      },
    });
    const outcome = await runner.run('在页面上点按钮');
    expect(outcome.status).toBe('completed');
    if (outcome.status === 'completed') expect(outcome.summary).toBe('完成');
    expect(commander.a11yCalls.length).toBe(2);
    expect(commander.visionCalls.length).toBe(0);
    expect(a11yCalls).toEqual([{ kind: 'click_ref', ref: 'e1' }]);
  });

  it('auto mode with rich a11y tree (refs ≥ 5) → picks accessibility', async () => {
    const commander = new DualModeScriptedCommander([], [{ kind: 'done', summary: 'ok' }]);
    const runner = new VisionLoopRunner({
      commander,
      visionModeEnv: 'auto',
      screenshotFn: async () => makeObservation(0),
      actionFn: async () => ({ ok: true }),
      accessibilityFn: async () => a11yObs(10), // 10 refs >= MIN_A11Y_ELEMENTS (5)
      a11yActionFn: async () => ({ ok: true }),
    });
    const outcome = await runner.run('read the page');
    expect(outcome.status).toBe('completed');
    expect(commander.a11yCalls.length).toBe(1);
    expect(commander.visionCalls.length).toBe(0);
  });

  it('auto mode with thin a11y tree (refs < 5) → falls through to screenshot', async () => {
    const commander = new DualModeScriptedCommander(
      [{ kind: 'done', summary: 'screenshot mode' }],
      [],
    );
    const runner = new VisionLoopRunner({
      commander,
      visionModeEnv: 'auto',
      screenshotFn: async () => makeObservation(0),
      actionFn: async () => ({ ok: true }),
      accessibilityFn: async () => a11yObs(2), // < MIN_A11Y_ELEMENTS
      a11yActionFn: async () => ({ ok: true }),
    });
    const outcome = await runner.run('canvas page');
    expect(outcome.status).toBe('completed');
    if (outcome.status === 'completed') expect(outcome.summary).toBe('screenshot mode');
    expect(commander.visionCalls.length).toBe(1);
    expect(commander.a11yCalls.length).toBe(0);
  });

  it('screenshot mode with no a11y wiring: existing callers unchanged', async () => {
    // No accessibilityFn / a11yActionFn / visionModeEnv provided — runner
    // must stay on the legacy screenshot path for back-compat.
    const commander = new DualModeScriptedCommander([{ kind: 'done', summary: 'legacy' }], []);
    const runner = new VisionLoopRunner({
      commander,
      screenshotFn: async () => makeObservation(0),
      actionFn: async () => ({ ok: true }),
    });
    const outcome = await runner.run('legacy');
    expect(outcome.status).toBe('completed');
    expect(commander.visionCalls.length).toBe(1);
    expect(commander.a11yCalls.length).toBe(0);
  });
});
