/**
 * REBUILD-3: the price contract inside the unified browser loop's finish path — fake executor,
 * scripted adapter, no browser and no model. Flag off (no `answerContract`): nothing changes.
 */
import { describe, expect, it } from 'vitest';
import type {
  MessagesAdapter,
  NeutralMessagesRequest,
  NeutralOutputContentBlock,
} from '../../llm/messages-adapter.js';
import { runUnifiedBrowserLoop } from '../browser-tools/unified-browser-loop.js';

const INTENT = '在亚马逊新加坡站搜 usb c cable，列出前三个的名称和价格';
const URL = 'https://www.amazon.sg/s?k=usb+c+cable';
const TREE = [
  '- main [ref=e1]:',
  '  - list [ref=e3]:',
  '    - listitem [ref=e10]:',
  '      - link "UGREEN USB C Cable 100W, 1M" [ref=e11] [cursor=pointer]:',
  '        - /url: /dp/B0AAA11111',
  '      - generic [ref=e12]: S$10.92',
  '    - listitem [ref=e20]:',
  '      - link "Anker USB C Cable 240W, 6ft" [ref=e21] [cursor=pointer]:',
  '        - /url: /dp/B0BBB22222',
  '      - generic [ref=e22]: S$12.45',
  '    - listitem [ref=e30]:',
  '      - link "Belkin Braided USB-A to USB-C Cable" [ref=e31] [cursor=pointer]:',
  '        - /url: /dp/B0CCC33333',
  '      - generic [ref=e32]: No featured offers available',
].join('\n');

type Turn = (request: NeutralMessagesRequest) => NeutralOutputContentBlock[];

