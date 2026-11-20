import { type Browser, chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { RunSupercarOptions } from '../supercar/agent-loop.js';
import { misplacedAdLabel } from './ad-label.js';
import { runUnifiedSupercarTask } from './unified-supercar-runner.js';

vi.mock('./browser-replay-service.js', () => ({ browserReplayStore: {} }));

/**
 * G2g BestBuy (local A r5sAr1 / abA 「在 BestBuy 搜 usb c cable 告诉我第一个结果」, screenshot-checked):
 * the first result was said to carry 「Sponsored」 — the label of the DJI ad slot above the list.
 * A label is the result's only when its own card shows it (no price rule involved).
 */
const RESULTS = `<!doctype html><meta charset="utf-8"><title>usb c cable - Best Buy</title>
<div class="banner"><p>Shop smart. These are all best sellers for a reason.</p>
<a href="/site/dji-7p">DJI - Osmo Mobile 7P Smartphone 3-Axis Gimbal Stabilizer - Gray</a><span>$99.00</span>
<div>Sponsored</div></div>
<h1>"usb c cable" in Cell Phones (1825)</h1>
<ul><li><span>Overall Pick</span><h2><a href="/site/insignia">Insignia™ - 8 ft. 240W USB-C to USB-C Charge-and-Sync Braided Cable - Black</a></h2><p>Rating 4.8 out of 5 stars with 111 reviews</p></li>
<li><span>Sponsored</span><h2><a href="/site/j5create">j5create - USB4 40Gbps Full-Featured USB-C Coaxial Cable - Black</a></h2></li></ul>`;

const INSIGNIA = 'Insignia™ - 8 ft. 240W USB-C to USB-C Charge-and-Sync Braided Cable - Black';
const J5 = 'j5create - USB4 40Gbps Full-Featured USB-C Coaxial Cable - Black';

let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch({ headless: true });
});
afterAll(async () => {
  await browser?.close();
});

async function firstResult(answers: string[]) {
  const page = await browser.newPage();
  await page.route('https://www.bestbuy.com/**', (route) =>
    route.fulfill({ contentType: 'text/html; charset=utf-8', body: RESULTS }),
  );
  let turn = 0;
  let finishes = 0;
  const told: string[] = [];
  try {
    const outcome = await runUnifiedSupercarTask({
      browserRescue: false,
      taskId: `g2g-ad-${answers.length}-${answers[0]!.length}`,
      userExternalId: 'fixture-user',
      intent: '在 BestBuy 搜 usb c cable 告诉我第一个结果',
      executor: { getPage: async () => page } as never,
      timeoutMs: 15_000,
      messagesAdapter: {
        metadata: { provider: 'anthropic', model: 'fixture' },
        async create(request: { messages: Array<{ content: unknown }> }) {
          turn += 1;
          told.push(JSON.stringify(request.messages.at(-1)?.content ?? ''));
          const call =
            turn === 1
              ? {
                  name: 'navigate',
                  input: { url: 'https://www.bestbuy.com/site/searchpage.jsp?st=usb+c+cable' },
                }
              : turn === 2
                ? { name: 'snapshot', input: {} }
                : {
                    name: 'finish',
                    input: {
                      status: 'completed',
                      summary: answers[Math.min(finishes++, answers.length - 1)],
                    },
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
    return { outcome, told: told.join('\n') };
  } finally {
    await page.close();
  }
}

describe('G2g BestBuy: an ad label is the result’s only when its own card shows it', () => {
  it('「Sponsored」 from the ad slot above, put on the first result, is sent back once', async () => {
    const wrong = `BestBuy 搜索 "usb c cable" 的第一个结果是：${INSIGNIA}。该结果带有 Overall Pick 和 Sponsored 标识。`;
    const right = `BestBuy 搜索 "usb c cable" 的第一个结果是：${INSIGNIA}，标签：Overall Pick。`;
    const { outcome, told } = await firstResult([wrong, right]);
    expect(told).toContain('读到的该结果自己的条目里没有这个标识');
    expect(outcome.status).toBe('completed');
    expect(outcome.status === 'completed' && outcome.summary).not.toContain('Sponsored');
  }, 30_000);

  it('a result whose own card says Sponsored keeps it (no correction asked)', async () => {
    const answer = `第一个结果（标记为 Sponsored）是：${J5}。`;
    const { outcome, told } = await firstResult([answer]);
    expect(told).not.toContain('读到的该结果自己的条目里没有这个标识');
    expect(outcome.status === 'completed' && outcome.summary).toContain('Sponsored');
  }, 30_000);

  it('judges only what it can tell', () => {
    const tree = (cards: string) =>
      [{ text: `- generic:\n  - generic: Sponsored\n  - list:\n${cards}` }] as never;
    const insignia = `    - listitem:\n      - generic: Overall Pick\n      - link "${INSIGNIA}":\n        - /url: /site/insignia\n`;
    // A negated label, or the slot named apart from the result.
    expect(
      misplacedAdLabel(`第一个结果是 ${INSIGNIA}，它没有 Sponsored 标识。`, tree(insignia)),
    ).toBe(null);
    expect(
      misplacedAdLabel(
        `列表上方是 DJI 的 Sponsored 广告位；第一个结果是 ${INSIGNIA}。`,
        tree(insignia),
      ),
    ).toBe(null);
    // No cards in the read tree, or the answer names none of them: nothing to tell.
    expect(
      misplacedAdLabel(`第一个结果是 ${INSIGNIA}（Sponsored）。`, [
        { text: `- generic: Sponsored\n- link "${INSIGNIA}"` },
      ] as never),
    ).toBe(null);
    expect(misplacedAdLabel('第一个结果是某款线缆（Sponsored）。', tree(insignia))).toBe(null);
    expect(
      misplacedAdLabel(`第一个结果是广告位（Sponsored）商品：${INSIGNIA}。`, tree(insignia)),
    ).toMatch(/Sponsored/);
  });
});
