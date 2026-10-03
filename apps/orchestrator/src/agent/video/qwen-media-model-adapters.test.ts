import { describe, expect, it, vi } from 'vitest';
import type { MessagesAdapter, NeutralMessagesResponse } from '../../llm/messages-adapter.js';
import { createMessagesSubjectConsistencyVerifier } from '../image/image-subject-verifier.js';
import { createMessagesVideoQualityAnalyzer } from './video-quality-verifier.js';
import { createMessagesScriptLlm } from './video-script.js';

function adapter(content: NeutralMessagesResponse['content']): {
  adapter: MessagesAdapter;
  create: ReturnType<typeof vi.fn>;
} {
  const create = vi.fn(async () => ({
    id: 'r',
    metadata: { provider: 'openai' as const, model: 'qwen3.8-max' },
    content,
    stopReason: 'tool_use' as const,
    usage: {
      inputTokens: 1,
      outputTokens: 1,
      cacheReadInputTokens: null,
      cacheCreationInputTokens: null,
      complete: true,
    },
  }));
  return {
    adapter: { metadata: { provider: 'openai', model: 'qwen3.8-max' }, create },
    create,
  };
}

describe('Qwen (Messages adapter) replacements for the legacy Anthropic media calls', () => {
  it('script LLM sends system + user and concatenates text blocks', async () => {
    const { adapter: a, create } = adapter([
      { type: 'text', text: '{"title":' },
      { type: 'text', text: '"x"}' },
    ]);
    await expect(createMessagesScriptLlm(a)({ system: 'S', user: 'U' })).resolves.toBe(
      '{"title":"x"}',
    );
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ system: 'S', messages: [{ role: 'user', content: 'U' }] }),
      expect.objectContaining({ maxRetries: 2 }),
    );
  });

  it('video quality analyzer forces the verdict tool and sends frames as base64 images', async () => {
    const { adapter: a, create } = adapter([
      {
        type: 'tool_use',
        id: 't',
        name: 'submit_video_quality_verdict',
        input: { status: 'pass' },
      },
    ]);
    const out = await createMessagesVideoQualityAnalyzer(a)({
      references: [],
      frames: [{ data: 'JPG', mediaType: 'image/jpeg', timestampSeconds: 1 }],
      prompt: '验收',
    });
    expect(JSON.parse(out)).toEqual({ status: 'pass' });
    const request = (create.mock.calls[0] as unknown[])[0] as {
      toolChoice: unknown;
      messages: Array<{ content: Array<{ type: string; source?: unknown }> }>;
    };
    expect(request.toolChoice).toEqual({ type: 'tool', name: 'submit_video_quality_verdict' });
    expect(request.messages[0]?.content.find((b) => b.type === 'image')?.source).toEqual({
      kind: 'base64',
      mediaType: 'image/jpeg',
      data: 'JPG',
    });
  });

  it('video quality analyzer returns empty text when the tool was not called', async () => {
    const { adapter: a } = adapter([{ type: 'text', text: 'no tool' }]);
    await expect(
      createMessagesVideoQualityAnalyzer(a)({ references: [], frames: [], prompt: 'p' }),
    ).resolves.toBe('');
  });

  it('subject verifier passes high-confidence verdicts and fails closed otherwise', async () => {
    const input = {
      subject: { data: 'A', mimeType: 'image/jpeg' },
      candidate: { buffer: Buffer.from('B'), mimeType: 'image/png' },
      intent: '换背景',
    };
    const pass = adapter([
      {
        type: 'tool_use',
        id: 't',
        name: 'assess_subject_consistency',
        input: { same_subject: true, confidence: 0.92, reason: '一致' },
      },
    ]);
    await expect(createMessagesSubjectConsistencyVerifier(pass.adapter)(input)).resolves.toEqual({
      status: 'pass',
      confidence: 0.92,
      reason: '一致',
    });
    const low = adapter([
      {
        type: 'tool_use',
        id: 't',
        name: 'assess_subject_consistency',
        input: { same_subject: true, confidence: 0.4, reason: '模糊' },
      },
    ]);
    await expect(createMessagesSubjectConsistencyVerifier(low.adapter)(input)).resolves.toMatchObject({
      status: 'fail',
    });
    const broken: MessagesAdapter = {
      metadata: { provider: 'openai', model: 'qwen3.8-max' },
      create: vi.fn(async () => {
        throw new Error('timeout');
      }),
    };
    await expect(createMessagesSubjectConsistencyVerifier(broken)(input)).resolves.toMatchObject({
      status: 'unknown',
    });
  });
});
