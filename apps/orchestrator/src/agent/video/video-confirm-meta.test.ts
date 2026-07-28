import { describe, expect, it, vi } from 'vitest';
import {
  VIDEO_FAILURE_REASONS,
  claimVideoConfirmAfterVerifierPreflight,
  deriveVideoType,
  mapVideoFailureReason,
  videoQualityFailureOutcome,
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
        gateVersion: 'video-final-v3',
        verifiedAt: '2026-07-25T06:00:00.000Z',
        coverage: {
          playableVideo: 'verified',
          sampledFrames: 'verified',
          audibleAudio: 'not_verified',
          audiovisualSync: 'not_applicable',
        },
      },
    });
  });

  it('records the exact verification boundary for lip-synced deliverables', () => {
    expect(
      videoQualityVerificationMetadata(
        new Date('2026-07-25T06:00:00.000Z'),
        {
          audibleAudio: 'verified',
          audiovisualSync: 'not_verified',
        },
      ),
    ).toEqual({
      qualityVerification: {
        status: 'passed',
        gateVersion: 'video-final-v3',
        verifiedAt: '2026-07-25T06:00:00.000Z',
        coverage: {
          playableVideo: 'verified',
          sampledFrames: 'verified',
          audibleAudio: 'verified',
          audiovisualSync: 'not_verified',
        },
      },
    });
  });

  it('stamps rejected deliverables with safe structured checks and an explicit false verdict', () => {
    expect(
      videoQualityFailureOutcome(
        {
          name: 'IpVideoError',
          kind: 'quality',
          failedChecks: [
            'fused_hands',
            'face_drift',
            'https://secret.example/file_123',
            'fused_hands',
          ],
          qualityReason: 'raw verifier text must remain internal',
        },
        new Date('2026-07-27T05:00:00.000Z'),
      ),
    ).toEqual({
      verificationPassed: false,
      failedChecks: [
        { type: 'fused_hands', detail: '成片手部或肢体结构异常' },
        { type: 'face_drift', detail: '人物或主体跨帧不一致' },
      ],
      metadata: {
        qualityVerification: {
          status: 'failed',
          gateVersion: 'video-final-v3',
          verifiedAt: '2026-07-27T05:00:00.000Z',
          failedChecks: ['fused_hands', 'face_drift'],
        },
      },
    });
  });

  it('keeps inconclusive verification distinct from a known failed verdict', () => {
    expect(
      videoQualityFailureOutcome(
        {
          name: 'SimpleVideoError',
          kind: 'quality_unavailable',
          failedChecks: ['verifier_inconclusive'],
        },
        new Date('2026-07-27T05:00:00.000Z'),
      ),
    ).toEqual({
      failedChecks: [
        { type: 'verifier_inconclusive', detail: '自动质检未能得出结论' },
      ],
      metadata: {
        qualityVerification: {
          status: 'unknown',
          gateVersion: 'video-final-v3',
          verifiedAt: '2026-07-27T05:00:00.000Z',
          failedChecks: ['verifier_inconclusive'],
        },
      },
    });
  });

  it('does not manufacture quality metadata for unrelated failures', () => {
    expect(
      videoQualityFailureOutcome({
        name: 'IpVideoError',
        kind: 'config',
        failedChecks: ['fused_hands'],
      }),
    ).toEqual({});
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

  it('Wan account billing failure → actionable model-switch copy without leaking provider detail', () => {
    const out = mapVideoFailureReason({
      name: 'WanxiangError',
      kind: 'http',
      status: 400,
      detail:
        '{"code":"Arrearage","message":"The account is not in good standing due to an overdue payment.","request_id":"secret"}',
    });

    expect(out).toBe(VIDEO_FAILURE_REASONS.providerQuota);
    expect(out).toMatch(/切换其他模型|稍后重试/);
    expect(out).not.toMatch(/Arrearage|account|overdue|payment|request_id|secret/i);
  });

  it('Wan Animate account billing failure → provider-unavailable copy without leaking billing detail', () => {
    const out = mapVideoFailureReason({
      name: 'WanAnimateMixError',
      kind: 'http',
      status: 400,
      code: 'Arrearage',
      message:
        'Access denied, please make sure your account is in good standing due to an overdue payment.',
    });

    expect(out).toBe(VIDEO_FAILURE_REASONS.cloneProviderUnavailable);
    expect(out).not.toMatch(/Arrearage|account|overdue|payment/i);
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

  it('uses the failed check category to give a precise safe retry reason', () => {
    expect(
      mapVideoFailureReason({
        name: 'IpVideoError',
        kind: 'quality',
        failedChecks: ['duration_too_short'],
      }),
    ).toBe(VIDEO_FAILURE_REASONS.qualityDuration);
    expect(
      mapVideoFailureReason({
        name: 'IpVideoError',
        kind: 'quality',
        failedChecks: ['fused_hands'],
      }),
    ).toBe(VIDEO_FAILURE_REASONS.qualityAnatomy);
    expect(
      mapVideoFailureReason({
        name: 'SimpleVideoError',
        kind: 'quality',
        failedChecks: ['required_action_missing'],
      }),
    ).toBe(VIDEO_FAILURE_REASONS.qualityAction);
    expect(
      mapVideoFailureReason({
        name: 'SimpleVideoError',
        kind: 'quality',
        failedChecks: ['subtitle_mismatch'],
      }),
    ).toBe(VIDEO_FAILURE_REASONS.qualityText);
    expect(
      mapVideoFailureReason({
        name: 'IpVideoError',
        kind: 'quality',
        failedChecks: ['output_audio_inaudible'],
      }),
    ).toBe(VIDEO_FAILURE_REASONS.qualityAudio);
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

  it('maps clone compatibility failures without exposing raw analyzer output', () => {
    expect(
      mapVideoFailureReason({
        name: 'SimpleVideoError',
        kind: 'clone_incompatible',
        message: 'raw model reason must not leak',
      }),
    ).toBe(VIDEO_FAILURE_REASONS.cloneIncompatible);
    expect(
      mapVideoFailureReason({
        name: 'SimpleVideoError',
        kind: 'clone_compatibility_unavailable',
        message: 'provider detail must not leak',
      }),
    ).toBe(VIDEO_FAILURE_REASONS.cloneCompatibilityUnavailable);
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
