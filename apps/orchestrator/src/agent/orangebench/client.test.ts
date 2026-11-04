import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OrangeBenchTaskClient } from './client.js';

const ACCOUNT = '11111111-1111-4111-8111-111111111111';
const KEY = '22222222-2222-4222-8222-222222222222';
const PROJECT = '33333333-3333-4333-8333-333333333333';
const QUOTE = '44444444-4444-4444-8444-444444444444';
const TASK = '55555555-5555-4555-8555-555555555555';
const NAMES = [
  'orangebench_create_project',
  'orangebench_storyboard',
  'orangebench_character_cards',
  'orangebench_generate_episode',
  'orangebench_multilingual_version',
];
const directories: string[] = [];
afterEach(async () => {
  for (const path of directories.splice(0)) await rm(path, { recursive: true, force: true });
});
async function fixture(
  extra: { journalDirectory?: string; requestUnknown?: boolean; now?: () => number } = {},
) {
  const journalDirectory = extra.journalDirectory ?? (await mkdtemp(join(tmpdir(), 'hd-ob-')));
  if (!extra.journalDirectory) directories.push(journalDirectory);
  let revoked = false;
  const calls: Array<{ name: string; arguments: unknown }> = [];
  const rpc = {
    listTools: vi.fn(async () => ({
      tools: NAMES.map((name) => ({
        name,
        inputSchema: { type: 'object', properties: { request: { type: 'object' } } },
      })),
    })),
    readResource: vi.fn(async () => {
      if (revoked) throw new Error('unauthorized');
      return {
        contents: [
          {
            uri: 'orangebench://connection',
            text: JSON.stringify({
              account_id: ACCOUNT,
              key_id: KEY,
              region: 'cn',
              scopes: ['episodes:create'],
              execution_available: true,
            }),
          },
        ],
      };
    }),
    callTool: vi.fn(async (args: { name: string; arguments: unknown }) => {
      calls.push(args);
      const request = (args.arguments as { request: Record<string, unknown> }).request;
      if (request.mode === 'execute') {
        if (extra.requestUnknown) throw new Error('request_unknown');
        return {
          structuredContent: {
            id: TASK,
            state: 'queued',
            project_id: PROJECT,
            capability: 'episodes',
          },
        };
      }
      if (args.name === 'orangebench_create_project')
        return { structuredContent: { id: PROJECT, revision: 1 } };
      return {
        structuredContent: {
          id: QUOTE,
          project_id: PROJECT,
          project_revision: 3,
          capability: 'episodes',
          region: 'cn',
          credits_micro_usd: 123456,
          expires_at: new Date(Date.now() + 600000).toISOString(),
          execution_available: true,
        },
      };
    }),
    close: vi.fn(async () => {}),
  };
  const client = await OrangeBenchTaskClient.open({
    taskId: 'host-task-a',
    rpc,
    journalDirectory,
    now: extra.now,
  });
  return {
    client,
    rpc,
    calls,
    journalDirectory,
    revoke: () => {
      revoked = true;
    },
  };
}
const quote = { request: { project_id: PROJECT, project_revision: 3 } };
const execute = {
  request: {
    project_id: PROJECT,
    mode: 'execute',
    quote_id: QUOTE,
    confirm: true,
    max_credits_micro_usd: 123456,
    idempotency_key: 'model-invented',
  },
};
const context = { taskId: 'host-task-a' };
const approve = vi.fn(async (view: { binding: string }) => ({
  decision: 'approve' as const,
  binding: view.binding,
  maximumCreditsMicroUsd: 123456,
}));

