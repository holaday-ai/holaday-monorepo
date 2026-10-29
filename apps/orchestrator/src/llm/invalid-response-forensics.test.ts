import { describe, expect, it } from 'vitest';
import { FORENSIC_BODY_LIMIT, maskForensicBody } from './invalid-response-forensics.js';
import { MessagesAdapterError, createQwenMessagesAdapter } from './messages-adapter.js';
import type { QwenRuntimeEnvironment } from './qwen-route.js';

const ENVIRONMENT: QwenRuntimeEnvironment & { QWEN_MESSAGES_ADAPTER_ENABLED: boolean } = {
  DASHSCOPE_API_KEY: 'legacy-intl',
  DASHSCOPE_WORKSPACE_ID: 'legacy-workspace',
  DASHSCOPE_INTL_API_KEY: 'intl-key',
  DASHSCOPE_INTL_ANTHROPIC_BASE_URL: 'https://dashscope-intl.aliyuncs.com/apps/anthropic',
  DASHSCOPE_INTL_RESPONSES_BASE_URL: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
  DASHSCOPE_INTL_WORKSPACE_ID: 'intl-workspace',
  DASHSCOPE_CN_API_KEY: 'cn-secret-key-123456',
  DASHSCOPE_CN_ANTHROPIC_BASE_URL: 'https://dashscope.aliyuncs.com/apps/anthropic',
  DASHSCOPE_CN_RESPONSES_BASE_URL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  DASHSCOPE_CN_WORKSPACE_ID: 'cn-workspace-7890',
  QWEN_REASONING_MODEL: 'qwen3.8-max',
  QWEN_STANDARD_MODEL: 'qwen3.7-plus',
  QWEN_MESSAGES_ADAPTER_ENABLED: true,
} as never;

const REQUEST = {
  maxTokens: 512,
  system: '合成系统提示',
  messages: [
    { role: 'user' as const, content: '用户问题' },
    { role: 'assistant' as const, content: '好的' },
    { role: 'user' as const, content: '继续' },
  ],
  tools: [
    { name: 'navigate', description: 'open', inputSchema: { type: 'object', properties: {} } },
    { name: 'snapshot', description: 'read', inputSchema: { type: 'object', properties: {} } },
  ],
};

async function failure(body: string, headers: Record<string, string> = {}) {
  const adapter = createQwenMessagesAdapter({
    environment: ENVIRONMENT,
    region: 'cn',
    purpose: 'reasoning',
    retryBaseDelayMs: 0,
    fetchImpl: async () => new Response(body, { status: 200, headers }),
  });
  try {
    await adapter.create(REQUEST as never);
  } catch (error) {
    return error as MessagesAdapterError;
  }
  throw new Error('expected INVALID_RESPONSE');
}

describe('FIX-47 #4 · an INVALID_RESPONSE keeps what came back', () => {
  it('empty content (the 2026-10-28 pattern: 200 in about a second, nothing to use)', async () => {
    const error = await failure(
      JSON.stringify({
        id: 'msg_1',
        type: 'message',
        content: [],
        stop_reason: 'end_turn',
        usage: { input_tokens: 5021, output_tokens: 0 },
      }),
      { 'x-request-id': 'req-abc-123' },
    );
    expect(error).toBeInstanceOf(MessagesAdapterError);
    expect(error.code).toBe('INVALID_RESPONSE');
    expect(error.diagnostics).toMatchObject({ httpStatus: 200, requestId: 'req-abc-123' });
    expect(error.forensics).toMatchObject({
      kind: 'empty_content',
      httpStatus: 200,
      requestId: 'req-abc-123',
      model: 'qwen3.8-max',
      toolCount: 2,
      messageCount: 3,
      stopReason: 'end_turn',
      contentTypes: [],
      usage: { inputTokens: 5021, outputTokens: 0 },
    });
    expect(error.forensics?.requestBytes).toBeGreaterThan(100);
    expect(error.forensics?.body).toContain('"content":[]');
    // The request itself is never kept.
    expect(JSON.stringify(error.forensics)).not.toContain('合成系统提示');
    expect(JSON.stringify(error.forensics)).not.toContain('用户问题');
  });

  it('thinking only: the block types say so', async () => {
    const error = await failure(
      JSON.stringify({
        id: 'msg_2',
        content: [{ type: 'thinking', thinking: '先打开页面' }],
        stop_reason: 'end_turn',
      }),
    );
    expect(error.forensics).toMatchObject({ kind: 'empty_content', contentTypes: ['thinking'] });
  });

  it('each check names itself', async () => {
    const cases: Array<[unknown, string]> = [
      [{ content: [{ type: 'text', text: 'x' }] }, 'no_id'],
      [{ id: 'm', content: 'x' }, 'no_content_array'],
      [{ id: 'm', content: [{ type: 'text', text: 3 }] }, 'bad_text_block'],
      [
        { id: 'm', content: [{ type: 'tool_use', name: 'navigate', input: {} }] },
        'bad_tool_use_block',
      ],
      [[1, 2], 'not_object'],
    ];
    for (const [body, kind] of cases)
      expect((await failure(JSON.stringify(body))).forensics?.kind).toBe(kind);
  });

  it('a body that is not JSON is kept as sent', async () => {
    const error = await failure('<html>upstream reset</html>', {
      'x-dashscope-request-id': 'ds-9',
    });
    expect(error.code).toBe('INVALID_RESPONSE');
    expect(error.forensics).toMatchObject({ kind: 'not_json', httpStatus: 200, requestId: 'ds-9' });
    expect(error.forensics?.body).toBe('<html>upstream reset</html>');
  });

  it('the route key and workspace never stay in the kept body', async () => {
    const error = await failure(
      JSON.stringify({ id: 'm', content: [], echo: 'cn-secret-key-123456 cn-workspace-7890' }),
    );
    expect(error.forensics?.body).not.toContain('cn-secret-key-123456');
    expect(error.forensics?.body).not.toContain('cn-workspace-7890');
  });
});