function scripted(turns: Turn[]) {
  const requests: NeutralMessagesRequest[] = [];
  let i = 0;
  const adapter: MessagesAdapter = {
    metadata: { provider: 'anthropic', model: 'scripted' },
    async create(request) {
      requests.push(request);
      const turn = turns[Math.min(i++, turns.length - 1)]!;
      return {
        id: `r${i}`,
        metadata: { provider: 'anthropic', model: 'scripted' },
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
  return { adapter, requests };
}

const call = (name: string, input: unknown, id = name): NeutralOutputContentBlock => ({
  type: 'tool_use',
  id,
  name,
  input,
});

const item = (name: string, price: string, ref: string) => ({
  name,
  variant: null,
  price,
  currency: 'SGD',
  source_url: null,
  quote: price,
  block_ref: ref,
});

const UGREEN = item('UGREEN USB C Cable 100W, 1M', 'S$10.92', 'e10');
const ANKER = item('Anker USB C Cable 240W, 6ft', 'S$12.45', 'e20');
const BELKIN_OTHER_VARIANT = item('Belkin Braided USB-A to USB-C Cable', 'S$6.86', 'e30');

function run(turns: Turn[], contract: boolean) {
  const { adapter, requests } = scripted(turns);
  let url = 'about:blank';
  const outcome = runUnifiedBrowserLoop({
    intent: INTENT,
    userIntent: INTENT,
    adapter,
    maxSteps: 10,
    rescue: false,
    currentPageUrl: () => url,
    ...(contract ? { answerContract: 'price' as const } : {}),
    execute: (async (action: { tool: string; url?: string }) => {
      if (action.tool === 'navigate') {
        url = action.url!;
        return { ok: true, text: '已打开', url };
      }
      if (action.tool === 'screenshot')
        return { ok: true, text: '截图', image: { mediaType: 'image/jpeg', data: 'AAAA' } };
      return { ok: true, text: `URL: ${url}\n标题: usb c cable\n${TREE}`, url };
    }) as never,
  });
  return outcome.then((out) => ({ outcome: out, requests }));
}

const opening: Turn[] = [
  () => [call('navigate', { url: URL }, 'n1')],
  () => [call('snapshot', {}, 's1')],
];

describe('REBUILD-3 price contract in the browser loop', () => {
  it('flag off: finish has no price_result, the prompt has no contract rule', async () => {
    const { outcome, requests } = await run(
      [
        ...opening,
        () => [
          call('finish', {
            status: 'completed',
            summary:
              '1. UGREEN USB C Cable 100W, 1M：S$10.92\n2. Anker USB C Cable 240W, 6ft：S$12.45',
          }),
        ],
      ],
      false,
    );
    const finish = requests[0]!.tools!.find((tool) => tool.name === 'finish')!;
    expect(Object.keys((finish.inputSchema as { properties: object }).properties)).not.toContain(
      'price_result',
    );
    expect(String(requests[0]!.system)).not.toContain('price_result');
    expect(outcome.status).toBe('completed');
    if (outcome.status === 'completed') expect(outcome.answerContract).toBeUndefined();
  });

  it('flag on: a checked result is rendered by code, honest gap delivered as 部分完成', async () => {
    const { outcome, requests } = await run(
      [
        ...opening,
        () => [
          call('finish', {
            status: 'completed',
            summary: '找到了前两款的价格。',
            price_result: {
              language: 'zh',
              items: [UGREEN, ANKER],
              missing: [
                {
                  field: 'price',
                  item: 'Belkin Braided USB-A to USB-C Cable',
                  reason: '卡片只显示 No featured offers available',
                },
              ],
              note: null,
            },
          }),
        ],
      ],
      true,
    );
    const finish = requests[0]!.tools!.find((tool) => tool.name === 'finish')!;
    expect((finish.inputSchema as { required: string[] }).required).toContain('price_result');
    expect(String(requests[0]!.system)).toContain('17. 这是查价格任务');
    // Exactly one finish turn: the missing item was not sent back.
    expect(requests).toHaveLength(3);
    expect(outcome).toMatchObject({
      status: 'completed',
      answerContract: 'price',
      partial: { found: 2, wanted: 3 },
    });
    if (outcome.status !== 'completed') return;
    expect(outcome.summary).toMatch(
      /^部分完成：「Belkin Braided USB-A to USB-C Cable」的价格没有拿到。/,
    );
    expect(outcome.summary).toContain(
      '1. UGREEN USB C Cable 100W, 1M：S$10.92\n   来源：https://www.amazon.sg/dp/B0AAA11111',
    );
    expect(outcome.summary).not.toContain('找到了前两款');
  });

  it('flag on: another variant’s price is sent back once with the block read, then moved to missing', async () => {
    const wrong = {
      status: 'completed',
      summary: '三款都有价格。',
      price_result: {
        language: 'zh',
        items: [UGREEN, ANKER, BELKIN_OTHER_VARIANT],
        missing: [],
        note: null,
      },
    };
    const { outcome, requests } = await run(
      [...opening, () => [call('finish', wrong, 'f1')], () => [call('finish', wrong, 'f2')]],
      true,
    );
    const sentBack = JSON.stringify(requests[3]!.messages.at(-1));
    expect(sentBack).toContain('价格「S$6.86」不在这个区块里');
    expect(sentBack).toContain('No featured offers available');
    expect(outcome.status).toBe('completed');
    if (outcome.status !== 'completed') return;
    expect(outcome.summary).not.toContain('S$6.86');
    expect(outcome.summary.startsWith('部分完成：「Belkin')).toBe(true);
    expect(outcome.partial).toMatchObject({ found: 2, wanted: 3 });
  });

  it('flag on: schema invalid twice with a screenshot in context → two steps, text only', async () => {
    const good = {
      status: 'completed',
      summary: '查到了。',
      price_result: { language: 'zh', items: [UGREEN, ANKER], missing: [], note: null },
    };
    const { outcome, requests } = await run(
      [
        ...opening,
        () => [call('screenshot', {}, 'shot')],
        () => [call('finish', { status: 'completed', summary: 'x', price_result: '{bad' }, 'f1')],
        () => [
          call('finish', { status: 'completed', summary: 'x', price_result: { items: 3 } }, 'f2'),
        ],
        // Two steps: describe the screenshot, then structure from text only.
        () => [{ type: 'text', text: 'UGREEN USB C Cable 100W, 1M S$10.92' }],
        () => [call('finish', good, 'f3')],
      ],
      true,
    );
    const describe = requests[5]!;
    expect(describe.tools).toBeUndefined();
    expect(JSON.stringify(describe.messages)).toContain('"type":"image"');
    const structure = requests[6]!;
    expect(JSON.stringify(structure.messages)).not.toContain('"type":"image"');
    expect(structure.toolChoice).toEqual({ type: 'tool', name: 'finish' });
    expect(outcome).toMatchObject({ status: 'completed', answerContract: 'price' });
  });

  it('flag on: no valid price_result at all falls back to the legacy finish path', async () => {
    const plain = { status: 'completed', summary: '1. UGREEN USB C Cable 100W, 1M：S$10.92' };
    const { outcome } = await run(
      [...opening, () => [call('finish', plain, 'f1')], () => [call('finish', plain, 'f2')]],
      true,
    );
    expect(outcome.status).toBe('completed');
    if (outcome.status === 'completed') {
      expect(outcome.answerContract).toBeUndefined();
      expect(outcome.summary).toContain('S$10.92');
    }
  });
});
