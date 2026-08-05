import type Anthropic from '@anthropic-ai/sdk';
import type {
  SubjectConsistencyVerdict,
  VerifySubjectFn,
} from './image-runner.js';

const VERIFY_MODEL = 'claude-sonnet-4-6';
const PASS_CONFIDENCE = 0.8;
const TOOL_NAME = 'assess_subject_consistency';

const SUBJECT_CONSISTENCY_TOOL = {
  name: TOOL_NAME,
  description:
    'Compare the identity anchor with the generated candidate and return a strict subject-consistency verdict.',
  input_schema: {
    type: 'object' as const,
    properties: {
      same_subject: { type: 'boolean' as const },
      confidence: { type: 'number' as const, minimum: 0, maximum: 1 },
      reason: { type: 'string' as const },
    },
    required: ['same_subject', 'confidence', 'reason'],
    additionalProperties: false,
  },
};

function normalizeMediaType(
  mimeType: string,
): 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' {
  const normalized = mimeType.toLowerCase().split(';', 1)[0]?.trim();
  if (normalized === 'image/jpeg' || normalized === 'image/jpg') return 'image/jpeg';
  if (normalized === 'image/gif') return 'image/gif';
  if (normalized === 'image/webp') return 'image/webp';
  return 'image/png';
}

function unknown(reason: string): SubjectConsistencyVerdict {
  return { status: 'unknown', confidence: null, reason };
}

export function createAnthropicSubjectConsistencyVerifier(
  client: Anthropic,
): VerifySubjectFn {
  return async ({ subject, candidate, intent }) => {
    try {
      const response = await client.messages.create(
        {
          model: VERIFY_MODEL,
          max_tokens: 256,
          tools: [SUBJECT_CONSISTENCY_TOOL],
          tool_choice: { type: 'tool', name: TOOL_NAME },
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: '图 A：用户明确指定的身份锚点。' },
                {
                  type: 'image',
                  source: {
                    type: 'base64',
                    media_type: normalizeMediaType(subject.mimeType),
                    data: subject.data,
                  },
                },
                { type: 'text', text: '图 B：待交付的生成结果。' },
                {
                  type: 'image',
                  source: {
                    type: 'base64',
                    media_type: normalizeMediaType(candidate.mimeType),
                    data: candidate.buffer.toString('base64'),
                  },
                },
                {
                  type: 'text',
                  text:
                    `用户要求：${intent}\n\n` +
                    '严格判断图 B 是否仍是图 A 的同一主体。主体可能是人物、宠物、商品或 IP。' +
                    '允许背景、光线、姿态、动作、镜头与绘画风格变化；不得因风格变化而放宽身份判断。' +
                    '重点比较脸型五官、毛色花纹、体态比例、商品结构、Logo/包装关键特征或 IP 核心造型。' +
                    '若关键身份特征被替换、重塑、混入其他参考图主体，same_subject 必须为 false。',
                },
              ],
            },
          ],
        },
        { timeout: 45_000, maxRetries: 2 },
      );
      const block = response.content.find(
        (item): item is Anthropic.ToolUseBlock =>
          item.type === 'tool_use' && item.name === TOOL_NAME,
      );
      if (!block || typeof block.input !== 'object' || block.input === null) {
        return unknown('复核模型未返回结构化结论');
      }
      const value = block.input as Record<string, unknown>;
      const sameSubject = value.same_subject === true;
      const confidence =
        typeof value.confidence === 'number' && Number.isFinite(value.confidence)
          ? Math.max(0, Math.min(1, value.confidence))
          : null;
      const reason =
        typeof value.reason === 'string' && value.reason.trim()
          ? value.reason.trim().slice(0, 500)
          : '复核模型未说明原因';
      if (confidence === null) return unknown(reason);
      return {
        status: sameSubject && confidence >= PASS_CONFIDENCE ? 'pass' : 'fail',
        confidence,
        reason,
      };
    } catch (error) {
      return unknown(error instanceof Error ? error.message : '主体一致性复核请求失败');
    }
  };
}

export { PASS_CONFIDENCE as SUBJECT_CONSISTENCY_PASS_CONFIDENCE };
