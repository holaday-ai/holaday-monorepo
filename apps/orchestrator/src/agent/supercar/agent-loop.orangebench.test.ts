import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const { createMessage } = vi.hoisted(() => ({ createMessage: vi.fn() }));
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    beta = { messages: { create: createMessage } };
  },
}));
import { OrangeBenchTaskClient } from '../orangebench/client.js';
import { ORANGEBENCH_TOOLS } from '../orangebench/contracts.js';
import type { PlaywrightExecutor } from '../vision-loop/playwright-executor.js';
import { runSupercarTask, supercarAbort } from './agent-loop.js';
const P = '33333333-3333-4333-8333-333333333333';
const Q = '44444444-4444-4444-8444-444444444444';
const T = '55555555-5555-4555-8555-555555555555';
const roots: string[] = [];
afterEach(async () => {
  for (const r of roots.splice(0)) await rm(r, { recursive: true, force: true });
});
beforeEach(() => createMessage.mockReset());
function response(content: unknown[], stop_reason = 'tool_use') {
  return {
    id: 'fake-model',
    type: 'message',
    role: 'assistant',
    model: 'fixture',
    content,
    stop_reason,
    usage: {
      input_tokens: 1,
      output_tokens: 1,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
  };
}
export function fixtureExecutor(): PlaywrightExecutor {
  const page = {
    url: () => 'https://example.com/',
    title: async () => 'Fixture',
    evaluate: async () => ({ bodyTextLen: 100, images: 0, inputs: 0, buttons: 0 }),
    goto: vi.fn(),
    mouse: { move: vi.fn(), click: vi.fn(), down: vi.fn(), up: vi.fn() },
    keyboard: { down: vi.fn(), up: vi.fn() },
    waitForTimeout: vi.fn(),
  };
  return {
    resetPageForTask: vi.fn(),
    getPage: async () => page,
    screenshot: async () => ({ base64: 'dGVzdA==', viewportWidth: 1280, viewportHeight: 720 }),
  } as unknown as PlaywrightExecutor;
}
it.each(['missing', 'approve', 'abort'] as const)(
  'actual HOLA loop gates execution with host approval=%s',
  async (mode) => {
    const root = await mkdtemp(join(tmpdir(), 'hd-ob-loop-'));
    roots.push(root);
    const calls: unknown[] = [];
    const rpc = {
      listTools: async () => ({
        tools: ORANGEBENCH_TOOLS.map((name) => ({ name, inputSchema: { type: 'object' } })),
      }),
      readResource: async () => ({
        contents: [
          {
            text: JSON.stringify({
              account_id: '11111111-1111-4111-8111-111111111111',
              key_id: '22222222-2222-4222-8222-222222222222',
              region: 'cn',
              scopes: ['episodes:create'],
              execution_available: true,
            }),
          },
        ],
      }),
      callTool: async (args: { name: string; arguments: Record<string, unknown> }) => {
        calls.push(args);
        const request = args.arguments.request as Record<string, unknown>;
        return {
          structuredContent:
            request.mode === 'execute'
              ? { id: T, project_id: P, capability: 'episodes', state: 'queued' }
              : {
                  id: Q,
                  project_id: P,
                  project_revision: 1,
                  capability: 'episodes',
                  region: 'cn',
                  credits_micro_usd: 100,
                  expires_at: new Date(Date.now() + 600000).toISOString(),
                  execution_available: true,
                },
        };
      },
      close: async () => {},
    };
    const taskId = 'host-task-loop';
    const client = await OrangeBenchTaskClient.open({ taskId, rpc, journalDirectory: root });
    const approval = vi.fn(async (view: { binding: string }) => {
      if (mode === 'abort') {
        expect(supercarAbort(taskId)).toBe(true);
        return new Promise<never>(() => {});
      }
      return { decision: 'approve' as const, binding: view.binding, maximumCreditsMicroUsd: 100 };
    });
    let stage = 0;
    createMessage.mockImplementation(async () => {
      stage++;
      if (stage === 1)
        return response([
          {
            type: 'tool_use',
            id: 'quote',
            name: 'orangebench_generate_episode',
            input: { request: { project_id: P, project_revision: 1 } },
          },
        ]);
      if (stage === 2)
        return response([
          {
            type: 'tool_use',
            id: 'execute',
            name: 'orangebench_generate_episode',
            input: {
              request: {
                project_id: P,
                mode: 'execute',
                quote_id: Q,
                confirm: true,
                max_credits_micro_usd: 100,
                idempotency_key: 'untrusted-model-key',
              },
            },
          },
        ]);
      return response([{ type: 'text', text: 'Fixture complete.' }], 'end_turn');
    });
    try {
      const outcome = await runSupercarTask({
        taskId,
        intent: 'Produce a fictional episode using OrangeBench',
        executor: fixtureExecutor(),
        apiKey: 'mock-only',
        maxIterations: 3,
        orangebench: client,
        onOrangeBenchApproval: mode !== 'missing' ? approval : undefined,
      });
      const tools = createMessage.mock.calls[0]?.[0].tools as Array<{ name: string }>;
      expect(tools.filter((t) => t.name.startsWith('orangebench_')).map((t) => t.name)).toEqual([
        ...ORANGEBENCH_TOOLS,
      ]);
      expect(calls).toHaveLength(mode === 'approve' ? 2 : 1);
      if (mode === 'abort') expect(outcome.status).toBe('cancelled');
      expect(approval).toHaveBeenCalledTimes(mode === 'missing' ? 0 : 1);
      expect(JSON.stringify(createMessage.mock.calls)).not.toContain('obk_');
    } finally {
      await client.close();
    }
  },
);
