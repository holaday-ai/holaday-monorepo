import { describe, expect, it, vi } from 'vitest';
import {
  type AnthropicCompatibleClient,
  createAnthropicCompatibleMessagesAdapter,
} from '../llm/messages-adapter.js';
import { effectPauseQuestion, refName } from './browser-tools/effect-pause-copy.js';
import {
  cleanElementName,
  hasReasoningTag,
  hasSnapshotSyntax,
  stripReasoning,
  stripSnapshotSyntax,
} from './internal-refs.js';
import { sanitizeFinalText } from './text-sanitizer.js';

/**
 * FIX-61B (DEPLOY-61 online acceptance, rolled back): what the user reads never carries the
 * browser's snapshot syntax (P0-1, new-bestbuy) or the model's reasoning (P0-2, as-shan).
 */
describe('FIX-61B P0-1: snapshot syntax never reaches the user', () => {
  const LIVE = '- generic [ref=e6]:';

  it('the Best Buy pause (a nameless control) names no snapshot line', () => {
    const copy = effectPauseQuestion({
      english: false,
      site: 'Best Buy',
      action: { tool: 'type', label: LIVE },
      readOnly: true,
      background: false,
    });
    expect(copy).toBe(
      '我在Best Buy在一个输入框里输入了内容，页面像是提交了一个请求，我先停下了。你看一下右侧画面有没有生成预约或订单；没有的话回复「继续」，我接着只读查看。',
    );
    expect(hasSnapshotSyntax(copy)).toBe(false);
  });

  it.each([
    LIVE,
    'generic',
    'button',
    'e12',
    '- button "OK" [ref=e7] [cursor=pointer]:',
    '[ref=e9]',
  ])('「%s」 is no control name', (raw) => {
    expect(cleanElementName(raw)).toBeNull();
    for (const tool of ['click', 'type'] as const)
      for (const english of [false, true]) {
        const copy = effectPauseQuestion({
          english,
          site: 'Best Buy',
          action: { tool, label: raw },
          readOnly: true,
          background: true,
        });
        expect(hasSnapshotSyntax(copy)).toBe(false);
        expect(copy).not.toMatch(/\bgeneric\b|\be\d{1,6}\b/);
      }
  });

  it('a nameless control in the snapshot gets no name (its own line, its child line)', () => {
    const snapshot = [
      '- main [ref=e1]:',
      '  - generic [ref=e5]:',
      '    - generic [ref=e6]:',
      '  - textbox [ref=e8]: - generic [ref=e9]:',
      '  - button "加入购物车" [ref=e10]',
    ].join('\n');
    expect(refName(snapshot, 'e5')).toBeNull();
    expect(refName(snapshot, 'e8')).toBeNull();
    expect(refName(snapshot, 'e10')).toBe('加入购物车');
  });

  it('复审 #1: Markdown lists that look like roles are ordinary text', () => {
    for (const text of [
      '推荐资源：\n- Document [PDF](https://a.com/x.pdf)\n- Video [YouTube](https://y.com)',
      '- Link [GitHub](https://github.com/x)',
      '- Status [Open]',
    ]) {
      expect(hasSnapshotSyntax(text)).toBe(false);
      expect(sanitizeFinalText(text)).toContain(text.split('\n').at(-1)!.slice(2, 10));
    }
    expect(cleanElementName('Search')).toBe('Search');
    expect(cleanElementName('Menu')).toBe('Menu');
  });

  it('real names, URLs and ordinary prose are left alone', () => {
    expect(cleanElementName('Search products')).toBe('Search products');
    expect(cleanElementName('搜索框')).toBe('搜索框');
    for (const text of [
      '打开 https://example.com/?ref=e12 看看',
      '- 第一条：价格 S$8.87',
      '这个 button 的颜色很好看',
      '列表：\n- 苹果\n- 香蕉',
    ]) {
      expect(hasSnapshotSyntax(text)).toBe(false);
      expect(stripSnapshotSyntax(text)).toBe(text);
    }
  });

  it('the final sanitizer takes snapshot syntax out of an answer', () => {
    const out = sanitizeFinalText('我在「- generic [ref=e6]:」里输入了内容。结果：S$8.87');
    expect(hasSnapshotSyntax(out)).toBe(false);
    expect(out).toContain('S$8.87');
  });
});

