import { describe, expect, it, vi } from 'vitest';
import {
  buildCloneCompatibilityFrameCommands,
  verifyCloneVideoCompatibility,
} from './video-clone-compatibility.js';
import type { VideoQualityAnalysisInput } from './video-quality-verifier.js';

const SUBJECT = {
  data: Buffer.from('subject').toString('base64'),
  mediaType: 'image/jpeg' as const,
  label: '上传的主角照片',
};

function makeDeps() {
  const runFfmpeg = vi.fn(async () => {});
  const readFile = vi.fn(async () => Buffer.from('frame'));
  const normalizeImage = vi.fn(async (buffer: Buffer) => buffer);
  const createSubjectBodyDetail = vi.fn(async (buffer: Buffer) =>
    Buffer.concat([buffer, Buffer.from('-body-detail')]),
  );
  const analyzeFrames = vi.fn(async (_input: VideoQualityAnalysisInput) =>
    JSON.stringify({
      status: 'pass',
      failedChecks: [],
      reason: '单人主体和参考视频取景相容',
    }),
  );
  return {
    deps: {
      runFfmpeg,
      readFile,
      normalizeImage,
      createSubjectBodyDetail,
      analyzeFrames,
    },
    mocks: {
      runFfmpeg,
      readFile,
      normalizeImage,
      createSubjectBodyDetail,
      analyzeFrames,
    },
  };
}

describe('clone-video compatibility preflight', () => {
  it('samples five points across the reference video', () => {
    const commands = buildCloneCompatibilityFrameCommands({
      referenceVideoPath: '/tmp/reference.mp4',
      referenceVideoDurationMs: 10_000,
      workdir: '/tmp/clone',
      ffmpegBin: '/usr/local/bin/ffmpeg',
    });

    expect(commands.map((item) => item.timestampSeconds)).toEqual([1, 3, 5, 7, 9]);
    expect(commands[0]?.command).toEqual({
      bin: '/usr/local/bin/ffmpeg',
      args: [
        '-y',
        '-ss',
        '1.000',
        '-i',
        '/tmp/reference.mp4',
        '-frames:v',
        '1',
        '-q:v',
        '3',
        '/tmp/clone/clone-compatibility-01.jpg',
      ],
    });
  });

  it('asks for human-to-human and framing compatibility without comparing identity', async () => {
    const { deps, mocks } = makeDeps();
    const result = await verifyCloneVideoCompatibility(
      {
        subjectImage: SUBJECT,
        referenceVideoPath: '/tmp/reference.mp4',
        referenceVideoDurationMs: 10_000,
        workdir: '/tmp/clone',
      },
      deps,
    );

    expect(result.status).toBe('pass');
    expect(mocks.runFfmpeg).toHaveBeenCalledTimes(5);
    expect(mocks.analyzeFrames).toHaveBeenCalledWith(
      expect.objectContaining({
        references: [
          expect.objectContaining({ label: '上传的主角照片' }),
          expect.objectContaining({ label: '主角照片下半区域放大' }),
        ],
        frames: expect.arrayContaining([
          expect.objectContaining({ timestampSeconds: 1 }),
          expect.objectContaining({ timestampSeconds: 9 }),
        ]),
        prompt: expect.stringMatching(/不要比较.*身份/),
      }),
    );
    expect(mocks.analyzeFrames.mock.calls[0]?.[0].prompt).toMatch(/仅支持单人换单人/);
    expect(mocks.analyzeFrames.mock.calls[0]?.[0].prompt).toMatch(/取景兼容性.*单向约束/);
    expect(mocks.analyzeFrames.mock.calls[0]?.[0].prompt).toMatch(
      /参考帧.*手臂.*双手.*主角照片.*完整可见.*framing_mismatch/,
    );
    expect(mocks.analyzeFrames.mock.calls[0]?.[0].prompt).toMatch(
      /姿态.*手势.*不同.*不能单独.*framing_mismatch/,
    );
    expect(mocks.analyzeFrames.mock.calls[0]?.[0].prompt).toMatch(
      /完整可见.*接近画面边缘.*不视为缺失/,
    );
    expect(mocks.analyzeFrames.mock.calls[0]?.[0].prompt).toMatch(
      /只比较.*可见身体范围.*不要要求.*同一姿态/,
    );
    expect(mocks.analyzeFrames.mock.calls[0]?.[0].prompt).toMatch(
      /只在参考帧需要的身体区域.*主角照片.*缺失.*framing_mismatch/,
    );
    expect(mocks.analyzeFrames.mock.calls[0]?.[0].prompt).toMatch(
      /主角照片.*身体范围比参考帧更完整.*不能.*framing_mismatch/,
    );
    expect(mocks.analyzeFrames.mock.calls[0]?.[0].prompt).toMatch(
      /下半区域放大.*同一张主角照片.*核对.*手臂.*双手/,
    );
    expect(mocks.createSubjectBodyDetail).toHaveBeenCalledTimes(1);
  });

  it('retries an inconclusive verdict once and returns the next structured result', async () => {
    const { deps, mocks } = makeDeps();
    mocks.analyzeFrames
      .mockResolvedValueOnce(
        JSON.stringify({
          status: 'unknown',
          failedChecks: ['verifier_inconclusive'],
          reason: '首轮无法判断',
        }),
      )
      .mockResolvedValueOnce(
        JSON.stringify({
          status: 'fail',
          failedChecks: ['framing_mismatch'],
          reason: '照片为近景，参考视频为全身',
        }),
      );

    const result = await verifyCloneVideoCompatibility(
      {
        subjectImage: SUBJECT,
        referenceVideoPath: '/tmp/reference.mp4',
        referenceVideoDurationMs: 10_000,
        workdir: '/tmp/clone',
      },
      deps,
    );

    expect(result).toEqual({
      status: 'fail',
      failedChecks: ['framing_mismatch'],
      reason: '照片为近景，参考视频为全身',
    });
    expect(mocks.analyzeFrames).toHaveBeenCalledTimes(2);
  });

  it('fails closed when reference frames cannot be extracted', async () => {
    const { deps, mocks } = makeDeps();
    mocks.runFfmpeg.mockRejectedValueOnce(new Error('ffmpeg failed'));

    await expect(
      verifyCloneVideoCompatibility(
        {
          subjectImage: SUBJECT,
          referenceVideoPath: '/tmp/reference.mp4',
          referenceVideoDurationMs: 10_000,
          workdir: '/tmp/clone',
        },
        deps,
      ),
    ).resolves.toEqual({
      status: 'unknown',
      failedChecks: ['verifier_inconclusive'],
      reason: '无法抽取参考视频兼容性检查帧',
    });
    expect(mocks.analyzeFrames).not.toHaveBeenCalled();
  });
});
