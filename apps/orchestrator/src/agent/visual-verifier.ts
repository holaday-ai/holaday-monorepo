/**
 * Visual verifier — uses a vision call to judge whether a task's
 * latest screenshot reflects success, partial progress, or failure.
 *
 * Wraps an Anthropic Sonnet call with one image + a 4-choice prompt
 * (SUCCESS / PARTIAL / FAILED / UNKNOWN). The verifier never throws —
 * it returns 'unknown' on any error (network, malformed response,
 * missing client). Callers gate decisions on the returned label.
 *
 * Cost: each call ≈ 1 image + ≈ 200 output tokens on Sonnet 4.6 (a
 * few cents per call). DO NOT call after every iteration — gate on
 * step boundaries (every N ticks or at task_done) so total cost
 * stays bounded. The default integration in task-runner only verifies
 * at terminal states, not mid-loop.
 *
 * Off by default. Set `VISUAL_VERIFIER_ENABLED=1` in env to wire
 * the verifier into the loop. Without that flag the function exists
 * but isn't called — keeps API costs unchanged for prod tasks until
 * BOSS opts in via env flip.
 */

import type Anthropic from '@anthropic-ai/sdk';

export type VerificationLabel = 'success' | 'partial' | 'failed' | 'unknown';

const VERIFY_MODEL = 'claude-sonnet-4-6';

const PROMPT_TEMPLATE = (intent: string): string =>
  `你是一个任务验证器。用户的任务是："${intent}"

请根据截图判断任务执行状态：
- 如果截图显示任务已成功完成（目标页面已打开、信息已找到、表单已填写等），回复 SUCCESS
- 如果截图显示部分完成（正在加载、中间步骤），回复 PARTIAL
- 如果截图显示明显失败（错误页面、空白页、反爬拦截、CAPTCHA），回复 FAILED
- 如果无法判断，回复 UNKNOWN

只回复一个词：SUCCESS / PARTIAL / FAILED / UNKNOWN`;

export interface VerifyOptions {
  /** Anthropic SDK client. Required. */
  client: Anthropic;
  /** Base64-encoded screenshot bytes (no data: prefix). Required. */
  screenshotBase64: string;
  /** Original user intent. Used to ground the verification prompt. */
  intent: string;
  /** Override media type — default 'image/png'. JPEG screenshots OK too. */
  mediaType?: 'image/png' | 'image/jpeg';
}

export async function verifyWithVision(
  opts: VerifyOptions,
): Promise<VerificationLabel> {
  if (!opts.client || !opts.screenshotBase64 || !opts.intent) return 'unknown';
  try {
    const response = await opts.client.messages.create({
      model: VERIFY_MODEL,
      max_tokens: 32,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: opts.mediaType ?? 'image/png',
                data: opts.screenshotBase64,
              },
            },
            {
              type: 'text',
              text: PROMPT_TEMPLATE(opts.intent),
            },
          ],
        },
      ],
    });
    const block = response.content.find((b) => b.type === 'text');
    const text = block && block.type === 'text' ? block.text.trim().toUpperCase() : '';
    if (text.includes('SUCCESS')) return 'success';
    if (text.includes('PARTIAL')) return 'partial';
    if (text.includes('FAILED')) return 'failed';
    return 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Env gate. Call sites read this before invoking `verifyWithVision`
 * so the default is "no extra API calls". Flip via `VISUAL_VERIFIER_ENABLED=1`.
 */
export function isVisualVerifierEnabled(): boolean {
  const v = process.env.VISUAL_VERIFIER_ENABLED;
  return v === '1' || v === 'true';
}