describe('trusted host confirmation', () => {
  it('quotes freely but model confirm cannot approve execution or pass an approval field', async () => {
    const f = await fixture();
    expect(f.client.tools).toHaveLength(5);
    expect(await f.client.dispatch('orangebench_generate_episode', quote, context)).toMatchObject({
      ok: true,
    });
    expect(await f.client.dispatch('orangebench_generate_episode', execute, context)).toMatchObject(
      { ok: false, error: 'confirmation_required' },
    );
    expect(
      await f.client.dispatch(
        'orangebench_generate_episode',
        { request: { ...execute.request, approval: { decision: 'approve' } } },
        context,
      ),
    ).toMatchObject({ ok: false, error: 'invalid_arguments' });
    expect(f.calls).toHaveLength(1);
  });
  it('binds task, quote, maximum and trusted callback; cancels before dispatch', async () => {
    const f = await fixture();
    await f.client.dispatch('orangebench_generate_episode', quote, context);
    expect(
      await f.client.dispatch('orangebench_generate_episode', execute, {
        taskId: 'other',
        onApproval: approve,
      }),
    ).toMatchObject({ ok: false, error: 'task_target_mismatch' });
    expect(
      await f.client.dispatch('orangebench_generate_episode', execute, {
        ...context,
        onApproval: async () => ({
          decision: 'approve',
          binding: 'forged',
          maximumCreditsMicroUsd: 123456,
        }),
      }),
    ).toMatchObject({ ok: false, error: 'approval_mismatch' });
    expect(
      await f.client.dispatch('orangebench_generate_episode', execute, {
        ...context,
        onApproval: approve,
        isCancelled: async () => true,
      }),
    ).toMatchObject({ ok: false, error: 'task_cancelled' });
    expect(f.calls).toHaveLength(1);
  });
  it('persists approved exact intent and never changes idempotency across unknown response and restart', async () => {
    const f = await fixture({ requestUnknown: true });
    await f.client.dispatch('orangebench_generate_episode', quote, context);
    expect(
      await f.client.dispatch('orangebench_generate_episode', execute, {
        ...context,
        onApproval: approve,
      }),
    ).toMatchObject({ ok: false, error: 'request_unknown' });
    const first = (required(f.calls[1]).arguments as { request: Record<string, unknown> }).request;
    expect(first.idempotency_key).not.toBe('model-invented');
    await f.client.close();
    const resumed = await fixture({ journalDirectory: f.journalDirectory });
    const noNewApproval = vi.fn(async () => {
      throw new Error('must reuse existing trusted approval');
    });
    expect(
      await resumed.client.dispatch(
        'orangebench_generate_episode',
        { request: { ...execute.request, idempotency_key: 'new-model-key' } },
        { ...context, onApproval: noNewApproval },
      ),
    ).toMatchObject({ ok: true, data: { id: TASK } });
    expect(
      (required(resumed.calls[0]).arguments as { request: Record<string, unknown> }).request,
    ).toEqual(first);
    expect(noNewApproval).not.toHaveBeenCalled();
  });
  it('revalidates revoked connection before returning cached successful execution', async () => {
    const f = await fixture();
    await f.client.dispatch('orangebench_generate_episode', quote, context);
    expect(
      await f.client.dispatch('orangebench_generate_episode', execute, {
        ...context,
        onApproval: approve,
      }),
    ).toMatchObject({ ok: true });
    f.revoke();
    expect(await f.client.dispatch('orangebench_generate_episode', execute, context)).toMatchObject(
      { ok: false, error: 'unauthorized' },
    );
    expect(f.calls).toHaveLength(2);
  });
  it('does not execute an expired quote after host approval and never records script or credential values', async () => {
    let now = Date.now();
    const f = await fixture({ now: () => now });
    await f.client.dispatch('orangebench_generate_episode', quote, context);
    const result = await f.client.dispatch('orangebench_generate_episode', execute, {
      ...context,
      onApproval: async (view) => {
        now += 700000;
        return { decision: 'approve', binding: view.binding, maximumCreditsMicroUsd: 123456 };
      },
    });
    expect(result).toMatchObject({ ok: false, error: 'quote_expired' });
    expect(f.calls).toHaveLength(1);
  });
});

it('aborts a pending host approval without a provider request', async () => {
  const f = await fixture();
  await f.client.dispatch('orangebench_generate_episode', quote, context);
  const controller = new AbortController();
  let started!: () => void;
  const pending = new Promise<void>((resolve) => {
    started = resolve;
  });
  const work = f.client.dispatch('orangebench_generate_episode', execute, {
    ...context,
    signal: controller.signal,
    onApproval: async () => {
      started();
      return new Promise(() => {});
    },
  });
  await pending;
  controller.abort();
  expect(await work).toMatchObject({ ok: false, error: 'task_cancelled' });
  expect(f.calls).toHaveLength(1);
});
it('reports an unknown mutation safely when transport error contains private data', async () => {
  const f = await fixture();
  await f.client.dispatch('orangebench_generate_episode', quote, context);
  f.rpc.callTool.mockRejectedValueOnce(new Error('private-fixture-data-transport-reset'));
  const result = await f.client.dispatch('orangebench_generate_episode', execute, {
    ...context,
    onApproval: approve,
  });
  expect(result).toEqual({ ok: false, error: 'request_unknown' });
  expect(JSON.stringify(result)).not.toContain('private-fixture-data');
});
it.each(['close', 'durable'])('stops pending approval on %s cancellation', async (kind) => {
  const f = await fixture();
  await f.client.dispatch('orangebench_generate_episode', quote, context);
  let started!: () => void;
  const pending = new Promise<void>((r) => {
    started = r;
  });
  let cancelled = false;
  const work = f.client.dispatch('orangebench_generate_episode', execute, {
    ...context,
    isCancelled: () => cancelled,
    onApproval: async () => {
      started();
      return new Promise(() => {});
    },
  });
  await pending;
  if (kind === 'close') await f.client.close();
  else cancelled = true;
  expect(await work).toMatchObject({ ok: false, error: 'task_cancelled' });
  expect(f.calls).toHaveLength(1);
});

