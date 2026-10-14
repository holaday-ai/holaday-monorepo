import { describe, expect, it } from 'vitest';
import type { MessagesAdapter, NeutralMessagesRequest } from '../../llm/messages-adapter.js';
import { completionGap } from './browser-completion.js';
import { completionFieldGaps } from './completion-fields.js';
import { runUnifiedBrowserLoop } from './unified-browser-loop.js';

function brain(turns: Array<{ name: string; input: unknown }>) {
  const requests: NeutralMessagesRequest[] = [];
  const adapter: MessagesAdapter = {
    metadata: { provider: 'anthropic', model: 'fixture' },
    async create(request) {
      requests.push(request);
      const call = turns[requests.length - 1];
      if (!call) throw Error('fixture exhausted');
      return {
        id: String(requests.length),
        metadata: this.metadata,
        content: [{ type: 'tool_use', id: String(requests.length), ...call }],
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
  return { adapter, requests };
}
const finish = (summary: string, evidence: string, fields?: unknown[]) => ({
  name: 'finish',
  input: { status: 'completed', summary, evidence, ...(fields ? { fields } : {}) },
});
const read = { name: 'read_page', input: {} };
const actual =
  'heading "Rick Astley - Never Gonna Give You Up"\nrecommendations\nlink "Rick Astley"\nmore text\ngeneric "18亿次观看"\ngeneric "16年前"';

describe('BROWSER-FIX-4 field evidence', () => {
  it('matches a read tab source URL containing balanced path parentheses', () => {
    const url = 'https://en.wikipedia.org/wiki/Science_(journal)';
    expect(
      completionFieldGaps(
        `1. Science (journal) — ${url}`,
        'Science (journal)',
        undefined,
        [{ text: 'heading "Science (journal)"', sourceURL: url }],
        '从页面打开链接到新标签并读标题',
      ),
    ).toBeNull();
  });
  it('does not certify a title after a new link tab fails to load', async () => {
    const { adapter } = brain([
      { name: 'click', input: { ref: 'e1', newTab: true } },
      read,
      finish('标题：Network error', 'Network error'),
    ]);
    const result = await runUnifiedBrowserLoop({
      adapter,
      intent: '从页面打开链接到新标签并读取标题',
      observationV2: true,
      maxSteps: 3,
      execute: async (action) =>
        action.tool === 'click'
          ? {
              ok: false,
              text: 'load timeout',
              openedTab: true,
              tabId: 'bad',
              url: 'https://example.com/unavailable',
            }
          : {
              ok: true,
              text: JSON.stringify({
                tabId: 'bad',
                sourceURL: 'https://example.com/unavailable',
                tree: 'Network error',
              }),
            },
    });
    expect(result.status).toBe('failed');
  });
  it('accepts the requested channel on a video metadata page', () => {
    expect(
      completionFieldGaps(
        '频道：Rick Astley',
        'Rick Astley',
        undefined,
        [
          {
            text: actual,
            sourceURL: 'https://youtube.com/watch?v=test',
            links: [
              { text: 'Rick Astley', url: 'https://youtube.com/@RickAstley', kind: 'channel' },
            ],
          },
        ],
        'YouTube 公开视频页读标题/频道/播放量/发布日期',
      ),
    ).toBeNull();
  });
  it('does not confuse an individual full-course video title with a playlist', () => {
    expect(
      completionGap(
        'YouTube 搜索前5个视频标题',
        '1. Playwright Full Course — https://youtube.com/watch?v=one',
        [{ tool: 'read_page', ok: true, url: 'https://youtube.com/results' }],
        true,
      ),
    ).toBeNull();
  });
  it('does not use source-link text as proof of an unread child tab title', () => {
    expect(
      completionFieldGaps(
        '1. Target title — https://target.test/',
        'Target title',
        undefined,
        [
          {
            text: 'Target title https://target.test/',
            sourceURL: 'https://source.test/',
            links: [{ text: 'Target title', url: 'https://target.test/', kind: 'link' }],
          },
        ],
        '从页面打开链接到新标签，分别读取标题',
      ),
    ).toBeTruthy();
  });
  it('allows retrying the initial source navigation when it never loaded', async () => {
    const { adapter } = brain([
      { name: 'navigate', input: { url: 'https://example.com/' } },
      { name: 'navigate', input: { url: 'https://example.com/' } },
    ]);
    let executed = 0;
    await runUnifiedBrowserLoop({
      adapter,
      intent: '从一个页面打开3个链接到新标签',
      observationV2: true,
      maxSteps: 2,
      execute: async () => {
        executed++;
        return { ok: false, text: 'timeout' };
      },
    });
    expect(executed).toBe(2);
  });
  it('does not let a download receipt certify an invented webpage title', async () => {
    const { adapter } = brain([
      { name: 'download', input: { ref: 'e1' } },
      finish('文件 foo.txt，16 bytes\n标题：Invented title', ''),
    ]);
    const result = await runUnifiedBrowserLoop({
      adapter,
      intent: '下载文件并报告文件名大小',
      observationV2: true,
      maxSteps: 2,
      execute: async () => ({
        ok: true,
        url: 'https://example.com/download',
        text: 'downloaded',
        download: {
          fileId: 'file_1',
          filename: 'foo.txt',
          sizeBytes: 16,
          sha256: 'a'.repeat(64),
          downloadUrl: '/files/foo.txt',
        },
      }),
    });
    expect(result.status).toBe('failed');
  });
  it.each([
    '| 标题 | 频道 |\n|---|---|\n| Rick Astley - Never Gonna Give You Up | Invented channel |',
    '播放量为999亿次观看',
  ])('rejects an unobserved factual field in a table or natural label: %s', async (summary) => {
    const { adapter } = brain([read, finish(summary, 'Rick Astley')]);
    const result = await runUnifiedBrowserLoop({
      adapter,
      intent: '读取标题频道播放量',
      observationV2: true,
      maxSteps: 2,
      execute: async () => ({ ok: true, text: actual }),
    });
    expect(result.status).toBe('failed');
  });
  it('does not certify a page title read after its navigation failed', async () => {
    const { adapter } = brain([
      { name: 'navigate', input: { url: 'https://example.com/unavailable' } },
      read,
      finish('标题：Unexpected error page', 'Unexpected error page'),
    ]);
    const result = await runUnifiedBrowserLoop({
      adapter,
      intent: '打开网页读取标题',
      observationV2: true,
      maxSteps: 3,
      execute: async (action) =>
        action.tool === 'navigate'
          ? { ok: false, text: 'navigation timeout', url: action.url }
          : {
              ok: true,
              text: JSON.stringify({
                tabId: 'failed',
                sourceURL: 'https://example.com/unavailable',
                tree: 'Unexpected error page',
              }),
            },
    });
    expect(result.status).toBe('failed');
  });
  it('emits sanitized bounded rejection diagnostics before returning a failure', async () => {
    const rejected: unknown[] = [];
    const { adapter } = brain([
      read,
      finish('标题：Wrong title; token=secret-marker user@example.com', 'Wrong title'),
    ]);
    await runUnifiedBrowserLoop({
      adapter,
      intent: '读标题',
      observationV2: true,
      maxSteps: 2,
      onCompletionRejected: async (event) => {
        rejected.push(event);
      },
      execute: async () => ({ ok: true, text: actual }),
    });
    expect(rejected).toHaveLength(1);
    expect(JSON.stringify(rejected)).toContain('Wrong title');
    expect(JSON.stringify(rejected)).not.toContain('secret-marker');
    expect(JSON.stringify(rejected)).not.toContain('user@example.com');
  });
  it('accepts independently observed video fields, not one contiguous paragraph', async () => {
    const { adapter } = brain([
      read,
      finish(
        '标题：Rick Astley - Never Gonna Give You Up；频道：Rick Astley；播放量：18亿次观看；发布日期：16年前',
        'heading "Rick Astley - Never Gonna Give You Up"\nlink "Rick Astley"\ngeneric "18亿次观看"\ngeneric "16年前"',
      ),
    ]);
    const result = await runUnifiedBrowserLoop({
      adapter,
      intent: '读取视频标题、频道、播放量、发布日期',
      observationV2: true,
      maxSteps: 2,
      execute: async () => ({
        ok: true,
        text: JSON.stringify({
          tree: actual,
          tabId: 'one',
          sourceURL: 'https://example.test/video',
        }),
      }),
    });
    expect(result.status).toBe('completed');
  });
  it('rejects an invented answer field even when its short evidence is real', async () => {
    const { adapter } = brain([read, finish('标题：Invented video title', 'Rick Astley')]);
    const result = await runUnifiedBrowserLoop({
      adapter,
      intent: '读取视频标题',
      observationV2: true,
      maxSteps: 2,
      execute: async () => ({ ok: true, text: JSON.stringify({ tree: actual }) }),
    });
    expect(result.status).toBe('failed');
  });
  it('returns the rejected field and a nearby relevant original snippet instead of the tail', async () => {
    const { adapter, requests } = brain([
      read,
      finish('标题：Rick Astley - Wrong Song', 'Rick Astley - Wrong Song'),
      finish(
        '标题：Rick Astley - Never Gonna Give You Up',
        'Rick Astley - Never Gonna Give You Up',
      ),
    ]);
    const result = await runUnifiedBrowserLoop({
      adapter,
      intent: '读取标题',
      observationV2: true,
      maxSteps: 3,
      execute: async () => ({
        ok: true,
        text: `${actual}\n${'unrelated recommendation '.repeat(150)}`,
      }),
    });
    expect(result.status).toBe('completed');
    const feedback = JSON.stringify(requests[2]?.messages);
    expect(feedback).toContain('Wrong Song');
    expect(feedback).toContain('Never Gonna Give You Up');
  });
  it('validates multi-tab fields against their own read source', async () => {
    const fields = [
      { name: '标题', value: 'Alpha title', tabId: 'a' },
      { name: '标题', value: 'Beta title', tabId: 'b' },
    ];
    const { adapter } = brain([
      read,
      read,
      finish('Alpha title；Beta title', 'Alpha title\nBeta title', fields),
    ]);
    let count = 0;
    const result = await runUnifiedBrowserLoop({
      adapter,
      intent: '读两个标签的标题',
      observationV2: true,
      maxSteps: 3,
      execute: async () => ({
        ok: true,
        text: JSON.stringify(
          ++count === 1
            ? { tree: 'heading "Alpha title"', tabId: 'a', sourceURL: 'https://a.test' }
            : { tree: 'heading "Beta title"', tabId: 'b', sourceURL: 'https://b.test' },
        ),
      }),
    });
    expect(result.status).toBe('completed');
  });
  it('does not borrow a title from a different tab', async () => {
    const { adapter } = brain([
      read,
      read,
      finish('标题：Alpha title', 'Alpha title', [
        { name: '标题', value: 'Alpha title', tabId: 'b' },
      ]),
    ]);
    let count = 0;
    const result = await runUnifiedBrowserLoop({
      adapter,
      intent: '读取标签标题',
      observationV2: true,
      maxSteps: 3,
      execute: async () => ({
        ok: true,
        text: JSON.stringify(
          ++count === 1 ? { tree: 'Alpha title', tabId: 'a' } : { tree: 'Beta title', tabId: 'b' },
        ),
      }),
    });
    expect(result.status).toBe('failed');
  });
  it('does not accept a title learned only from the tab listing', async () => {
    const { adapter } = brain([
      { name: 'list_tabs', input: {} },
      finish('标题：Timeout page', 'Timeout page'),
    ]);
    const result = await runUnifiedBrowserLoop({
      adapter,
      intent: '读取网页标题',
      observationV2: true,
      maxSteps: 2,
      execute: async () => ({
        ok: true,
        text: JSON.stringify({ tabs: [{ tabId: 'bad', title: 'Timeout page' }] }),
      }),
    });
    expect(result.status).toBe('failed');
  });
  it('does not allow direct URL navigation to stand in for clicking source links', async () => {
    const { adapter, requests } = brain([
      { name: 'navigate', input: { url: 'https://source.test' } },
      read,
      { name: 'navigate', input: { url: 'https://made-up.test' } },
      finish('未完成', ''),
    ]);
    const executed: string[] = [];
    await runUnifiedBrowserLoop({
      adapter,
      intent: '从一个页面打开3个链接到新标签，分别读标题后回到第一个',
      observationV2: true,
      maxSteps: 4,
      execute: async (a) => {
        executed.push(a.tool === 'navigate' ? a.url : a.tool);
        return { ok: true, text: 'Source links', url: 'https://source.test' };
      },
    });
    expect(executed).not.toContain('https://made-up.test');
    expect(JSON.stringify(requests[3]?.messages)).toContain('newTab');
  });
});
