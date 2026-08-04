import { describe, expect, it } from 'vitest';
import {
  buildRecoveryActions,
  buildTrustSummary,
  shouldShowTrustSummary,
} from './trust-summary';

describe('trust summary', () => {
  it('uses a compact warning for completed research results without clickable sources', () => {
    const summary = buildTrustSummary({
      status: 'completed',
      intent: '研究主流 SaaS 定价模式',
      resultText: '按席位、按量和按功能定价各有优劣。',
      currentUrl: null,
    });

    expect(summary.presentation).toBe('compact');
    expect(summary.tone).toBe('warning');
    expect(summary.title).toBe('结果需复核');
    expect(summary.verdict).toBe('缺少可核验来源');
    expect(summary.boundary).toContain('关键事实未验证');
    expect(summary.rows).toEqual([]);
    expect(summary.checks).toEqual([]);
    expect(summary.ledger).toEqual([]);
  });

  it('states evidence boundaries without implying fact-level certainty', () => {
    const summary = buildTrustSummary({
      status: 'completed',
      intent: '研究行业报告',
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

    expect(summary.presentation).toBe('full');
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

  it('does not count a server-confirmed unavailable file as downloadable evidence', () => {
    const summary = buildTrustSummary({
      status: 'completed',
      resultText: '任务已完成，但产物存储已失效。',
      attachments: [
        {
          fileId: 'file_missing',
          downloadUrl: '/api/files/file_missing/download',
          filename: 'result.pdf',
          mimetype: 'application/pdf',
          sizeBytes: 1200,
          expiresAt: '2026-07-24T00:00:00Z',
          availability: 'unavailable',
          kind: 'pdf',
        },
      ],
    });

    expect(summary.rows.find((row) => row.label === '产物文件')).toBeUndefined();
    expect(
      summary.ledger.find((item) => item.label === '产物文件'),
    ).toBeUndefined();
  });

  it('does not frame awaiting-user states as result review', () => {
    const summary = buildTrustSummary({
      status: 'awaiting_user',
      resultText: '',
      currentUrl: null,
      finalScreenshot: null,
      attachments: [],
    });

    expect(summary.tone).toBe('warning');
    expect(summary.title).toBe('等待你处理');
    expect(summary.verdict).toContain('任务正在等待你的操作');
    expect(summary.boundary).toContain('还没有进入结果复核');
    expect(summary.rows).toEqual([]);
    expect(summary.ledger.find((item) => item.label === '当前状态')?.value).toBe(
      '等待用户',
    );
  });
});

describe('shouldShowTrustSummary', () => {
  it('shows completed research results when no clickable source was returned', () => {
    expect(
      shouldShowTrustSummary({
        status: 'completed',
        intent: '检索 2026 年 AI 行业趋势',
        resultText: '行业仍在快速增长。',
      }),
    ).toBe(true);
  });

  it('does not warn on completed non-research prose without sources', () => {
    expect(
      shouldShowTrustSummary({
        status: 'completed',
        intent: '把这句话翻译成英文',
        resultText: 'The weather is nice today.',
      }),
    ).toBe(false);
  });

  it('does not apply the generic research warning to stock tasks', () => {
    expect(
      shouldShowTrustSummary({
        status: 'completed',
        intent: '查今天特斯拉股价并给出来源',
        resultText: '特斯拉当前股价为 123.45 美元。',
      }),
    ).toBe(false);
  });

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
  it('offers source-focused recovery for completed research with no links', () => {
    const actions = buildRecoveryActions({
      status: 'completed',
      intent: '研究主流 SaaS 定价模式',
      resultText: '按席位、按量和按功能定价各有优劣。',
    });

    expect(actions.find((action) => action.label === '带已完成信息重试')?.prompt).toContain(
      '按席位、按量和按功能定价',
    );
    expect(actions.find((action) => action.label === '指定可信来源')?.prompt).toContain(
      '请只使用以下可信来源',
    );
  });

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
      resultText: '已查到 TSLA 最新价，但答案缺少可点击来源链接。',
      failureLevel: 'fixable',
      failedChecks: [{ type: 'url_count', detail: 'only 0 URL' }],
    });

    const retryWithContext = actions.find((a) => a.label === '带已完成信息重试');
    expect(retryWithContext).toMatchObject({ kind: 'prefill' });
    expect(retryWithContext?.prompt).toContain('查今天特斯拉股价并给来源');
    expect(retryWithContext?.prompt).toContain('已查到 TSLA 最新价');
    expect(actions.some((a) => a.kind === 'retry' && a.label === '重新执行')).toBe(false);
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
