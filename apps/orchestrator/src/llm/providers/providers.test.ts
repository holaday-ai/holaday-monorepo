import { describe, expect, it, vi } from 'vitest';
import { type MessagesAdapter, MessagesAdapterError } from '../messages-adapter.js';
import { ResponsesAdapterError } from '../responses-adapter.js';
import { createMessagesBackedResponsesAdapter } from './messages-backed-responses-adapter.js';
import {
  createOpenAIMessagesAdapter,
  normalizeChatCompletion,
  toChatCompletionRequest,
} from './openai-messages-adapter.js';
import {
  createOpenAIResponsesAdapter,
  toOpenAIResponsesRequest,
} from './openai-responses-adapter.js';

describe('OpenAI messages adapter', () => {
  it('maps neutral tool turns onto Chat Completions', () => {
    const request = toChatCompletionRequest(
      {
        maxTokens: 512,
        system: [{ type: 'text', text: 'be brief' }],
        messages: [
          { role: 'user', content: 'open example.com' },
          {
            role: 'assistant',
            content: [
              {
                type: 'tool_use',
                id: 'call_1',
                name: 'navigate',
                input: { url: 'https://example.com' },
              },
            ],
          },
          {
            role: 'user',
            content: [
              { type: 'tool_result', toolUseId: 'call_1', content: 'ok' },
              { type: 'image', source: { kind: 'base64', mediaType: 'image/png', data: 'AAAA' } },
            ],
          },
        ],
        tools: [{ name: 'navigate', description: 'go', inputSchema: { type: 'object' } }],
        toolChoice: { type: 'any' },
      },
      'gpt-4o',
    );
    expect(request).toMatchObject({
      model: 'gpt-4o',
      max_completion_tokens: 512,
      tool_choice: 'required',
      tools: [{ type: 'function', function: { name: 'navigate', parameters: { type: 'object' } } }],
    });
    expect(request.messages).toEqual([
      { role: 'system', content: 'be brief' },
      { role: 'user', content: 'open example.com' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call_1',
            type: 'function',
            function: { name: 'navigate', arguments: '{"url":"https://example.com"}' },
          },
        ],
      },
      { role: 'tool', tool_call_id: 'call_1', content: 'ok' },
      {
        role: 'user',
        content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } }],
      },
    ]);
  });

  it('normalizes tool calls, stop reasons and usage', () => {
    const response = normalizeChatCompletion(
      {
        id: 'chatcmpl_1',
        choices: [
          {
            finish_reason: 'tool_calls',
            message: {
              content: null,
              tool_calls: [{ id: 'call_2', function: { name: 'click', arguments: '{"x":1}' } }],
            },
          },
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 3,
          prompt_tokens_details: { cached_tokens: 4 },
        },
      },
      { provider: 'openai', model: 'gpt-4o' },
    );
    expect(response.content).toEqual([
      { type: 'tool_use', id: 'call_2', name: 'click', input: { x: 1 } },
    ]);
    expect(response.stopReason).toBe('tool_use');
    expect(response.usage).toMatchObject({
      inputTokens: 10,
      outputTokens: 3,
      cacheReadInputTokens: 4,
      complete: true,
    });
  });

  it('maps provider failures onto neutral error codes without leaking details', async () => {
    const create = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error('secret upstream text'), { status: 504 }));
    const adapter = createOpenAIMessagesAdapter({
      apiKey: 'synthetic',
      model: 'gpt-4o',
      clientFactory: () => ({ chat: { completions: { create } } }),
    });
    await expect(
      adapter.create({ maxTokens: 10, messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toMatchObject({
      code: 'REQUEST_TIMEOUT',
      message: 'Message provider request timed out',
    });
  });
});

describe('OpenAI responses adapter', () => {
  it('streams text deltas and collects cited sources', async () => {
    async function* events() {
      yield { type: 'response.output_text.delta', delta: '你好' };
      yield {
        type: 'response.completed',
        response: {
          id: 'resp_1',
          status: 'completed',
          usage: { input_tokens: 5, output_tokens: 2 },
          output: [
            {
              type: 'message',
              content: [
                {
                  type: 'output_text',
                  text: '你好',
                  annotations: [{ type: 'url_citation', url: 'https://example.com/a', title: 'A' }],
                },
              ],
            },
          ],
        },
      };
    }
    const create = vi.fn().mockResolvedValue(events());
    const deltas: string[] = [];
    const adapter = createOpenAIResponsesAdapter({
      apiKey: 'synthetic',
      model: 'gpt-4o',
      clientFactory: () => ({ responses: { create } }),
    });
    const result = await adapter.stream(
      { input: 'hi', tools: [{ type: 'web_search' }] },
      { onTextDelta: (delta) => deltas.push(delta) },
    );
    expect(create.mock.calls[0]?.[0]).toMatchObject({
      tools: [{ type: 'web_search_preview' }],
      stream: true,
    });
    expect(deltas).toEqual(['你好']);
    expect(result).toMatchObject({
      text: '你好',
      status: 'completed',
      sources: [{ title: 'A', url: 'https://example.com/a', provenance: 'web_search' }],
      metadata: { provider: 'openai', model: 'gpt-4o', protocol: 'responses' },
    });
  });

  it('drops unsupported builtin tools from the request', () => {
    expect(
      toOpenAIResponsesRequest({ input: 'x', tools: [{ type: 'code_interpreter' }] }, 'gpt-4o'),
    ).not.toHaveProperty('tools');
  });
});

describe('messages-backed responses adapter (Claude generation lanes)', () => {
  const messages = (create: MessagesAdapter['create']): MessagesAdapter => ({
    metadata: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
    create,
  });

  it('answers a Responses request through one Messages call', async () => {
    const create = vi.fn().mockResolvedValue({
      id: 'msg_1',
      metadata: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
      content: [{ type: 'text', text: '结果' }],
      stopReason: 'max_tokens',
      usage: {
        inputTokens: 9,
        outputTokens: 4,
        cacheReadInputTokens: null,
        cacheCreationInputTokens: null,
        complete: true,
      },
    });
    const adapter = createMessagesBackedResponsesAdapter({
      messages: messages(create),
      provider: 'anthropic',
    });
    const deltas: string[] = [];
    const result = await adapter.stream(
      {
        instructions: 'sys',
        input: [{ role: 'user', content: [{ type: 'input_text', text: '写' }] }],
        maxOutputTokens: 100,
      },
      { onTextDelta: (delta) => deltas.push(delta) },
    );
    expect(create.mock.calls[0]?.[0]).toMatchObject({
      system: 'sys',
      maxTokens: 100,
      messages: [{ role: 'user', content: [{ type: 'text', text: '写' }] }],
    });
    expect(deltas).toEqual(['结果']);
    expect(result).toMatchObject({
      text: '结果',
      status: 'incomplete',
      incompleteReason: 'max_output_tokens',
      sources: [],
    });
  });

  it('maps messages errors onto responses errors', async () => {
    const adapter = createMessagesBackedResponsesAdapter({
      messages: messages(
        vi.fn().mockRejectedValue(new MessagesAdapterError('REQUEST_ABORTED', 'x')),
      ),
      provider: 'anthropic',
    });
    await expect(adapter.stream({ input: 'x' })).rejects.toBeInstanceOf(ResponsesAdapterError);
    await expect(adapter.stream({ input: 'x' })).rejects.toMatchObject({ code: 'REQUEST_ABORTED' });
  });
});
