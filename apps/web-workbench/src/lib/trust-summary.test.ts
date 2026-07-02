import { describe, expect, it } from 'vitest';
import {
  buildRecoveryActions,
  buildTrustSummary,
  shouldShowTrustSummary,
} from './trust-summary';

describe('trust summary', () => {
  it('states evidence boundaries without implying fact-level certainty', () => {
    const summary = buildTrustSummary({
      status: 'completed',
      resultText: '来源：https://example.com/report',
      currentUrl: 'https://example.com/report',
      finalScreenshot: 'base64',
      attachments: [
        {
          fileId: 'file_1',
          downloadUrl: '/api/files/file_1/download',
          filename: 'result.pdf',
          mimetype: 'application/pdf',
          sizeBytes: 1200,
          expiresAt: '2026-06-29T00:00:00Z',
          kind: 'pdf',
        },
      ],
      verificationPassed: true,
    });

    expect(summary.tone).toBe('neutral');
    expect(summary.verdict).toContain('仍需按来源复核关键事实');
    expect(summary.boundary).toContain('不会被当作已验证事实');
    expect(summary.rows.find((r) => r.label === '事实级证据')).toBeUndefined();
    expect(summary.rows.find((r) => r.label === '来源链接')?.detail).toContain(
      '关键事实仍建议点开核对',
    );
    expect(summary.ledger.map((item) => item.stage)).toEqual([
      'observed',
      'extracted',
      'extracted',
      'inferred',
      'boundary',
    ]);
    expect(summary.ledger.find((item) => item.stage === 'boundary')?.detail).toContain(
      '判断、建议和归因',
    );
  });

  it('surfaces failed checks as warning instead of a confidence score', () => {
    const summary = buildTrustSummary({
      status: 'partial_success',
      resultText: '这里没有链接',
      verificationPassed: false,
      failedChecks: [{ type: 'url_count', detail: 'only 0 URL' }],
    });

    expect(summary.tone).toBe('warning');
    expect(summary.verdict).toContain('自动审核发现不完整');
    expect(summary.checks).toEqual(['缺少可验证来源链接']);
    expect(summary.title).toBe('复核提示');
    expect(summary.rows).toEqual([]);
    expect(summary.ledger.find((item) => item.label === '自动审核')?.value).toBe('发现问题');
  });

  it('does not present empty evidence counters as a review card for cancelled tasks', () => {
    const summary = buildTrustSummary({
      status: 'cancelled',
      resultText: '',
      currentUrl: null,
      finalScreenshot: null,
      attachments: [],
    });

    expect(summary.title).toBe('任务状态');
    expect(summary.boundary).toContain('不会把空指标包装成证据');
    expect(summary.rows).toEqual([]);
    expect(summary.ledger.find((item) => item.label === '页面状态')?.value).toBe(
      '未形成终态证据',
    );
  });

  it('only puts collected evidence in the top evidence rows', () => {
    const summary = buildTrustSummary({
      status: 'failed',
      resultText: '已生成中间说明，但没有链接',
      currentUrl: null,
      finalScreenshot: 'base64',
      attachments: [],
      failedChecks: [{ type: 'source_count', detail: '缺少来源链接' }],
    });

    expect(summary.title).toBe('结果复核');
    expect(summary.rows.map((row) => row.label)).toEqual(['页面截图']);
    expect(summary.rows.map((row) => row.value)).not.toContain('0 个链接');
    expect(summary.rows.map((row) => row.value)).not.toContain('未记录');
    expect(summary.ledger.find((item) => item.label === '来源链接')?.value).toBe(
      '0 个',
    );
  });
});

describe('shouldShowTrustSummary', () => {
  it('hides cancelled empty evidence states to avoid fake review counters', () => {
    expect(
      shouldShowTrustSummary({
        status: 'cancelled',
        resultText: '',
        currentUrl: null,
        finalScreenshot: null,
        attachments: [],
      }),
    ).toBe(false);
  });

  it('keeps warning summaries visible when verification flags a result without evidence', () => {
    expect(
      shouldShowTrustSummary({
        status: 'partial_success',
        resultText: '没有来源',
        verificationPassed: false,
        failedChecks: [{ type: 'url_count', detail: 'only 0 URL' }],
      }),
    ).toBe(true);
  });

  it('shows cancelled tasks when they left real evidence behind', () => {
    expect(
      shouldShowTrustSummary({
        status: 'cancelled',
        finalScreenshot: 'base64',
      }),
    ).toBe(true);
  });
});

describe('recovery actions', () => {
  it('offers login continuation while awaiting user', () => {
    const actions = buildRecoveryActions({
      status: 'awaiting_user',
      awaitingKind: 'login',
      intent: '打开后台导出报表',
    });

    expect(actions[0]).toMatchObject({
      kind: 'prefill',
      label: '登录完成后继续',
      prompt: '我已完成登录，请继续。',
    });
  });

  it('turns source failures into a source-scoped retry prompt', () => {
    const actions = buildRecoveryActions({
      status: 'partial_success',
      intent: '查今天特斯拉股价并给来源',
      failureLevel: 'fixable',
      failedChecks: [{ type: 'url_count', detail: 'only 0 URL' }],
    });

    expect(actions.some((a) => a.kind === 'retry' && a.label === '重新执行')).toBe(true);
    const sourceAction = actions.find((a) => a.label === '指定可信来源');
    expect(sourceAction?.prompt).toContain('请只使用以下可信来源');
    expect(sourceAction?.prompt).toContain('查今天特斯拉股价');
  });

  it('suggests splitting hard failures into smaller steps', () => {
    const actions = buildRecoveryActions({
      status: 'failed',
      intent: '对比三家平台价格并总结',
      failureLevel: 'hard_fail',
    });

    expect(actions.some((a) => a.kind === 'retry')).toBe(false);
    expect(actions.find((a) => a.label === '拆成小步骤')?.prompt).toContain('请先只完成第一步');
  });
});
