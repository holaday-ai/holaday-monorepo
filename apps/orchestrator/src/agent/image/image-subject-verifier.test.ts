import { describe, expect, it, vi } from 'vitest';
import { createAnthropicSubjectConsistencyVerifier } from './image-subject-verifier.js';

function input() {
  return {
    subject: { data: 'SUBJECT_BASE64', mimeType: 'image/jpeg' },
    candidate: { buffer: Buffer.from('CANDIDATE'), mimeType: 'image/png' },
    intent: '把背景换成电影夜景',
  };
}

describe('createAnthropicSubjectConsistencyVerifier', () => {
  it('passes a high-confidence same-subject tool verdict', async () => {
    const create = vi.fn().mockResolvedValue({
      content: [
        {
          type: 'tool_use',
          name: 'assess_subject_consistency',
          input: { same_subject: true, confidence: 0.94, reason: '关键身份特征一致' },
        },
      ],
    });
    const verify = createAnthropicSubjectConsistencyVerifier({ messages: { create } } as never);

    await expect(verify(input())).resolves.toEqual({
      status: 'pass',
      confidence: 0.94,
      reason: '关键身份特征一致',
    });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        tool_choice: { type: 'tool', name: 'assess_subject_consistency' },
      }),
      expect.objectContaining({ timeout: 45_000, maxRetries: 2 }),
    );
  });

  it('fails closed on a low-confidence or malformed verdict', async () => {
    const lowConfidence = vi.fn().mockResolvedValue({
      content: [
        {
          type: 'tool_use',
          name: 'assess_subject_consistency',
          input: { same_subject: true, confidence: 0.51, reason: '脸部特征模糊' },
        },
      ],
    });
    const verifyLow = createAnthropicSubjectConsistencyVerifier({
      messages: { create: lowConfidence },
    } as never);
    await expect(verifyLow(input())).resolves.toMatchObject({
      status: 'fail',
      confidence: 0.51,
    });

    const malformed = vi.fn().mockResolvedValue({ content: [] });
    const verifyMalformed = createAnthropicSubjectConsistencyVerifier({
      messages: { create: malformed },
    } as never);
    await expect(verifyMalformed(input())).resolves.toMatchObject({
      status: 'unknown',
      confidence: null,
    });
  });
});
