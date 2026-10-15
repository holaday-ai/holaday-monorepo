import { describe, expect, it, vi } from 'vitest';
import type { MessagesAdapter } from '../../llm/messages-adapter.js';
import { CHALLENGE_HINTS } from '../supercar/captcha-challenge.js';
import { runUnifiedBrowserLoop } from './unified-browser-loop.js';

/** CAPTCHA-REDUCE-1: who is asked to solve a wall, and how it ends. */
const scripted = (calls: Array<{ name: string; input: Record<string, unknown> }>) => {
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
};
const wall = {
  reason: 'captcha' as const,
  message: '页面遇到机器人验证或验证码',
  evidence: { rule: 'captcha:url:/sorry/', scope: 'document' as const, visible: true },
};

describe('a search wall the fallback can answer is not handed to the user', () => {
  it('pauses for the fallback instead of starting a handoff', async () => {
    const handoff = vi.fn(async () => true);
    const { adapter } = scripted([
      { name: 'navigate', input: { url: 'https://www.google.com/search?q=x' } },
    ]);
    const outcome = await runUnifiedBrowserLoop({
      intent: 'Google 搜索「x」',
      adapter,
      maxSteps: 3,
      execute: async () => ({
        ok: true,
        text: '已打开',
        url: 'https://www.google.com/sorry/index',
      }),
      probeBlocker: async () => wall as never,
      captchaHandoff: handoff,
      captchaHandoffWanted: () => false,
    });
    expect(handoff).not.toHaveBeenCalled();
    expect(outcome).toMatchObject({ status: 'awaiting_user' });
  });
  it('still hands a non-replaceable wall to the user', async () => {
    let up = true;
    const handoff = vi.fn(async () => {
      up = false;
      return true;
    });
    const { adapter } = scripted([
      { name: 'navigate', input: { url: 'https://shop.test/item' } },
      { name: 'snapshot', input: {} },
      { name: 'finish', input: { status: 'failed', summary: '未完成' } },
    ]);
    await runUnifiedBrowserLoop({
      intent: '打开 https://shop.test/item 读价格',
      adapter,
      maxSteps: 4,
      execute: async () => ({ ok: true, text: 'heading "Item"', url: 'https://shop.test/item' }),
      probeBlocker: async () => (up ? (wall as never) : null),
      captchaHandoff: handoff,
      captchaHandoffWanted: () => true,
    });
    expect(handoff).toHaveBeenCalledTimes(1);
  });
});

describe('after two failed rounds the user can continue another way', () => {
  it('resumes the agent with an instruction to leave the walled page', async () => {
    let up = true;
    const { adapter, seen } = scripted([
      { name: 'navigate', input: { url: 'https://shop.test/item' } },
      { name: 'finish', input: { status: 'failed', summary: '该页面有验证码，只能如实说明' } },
    ]);
    const outcome = await runUnifiedBrowserLoop({
      intent: '打开 https://shop.test/item 读价格',
      adapter,
      maxSteps: 4,
      execute: async () => ({ ok: true, text: 'heading "Item"', url: 'https://shop.test/item' }),
      probeBlocker: async () => (up ? (wall as never) : null),
      captchaHandoff: async () => {
        up = false;
        return 'alternate';
      },
    });
    expect(seen.join('\n')).toContain('换个方式继续');
    expect(outcome).toMatchObject({ status: 'failed' });
  });
});

describe('challenge hints', () => {
  it('give one actionable sentence per challenge kind', () => {
    expect(CHALLENGE_HINTS.recaptcha_image).toContain('新图里还有也要点');
    expect(CHALLENGE_HINTS.recaptcha_image).toContain('耳机');
    for (const hint of Object.values(CHALLENGE_HINTS)) expect(hint.length).toBeLessThan(90);
  });
});
