import { describe, expect, it } from 'vitest';
import { buildRecoveryActions, buildTrustSummary } from './trust-summary';

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
    expect(summary.boundary).toContain('不把推断包装成事实');
    expect(summary.boundary).toContain('ledger');
    expect(summary.rows.find((r) => r.label === '事实级证据')?.value).toBe('见 ledger');
    expect(summary.rows.find((r) => r.label === '答案可见来源')?.detail).toContain(
      '不代表每条结论都已逐条验证',
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
    expect(summary.rows.find((r) => r.label === '答案可见来源')?.value).toBe('0 个链接');
    expect(summary.ledger.find((item) => item.label === '自动审核')?.value).toBe('发现问题');
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

    expect(actions.some((a) => a.kind === 'retry')).toBe(true);
    expect(actions.find((a) => a.label === '拆成小步骤')?.prompt).toContain('请先只完成第一步');
  });
});
