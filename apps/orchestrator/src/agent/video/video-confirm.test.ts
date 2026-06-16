import { describe, expect, it, vi } from 'vitest';
import { decideVideoGate, parseVideoConfirm, quoteVideo } from './video-confirm.js';

describe('parseVideoConfirm — structured action wins', () => {
  it('maps button actions with zero text guessing', () => {
    expect(parseVideoConfirm({ action: 'confirm_video' })).toBe('video');
    expect(parseVideoConfirm({ action: 'confirm_image' })).toBe('image');
    expect(parseVideoConfirm({ action: 'cancel' })).toBe('cancel');
    // action wins even if text says otherwise
    expect(parseVideoConfirm({ action: 'cancel', text: '确认' })).toBe('cancel');
  });
});

describe('parseVideoConfirm — free-text negation guard FIRST (anti-burn)', () => {
  it('any negation → cancel, even alongside a confirm-ish word', () => {
    for (const t of ['先不要了', '不做了', '取消', '别了', '算了', '先不', '再想想', '暂时不用', '我不要做']) {
      expect(parseVideoConfirm({ text: t })).toBe('cancel');
    }
  });
  it('anchored confirm words → video (NOT substring 要/好)', () => {
    for (const t of ['确认', '确定', '开始制作', '做吧', '开始吧', '可以开始']) {
      expect(parseVideoConfirm({ text: t })).toBe('video');
    }
  });
  it('bare 要/好 / vague → unclear (never auto-confirm)', () => {
    expect(parseVideoConfirm({ text: '好' })).toBe('unclear');
    expect(parseVideoConfirm({ text: '要' })).toBe('unclear');
    expect(parseVideoConfirm({ text: '随便' })).toBe('unclear');
    expect(parseVideoConfirm({ text: '' })).toBe('unclear');
    expect(parseVideoConfirm({})).toBe('unclear');
  });
  it('image words → image', () => {
    expect(parseVideoConfirm({ text: '图片版' })).toBe('image');
    expect(parseVideoConfirm({ text: '用图片就好' })).toBe('image');
  });
});

describe('decideVideoGate — Veo burns ONLY on generate_*', () => {
  it('cancel/unclear/not-claimed never generate', () => {
    expect(decideVideoGate('cancel', true)).toBe('cancel');
    expect(decideVideoGate('unclear', true)).toBe('reprompt');
    expect(decideVideoGate('video', false)).toBe('already_consumed');
    expect(decideVideoGate('image', false)).toBe('already_consumed');
  });
  it('video/image with claim → generate', () => {
    expect(decideVideoGate('video', true)).toBe('generate_video');
    expect(decideVideoGate('image', true)).toBe('generate_image');
  });
});

// ① 否定文本 → cancel 且 generateVeoVideo zero-call (gate 真决策驱动 spy)
describe('① negation reply → cancel → zero generation call', () => {
  it('a rejection never reaches the generate path', () => {
    const generateVeoVideo = vi.fn(); // 代表 runSimpleVideoCreation(含 Veo)
    const choice = parseVideoConfirm({ text: '先不要了' });
    expect(choice).toBe('cancel');
    const action = decideVideoGate(choice, /* claimed */ true);
    if (action === 'generate_video' || action === 'generate_image') generateVeoVideo();
    expect(generateVeoVideo).not.toHaveBeenCalled(); // zero-call
  });
});

// ② 同一报价双确认 → consumeVideoConfirm 第一次 true/第二次 false → generate exactly once
describe('② double-confirm → generate exactly once', () => {
  it('second confirm (claim=false) does not re-generate', () => {
    const generateVeoVideo = vi.fn();
    const claims = [true, false]; // consumeVideoConfirm: 第一次抢到、第二次已被消费
    let i = 0;
    const confirmOnce = () => {
      const choice = parseVideoConfirm({ action: 'confirm_video' });
      const claimed = claims[i++] ?? false;
      const action = decideVideoGate(choice, claimed);
      if (action === 'generate_video' || action === 'generate_image') generateVeoVideo();
      return action;
    };
    expect(confirmOnce()).toBe('generate_video'); // 1st → 生成
    expect(confirmOnce()).toBe('already_consumed'); // 2nd → 不生成
    expect(generateVeoVideo).toHaveBeenCalledTimes(1); // exactly once
  });
});

describe('quoteVideo — dynamic by segment count', () => {
  it('videoCny = segs × 8s × Fast($0.12) × 7.3, ceil', () => {
    const q = quoteVideo(5, 'veo_fast');
    expect(q.segments).toBe(5);
    expect(q.videoCny).toBe(Math.ceil(5 * 8 * 0.12 * 7.3)); // = 36
    expect(q.message).toContain('5 段');
    expect(q.message).toContain(`¥${q.videoCny}`);
  });
  it('scales with segments (3 vs 6 segs)', () => {
    expect(quoteVideo(6, 'veo_fast').videoCny).toBeGreaterThan(quoteVideo(3, 'veo_fast').videoCny);
  });
  it('lite tier is cheaper than fast for the same segments', () => {
    expect(quoteVideo(5, 'veo_lite').videoCny).toBeLessThan(quoteVideo(5, 'veo_fast').videoCny);
  });

  it('720p is cheaper than 1080p (画质诚实定价) for Veo Fast', () => {
    const p720 = quoteVideo(5, 'veo_fast', { resolution: '720p' });
    const p1080 = quoteVideo(5, 'veo_fast', { resolution: '1080p' });
    expect(p720.videoCny).toBe(Math.ceil(5 * 8 * 0.1 * 7.3)); // 720p $0.10/s
    expect(p720.videoCny).toBeLessThan(p1080.videoCny);
    expect(p720.message).toContain('720p');
  });

  it('6s duration bills less than 8s (时长进计费)', () => {
    const d6 = quoteVideo(5, 'veo_fast', { durationSeconds: 6 });
    const d8 = quoteVideo(5, 'veo_fast', { durationSeconds: 8 });
    expect(d6.videoCny).toBe(Math.ceil(5 * 6 * 0.12 * 7.3));
    expect(d6.videoCny).toBeLessThan(d8.videoCny);
    expect(d6.message).toContain('每段 6 秒');
  });

  it('label + 画幅措辞如实标注选定档 (happyhorse / 横屏)', () => {
    const q = quoteVideo(4, 'happyhorse', { aspectRatio: '16:9' });
    expect(q.message).toContain('快马 HappyHorse');
    expect(q.message).toContain('横屏');
    expect(q.message).not.toContain('Veo Fast'); // 不再硬写 Fast
  });
});
