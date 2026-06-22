import { describe, expect, it } from 'vitest';
import {
  CRYSTALLIZER_VERSION,
  type CaptureRow,
  PLACEHOLDER_CAPABILITY_KEY,
  type PlanInput,
  type SourceTaskRow,
  buildPathMetadata,
  deriveStepIntent,
  planCrystallization,
  wrapTargetText,
} from './crystallizer.js';

const NOW = '2026-06-23T00:00:00.000Z';

function task(id: number, over: Partial<SourceTaskRow> = {}): SourceTaskRow {
  return { id, externalId: `tsk_${id}`, intent: `intent ${id}`, status: 'completed', ...over };
}

function cap(actionIndex: number, over: Partial<CaptureRow> = {}): CaptureRow {
  return {
    actionIndex,
    stepType: 'click',
    siteDomain: 'example.com',
    visibleText: 'Learn more',
    targetSelectorJson: null,
    coordinateJson: null,
    framePath: null,
    screenshotAnchorId: null,
    ...over,
  };
}

function baseInput(over: Partial<PlanInput> = {}): PlanInput {
  return {
    tasks: [],
    capturesByTaskId: new Map(),
    alreadyCrystallizedTaskIds: new Set(),
    existingSiteIdByDomain: new Map(),
    existingCapByDomain: new Map(),
    nowIso: NOW,
    ...over,
  };
}

describe('wrapTargetText', () => {
  it('wraps non-empty text as a candidates array', () => {
    expect(wrapTargetText('Learn more')).toEqual({ candidates: ['Learn more'] });
  });
  it('trims', () => {
    expect(wrapTargetText('  hi  ')).toEqual({ candidates: ['hi'] });
  });
  it('returns null for null / empty / whitespace', () => {
    expect(wrapTargetText(null)).toBeNull();
    expect(wrapTargetText('')).toBeNull();
    expect(wrapTargetText('   ')).toBeNull();
  });
});

describe('deriveStepIntent', () => {
  it('navigate uses the domain', () => {
    expect(deriveStepIntent('navigate', null, 'example.com')).toBe('打开 example.com');
  });
  it('navigate without a domain falls back', () => {
    expect(deriveStepIntent('navigate', null, null)).toBe('打开页面');
  });
  it('click quotes the visible text', () => {
    expect(deriveStepIntent('click', 'Learn more', 'example.com')).toBe('点击"Learn more"');
  });
  it('click without text falls back', () => {
    expect(deriveStepIntent('click', null, 'example.com')).toBe('点击页面元素');
  });
  it('type references the anchor but never the typed value', () => {
    expect(deriveStepIntent('type', 'Email', null)).toBe('在"Email"输入文本');
    expect(deriveStepIntent('type', null, null)).toBe('输入文本');
  });
  it('scroll + unknown types', () => {
    expect(deriveStepIntent('scroll', null, null)).toBe('滚动页面');
    expect(deriveStepIntent('wait', null, null)).toBe('wait');
  });
  it('caps the result at 255 chars even with very long visible text', () => {
    const long = 'x'.repeat(5000);
    const out = deriveStepIntent('click', long, 'example.com');
    expect(Array.from(out).length).toBeLessThanOrEqual(255);
  });
});

describe('buildPathMetadata', () => {
  it('keeps the FULL source intent (never truncated) + provenance', () => {
    const longIntent = '请帮我'.repeat(500);
    const meta = buildPathMetadata(task(7, { intent: longIntent }), NOW);
    expect(meta.sourceTaskIntent).toBe(longIntent); // v2 clustering material — verbatim
    expect(meta.sourceTaskId).toBe(7);
    expect(meta.sourceTaskExternalId).toBe('tsk_7');
    expect(meta.crystallizedAt).toBe(NOW);
    expect(meta.crystallizerVersion).toBe(CRYSTALLIZER_VERSION);
  });
});

describe('planCrystallization — selection / dedup', () => {
  it('skips a task that is already crystallized (source_task_id dedup)', () => {
    const r = planCrystallization(
      baseInput({
        tasks: [task(1)],
        capturesByTaskId: new Map([[1, [cap(1)]]]),
        alreadyCrystallizedTaskIds: new Set([1]),
      }),
    );
    expect(r.planned).toHaveLength(0);
    expect(r.skipped).toEqual([
      { sourceTaskId: 1, sourceTaskExternalId: 'tsk_1', reason: 'already_crystallized' },
    ]);
  });

  it('skips a task with no captures', () => {
    const r = planCrystallization(baseInput({ tasks: [task(1)], capturesByTaskId: new Map() }));
    expect(r.skipped[0]?.reason).toBe('no_captures');
  });

  it('skips a task whose captures all have null/blank site_domain', () => {
    const r = planCrystallization(
      baseInput({
        tasks: [task(1)],
        capturesByTaskId: new Map([
          [1, [cap(1, { siteDomain: null }), cap(2, { siteDomain: '  ' })]],
        ]),
      }),
    );
    expect(r.skipped[0]?.reason).toBe('no_site_domain');
    expect(r.planned).toHaveLength(0);
  });
});

