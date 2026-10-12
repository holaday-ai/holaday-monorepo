import { chromium } from 'playwright';
import { expect, it } from 'vitest';
import type { SupercarTickEvent } from '../supercar/agent-loop.js';
import { runUnifiedSupercarTask, unifiedSupercarAbort } from './unified-supercar-runner.js';

it('persists the sanitized wall source as a host-owned execution step before handoff', async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.route('**/*', (r) =>
    r.fulfill({
      contentType: 'text/html; charset=utf-8',
      body: '<h1>Sign in to continue</h1><input type="password">',
    }),
  );
  await page.goto('https://accounts.example.test/signin?token=private');
  const taskId = 'login-evidence';
  const ticks: SupercarTickEvent[] = [];
  const running = runUnifiedSupercarTask({
    taskId,
    userExternalId: 'owner',
    intent: 'Read public data',
    executor: { getPage: async () => page } as never,
    browserCapabilities: {
      observationV2: true,
      viewportV2: true,
      replayV1: false,
      routingV2: true,
    },
    messagesAdapter: {
      metadata: { provider: 'anthropic', model: 'scripted' },
      async create() {
        return {
          id: 'one',
          metadata: this.metadata,
          content: [{ type: 'tool_use', id: 'one', name: 'snapshot', input: {} }],
          stopReason: 'tool_use',
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
    onTick: (e) => {
      ticks.push(e);
    },
  });
  try {
    expect(await running).toMatchObject({ status: 'awaiting_user' });
    expect(ticks).toContainEqual(
      expect.objectContaining({
        execution: expect.objectContaining({
          actionKind: 'browser_blocker',
          errorCode: 'browser_login_wall',
          blockerEvidence: {
            frameHost: 'accounts.example.test',
            framePath: '/signin',
            rule: 'login:url-host:accounts.',
            visible: true,
            scope: 'document',
          },
        }),
      }),
    );
    expect(
      JSON.stringify(ticks.filter((t) => t.execution?.actionKind === 'browser_blocker')),
    ).not.toMatch(/private|token=/);
  } finally {
    unifiedSupercarAbort(taskId);
    await running;
    await browser.close();
  }
});
