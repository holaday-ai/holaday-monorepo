import { describe, expect, it } from 'vitest';
import { BrowserControl } from './browser-control.js';

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function lease(control: BrowserControl): string {
  const value = control.snapshot().lease;
  expect(typeof value).toBe('string');
  if (!value) throw new Error('expected owner lease');
  return value;
}

describe('BrowserControl ownership handoff', () => {
  it('parks a waiting reply on the same control and preserves an early reply until return', async () => {
    const control = new BrowserControl();
    const reply = deferred<string>();
    const effects: string[] = [];
    const waiting = control.waitForReply(
      reply.promise,
      async () => {
        effects.push('observe');
      },
      1000,
    );
    control.requestHuman();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(control.snapshot().phase).toBe('human');
    reply.resolve('继续');
    let finished = false;
    void waiting.then(() => {
      finished = true;
    });
    await Promise.resolve();
    expect(finished).toBe(false);
    control.returnToAgent(lease(control));
    expect(await waiting).toMatchObject({ reason: 'reply', value: '继续', resumed: true });
    expect(effects).toEqual(['observe']);
  });

  it('coalesces resize requests and reobserves before allowing another AI action', async () => {
    const control = new BrowserControl();
    const effects: string[] = [];
    control.queueViewport(async () => {
      effects.push('old-size');
    });
    control.queueViewport(async () => {
      effects.push('latest-size');
    });
    expect(control.canAgentAct()).toBe(false);
    expect(control.snapshot().lease).toBeNull();
    expect(effects).toEqual([]);
    await control.checkpoint(async () => {
      effects.push('observe');
      expect(control.canAgentAct()).toBe(false);
    });
    expect(effects).toEqual(['latest-size', 'observe']);
    expect(control.canAgentAct()).toBe(true);
    expect(control.snapshot().lease).toBeNull();
  });

  it('repeats observation if the window changes during screenshot capture', async () => {
    const control = new BrowserControl();
    const effects: string[] = [];
    control.queueViewport(async () => {
      effects.push('first-size');
    });
    await control.checkpoint(async () => {
      effects.push('observe');
      if (effects.length === 2) {
        control.queueViewport(async () => {
          effects.push('second-size');
        });
      }
    });
    expect(effects).toEqual(['first-size', 'observe', 'second-size', 'observe']);
    expect(control.canAgentAct()).toBe(true);
  });

  it('settles manual input before resize and observes the new size on return', async () => {
    const control = new BrowserControl();
    const finish = deferred();
    const started = deferred();
    const effects: string[] = [];
    control.requestHuman();
    const parked = control.checkpoint(async () => {
      effects.push('observe');
    });
    const token = lease(control);
    const input = control.runHuman(token, async () => {
      started.resolve();
      await finish.promise;
      effects.push('input');
    });
    await started.promise;
    control.queueViewport(async () => {
      effects.push('resize');
    });
    control.returnToAgent(token);
    expect(effects).toEqual([]);
    finish.resolve();
    await Promise.all([input, parked]);
    expect(effects).toEqual(['input', 'resize', 'observe']);
  });

  it('does not grant human control or resume AI when an automatic resize fails', async () => {
    const control = new BrowserControl();
    const effects: string[] = [];
    control.queueViewport(async () => {
      throw new Error('session gone');
    });
    expect(
      await control.checkpoint(async () => {
        effects.push('observe');
      }),
    ).toMatchObject({ resumed: false });
    expect(control.snapshot()).toMatchObject({
      phase: 'closed',
      lease: null,
      error: 'viewport_failed',
    });
    expect(effects).toEqual([]);
  });

  it('does not grant manual input until the runner reaches a settled boundary', async () => {
    const control = new BrowserControl();
    const effects: string[] = [];
    control.requestHuman();
    expect(control.snapshot().phase).toBe('requested');
    expect(control.snapshot().lease).toBeNull();
    await expect(
      control.runHuman('invented', async () => {
        effects.push('input');
      }),
    ).rejects.toThrow('browser_control_not_owned');
    const parked = control.checkpoint(async () => {
      effects.push('observe');
    });
    expect(control.snapshot().phase).toBe('human');
    const token = lease(control);
    await control.runHuman(token, async () => {
      effects.push('input');
    });
    expect(effects).toEqual(['input']);
    control.returnToAgent(token);
    expect(await parked).toMatchObject({ resumed: true });
    expect(effects).toEqual(['input', 'observe']);
    expect(control.snapshot().phase).toBe('agent');
  });

  it('merges repeated requests without replacing a valid lease', async () => {
    const control = new BrowserControl();
    control.requestHuman();
    control.requestHuman();
    const parked = control.checkpoint(async () => undefined);
    const token = lease(control);
    control.requestHuman();
    expect(lease(control)).toBe(token);
    control.returnToAgent(token);
    control.returnToAgent(token);
    await parked;
    expect(control.snapshot().phase).toBe('agent');
  });

  it('serializes accepted inputs and settles all of them before observing', async () => {
    const control = new BrowserControl();
    const firstStarted = deferred();
    const finishFirst = deferred();
    const events: string[] = [];
    control.requestHuman();
    const parked = control.checkpoint(async () => {
      events.push('observe');
    });
    const token = lease(control);
    const first = control.runHuman(token, async () => {
      events.push('first-start');
      firstStarted.resolve();
      await finishFirst.promise;
      events.push('first-end');
    });
    const second = control.runHuman(token, async () => {
      events.push('second');
    });
    await firstStarted.promise;
    control.returnToAgent(token);
    expect(control.snapshot().phase).toBe('resuming');
    expect(control.snapshot().lease).toBeNull();
    await expect(
      control.runHuman(token, async () => {
        events.push('late');
      }),
    ).rejects.toThrow('browser_control_not_owned');
    expect(events).toEqual(['first-start']);
    finishFirst.resolve();
    await Promise.all([first, second, parked]);
    expect(events).toEqual(['first-start', 'first-end', 'second', 'observe']);
  });

  it('invalidates earlier handoff leases even on the same task', async () => {
    const control = new BrowserControl();
    const effects: string[] = [];
    control.requestHuman();
    const first = control.checkpoint(async () => undefined);
    const oldToken = lease(control);
    control.returnToAgent(oldToken);
    await first;
    control.requestHuman();
    const second = control.checkpoint(async () => undefined);
    const newToken = lease(control);
    expect(newToken).not.toBe(oldToken);
    await expect(
      control.runHuman(oldToken, async () => {
        effects.push('stale');
      }),
    ).rejects.toThrow('browser_control_not_owned');
    expect(() => control.returnToAgent(oldToken)).toThrow('browser_control_not_owned');
    expect(effects).toEqual([]);
    control.returnToAgent(newToken);
    await second;
  });

  it('does not accept another running task or process generation lease', async () => {
    const one = new BrowserControl();
    const two = new BrowserControl();
    one.requestHuman();
    two.requestHuman();
    const a = one.checkpoint(async () => undefined);
    const b = two.checkpoint(async () => undefined);
    await expect(two.runHuman(lease(one), async () => 'wrong task')).rejects.toThrow(
      'browser_control_not_owned',
    );
    one.close();
    two.close();
    await Promise.all([a, b]);
  });

  it('keeps the runner paused with a new lease when observation fails', async () => {
    const control = new BrowserControl();
    const observed = deferred();
    let attempts = 0;
    control.requestHuman();
    const parked = control.checkpoint(async () => {
      attempts++;
      if (attempts === 1) {
        observed.resolve();
        throw new Error('camera unavailable');
      }
    });
    const oldToken = lease(control);
    control.returnToAgent(oldToken);
    await observed.promise;
    // Let the rejected observation settle inside the real checkpoint.
    await Promise.resolve();
    expect(control.snapshot()).toMatchObject({ phase: 'human', error: 'observation_failed' });
    const retryToken = lease(control);
    expect(retryToken).not.toBe(oldToken);
    control.returnToAgent(retryToken);
    expect(await parked).toMatchObject({ resumed: true });
    expect(attempts).toBe(2);
    expect(control.snapshot().error).toBeNull();
  });

  it('does not confirm return while a fresh observation is still pending', async () => {
    const control = new BrowserControl();
    const observing = deferred();
    const finishObservation = deferred();
    control.requestHuman();
    const parked = control.checkpoint(async () => {
      observing.resolve();
      await finishObservation.promise;
    });
    const token = lease(control);
    control.returnToAgent(token);
    await observing.promise;
    expect(control.snapshot().phase).toBe('resuming');
    expect(() => control.requestHuman()).toThrow('browser_control_transfer_pending');
    finishObservation.resolve();
    await parked;
    expect(control.snapshot().phase).toBe('agent');
  });

  it('cancellation releases the parked runner without resuming AI', async () => {
    const control = new BrowserControl();
    const events: string[] = [];
    control.requestHuman();
    const parked = control.checkpoint(async () => {
      events.push('observe');
    });
    const token = lease(control);
    control.close();
    expect(await parked).toMatchObject({ resumed: false });
    await expect(
      control.runHuman(token, async () => {
        events.push('input');
      }),
    ).rejects.toThrow('browser_control_not_owned');
    expect(events).toEqual([]);
    expect(control.snapshot().phase).toBe('closed');
  });

  it('does not resurrect a closed run when observation finishes late', async () => {
    const control = new BrowserControl();
    const observing = deferred();
    const finish = deferred();
    control.requestHuman();
    const parked = control.checkpoint(async () => {
      observing.resolve();
      await finish.promise;
    });
    control.returnToAgent(lease(control));
    await observing.promise;
    control.close();
    finish.resolve();
    expect(await parked).toMatchObject({ resumed: false });
    expect(control.snapshot().phase).toBe('closed');
  });

  it('does not poison later input settlement when an accepted input rejects', async () => {
    const control = new BrowserControl();
    const effects: string[] = [];
    control.requestHuman();
    const parked = control.checkpoint(async () => {
      effects.push('observe');
    });
    const token = lease(control);
    await expect(
      control.runHuman(token, async () => {
        throw new Error('input rejected');
      }),
    ).rejects.toThrow('input rejected');
    await control.runHuman(token, async () => {
      effects.push('next');
    });
    control.returnToAgent(token);
    await parked;
    expect(effects).toEqual(['next', 'observe']);
  });

  it('skips queued input after cancellation without treating active input as settled', async () => {
    const control = new BrowserControl();
    const started = deferred();
    const finish = deferred();
    const events: string[] = [];
    control.requestHuman();
    const parked = control.checkpoint(async () => {
      events.push('observe');
    });
    const token = lease(control);
    const active = control.runHuman(token, async () => {
      started.resolve();
      await finish.promise;
      events.push('active-ended');
    });
    const queued = control.runHuman(token, async () => {
      events.push('queued');
    });
    const rejected = expect(queued).rejects.toThrow('browser_control_closed');
    await started.promise;
    control.close();
    let runnerReleased = false;
    void parked.then(() => {
      runnerReleased = true;
    });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    try {
      expect(runnerReleased).toBe(false);
      expect(events).toEqual([]);
    } finally {
      finish.resolve();
      await active;
      await rejected;
      await parked;
    }
    expect(events).toEqual(['active-ended']);
  });

  it('leaves uninterrupted execution alone and refuses two parked owners', async () => {
    const control = new BrowserControl();
    const events: string[] = [];
    expect(
      await control.checkpoint(async () => {
        events.push('unneeded');
      }),
    ).toEqual({ resumed: false, waitedMs: 0 });
    control.requestHuman();
    const parked = control.checkpoint(async () => undefined);
    await expect(control.checkpoint(async () => undefined)).rejects.toThrow(
      'browser_control_checkpoint_active',
    );
    control.close();
    await parked;
    expect(events).toEqual([]);
  });
});
