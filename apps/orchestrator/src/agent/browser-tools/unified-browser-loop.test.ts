import { type Browser, chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type {
  MessagesAdapter,
  NeutralMessagesRequest,
  NeutralMessagesResponse,
  NeutralOutputContentBlock,
} from '../../llm/messages-adapter.js';
import { createPlaywrightUnifiedExecutor } from './playwright-unified-executor.js';
import { UNIFIED_LOOP_TOOLS, runUnifiedBrowserLoop } from './unified-browser-loop.js';

const PAGE = `<!doctype html><html><head><title>合成商城</title></head><body>
<label>关键词 <input id="q" /></label>
<button onclick="document.getElementById('r').textContent='结果：'+document.getElementById('q').value+' ￥29'">搜索</button>
<p id="r"></p></body></html>`;

type Script = (request: NeutralMessagesRequest) => NeutralOutputContentBlock[];

function scriptedAdapter(
  turns: Script[],
): MessagesAdapter & { requests: NeutralMessagesRequest[] } {
  const requests: NeutralMessagesRequest[] = [];
  let index = 0;
  return {
    requests,
    metadata: { provider: 'anthropic', model: 'scripted' },
    async create(request): Promise<NeutralMessagesResponse> {
      requests.push(request);
      const turn = turns[index++];
      if (!turn) throw new Error('script exhausted');
      return {
        id: `r${index}`,
        metadata: this.metadata,
        content: turn(request),
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
}

const call = (name: string, input: unknown, id = name): NeutralOutputContentBlock => ({
  type: 'tool_use',
  id,
  name,
  input,
});

/** Finds the ref for a line in the most recent snapshot tool result. */
function refFrom(request: NeutralMessagesRequest, pattern: RegExp): string {
  const last = request.messages.at(-1);
  const text = Array.isArray(last?.content)
    ? last.content.map((block) => (block.type === 'tool_result' ? block.content : '')).join('\n')
    : '';
  const match = text
    .split('\n')
    .find((line) => pattern.test(line))
    ?.match(/\[ref=(e\d+)\]/);
  if (!match?.[1]) throw new Error(`no ref for ${pattern}`);
  return match[1];
}

describe('unified browser loop', () => {
  let browser: Browser;
  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
  }, 60_000);
  afterAll(async () => {
    await browser?.close();
  });

  it('drives snapshot → type → click → finish with any brain over the same tools', async () => {
    const page = await browser.newPage();
    await page.setContent(PAGE);
    const tools = createPlaywrightUnifiedExecutor(page, { actionTimeoutMs: 3_000 });
    const adapter = scriptedAdapter([
      () => [call('snapshot', {}, 's1')],
      (request) => [
        call(
          'type',
          { ref: refFrom(request, /textbox "关键词"/), text: '收纳盒', expect: '输入框出现收纳盒' },
          't1',
        ),
        call('snapshot', {}, 's2'),
      ],
      (request) => [
        call('click', { ref: refFrom(request, /button "搜索"/), expect: '出现搜索结果' }, 'c1'),
      ],
      () => [call('wait_for', { text: '结果：收纳盒' }, 'w1')],
      () => [
        call(
          'finish',
          { status: 'completed', summary: '收纳盒 29 元', evidence: '结果：收纳盒 ￥29' },
          'f1',
        ),
      ],
    ]);
    const outcome = await runUnifiedBrowserLoop({
      intent: '搜索收纳盒并告诉我价格',
      adapter,
      execute: tools.execute,
    });
    await page.close();
    expect(outcome).toMatchObject({ status: 'completed', evidence: '结果：收纳盒 ￥29' });
    expect(adapter.requests[0]?.tools?.map((tool) => tool.name)).toEqual(
      UNIFIED_LOOP_TOOLS.map((t) => t.name),
    );
    expect(String(adapter.requests[0]?.system)).toContain('先调用 snapshot');
  }, 60_000);

  it('hands login/captcha/payment to the user and resumes after the handoff', async () => {
    const requestHuman = vi.fn(async () => true);
    const adapter = scriptedAdapter([
      () => [call('request_human', { reason: 'login', message: '请先登录淘宝' }, 'h1')],
      (request) => {
        const last = request.messages.at(-1);
        expect(JSON.stringify(last)).toContain('用户已完成接管');
        return [call('finish', { status: 'failed', summary: '登录后未找到订单' }, 'f1')];
      },
    ]);
    const outcome = await runUnifiedBrowserLoop({
      intent: '查一下我的订单',
      adapter,
      execute: async () => ({ ok: true, text: '' }),
      requestHuman,
    });
    expect(requestHuman).toHaveBeenCalledWith({ reason: 'login', message: '请先登录淘宝' });
    expect(outcome).toMatchObject({ status: 'failed', reason: '登录后未找到订单' });
  });

  it('parks as awaiting_user when no handoff channel is available', async () => {
    const adapter = scriptedAdapter([
      () => [call('request_human', { reason: 'captcha', message: '请完成验证码' })],
    ]);
    const outcome = await runUnifiedBrowserLoop({
      intent: 'x',
      adapter,
      execute: async () => ({ ok: true, text: '' }),
    });
    expect(outcome).toMatchObject({ status: 'awaiting_user', reason: 'captcha' });
  });

  it('rejects completion without page evidence and bad refs without executing them', async () => {
    const execute = vi.fn(async () => ({ ok: true, text: 'ok' }));
    const adapter = scriptedAdapter([
      () => [
        call('click', { ref: '#buy' }, 'bad'),
        call('finish', { status: 'completed', summary: '完成' }, 'f0'),
      ],
      (request) => {
        const results = JSON.stringify(request.messages.at(-1));
        expect(results).toContain('ref 无效');
        expect(results).toContain('evidence');
        return [call('finish', { status: 'failed', summary: '无法确认结果' }, 'f1')];
      },
    ]);
    const outcome = await runUnifiedBrowserLoop({ intent: 'x', adapter, execute });
    expect(execute).not.toHaveBeenCalled();
    expect(outcome.status).toBe('failed');
  });

  it('reports a model outage as a readable failure instead of throwing', async () => {
    const adapter: MessagesAdapter = {
      metadata: { provider: 'anthropic', model: 'down' },
      create: async () => {
        throw new Error('503');
      },
    };
    const outcome = await runUnifiedBrowserLoop({
      intent: 'x',
      adapter,
      execute: async () => ({ ok: true, text: '' }),
    });
    expect(outcome).toMatchObject({ status: 'failed', reason: '模型服务暂时不可用，请稍后重试。' });
  });
});