describe('FIX-47 #4 · masking and the 4 KB cut', () => {
  it('credentials and personal identifiers are masked', () => {
    const out = maskForensicBody(
      'Bearer abcdefghijklmnop sk-1234567890abcdef a@b.com 13812345678 110101199003071234 0123456789abcdef0123456789abcdef 1234567890123',
    );
    expect(out).toBe('Bearer [密钥] [密钥] [邮箱] [手机号] [证件号] [密钥] [长数字]');
  });

  it('a long body is cut at 4 KB on a character boundary', () => {
    const out = maskForensicBody('汉'.repeat(3000));
    expect(out.endsWith('…[截断]')).toBe(true);
    expect(Buffer.byteLength(out.replace('…[截断]', ''), 'utf8')).toBeLessThanOrEqual(
      FORENSIC_BODY_LIMIT,
    );
    expect(out).not.toContain('�');
  });

  it('a normal body is untouched', () => {
    const body = '{"id":"msg_1","content":[],"stop_reason":"end_turn","usage":{"input_tokens":12}}';
    expect(maskForensicBody(body)).toBe(body);
  });
});

describe('DEPLOY-48 复审 #3 · evidence hardening', () => {
  it('a block keeps only its type and length, never its words', async () => {
    const error = await failure(
      JSON.stringify({
        id: 'm',
        content: [
          { type: 'thinking', thinking: '用户问的是我的身份证号' },
          { type: 'text', text: 7 },
        ],
      }),
    );
    expect(error.forensics?.kind).toBe('bad_text_block');
    expect(error.forensics?.body).not.toContain('用户问的是');
    expect(JSON.parse(error.forensics?.body ?? '{}').content).toEqual([
      { type: 'thinking', chars: 11 },
      { type: 'text', chars: 0 },
    ]);
  });

  it('the not-JSON body is masked when it is kept, and never serialised with the error', async () => {
    const { QwenTransportError } = await import('./qwen-messages-transport.js');
    const { createQwenMessagesTransport } = await import('./qwen-messages-transport.js');
    const transport = createQwenMessagesTransport({
      route: {
        protocol: 'messages',
        baseURL: 'https://dashscope.aliyuncs.com/apps/anthropic',
        apiKey: 'cn-secret-key-123456',
        model: 'qwen3.8-max',
      } as never,
      retryBaseDelayMs: 0,
      fetchImpl: async () => new Response('oops cn-secret-key-123456 a@b.com', { status: 200 }),
    });
    const error = await transport.messages
      .create({ model: 'qwen3.8-max', max_tokens: 5, messages: [] } as never)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(QwenTransportError);
    const meta = (error as InstanceType<typeof QwenTransportError>).responseMeta;
    expect(meta?.maskedText).toBe('oops [密钥] [邮箱]');
    expect(Object.keys(error as object)).not.toContain('responseMeta');
    expect(JSON.stringify(error)).not.toContain('oops');
  });

  it('evidence that cannot be gathered never replaces the INVALID_RESPONSE', async () => {
    const circular: Record<string, unknown> = { id: 'm', content: [] };
    circular.self = circular;
    const { createAnthropicCompatibleMessagesAdapter } = await import('./messages-adapter.js');
    const adapter = createAnthropicCompatibleMessagesAdapter({
      client: { messages: { create: async () => circular } } as never,
      metadata: { provider: 'anthropic', model: 'fixture' },
    });
    const error = await adapter.create(REQUEST as never).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MessagesAdapterError);
    expect((error as MessagesAdapterError).code).toBe('INVALID_RESPONSE');
    expect((error as MessagesAdapterError).forensics).toBeUndefined();
  });
});