it('blocks a second live client during host approval without consuming a second approval', async () => {
  const first = await fixture();
  await first.client.dispatch('orangebench_generate_episode', quote, context);
  let release!: (value: {
    decision: 'approve';
    binding: string;
    maximumCreditsMicroUsd: number;
  }) => void;
  let signal!: () => void;
  const started = new Promise<void>((r) => {
    signal = r;
  });
  let binding = '';
  const pending = first.client.dispatch('orangebench_generate_episode', execute, {
    ...context,
    onApproval: async (view) => {
      binding = view.binding;
      signal();
      return new Promise((r) => {
        release = r;
      });
    },
  });
  await started;
  const second = await fixture({ journalDirectory: first.journalDirectory });
  const shouldNotApprove = vi.fn(async () => {
    throw new Error('duplicate approval');
  });
  expect(
    await second.client.dispatch('orangebench_generate_episode', execute, {
      ...context,
      onApproval: shouldNotApprove,
    }),
  ).toMatchObject({ ok: false, error: 'client_busy' });
  expect(shouldNotApprove).not.toHaveBeenCalled();
  expect(second.calls).toHaveLength(0);
  release({ decision: 'approve', binding, maximumCreditsMicroUsd: 123456 });
  expect(await pending).toMatchObject({ ok: true });
  const files = (await readdir(first.journalDirectory)).filter((f) => f.endsWith('.json'));
  expect(files).toHaveLength(1);
  const path = join(first.journalDirectory, required(files[0]));
  expect((await stat(path)).mode & 0o777).toBe(0o600);
  const stored = await readFile(path, 'utf8');
  expect(stored).not.toContain('model-invented');
  expect(stored).not.toContain('script');
  expect(stored).not.toContain('secret');
});
it('fails closed when the live journal lease is compromised during approval', async () => {
  const f = await fixture();
  await f.client.dispatch('orangebench_generate_episode', quote, context);
  let signal!: () => void;
  const started = new Promise<void>((r) => {
    signal = r;
  });
  const pending = f.client.dispatch('orangebench_generate_episode', execute, {
    ...context,
    onApproval: async () => {
      signal();
      return new Promise(() => {});
    },
  });
  await started;
  const locks = (await readdir(f.journalDirectory)).filter((name) => name.endsWith('.lock'));
  expect(locks).toHaveLength(1);
  await rm(join(f.journalDirectory, required(locks[0])), { recursive: true });
  expect(await pending).toMatchObject({ ok: false, error: 'journal_compromised' });
  expect(f.calls).toHaveLength(1);
});
it('fails closed if durable cancellation synchronously throws while approval is pending', async () => {
  const f = await fixture();
  await f.client.dispatch('orangebench_generate_episode', quote, context);
  let pollThrows = false;
  let started!: () => void;
  const signal = new Promise<void>((r) => {
    started = r;
  });
  const pending = f.client.dispatch('orangebench_generate_episode', execute, {
    ...context,
    isCancelled: () => {
      if (pollThrows) throw new Error('private-cancellation-adapter-error');
      return false;
    },
    onApproval: async () => {
      started();
      return new Promise(() => {});
    },
  });
  await signal;
  pollThrows = true;
  expect(await pending).toMatchObject({ ok: false, error: 'task_cancelled' });
  expect(f.calls).toHaveLength(1);
});

function required<T>(value: T | null | undefined): T {
  if (value === undefined || value === null)
    throw new Error('Fixture did not return its expected value');
  return value;
}
