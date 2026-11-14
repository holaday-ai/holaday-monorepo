import { type Browser, chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { RunSupercarOptions } from '../supercar/agent-loop.js';
import { runUnifiedSupercarTask } from './unified-supercar-runner.js';

vi.mock('./browser-replay-service.js', () => ({ browserReplayStore: {} }));

/**
 * G2g (REBUILD-4 本机验收 2026-11-13, tsk_Rogoz5VGbEiqodiH44vat): on a task with an open form, the
 * follow-up 「看一下表单各个框里填了什么…不要修改也不要提交」 was refused twice with 「没有实际填表回执」
 * and failed although its answer was right. The completion check read the follow-up's full
 * intent — the parent task's 「填写」 in its context block — as this turn's request.
 */
const FORM = `<!doctype html><meta charset="utf-8"><title>Order form</title>
<form><label>Customer name: <input name="custname"></label>
<label>Telephone: <input name="custtel"></label><button>Submit order</button></form>`;

const OWN_WORDS = '看一下表单各个框里填了什么，告诉我每个框的内容，不要修改也不要提交';
const PARENT_CONTEXT = [
  '---',
  '【追问上下文】',
  '前一个任务："请使用云端浏览器，打开 https://forms.example/order 填写表单：Customer name 填 张三，不要提交"',
  '前一个任务结果：已打开表单页面',
  '---',
  '',
].join('\n');
const ANSWER =
  '表单里 Customer name 和 Telephone 两个框目前都是空的，我只看了，没有修改也没有提交。';

let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch({ headless: true });
});
afterAll(async () => {
  await browser?.close();
});

async function followUp(userIntent: string | undefined) {
  const page = await browser.newPage();
  await page.route('https://forms.example/**', (route) =>
    route.fulfill({ contentType: 'text/html; charset=utf-8', body: FORM }),
  );
  let turn = 0;
  const calls = [
    { name: 'navigate', input: { url: 'https://forms.example/order' } },
    { name: 'snapshot', input: {} },
  ];
  try {
    return await runUnifiedSupercarTask({
      browserRescue: false,
      taskId: `g2g-read-form-${userIntent ? 'own' : 'full'}`,
      userExternalId: 'fixture-user',
      intent: `${PARENT_CONTEXT}${OWN_WORDS}`,
      ...(userIntent ? { userIntent } : {}),
      executor: { getPage: async () => page } as never,
      timeoutMs: 15_000,
      messagesAdapter: {
        metadata: { provider: 'anthropic', model: 'fixture' },
        async create() {
          turn += 1;
          const call = calls[turn - 1] ?? {
            name: 'finish',
            input: { status: 'completed', summary: ANSWER },
          };
          return {
            id: String(turn),
            metadata: this.metadata,
            stopReason: 'tool_use',
            content: [{ type: 'tool_use', id: String(turn), ...call }],
            usage: {
              inputTokens: 0,
              outputTokens: 0,
              cacheReadInputTokens: null,
              cacheCreationInputTokens: null,
              complete: true,
            },
          };
        },
      },
    } as unknown as RunSupercarOptions);
  } finally {
    await page.close();
  }
}

describe('G2g: a read-only follow-up about a form is not held to the form-fill receipt', () => {
  it('the user’s own words this turn ask nothing filled: the answer is delivered', async () => {
    const outcome = await followUp(OWN_WORDS);
    expect(outcome.status).toBe('completed');
    expect(outcome.status === 'completed' && outcome.summary).toContain('目前都是空的');
  }, 30_000);

  it('without them (only the full intent), the parent’s 「填写」 is still what the check reads', async () => {
    const outcome = await followUp(undefined);
    expect(outcome.status).not.toBe('completed');
  }, 30_000);
});

describe('G2g: tasks.create gives the browser run the user’s own words', () => {
  it('the cloud-browser run carries userIntent: input.intent beside the full intent', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('../../trpc/routers/tasks.ts', import.meta.url), 'utf8');
    const args = source.slice(
      source.indexOf('const supercarArgs: Parameters<typeof runSupercarTask>[0] = {'),
    );
    expect(args.slice(0, 6000)).toMatch(
      /intent: effectiveIntent,[^\n]*\n(?:\s*\/\/[^\n]*\n)*\s*userIntent: input\.intent,/,
    );
  });
});