describe('FIX-61B P0-2: a model reasoning never reaches the user', () => {
  // The as-shan answer seen online (8912141e, qwen3.7-plus, generate channel).
  const AS_SHAN =
    '用户问的是"中国最高的山是哪座"，这是一个常识性问题，不需要打开浏览器搜索。\n\n中国最高的山是珠穆朗玛峰（Mount Everest），海拔8848.86米。\n\n直接回答即可。\n</think>\n\n中国最高的山是**珠穆朗玛峰**（Mount Everest），海拔 **8848.86 米**（2020 年中尼联合测量数据），位于中国西藏与尼泊尔交界处，也是世界最高峰。';

  it('a lone </think> takes the reasoning before it away', () => {
    const out = stripReasoning(AS_SHAN);
    expect(out.startsWith('中国最高的山是**珠穆朗玛峰**')).toBe(true);
    expect(out).not.toContain('用户问的是');
    expect(hasReasoningTag(out)).toBe(false);
  });

  it('复审 #1: code answers that mention the tags keep every line', () => {
    const js =
      "用下面的代码去掉推理标签：\n```js\nconst out = text.split('</think>').pop();\n```\n这样即可。";
    const py =
      "Example:\n```python\ns = s.replace('<think>', '').replace('</think>', '')\n```\nDone.";
    const inline = '用 `</think>` 作分隔符即可。';
    expect(stripReasoning(js)).toBe(js);
    expect(stripReasoning(py)).toBe(py);
    expect(stripReasoning(inline)).toBe(inline);
  });

  it('复审 #1: a reasoning cut off before it closed leaves nothing', () => {
    expect(stripReasoning('<think>用户想要…（被截断）')).toBe('');
  });

  it('a whole <think>…</think> block goes; text without tags is unchanged', () => {
    expect(stripReasoning('<think>先想一想</think>答案是 42。')).toBe('答案是 42。');
    expect(stripReasoning('答案是 42。')).toBe('答案是 42。');
  });

  it('the final sanitizer strips it too', () => {
    const out = sanitizeFinalText(AS_SHAN);
    expect(out).not.toContain('用户问的是');
    expect(hasReasoningTag(out)).toBe(false);
    expect(out).toContain('8848.86');
  });

  it('the model adapter drops inline reasoning from a text block, for every channel', async () => {
    const client: AnthropicCompatibleClient = {
      messages: {
        create: vi.fn().mockResolvedValue({
          id: 'msg_1',
          content: [
            { type: 'thinking', thinking: '(a proper thinking block)' },
            { type: 'text', text: AS_SHAN },
          ],
          stop_reason: 'end_turn',
          usage: { input_tokens: 10, output_tokens: 20 },
        }),
      },
    };
    const adapter = createAnthropicCompatibleMessagesAdapter({
      client,
      metadata: {
        provider: 'alibaba-model-studio',
        model: 'qwen3.7-plus',
        region: 'cn',
        deploymentScope: 'mainland',
        endpointKind: 'public',
        protocol: 'messages',
      } as never,
    });
    const response = await adapter.create({
      maxTokens: 512,
      messages: [{ role: 'user', content: '中国最高的山是哪座' }],
    });
    const text = response.content
      .filter((b) => b.type === 'text')
      .map((b) => (b as { text: string }).text)
      .join('');
    expect(text).not.toContain('用户问的是');
    expect(hasReasoningTag(text)).toBe(false);
    expect(text).toContain('8848.86');
  });
});
