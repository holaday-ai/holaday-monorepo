import { describe, expect, it } from 'vitest';
import type { MessagesAdapter } from '../../llm/messages-adapter.js';
import type { UnifiedToolResult } from './playwright-unified-executor.js';
import { runUnifiedBrowserLoop } from './unified-browser-loop.js';

function scripted(calls: Array<{ name: string; input: Record<string, unknown> }>) {
  let turn = 0;
  const seen: string[] = [];
  const adapter: MessagesAdapter = {
    metadata: { provider: 'anthropic', model: 'fixture' },
    async create(request) {
      seen.push(JSON.stringify(request.messages.at(-1)));
      const call = calls[Math.min(turn++, calls.length - 1)]!;
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
  return { adapter, seen };
}

const DY =
  '打开 https://www.douyin.com/video/7507106798919601427 读视频标题、作者，以及点赞数、评论数、收藏数、分享数（不播放）';
const PAGE =
  'heading "仙桥洞 真的好美，喜欢的小伙伴，冲冲冲" [level=1]\nlink "利利的旅行盲盒"\ngeneric: 20\ntext: 点赞';
const ANSWER =
  '视频标题：仙桥洞 真的好美，喜欢的小伙伴，冲冲冲；作者：利利的旅行盲盒；点赞数：20。页面有登录提示弹窗，未登录状态下读取的公开信息如上。';

describe('FIX-61: a browser answer that leaves out named counts is not 完成', () => {
  it('local dy-1: comments, favourites and shares left out → one look, then 部分完成', async () => {
    const { adapter, seen } = scripted([
      { name: 'navigate', input: { url: 'https://www.douyin.com/video/7507106798919601427' } },
      { name: 'snapshot', input: {} },
      { name: 'finish', input: { status: 'completed', summary: ANSWER } },
      { name: 'screenshot', input: {} },
      { name: 'finish', input: { status: 'completed', summary: ANSWER } },
    ]);
    const execute = async (action: { tool: string; url?: string }): Promise<UnifiedToolResult> => {
      if (action.tool === 'navigate')
        return { ok: true, text: `已打开 ${action.url}`, url: action.url };
      if (action.tool === 'screenshot') return { ok: true, text: '截图已保存' };
      return { ok: true, text: `${PAGE} @ https://www.douyin.com/video/7507106798919601427` };
    };
    const outcome = await runUnifiedBrowserLoop({
      intent: DY,
      adapter,
      maxSteps: 10,
      execute: execute as never,
      currentPageUrl: () => 'https://www.douyin.com/video/7507106798919601427',
    });
    expect(seen.join('\n')).toContain('答案里没有写出');
    expect(outcome.status).toBe('completed');
    const done = outcome as { summary: string; partial?: { missing?: string } };
    expect(done.summary).toMatch(/^部分完成/);
    expect(done.partial?.missing).toMatch(/评论数/);
  });
});
