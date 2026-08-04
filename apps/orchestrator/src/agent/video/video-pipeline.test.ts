import { describe, expect, it, vi } from 'vitest';
import { runVideoPipeline, type VideoPipelineDeps } from './video-pipeline.js';
import type { VideoScript } from './types.js';

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

const SCRIPT: VideoScript = {
  title: '夏季防晒',
  segments: [
    { text: '姐妹们夏天到了', type: 'voiceover' },
    { text: '防晒霜特写', type: 'broll', visual: '防晒霜产品特写' },
    { text: '记得补涂', type: 'voiceover' },
  ],
};

/** Deps that record calls + return deterministic refs keyed by segment index. */
function makeDeps(overrides: Partial<VideoPipelineDeps> = {}): {
  deps: VideoPipelineDeps;
  calls: { synth: number[]; broll: number[]; brollclip: number[]; lipsync: number[] };
} {
  const calls = {
    synth: [] as number[],
    broll: [] as number[],
    brollclip: [] as number[],
    lipsync: [] as number[],
  };
  const deps: VideoPipelineDeps = {
    async synthesizeSegmentAudio({ index }) {
      calls.synth.push(index);
      return { audioRef: `audio_${index}`, durationMs: 1000 * (index + 1) };
    },
    async generateBroll({ index }) {
      calls.broll.push(index);
      return { visualRef: `visual_${index}` };
    },
    async renderBrollClip({ index }) {
      calls.brollclip.push(index);
      return { clipRef: `clip_${index}` };
    },
    async lipSyncSegment({ index }) {
      calls.lipsync.push(index);
      return { clipRef: `clip_${index}` };
    },
    logger,
    ...overrides,
  };
  return { deps, calls };
}

describe('runVideoPipeline', () => {
  it('synthesizes all narration, builds the timeline from durations, then clips per type', async () => {
    const { deps, calls } = makeDeps();
    const out = await runVideoPipeline({ script: SCRIPT }, deps);

    // ② synth for every segment.
    expect(calls.synth).toEqual([0, 1, 2]);
    // ④ lip-sync only for voiceover (0, 2); ③ broll only for broll (1).
    expect(calls.lipsync).toEqual([0, 2]);
    expect(calls.broll).toEqual([1]);
    expect(calls.brollclip).toEqual([1]);

    // ⑤ timeline from MEASURED durations (1000, 2000, 3000), laid end-to-end.
    expect(out.timeline.segments.map((s) => s.durationMs)).toEqual([1000, 2000, 3000]);
    expect(out.timeline.segments.map((s) => s.startMs)).toEqual([0, 1000, 3000]);
    expect(out.timeline.totalDurationMs).toBe(6000);
    expect(out.srt).toContain('00:00:00,000 --> 00:00:01,000');

    // Each segment carries its clip; broll carries a visualRef.
    expect(out.segments.map((s) => s.clipRef)).toEqual(['clip_0', 'clip_1', 'clip_2']);
    expect(out.segments[1]?.visualRef).toBe('visual_1');
    expect(out.segments[0]?.visualRef).toBeUndefined();
  });

  it('keeps every generated segment at least as long as the selected model duration', async () => {
    const renderBrollClip = vi.fn(async () => ({ clipRef: 'clip_1' }));
    const lipSyncSegment = vi.fn(async ({ index }: { index: number }) => ({
      clipRef: `clip_${index}`,
    }));
    const { deps } = makeDeps({ renderBrollClip, lipSyncSegment });

    const out = await runVideoPipeline(
      { script: SCRIPT, minimumSegmentDurationMs: 2_500 },
      deps,
    );

    expect(out.timeline.segments.map((segment) => segment.durationMs)).toEqual([
      2_500, 2_500, 3_000,
    ]);
    expect(out.timeline.segments.map((segment) => segment.startMs)).toEqual([0, 2_500, 5_000]);
    expect(out.timeline.totalDurationMs).toBe(8_000);
    expect(lipSyncSegment).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ index: 0, durationMs: 2_500 }),
    );
    expect(renderBrollClip).toHaveBeenCalledWith(
      expect.objectContaining({ index: 1, durationMs: 2_500 }),
    );
  });

  it('retries only the failed句 (single transient failure recovers)', async () => {
    let lipFails = 1;
    const { deps, calls } = makeDeps({
      async lipSyncSegment({ index }) {
        calls.lipsync.push(index);
        if (index === 0 && lipFails > 0) {
          lipFails -= 1;
          throw new Error('fal transient');
        }
        return { clipRef: `clip_${index}` };
      },
    });
    const out = await runVideoPipeline({ script: SCRIPT, retries: 1 }, deps);
    // segment 0 lip-sync attempted twice (fail, then success); segment 2 once.
    expect(calls.lipsync).toEqual([0, 0, 2]);
    expect(out.segments[0]?.clipRef).toBe('clip_0');
  });

  it('does not retry a step that explicitly marks its failure as non-retryable', async () => {
    let attempts = 0;
    const { deps } = makeDeps({
      async generateBroll() {
        attempts += 1;
        throw Object.assign(new Error('quality gate unavailable'), { retryable: false });
      },
    });

    await expect(runVideoPipeline({ script: SCRIPT, retries: 3 }, deps)).rejects.toThrow(
      'quality gate unavailable',
    );
    expect(attempts).toBe(1);
  });

  it('throws after exhausting retries on a persistently failing句', async () => {
    const { deps } = makeDeps({
      async lipSyncSegment() {
        throw new Error('fal down');
      },
    });
    await expect(runVideoPipeline({ script: SCRIPT, retries: 2 }, deps)).rejects.toThrow('fal down');
    expect(logger.error).toHaveBeenCalled();
  });

  it('reports progress per stage', async () => {
    const onProgress = vi.fn();
    const { deps } = makeDeps({ onProgress });
    await runVideoPipeline({ script: SCRIPT }, deps);
    const stages = onProgress.mock.calls.map((c) => c[0].stage);
    expect(stages).toContain('synthesize');
    expect(stages).toContain('lipsync');
    expect(stages).toContain('broll');
    expect(stages).toContain('done');
  });

  it('throws on an empty script', async () => {
    const { deps } = makeDeps();
    await expect(
      runVideoPipeline({ script: { title: 'x', segments: [] } }, deps),
    ).rejects.toThrow(/no segments/);
  });
});
