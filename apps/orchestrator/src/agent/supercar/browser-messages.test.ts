import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it, vi } from 'vitest';
import { env } from '../../config/env.js';
import { createQwenMessagesAdapter } from '../../llm/messages-adapter.js';
import { createBrowserMessage } from './browser-messages.js';

const image = (data: string) => ({
  type: 'image' as const,
  source: { type: 'base64' as const, media_type: 'image/jpeg' as const, data },
});
function fixture(fetchImpl: typeof fetch) {
  return createQwenMessagesAdapter({
    environment: {
      ...env,
      QWEN_MESSAGES_ADAPTER_ENABLED: true,
      DASHSCOPE_CN_API_KEY: 'synthetic-key',
      DASHSCOPE_CN_WORKSPACE_ID: '',
      DASHSCOPE_CN_ANTHROPIC_BASE_URL: 'https://dashscope.aliyuncs.com/apps/anthropic',
      QWEN_VISION_MODEL: 'qwen3-vl-plus',
    },
    region: 'cn',
    purpose: 'vision',
    fetchImpl,
  });
}
function request(): Anthropic.Beta.MessageCreateParamsNonStreaming {
  return {
    model: 'ignored-anthropic-model',
    max_tokens: 100,
    thinking: { type: 'adaptive' },
    betas: ['computer-use-2025-11-24'],
    tools: [
      {
        type: 'computer_20251124',
        name: 'computer',
        display_width_px: 800,
        display_height_px: 600,
      },
    ],
    messages: [
      {
        role: 'user',
        content: [{ type: 'text', text: '按用户参考图操作网页' }, image('cmVmZXJlbmNl')],
      },
    ],
  };
}
const success = () =>
  new Response(
    JSON.stringify({
      id: 'reply',
      content: [{ type: 'text', text: '完成' }],
      stop_reason: 'end_turn',
    }),
    { status: 200 },
  );

describe('Qwen browser wire compatibility', () => {
  it('keeps all tool replies together and sends their screenshots in a separate user message', async () => {
    const input = request();
    input.messages.push({
      role: 'assistant',
      content: [
        { type: 'tool_use', id: 'first', name: 'computer', input: { action: 'screenshot' } },
        { type: 'tool_use', id: 'second', name: 'computer', input: { action: 'screenshot' } },
      ],
    });
    input.messages.push({
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: 'first',
          content: [{ type: 'text', text: 'first page' }, image('Zmlyc3Q=')],
        },
        {
          type: 'tool_result',
          tool_use_id: 'second',
          content: [{ type: 'text', text: 'second page' }, image('c2Vjb25k')],
        },
      ],
    });
    const original = structuredClone(input);
    const fetchImpl = vi.fn<typeof fetch>(async () => success());
    await createBrowserMessage(fixture(fetchImpl), input, {});
    const body = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body));
    expect(body.messages.slice(2)).toEqual([
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'first', content: 'first page' },
          { type: 'tool_result', tool_use_id: 'second', content: 'second page' },
        ],
      },
      {
        role: 'user',
        content: [
          { type: 'text', text: '工具 first 返回的页面截图：' },
          image('Zmlyc3Q='),
          { type: 'text', text: '工具 second 返回的页面截图：' },
          image('c2Vjb25k'),
        ],
      },
    ]);
    expect(input).toEqual(original);
  });
  it('sends ordinary computer tools and base64 images through the real adapter and transport', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => success());
    const result = await createBrowserMessage(fixture(fetchImpl), request(), { maxRetries: 0 });
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe('https://dashscope.aliyuncs.com/apps/anthropic/v1/messages');
    const body = JSON.parse(String(init?.body));
    expect(body.model).toBe('qwen3-vl-plus');
    expect(body.tools[0]).toMatchObject({
      name: 'computer',
      description: expect.stringContaining('800×600'),
      input_schema: { required: ['action'] },
    });
    expect(body.tools[0].type).toBeUndefined();
    expect(body.tools[0].description).toContain('0–1000');
    expect(body.tools[0].description).not.toContain('不要使用 0–1000');
    for (const field of ['coordinate', 'start_coordinate']) {
      expect(body.tools[0].input_schema.properties[field].items).toEqual({
        type: 'number',
        minimum: 0,
        maximum: 1000,
      });
    }
    for (const key of ['betas', 'thinking', 'context_management', 'container', 'output_config'])
      expect(body[key]).toBeUndefined();
    expect(body.messages[0].content[1]).toEqual(image('cmVmZXJlbmNl'));
    expect(result.usage).toMatchObject({ input_tokens: null, output_tokens: null });
  });

  it('retains user reference images and tool pairs while bounding historical browser screenshots', async () => {
    const input = request();
    for (let i = 0; i < 6; i++) {
      input.messages.push({
        role: 'assistant',
        content: [
          { type: 'tool_use', id: `tool-${i}`, name: 'computer', input: { action: 'screenshot' } },
        ],
      });
      input.messages.push({
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: `tool-${i}`,
            content: [
              { type: 'text', text: `page-${i}` },
              image(Buffer.from(`page-${i}`).toString('base64')),
            ],
          },
        ],
      });
    }
    const fetchImpl = vi.fn<typeof fetch>(async () => success());
    await createBrowserMessage(fixture(fetchImpl), input, {});
    const body = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body));
    expect(body.messages[0].content).toContainEqual(image('cmVmZXJlbmNl'));
    const replies = body.messages.flatMap((message: { content: Array<{ type: string }> }) =>
      message.content.filter((block) => block.type === 'tool_result'),
    );
    for (let i = 0; i < 6; i++)
      expect(replies[i]).toMatchObject({
        type: 'tool_result',
        tool_use_id: `tool-${i}`,
        content: `page-${i}`,
      });
    const screenshots = body.messages
      .slice(1)
      .flatMap((message: { content: Array<{ type: string }> }) =>
        message.content.filter((block) => block.type === 'image'),
      );
    expect(screenshots).toHaveLength(3);
    expect(screenshots.at(-1)).toEqual(image(Buffer.from('page-5').toString('base64')));
    expect(input.messages[2]?.content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'tool_result',
          content: expect.arrayContaining([image(Buffer.from('page-0').toString('base64'))]),
        }),
      ]),
    );
  });

  it('aborts the actual fetch without launching a replacement request', async () => {
    let signal: AbortSignal | undefined;
    const fetchImpl = vi.fn<typeof fetch>(async (_url, init) => {
      signal = init?.signal ?? undefined;
      return new Promise((_resolve, reject) =>
        signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), {
          once: true,
        }),
      );
    });
    const controller = new AbortController();
    const pending = createBrowserMessage(fixture(fetchImpl), request(), {
      signal: controller.signal,
      timeoutMs: 1000,
      maxRetries: 0,
    });
    const rejection = expect(pending).rejects.toMatchObject({ code: 'REQUEST_ABORTED' });
    await vi.waitFor(() => expect(signal).toBeDefined());
    controller.abort();
    await rejection;
    expect(signal?.aborted).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('rejects an oversized latest screenshot before sending any request', async () => {
    const input = request();
    input.messages.push({ role: 'user', content: [image('a'.repeat(4_000_001))] });
    const fetchImpl = vi.fn<typeof fetch>();
    await expect(createBrowserMessage(fixture(fetchImpl), input, {})).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
