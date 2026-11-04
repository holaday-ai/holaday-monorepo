/** Launched ONLY by OrangeBench's isolated API/DB fixture acceptance. */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
const { createMessage } = vi.hoisted(() => ({ createMessage: vi.fn() }));
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    beta = { messages: { create: createMessage } };
  },
}));
import { runSupercarTask } from '../supercar/agent-loop.js';
import type { PlaywrightExecutor } from '../vision-loop/playwright-executor.js';
import { ORANGEBENCH_TOOLS } from './contracts.js';
import { loadOrangeBenchClient } from './stdio.js';
const enabled = process.env.OB_HOLA_FIXTURE_ENABLED === '1';
function response(content: unknown[], stop_reason = 'tool_use') {
  return {
    id: 'fixture-model',
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
it.skipIf(!enabled)(
  'HOLA actual loop → Node SDK → Python stdio → actual isolated API/DB',
  async () => {
    const root = await mkdtemp(join(tmpdir(), 'hd-ob-stdio-'));
    const taskId = 'holaday-fixture-client';
    const url = process.env.ORANGEBENCH_API_URL ?? '';
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/v1$/);
    const config = {
      enabled: true,
      taskId,
      journalDirectory: root,
      pythonExecutable: process.env.OB_MCP_FIXTURE_PYTHON ?? '',
      serverRoot: process.env.OB_MCP_FIXTURE_ROOT ?? '',
      apiUrl: url,
      apiKey: process.env.ORANGEBENCH_API_KEY ?? '',
      allowLoopbackForTests: true,
    };
    if (process.env.OB_HOLA_FIXTURE_REVOKED === '1') {
      await expect(loadOrangeBenchClient(config)).rejects.toThrow('unauthorized');
      await rm(root, { recursive: true, force: true });
      return;
    }
    const client = await loadOrangeBenchClient(config);
    expect(client).not.toBeNull();
    const page = {
      url: () => 'https://example.com/',
      title: async () => 'Fixture',
      evaluate: async () => ({ bodyTextLen: 100, images: 0, inputs: 0, buttons: 0 }),
      goto: vi.fn(),
      mouse: { move: vi.fn(), click: vi.fn(), down: vi.fn(), up: vi.fn() },
      keyboard: { down: vi.fn(), up: vi.fn() },
      waitForTimeout: vi.fn(),
    };
    const executor = {
      resetPageForTask: vi.fn(),
      getPage: async () => page,
      screenshot: async () => ({ base64: 'dGVzdA==', viewportWidth: 1280, viewportHeight: 720 }),
    } as unknown as PlaywrightExecutor;
    let stage = 0;
    let project = '';
    let quote = '';
    let task = '';
    let maximum = 0;
    const returned: Array<Record<string, unknown>> = [];
    createMessage.mockImplementation(
      async (options: {
        tools: Array<{ name: string }>;
        messages: Array<{ content: unknown }>;
      }) => {
        expect(
          options.tools.filter((t) => t.name.startsWith('orangebench_')).map((t) => t.name),
        ).toEqual([...ORANGEBENCH_TOOLS]);
        if (stage > 0) {
          const last = options.messages.at(-1)?.content as Array<{
            type: string;
            content: Array<{ text: string }>;
          }>;
          const tool = required(last.filter((c) => c.type === 'tool_result').at(-1));
          const packet = JSON.parse(required(tool.content[0]).text);
          expect(packet.ok, packet.error).toBe(true);
          returned.push(packet.data);
          if (stage === 1) project = packet.data.id;
          if (stage === 2) {
            quote = packet.data.id;
            maximum = packet.data.credits_micro_usd;
          }
          if (stage === 3) task = packet.data.id;
          if (stage === 4) expect(packet.data.id).toBe(task);
        }
        stage++;
        const call = (name: string, request: unknown) =>
          response([{ type: 'tool_use', id: `fixture-${stage}`, name, input: { request } }]);
        if (stage === 1)
          return call('orangebench_create_project', {
            name: 'HOLA MCP fixture',
            script: 'A fictional story.',
            idempotency_key: 'model-project',
          });
        if (stage === 2)
          return call('orangebench_storyboard', { project_id: project, project_revision: 1 });
        if (stage === 3 || stage === 4)
          return call('orangebench_storyboard', {
            project_id: project,
            mode: 'execute',
            quote_id: quote,
            confirm: true,
            max_credits_micro_usd: maximum,
            idempotency_key: `model-execution-${stage}`,
          });
        if (stage === 5)
          return call('orangebench_storyboard', {
            project_id: project,
            mode: 'cancel',
            task_id: task,
          });
        return response([{ type: 'text', text: 'Fixture acceptance complete.' }], 'end_turn');
      },
    );
    const approval = vi.fn(async (view: { binding: string; maximumCreditsMicroUsd: number }) => ({
      decision: 'approve' as const,
      binding: view.binding,
      maximumCreditsMicroUsd: view.maximumCreditsMicroUsd,
    }));
    try {
      const result = await runSupercarTask({
        taskId,
        intent: 'Create a fictional OrangeBench storyboard project',
        executor,
        apiKey: 'mock-model-only',
        maxIterations: 6,
        orangebench: required(client),
        onOrangeBenchApproval: approval,
      });
      expect(result.status).toBe('completed');
      expect(approval).toHaveBeenCalledTimes(1);
      expect(returned).toHaveLength(5);
      expect(JSON.stringify(createMessage.mock.calls)).not.toContain(config.apiKey);
      await writeFile(
        required(process.env.OB_HOLA_FIXTURE_RECEIPT),
        JSON.stringify({
          projectId: project,
          taskId: task,
          approvalCalls: approval.mock.calls.length,
          tools: ORANGEBENCH_TOOLS,
          modelCalls: createMessage.mock.calls.length,
          realProviderCalls: 0,
        }),
        { mode: 0o600 },
      );
    } finally {
      await required(client).close();
      await rm(root, { recursive: true, force: true });
    }
  },
  30000,
);

function required<T>(value: T | null | undefined): T {
  if (value === undefined || value === null)
    throw new Error('Fixture did not return its expected value');
  return value;
}
