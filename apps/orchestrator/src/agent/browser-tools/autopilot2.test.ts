import { describe, expect, it } from 'vitest';
import { browserCompletionVerdict } from '../../execution/execution-pipeline.js';
import type { MessagesAdapter } from '../../llm/messages-adapter.js';
import { detectBrowserBlocker } from './browser-completion.js';
import { assessCompletionFacts } from './completion-fields.js';
import { runUnifiedBrowserLoop } from './unified-browser-loop.js';

/** BROWSER-AUTOPILOT-2: the four issues left open by BROWSER-AUTOPILOT-1. */
const failedCheck = (criterionId: string, criterionType: string, detail: string) => ({
  criterionId,
  criterionType,
  passed: false,
  checker: 'deterministic' as const,
  detail,
});
describe('1. post-hoc success criteria only annotate a completed browser answer', () => {
  const verification = (checks: ReturnType<typeof failedCheck>[]) =>
    ({
      taskId: 't',
      passed: false,
      tier: 'deterministic',
      checks,
      failureLevel: 'needs_clarification',
    }) as never;
  it('keeps the answer completed with a note when only url_count failed (core-07-fa)', () => {
    const verdict = browserCompletionVerdict({
      runnerStatus: 'completed',
      verification: verification([
        failedCheck(
          'c1',
          'url_count',
          'only 0 URL(s) found (global scan fallback), need at least 1',
        ),
      ]),
      verifiedText: '未能给出可验证的结果，本次不会把未通过校验的内容作为结论。\n\n原因：…',
      originalText: '已打开 3 个标签：A、B、C，并切回原标签。',
    });
    expect(verdict.status).toBe('completed');
    expect(verdict.text).toContain('已打开 3 个标签：A、B、C');
    expect(verdict.text).toContain('核验提示：only 0 URL(s) found');
    expect(verdict.text).not.toContain('未能给出可验证的结果');
  });
  it('still fails a completed answer that violated a constraint the user stated', () => {
    expect(
      browserCompletionVerdict({
        runnerStatus: 'completed',
        verification: verification([
          failedCheck('generic.constraints', '', 'no_form_submit violated'),
        ]),
        verifiedText: 'x',
        originalText: 'x',
      }).status,
    ).toBe('failed');
  });
  it('turns a non-blocking source-trust review into a note', () => {
    const verdict = browserCompletionVerdict({
      runnerStatus: 'completed',
      verification: null,
      sourceTrust: {
        requiresReview: true,
        blocking: true,
        failedChecks: [{ type: 'source_count', detail: '缺少可点击来源' }],
      },
      verifiedText: '答案',
      originalText: '答案',
    });
    expect(verdict).toMatchObject({
      status: 'completed',
      text: '答案\n\n核验提示：缺少可点击来源',
    });
  });
  it('leaves non-completed outcomes to the shared derivation', () => {
    expect(
      browserCompletionVerdict({
        runnerStatus: 'failed',
        verification: null,
        verifiedText: 'r',
        originalText: 'r',
      }).status,
    ).toBe('failed');
  });
});

describe('2. a cloud-observation switch_tab result counts as a read (core-07-fb)', () => {
  it('grounds tab titles seen through switch_tab', async () => {
    const tabs: Record<string, string> = { a: 'Alpha title', b: 'Beta title' };
    let turn = 0;
    const script = [
      { name: 'switch_tab', input: { targetTabId: 'a' } },
      { name: 'switch_tab', input: { targetTabId: 'b' } },
      {
        name: 'finish',
        input: {
          status: 'completed',
          summary: '两个标签的标题',
          fields: [
            { name: 'tab1_title', value: 'Alpha title', tabId: 'a' },
            { name: 'tab2_title', value: 'Beta title', tabId: 'b' },
          ],
        },
      },
    ];
    const adapter: MessagesAdapter = {
      metadata: { provider: 'anthropic', model: 'fixture' },
      async create() {
        const call = script[turn++]!;
        return {
          id: String(turn),
          metadata: { provider: 'anthropic', model: 'fixture' },
          content: [{ type: 'tool_use', id: String(turn), ...call }],
          stopReason: 'tool_use',
          usage: {
            inputTokens: 1,
            outputTokens: 1,
            cacheReadInputTokens: null,
            cacheCreationInputTokens: null,
            complete: true,
          },
        };
      },
    };
    const result = await runUnifiedBrowserLoop({
      intent: '读两个标签的标题',
      adapter,
      observationV2: true,
      maxSteps: 4,
      supportedTools: { download: false, upload: false, tabs: true },
      execute: async (action) =>
        action.tool === 'switch_tab'
          ? {
              ok: true,
              text: JSON.stringify({
                tabId: action.targetTabId,
                tree: `heading "${tabs[action.targetTabId]}" [level=1]`,
              }),
            }
          : { ok: true, text: 'x' },
    });
    expect(result).toMatchObject({ status: 'completed' });
  });
});

describe('3. short numeric quotes are not page-text claims (core-06-fa)', () => {
  it('does not reject “0/1”, still checks a quoted English phrase', () => {
    const pages = [{ text: '图灵：符号0和1' }];
    expect(assessCompletionFacts({ summary: '用“0/1”两个符号', pages }).contradictions).toEqual([]);
    expect(
      assessCompletionFacts({ summary: '页面显示 "You clicked: Ok"', pages }).contradictions,
    ).toHaveLength(1);
  });
});

describe('4. 未核实 noise', () => {
  const pages = [
    {
      text: 'generic "16年前"\nlink "Rick Astley"\n455万位订阅者\nsmall-file.txt',
    },
  ];
  it('drops an unclosed explanatory bracket left by the field cut', () => {
    expect(
      assessCompletionFacts({
        summary: '发布日期：16年前（YouTube 在详情页以相对时间展示；未直接给出绝对日期）',
        pages,
      }),
    ).toEqual({ contradictions: [], unverified: [] });
  });
  it('checks only the numeric pieces of a bracket note', () => {
    expect(
      assessCompletionFacts({
        summary: '频道：Rick Astley（音乐人官方频道，455万位订阅者）',
        pages,
      }),
    ).toEqual({ contradictions: [], unverified: [] });
  });
  it('does not read an enumeration header as a label value', () => {
    expect(
      assessCompletionFacts({
        summary: '成功获取到文件名与大小：文件名为 small-file.txt，大小为 1024 字节',
        pages,
        receipts: 'small-file.txt | 1024 bytes/字节',
      }).unverified,
    ).toEqual([]);
  });
});
describe('5. a headline mentioning cloudflare is not a captcha wall', () => {
  const page = (title: string, text: string) =>
    detectBrowserBlocker({
      url: 'https://example.com/',
      title,
      text,
      visible: true,
      blocking: true,
      scope: 'document',
      readableContent: false,
    });
  it('keeps a Hacker News front page readable', () => {
    const text = Array.from(
      { length: 30 },
      (_, i) => `${i + 1}. Story ${i + 1} (example${i}.com) 120 points`,
    )
      .concat('17. Yandex outage: malicious bots moved (cloudflare.com)')
      .join('\n');
    expect(page('Hacker News', text)).toBeNull();
  });
  it('still pauses on a real Cloudflare challenge', () => {
    expect(
      page(
        'news.example.com',
        'Checking your browser before accessing. Performance & security by Cloudflare',
      )?.reason,
    ).toBeTruthy();
    expect(page('Attention Required! | Cloudflare', 'Ray ID: 1234')?.reason).toBeTruthy();
  });
});