describe('planCrystallization — captures → steps mapping', () => {
  it('re-indexes NON-CONTIGUOUS action_index into dense 0..N in action order', () => {
    const r = planCrystallization(
      baseInput({
        tasks: [task(1)],
        capturesByTaskId: new Map([
          [
            1,
            [
              cap(5, { stepType: 'navigate', visibleText: null, siteDomain: 'iana.org' }),
              cap(1, { stepType: 'navigate', visibleText: null, siteDomain: 'example.com' }),
              cap(3, { stepType: 'click', visibleText: 'Learn more', siteDomain: 'example.com' }),
            ],
          ],
        ]),
      }),
    );
    const steps = r.planned[0]?.steps ?? [];
    expect(steps.map((s) => s.stepIndex)).toEqual([0, 1, 2]);
    // sorted by action_index: 1 (navigate example), 3 (click), 5 (navigate iana)
    expect(steps.map((s) => s.stepType)).toEqual(['navigate', 'click', 'navigate']);
    expect(r.planned[0]?.siteDomain).toBe('example.com'); // entry (first by action_index)
    expect(r.planned[0]?.crossDomain).toBe(true); // touched iana.org too
  });

  it('carries text anchor / selector / coordinate / frame_path / screenshot_anchor_id through', () => {
    const r = planCrystallization(
      baseInput({
        tasks: [task(1)],
        capturesByTaskId: new Map([
          [
            1,
            [
              cap(2, {
                stepType: 'click',
                visibleText: 'Learn more',
                targetSelectorJson: { css: 'a.more' },
                coordinateJson: { x: 10, y: 20 },
                framePath: 'https://example.com/',
                screenshotAnchorId: 82,
              }),
            ],
          ],
        ]),
      }),
    );
    const s = r.planned[0]?.steps[0];
    expect(s?.targetTextJson).toEqual({ candidates: ['Learn more'] });
    expect(s?.targetSelectorJson).toEqual({ css: 'a.more' });
    expect(s?.coordinateFallbackJson).toEqual({ x: 10, y: 20 });
    expect(s?.framePath).toBe('https://example.com/');
    expect(s?.screenshotAnchorId).toBe(82);
    expect(s?.intent).toBe('点击"Learn more"');
  });

  it('drops only the null-domain captures, keeps the rest as steps', () => {
    const r = planCrystallization(
      baseInput({
        tasks: [task(1)],
        capturesByTaskId: new Map([
          [
            1,
            [
              cap(1, { stepType: 'navigate', siteDomain: 'example.com', visibleText: null }),
              cap(2, { siteDomain: null }), // dropped
              cap(3, { stepType: 'click', siteDomain: 'example.com' }),
            ],
          ],
        ]),
      }),
    );
    expect(r.planned[0]?.steps).toHaveLength(2);
  });
});

describe('planCrystallization — version sequence + create/reuse', () => {
  it('assigns ascending versions for multiple tasks on the same NEW capability', () => {
    const r = planCrystallization(
      baseInput({
        tasks: [task(1), task(2), task(3)],
        capturesByTaskId: new Map([
          [1, [cap(1)]],
          [2, [cap(1)]],
          [3, [cap(1)]],
        ]),
      }),
    );
    expect(r.planned.map((p) => p.version)).toEqual([1, 2, 3]);
    // first task creates site+cap, the rest reuse
    expect(r.planned.map((p) => p.siteAction)).toEqual(['create', 'reuse', 'reuse']);
    expect(r.planned.map((p) => p.capabilityAction)).toEqual(['create', 'reuse', 'reuse']);
    expect(r.planned.every((p) => p.capabilityKey === PLACEHOLDER_CAPABILITY_KEY)).toBe(true);
  });

  it('continues the version after an EXISTING capability max version', () => {
    const r = planCrystallization(
      baseInput({
        tasks: [task(1), task(2)],
        capturesByTaskId: new Map([
          [1, [cap(1)]],
          [2, [cap(1)]],
        ]),
        existingSiteIdByDomain: new Map([['example.com', 100]]),
        existingCapByDomain: new Map([['example.com', { capabilityId: 200, maxVersion: 2 }]]),
      }),
    );
    expect(r.planned.map((p) => p.version)).toEqual([3, 4]);
    expect(r.planned.map((p) => p.siteAction)).toEqual(['reuse', 'reuse']);
    expect(r.planned.map((p) => p.capabilityAction)).toEqual(['reuse', 'reuse']);
  });

  it('versions are independent per domain', () => {
    const r = planCrystallization(
      baseInput({
        tasks: [task(1), task(2)],
        capturesByTaskId: new Map([
          [1, [cap(1, { siteDomain: 'a.com' })]],
          [2, [cap(1, { siteDomain: 'b.com' })]],
        ]),
      }),
    );
    expect(r.planned.map((p) => `${p.siteDomain}:v${p.version}`)).toEqual(['a.com:v1', 'b.com:v1']);
  });
});

describe('planCrystallization — determinism', () => {
  it('produces an identical plan on repeated calls (dry-run == commit plan)', () => {
    const mk = () =>
      baseInput({
        tasks: [task(2), task(1)], // unordered input
        capturesByTaskId: new Map([
          [1, [cap(3), cap(1)]],
          [2, [cap(2)]],
        ]),
      });
    expect(planCrystallization(mk())).toEqual(planCrystallization(mk()));
  });
});
