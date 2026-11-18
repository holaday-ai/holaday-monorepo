import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { MessagesAdapter, NeutralMessagesRequest } from '../../llm/messages-adapter.js';

/** Explicit network opt-in. Scripted model, actual public page/executor/action and finish gates. */
describe.runIf(process.env.HOLADAY_PUBLIC_SESSION_COMPAT === '1')(
  'public form session compatibility',
  () => {
    it('prepares the named public form without a Vault profile, submission or external model call', async () => {
      if (process.version !== 'v22.23.3')
        throw new Error('Requires production-matching Node22.23.3');
      const root = await mkdtemp(join(tmpdir(), 'ba-public-session-'));
      const artifacts = process.env.HOLADAY_E2E_ARTIFACT_DIR ?? join(root, 'artifacts');
      await mkdir(artifacts, { recursive: true });
      vi.stubEnv('HOLADAY_DISABLE_ENV_FILE', 'true');
      vi.stubEnv('NODE_ENV', 'test');
      vi.stubEnv('DATABASE_URL', 'mysql://fixture:fixture@127.0.0.1:9/fixture');
      vi.stubEnv('REDIS_URL', 'redis://127.0.0.1:9');
      vi.stubEnv('JWT_SECRET', 'synthetic-public-session-compat-only');
      vi.stubEnv('BROWSER_OBSERVATION_V2', 'true');
      vi.stubEnv('BROWSER_PROFILE_PERSIST_V1', 'false');
      const { PlaywrightExecutor } = await import('../vision-loop/playwright-executor.js');
      const { runUnifiedSupercarTask } = await import('./unified-supercar-runner.js');
      const executor = new PlaywrightExecutor();
      let postRequests = 0;
      let modelAttempts = 0;
      const evidence: Record<string, unknown> = {
        node: process.version,
        externalModelCalls: 0,
        site: 'https://httpbin.org/forms/post',
        profile: 'none, fresh anonymous managed browser',
      };
      try {
        expect(await executor.launchManaged()).toEqual({ ok: true });
        const page = await executor.getPage();
        page.on('request', (request) => {
          if (request.method() === 'POST') postRequests++;
        });
        const metadata = { provider: 'anthropic' as const, model: 'scripted-public-compat' };
        const ref = (request: NeutralMessagesRequest) => {
          const line = JSON.stringify(request.messages.at(-1))
            .split('\\n')
            .find((value) => /textbox.*Customer name/i.test(value));
          const value = line?.match(/\[ref=(e\d+)\]/)?.[1];
          if (!value) throw new Error('Customer name ref missing from actual snapshot');
          return value;
        };
        const adapter: MessagesAdapter = {
          metadata,
          async create(request) {
            modelAttempts++;
            const action =
              modelAttempts === 1
                ? { name: 'navigate', input: { url: 'https://httpbin.org/forms/post' } }
                : modelAttempts === 2
                  ? { name: 'snapshot', input: {} }
                  : modelAttempts === 3
                    ? {
                        name: 'type',
                        input: { ref: ref(request), text: 'Session QA', submit: false },
                      }
                    : modelAttempts === 4
                      ? { name: 'snapshot', input: {} }
                      : modelAttempts === 5
                        ? { name: 'screenshot', input: {} }
                        : {
                            name: 'finish',
                            input: {
                              status: 'completed',
                              summary:
                                '已在 httpbin.org/forms/post 填写 Customer name=Session QA，未提交并截图。页面没有日期控件。',
                              evidence: 'Session QA',
                            },
                          };
            if (modelAttempts > 7) throw new Error('Script exhausted');
            return {
              id: randomUUID(),
              metadata,
              content: [{ type: 'tool_use', id: `public-${modelAttempts}`, ...action }],
              stopReason: 'tool_use',
              usage: {
                inputTokens: 0,
                outputTokens: 0,
                cacheReadInputTokens: 0,
                cacheCreationInputTokens: 0,
                complete: true,
              },
            };
          },
        };
        const started = Date.now();
        const result = await runUnifiedSupercarTask({
          taskId: `public-session-${randomUUID()}`,
          intent:
            '请使用云端浏览器，在 https://httpbin.org/forms/post 填写 Customer name=Session QA 和日期控件，只填不提交并截图；如果没有日期控件，如实说明。',
          executor,
          messagesAdapter: adapter,
          maxIterations: 7,
        });
        Object.assign(evidence, {
          result,
          elapsedMs: Date.now() - started,
          modelAttempts,
          postRequests,
        });
        expect(result.status).toBe('completed');
        expect(result).toMatchObject({ partial: { missing: '日期控件' } });
        expect(result.status === 'completed' && result.summary).toContain('部分完成');
        expect(page.url()).toBe('https://httpbin.org/forms/post');
        expect(await page.locator('input[name="custname"]').inputValue()).toBe('Session QA');
        expect(await page.locator('input[type="date"]').count()).toBe(0);
        expect(postRequests).toBe(0);
        await page.screenshot({ path: join(artifacts, 'public-form-prepared-not-submitted.png') });
        evidence.actualFieldVerified = true;
        evidence.noDateControlVerified = true;
      } finally {
        await executor.disconnect();
        evidence.closed = true;
        await writeFile(join(artifacts, 'public-evidence.json'), JSON.stringify(evidence, null, 2));
        vi.unstubAllEnvs();
        await rm(root, { recursive: true, force: true });
      }
    }, 90_000);
  },
);
