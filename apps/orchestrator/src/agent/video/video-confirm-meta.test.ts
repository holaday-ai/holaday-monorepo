import { describe, expect, it, vi } from 'vitest';
import {
  VIDEO_FAILURE_REASONS,
  claimVideoConfirmAfterVerifierPreflight,
  deriveVideoType,
  mapVideoFailureReason,
  videoQualityVerificationMetadata,
  videoVerifierPreflightIssue,
} from './video-confirm-meta.js';

describe('deriveVideoType', () => {
  it('tab wins: normal/pet/ip_person', () => {
    expect(deriveVideoType({ isPet: false, isIp: false, tab: 'normal' })).toBe('normal');
    expect(deriveVideoType({ isPet: false, isIp: false, tab: 'pet' })).toBe('pet');
    expect(deriveVideoType({ isPet: false, isIp: false, tab: 'ip_person' })).toBe('ip_person');
  });
  it('falls back to isPet / isIp flags when tab absent', () => {
    expect(deriveVideoType({ isPet: true, isIp: false })).toBe('pet');
    expect(deriveVideoType({ isPet: false, isIp: true })).toBe('ip_person');
  });
  it('defaults to normal', () => {
    expect(deriveVideoType({ isPet: false, isIp: false })).toBe('normal');
  });
});

describe('videoVerifierPreflightIssue', () => {
  it('blocks paid video generation when no quality verifier client exists', () => {
    expect(videoVerifierPreflightIssue({ choice: 'video', hasVerifier: false })).toMatch(
      /尚未开始制作/,
    );
  });

  it('blocks image-based video fallback too, and allows either path with a verifier', () => {
    expect(videoVerifierPreflightIssue({ choice: 'image', hasVerifier: false })).toMatch(
      /尚未开始制作/,
    );
    expect(videoVerifierPreflightIssue({ choice: 'video', hasVerifier: true })).toBeNull();
    expect(videoVerifierPreflightIssue({ choice: 'image', hasVerifier: true })).toBeNull();
  });

  it('does not consume the quote when the verifier is unavailable', async () => {
    const consume = vi.fn(async () => true);
    const result = await claimVideoConfirmAfterVerifierPreflight(
      { choice: 'video', hasVerifier: false },
      consume,
    );

    expect(result).toMatchObject({ claimed: false, issue: expect.stringMatching(/尚未开始制作/) });
    expect(consume).not.toHaveBeenCalled();
  });
});

describe('videoQualityVerificationMetadata', () => {
  it('stamps completed deliverables with an auditable quality-gate result', () => {
    expect(
      videoQualityVerificationMetadata(new Date('2026-07-25T06:00:00.000Z')),
    ).toEqual({
      qualityVerification: {
        status: 'passed',
        gateVersion: 'video-final-v2',
        verifiedAt: '2026-07-25T06:00:00.000Z',
      },
    });
  });
});

const ALL = Object.values(VIDEO_FAILURE_REASONS);
const isWhitelisted = (s: string) => ALL.includes(s as (typeof ALL)[number]);

