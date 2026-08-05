import { describe, expect, it, vi } from 'vitest';
import {
  decideVideoGate,
  parseVideoConfirm,
  preflightCloneVideoAssets,
  preflightIpVideoAssets,
  quoteCloneVideo,
  quoteIpVideo,
  quotePetI2v,
  quoteVideo,
} from './video-confirm.js';

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

describe('preflightIpVideoAssets — validate durable inputs before quote consumption', () => {
  it('blocks an unreadable base video with an actionable re-upload message', async () => {
    const signBaseVideo = vi.fn(async () => null);

    await expect(
      preflightIpVideoAssets(
        {
          voiceId: 'voice_ready',
          baseVideoFileId: 'file_stale',
          authorized: true,
        },
        signBaseVideo,
      ),
    ).resolves.toEqual({
      baseVideoUrl: null,
      issue: '出镜底版当前不可用，请稍后重试；若持续出现，请重新上传。',
    });
    expect(signBaseVideo).toHaveBeenCalledWith('file_stale');
  });

  it('returns the signed base-video URL when all durable inputs are ready', async () => {
    const signBaseVideo = vi.fn(async () => 'https://r2.example/base.mp4');

    await expect(
      preflightIpVideoAssets(
        {
          voiceId: 'voice_ready',
          baseVideoFileId: 'file_ready',
          authorized: true,
        },
        signBaseVideo,
      ),
    ).resolves.toEqual({
      baseVideoUrl: 'https://r2.example/base.mp4',
      issue: null,
    });
  });
});

