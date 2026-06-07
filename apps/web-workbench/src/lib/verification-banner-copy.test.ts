import { describe, expect, it } from 'vitest';
import {
  shouldShowVerificationBanner,
  verificationBannerCopy,
  verificationCheckLabel,
} from './verification-banner-copy';

describe('verificationCheckLabel', () => {
  it('keeps row-level ecommerce details', () => {
    expect(
      verificationCheckLabel({
        type: 'ecommerce_rows',
        detail: '第 3 行缺少商品链接',
      }),
    ).toBe('第 3 行缺少商品链接');
  });

  it('maps unknown second-opinion details without exposing model names', () => {
    const label = verificationCheckLabel({
      type: 'unknown',
      detail: 'OpenAI 2b second-opinion disagrees: missing citation',
    });

    expect(label).toBe('自动复核认为答案需要人工确认');
    expect(label).not.toMatch(/OpenAI|2b|second-opinion/i);
  });

  it('keeps audit timeout copy explicit', () => {
    expect(
      verificationCheckLabel({
        type: 'unknown',
        detail: 'Verifier timed out after 8000ms',
      }),
    ).toBe('自动审核超时，未阻塞任务结果');
  });

  it('clarifies when required source links were removed or absent', () => {
    expect(
      verificationCheckLabel({
        type: 'url_count',
        detail: 'only 0 URL(s) found (global scan), need at least 1',
      }),
    ).toBe('缺少可验证来源链接');
  });

  it('keeps legacy source-count checks on the same source-link copy path', () => {
    expect(
      verificationCheckLabel({
        type: 'source_count',
        detail: '缺少来源链接',
      }),
    ).toBe('缺少可验证来源链接');
  });
});

describe('shouldShowVerificationBanner', () => {
  it('always shows for partial_success regardless of checks', () => {
    expect(shouldShowVerificationBanner({ status: 'partial_success' })).toBe(true);
    expect(
      shouldShowVerificationBanner({ status: 'partial_success', failedChecks: [] }),
    ).toBe(true);
  });

  it('shows when verification explicitly failed or checks were flagged', () => {
    expect(
      shouldShowVerificationBanner({ status: 'completed', verificationPassed: false }),
    ).toBe(true);
    expect(
      shouldShowVerificationBanner({
        status: 'failed',
        failedChecks: [{ type: 'url_count', detail: '' }],
      }),
    ).toBe(true);
  });

  it('stays hidden for clean terminal results', () => {
    expect(
      shouldShowVerificationBanner({
        status: 'completed',
        verificationPassed: true,
        failedChecks: [],
      }),
    ).toBe(false);
    expect(shouldShowVerificationBanner({ status: 'completed' })).toBe(false);
    expect(shouldShowVerificationBanner({ status: 'cancelled' })).toBe(false);
  });
});

describe('verificationBannerCopy', () => {
  it('uses a warning tone for fixable partial results', () => {
    const copy = verificationBannerCopy({
      level: 'fixable',
      status: 'partial_success',
      failedChecks: [{ type: 'url_count', detail: '' }],
    });

    expect(copy.tone).toBe('warning');
    expect(copy.eyebrow).toBe('自动审核发现可修正问题');
    expect(copy.checks).toEqual(['缺少来源链接']);
  });

  it('explains missing verifiable sources without exposing raw URL counts', () => {
    const copy = verificationBannerCopy({
      level: 'fixable',
      status: 'partial_success',
      failedChecks: [
        {
          type: 'url_count',
          detail: 'only 0 URL(s) found (global scan), need at least 1',
        },
      ],
    });

    expect(copy.checks).toEqual(['缺少可验证来源链接']);
    expect(copy.body).toBe(
      '答案可先参考，但原始来源链接不足或已被移除，避免把未验证链接当作事实来源。建议重新执行或指定可信来源。',
    );
  });

  it('uses the source-link recovery copy for legacy source-count checks', () => {
    const copy = verificationBannerCopy({
      level: 'fixable',
      status: 'partial_success',
      failedChecks: [{ type: 'source_count', detail: '缺少来源链接' }],
    });

    expect(copy.checks).toEqual(['缺少可验证来源链接']);
    expect(copy.body).toBe(
      '答案可先参考，但原始来源链接不足或已被移除，避免把未验证链接当作事实来源。建议重新执行或指定可信来源。',
    );
  });

  it('uses a danger tone for hard failures', () => {
    const copy = verificationBannerCopy({
      level: 'hard_fail',
      status: 'failed',
      failedChecks: [{ type: 'generic.empty_result', detail: '' }],
    });

    expect(copy.tone).toBe('danger');
    expect(copy.title).toBe('这次结果不够可信');
    expect(copy.body).toBe(
      'HOLA DAY 已拦截这次结果。建议重新执行任务，或把范围、来源、字段要求写得更具体。',
    );
  });

  it('dedupes and caps visible checks', () => {
    const copy = verificationBannerCopy({
      level: 'needs_clarification',
      status: 'partial_success',
      failedChecks: [
        { type: 'url_count', detail: '' },
        { type: 'url_count', detail: '' },
        { type: 'result_count', detail: '' },
        { type: 'price_sort', detail: '' },
        { type: 'generic.constraints', detail: '' },
        { type: 'generic.number_cross_check', detail: '' },
      ],
    });

    expect(copy.checks).toHaveLength(4);
    expect(copy.hiddenCount).toBe(1);
  });

  it('explains timeout-only review results as non-blocking', () => {
    const copy = verificationBannerCopy({
      level: 'needs_clarification',
      status: 'partial_success',
      failedChecks: [{ type: 'unknown', detail: 'llm verifier timed out after 15000ms' }],
    });

    expect(copy.checks).toEqual(['自动审核超时，未阻塞任务结果']);
    expect(copy.body).toBe(
      '答案已经生成，但自动审核等待过久。HOLA DAY 没有因此阻塞任务，请按关键数据和来源自行核对。',
    );
  });
});