describe('mapVideoFailureReason — safe, whitelisted, no leak', () => {
  it('fal exhausted_balance → 服务繁忙', () => {
    expect(mapVideoFailureReason({ name: 'FalLipSyncError', kind: 'exhausted_balance' })).toBe(
      VIDEO_FAILURE_REASONS.busy,
    );
  });

  it('fal 422 face_detection → 检测不到清晰人脸', () => {
    const err = {
      name: 'FalLipSyncError',
      kind: 'http',
      status: 422,
      detail:
        '{"detail":[{"type":"face_detection_error","input":"https://r2/usr_X/file_Y/secret"}]}',
    };
    expect(mapVideoFailureReason(err)).toBe(VIDEO_FAILURE_REASONS.face);
  });

  it('fal timeout/network/job_failed → 服务繁忙', () => {
    for (const kind of ['timeout', 'network', 'job_failed']) {
      expect(mapVideoFailureReason({ name: 'FalLipSyncError', kind })).toBe(
        VIDEO_FAILURE_REASONS.busy,
      );
    }
  });

  it('IpVideoError too_long → 文案过长; config → IP 素材缺失', () => {
    expect(mapVideoFailureReason({ name: 'IpVideoError', kind: 'too_long' })).toBe(
      VIDEO_FAILURE_REASONS.tooLong,
    );
    expect(mapVideoFailureReason({ name: 'IpVideoError', kind: 'config' })).toBe(
      VIDEO_FAILURE_REASONS.ipAssets,
    );
  });

  it('provider capability mismatches → actionable parameter copy', () => {
    expect(mapVideoFailureReason({ name: 'SimpleVideoError', kind: 'invalid_options' })).toBe(
      VIDEO_FAILURE_REASONS.invalidOptions,
    );
    expect(mapVideoFailureReason({ name: 'VeoError', kind: 'invalid_argument' })).toBe(
      VIDEO_FAILURE_REASONS.invalidOptions,
    );
  });

  it('hard provider quota exhaustion → actionable model-switch copy without leaking billing detail', () => {
    const out = mapVideoFailureReason({
      name: 'VeoError',
      kind: 'quota_exhausted',
      status: 429,
      detail:
        'You exceeded your current quota. https://ai.dev/rate-limit account-plan-secret',
    });

    expect(out).toBe(VIDEO_FAILURE_REASONS.providerQuota);
    expect(out).toMatch(/切换其他模型|稍后重试/);
    expect(out).not.toMatch(/account|plan|billing|https?:/i);
  });

  it('automated anatomy failure → explicit quality rejection without internal detail', () => {
    expect(
      mapVideoFailureReason({
        name: 'SimpleVideoError',
        kind: 'quality',
        message: 'fused_hands frame 3 raw provider detail',
      }),
    ).toBe(VIDEO_FAILURE_REASONS.quality);
    expect(
      mapVideoFailureReason({
        name: 'IpVideoError',
        kind: 'quality',
        message: 'raw verifier details',
      }),
    ).toBe(VIDEO_FAILURE_REASONS.quality);
  });

  it('inconclusive verifier → honest unavailable copy without claiming a detected defect', () => {
    expect(
      mapVideoFailureReason({
        name: 'SimpleVideoError',
        kind: 'quality_unavailable',
        message: 'raw verifier timeout',
      }),
    ).toBe(VIDEO_FAILURE_REASONS.qualityUnavailable);
    expect(
      mapVideoFailureReason({
        name: 'IpVideoError',
        kind: 'quality_unavailable',
        message: 'raw verifier malformed response',
      }),
    ).toBe(VIDEO_FAILURE_REASONS.qualityUnavailable);
  });

  it('SimpleVideoError / unknown / null / string → generic', () => {
    expect(mapVideoFailureReason({ name: 'SimpleVideoError', kind: 'compose' })).toBe(
      VIDEO_FAILURE_REASONS.generic,
    );
    expect(mapVideoFailureReason(new Error('raw internal boom'))).toBe(
      VIDEO_FAILURE_REASONS.generic,
    );
    expect(mapVideoFailureReason(null)).toBe(VIDEO_FAILURE_REASONS.generic);
    expect(mapVideoFailureReason('some string')).toBe(VIDEO_FAILURE_REASONS.generic);
  });

  it('★ NEVER leaks internal detail (url / file id / stack / message)', () => {
    const sensitive = {
      name: 'FalLipSyncError',
      kind: 'http',
      status: 422,
      message: 'fal result returned 422',
      detail:
        'https://holaday-files-prod.r2.cloudflarestorage.com/usr_EeYp/input/file_LMywvC9UKjLThWSDqu4Hw',
      stack: 'FalLipSyncError: ...\n at fal-lipsync-client.ts:130',
    };
    const out = mapVideoFailureReason(sensitive);
    expect(isWhitelisted(out)).toBe(true);
    for (const leak of [
      'http',
      'r2',
      'file_',
      'usr_',
      'fal-lipsync-client',
      '422',
      'cloudflarestorage',
    ]) {
      expect(out).not.toContain(leak);
    }
  });
});
