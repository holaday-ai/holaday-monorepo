import { describe, expect, it } from 'vitest';
import type { MessagesAdapter, NeutralMessagesRequest } from '../../llm/messages-adapter.js';
import { completionGap } from './browser-completion.js';
import { runUnifiedBrowserLoop } from './unified-browser-loop.js';
import { parseUnifiedBrowserAction } from './unified-tools.js';

function brain(turns: Array<{ name: string; input: unknown }>) {
  const requests: NeutralMessagesRequest[] = [];
  const adapter: MessagesAdapter = {
    metadata: { provider: 'anthropic', model: 'scripted' },
    async create(request) {
      requests.push(request);
      const call = turns[requests.length - 1];
      if (!call) throw new Error('Script exhausted');
      return {
        id: String(requests.length),
        metadata: this.metadata,
        content: [{ type: 'tool_use', id: String(requests.length), ...call }],
        stopReason: 'tool_use',
        usage: {
          inputTokens: 0,
          outputTokens: 0,
          cacheReadInputTokens: null,
          cacheCreationInputTokens: null,
          complete: true,
        },
      };
    },
  };
  return { adapter, requests };
}
const finish = (evidence: string) => ({
  name: 'finish',
  input: {
    status: 'completed',
    summary: 'Observed public video metadata.',
    evidence,
  },
});

describe('BROWSER-FIX-3 grounded completion', () => {
  it('does not mistake a billion-view count for a download byte claim', () => {
    expect(
      completionGap(
        'Read video metadata',
        '1.8 B views, 16 years ago',
        [{ tool: 'read_page', ok: true, url: 'https://youtube.com/watch' }],
        true,
      ),
    ).toBeNull();
    expect(
      completionGap(
        '下载文件并报告大小',
        '错误文件大小 100 bytes',
        [{ tool: 'navigate', ok: true, url: 'https://example.com' }],
        true,
      ),
    ).toBeTruthy();
  });
  it('keeps observed table cells eligible as evidence', async () => {
    const { adapter } = brain([{ name: 'tables', input: {} }, finish('Verified table cell')]);
    const result = await runUnifiedBrowserLoop({
      intent: 'Read table',
      adapter,
      observationV2: true,
      maxSteps: 2,
      execute: async () => ({
        ok: true,
        url: 'https://example.com',
        text: JSON.stringify({ items: [{ columns: ['Name'], rows: [['Verified table cell']] }] }),
      }),
    });
    expect(result.status).toBe('completed');
  });
  it('accepts the actual frame-prefixed refs only with an explicit frame context', () => {
    expect(
      parseUnifiedBrowserAction('click', { ref: 'f1e2', frameId: 'frame-owned' }),
    ).toMatchObject({ ref: 'f1e2' });
    expect(() => parseUnifiedBrowserAction('click', { ref: 'f1e2' })).toThrow();
  });
  it('accepts decoded multiline evidence instead of requiring JSON escape sequences', async () => {
    const { adapter } = brain([
      { name: 'read_page', input: {} },
      finish('Public title\nPublic channel'),
    ]);
    const result = await runUnifiedBrowserLoop({
      intent: 'Read public video metadata',
      adapter,
      observationV2: true,
      requireBrowserEvidence: true,
      maxSteps: 2,
      execute: async () => ({
        ok: true,
        url: 'https://example.com/video',
        text: JSON.stringify({ tree: 'Public title\nPublic channel', observationRevision: 'r1' }),
      }),
    });
    expect(result.status).toBe('completed');
  });

  it('keeps grounded earlier chunks on the same page after a later read', async () => {
    const { adapter } = brain([
      { name: 'get_page_text', input: {} },
      { name: 'get_page_text', input: { cursor: 'next' } },
      finish('Verified first section'),
    ]);
    let read = 0;
    const result = await runUnifiedBrowserLoop({
      intent: 'Read sections',
      adapter,
      observationV2: true,
      maxSteps: 3,
      execute: async () => ({
        ok: true,
        url: 'https://example.com/article',
        text: JSON.stringify({
          text: ++read === 1 ? 'Verified first section' : 'Last section',
          snapshotId: 'same-document',
          range: [read * 20, read * 20 + 20],
        }),
      }),
    });
    expect(result.status).toBe('completed');
  });

  it('rejects invented evidence and gives a correction without requesting more repeated reads', async () => {
    const { adapter, requests } = brain([
      { name: 'read_page', input: {} },
      finish('Invented content'),
      finish('Verified title'),
    ]);
    const result = await runUnifiedBrowserLoop({
      intent: 'Read title',
      adapter,
      observationV2: true,
      maxSteps: 3,
      execute: async () => ({ ok: true, url: 'https://example.com', text: 'Verified title' }),
    });
    expect(result.status).toBe('completed');
    expect(JSON.stringify(requests[2]?.messages)).toContain('Verified title');
    expect(JSON.stringify(requests[2]?.messages)).toContain('证据');
    expect(JSON.stringify(requests[2]?.messages)).not.toContain('请重新读取');
  });

  it('never reuses evidence after a navigation to a different document', async () => {
    const { adapter } = brain([
      { name: 'read_page', input: {} },
      { name: 'navigate', input: { url: 'https://example.com/new' } },
      finish('Old private text'),
    ]);
    const result = await runUnifiedBrowserLoop({
      intent: 'Read current page',
      adapter,
      observationV2: true,
      maxSteps: 3,
      execute: async (action) =>
        action.tool === 'read_page'
          ? { ok: true, url: 'https://example.com/old', text: 'Old private text' }
          : { ok: true, url: 'https://example.com/new', text: 'navigated' },
    });
    expect(result.status).toBe('failed');
  });
});