describe('preflightCloneVideoAssets — validate quoted files before quota consumption', () => {
  it('blocks confirmation when either quoted file is no longer readable', async () => {
    const retainAndSign = vi.fn(async (fileId: string) =>
      fileId === 'fil_subject' ? 'https://r2.example/subject.png' : null,
    );

    await expect(
      preflightCloneVideoAssets(
        { subjectFileId: 'fil_subject', referenceVideoFileId: 'fil_stale' },
        retainAndSign,
      ),
    ).resolves.toEqual({
      subjectUrl: null,
      referenceVideoUrl: null,
      issue: '主角照片或参考视频当前不可用，请重新上传后再确认制作。',
    });
  });

  it('returns both signed URLs when the quoted inputs are ready', async () => {
    const retainAndSign = vi.fn(async (fileId: string) => `https://r2.example/${fileId}`);

    await expect(
      preflightCloneVideoAssets(
        { subjectFileId: 'fil_subject', referenceVideoFileId: 'fil_reference' },
        retainAndSign,
      ),
    ).resolves.toEqual({
      subjectUrl: 'https://r2.example/fil_subject',
      referenceVideoUrl: 'https://r2.example/fil_reference',
      issue: null,
    });
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

  it('Wan 2.7 uses the official Singapore price for the selected resolution', () => {
    const p720 = quoteVideo(1, 'wanxiang', {
      resolution: '720p',
      durationSeconds: 8,
    });
    const p1080 = quoteVideo(1, 'wanxiang', {
      resolution: '1080p',
      durationSeconds: 8,
    });

    expect(p720.videoCny).toBe(Math.ceil(8 * 0.1 * 7.3));
    expect(p1080.videoCny).toBe(Math.ceil(8 * 0.15 * 7.3));
    expect(p1080.videoCny).toBeGreaterThan(p720.videoCny);
    expect(p720.message).toContain('Wan 2.7');
  });
});

describe('quotePetI2v — 宠物 i2v 报价 (Phase 2 第二期, 原生 RMB/秒)', () => {
  it('happyhorse i2v: videoCny = 秒 × 元/秒 (720P 0.9 / 1080P 1.6), 1080 比 720 贵', () => {
    const p720 = quotePetI2v(5, 'happyhorse_i2v', '720p');
    const p1080 = quotePetI2v(5, 'happyhorse_i2v', '1080p');
    expect(p720.videoCny).toBe(Math.ceil(5 * 0.9)); // = 5
    expect(p1080.videoCny).toBe(Math.ceil(5 * 1.6)); // = 8
    expect(p1080.videoCny).toBeGreaterThan(p720.videoCny);
    expect(p720.message).toContain('快马 i2v');
    expect(p720.message).toContain('5 秒');
  });

  it('wan i2v(默认)远便宜于 happyhorse; 文案不含「图片版」', () => {
    const wan = quotePetI2v(5, 'wan_i2v', '1080p');
    const hh = quotePetI2v(5, 'happyhorse_i2v', '1080p');
    expect(wan.videoCny).toBeLessThan(hh.videoCny);
    expect(wan.videoCny).toBeGreaterThanOrEqual(1); // floor ¥1
    expect(wan.message).toContain('万相 i2v');
    expect(wan.message).not.toContain('图片版'); // 宠物只有 确认/取消
  });

  it('longer duration costs more', () => {
    expect(quotePetI2v(8, 'happyhorse_i2v', '1080p').videoCny).toBeGreaterThan(
      quotePetI2v(3, 'happyhorse_i2v', '1080p').videoCny,
    );
  });
});

describe('quoteCloneVideo — Wan Animate character swap', () => {
  it('uses only the Wan price for a silent reference video', () => {
    const standard = quoteCloneVideo(8.2, 'wan-std', {
      hasAudibleAudio: false,
      lipSyncModel: 'fal-ai/sync-lipsync/v3',
    });
    const professional = quoteCloneVideo(8.2, 'wan-pro', {
      hasAudibleAudio: false,
      lipSyncModel: 'fal-ai/sync-lipsync/v3',
    });

    expect(standard.durationSeconds).toBe(8.2);
    expect(standard.videoCny).toBe(Math.ceil(8.2 * 0.18 * 7.3));
    expect(professional.videoCny).toBe(Math.ceil(8.2 * 0.26 * 7.3));
    expect(professional.videoCny).toBeGreaterThan(standard.videoCny);
    expect(standard.message).toContain('Standard');
    expect(professional.message).toContain('Pro');
    expect(standard.message).toContain('实际输出时长');
    expect(standard.message).toContain('未检测到可听声音');
  });

  it('includes the selected Fal lip-sync price for an audible reference video', () => {
    const v2 = quoteCloneVideo(8.2, 'wan-std', {
      hasAudibleAudio: true,
      lipSyncModel: 'fal-ai/sync-lipsync/v2',
    });
    const v3 = quoteCloneVideo(8.2, 'wan-std', {
      hasAudibleAudio: true,
      lipSyncModel: 'fal-ai/sync-lipsync/v3',
    });

    expect(v2.videoCny).toBe(Math.ceil(8.2 * (0.18 + 3 / 60) * 7.3));
    expect(v3.videoCny).toBe(Math.ceil(8.2 * (0.18 + 8 / 60) * 7.3));
    expect(v3.videoCny).toBeGreaterThan(v2.videoCny);
    expect(v2.message).toContain('Sync Lipsync 2.0');
    expect(v3.message).toContain('Sync Lipsync 3.0');
  });
});

describe('quoteIpVideo — IP 真人换口型 B 架构 (Phase 3)', () => {
  it('按约 5 字/秒估算默认 Sync Lipsync 3.0 的时长成本', () => {
    const q = quoteIpVideo('大家好这是一段不太长的口播文案。');
    const estimatedSeconds = Math.max(1, Math.ceil(q.chars / 5));
    expect(q.videoCny).toBe(
      Math.max(
        1,
        Math.ceil(
          (estimatedSeconds * (8 / 60) + (q.chars / 10000) * 0.115) *
            7.3,
        ),
      ),
    );
    expect(q.videoCny).toBeGreaterThanOrEqual(1);
    expect(q.maybeTooLong).toBe(false);
    expect(q.message).toContain('IP人物视频');
    expect(q.message).toContain('Sync Lipsync 3.0');
    expect(q.message).toContain('预估');
    expect(q.message).toContain('已授权的声音 + 出镜底版');
    expect(q.message).not.toContain('你本人的声音');
    expect(q.message).not.toContain('图片版');
  });

  it('keeps the quote aligned when an environment explicitly selects v2', () => {
    const q = quoteIpVideo(
      '字'.repeat(100_000),
      'fal-ai/sync-lipsync/v2',
    );
    const estimatedSeconds = Math.max(1, Math.ceil(q.chars / 5));
    expect(q.videoCny).toBe(
      Math.max(
        1,
        Math.ceil(
          (estimatedSeconds * (3 / 60) + (q.chars / 10000) * 0.115) *
            7.3,
        ),
      ),
    );
    expect(q.message).toContain('Sync Lipsync 2.0');
  });

  it('locks the Qwen character-price snapshot independently of currency rounding', () => {
    const q = quoteIpVideo('字'.repeat(100_000));
    const estimatedSeconds = Math.ceil(q.chars / 5);

    expect(q.videoCny).toBe(
      Math.ceil(
        (estimatedSeconds * (8 / 60) + (q.chars / 10_000) * 0.115) * 7.3,
      ),
    );
  });

  it('超长文案 → maybeTooLong + 文案里有 40 秒提示', () => {
    const long = '这是一段很长的口播文案需要超过一百八十个字才能触发提示'.repeat(12);
    const q = quoteIpVideo(long);
    expect(q.chars).toBeGreaterThan(180);
    expect(q.maybeTooLong).toBe(true);
    expect(q.message).toMatch(/40 秒|超过/);
  });
});
