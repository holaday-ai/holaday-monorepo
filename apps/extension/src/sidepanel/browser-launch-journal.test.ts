import {
  type BrowserLaunchCreationReceipt,
  BrowserLaunchJournal,
  type BrowserLaunchJournalEntry,
  type BrowserLaunchTarget,
} from '@holaday/shared-types';
import { expect, it, vi } from 'vitest';
import { sidePanelLaunchDependencies } from './durable-launch.js';

const profile = '82cf0bca-b78c-4f12-af23-035421ab959c';
const source = {
  browserSessionId: profile,
  tabId: 42,
  origin: 'https://work.example',
  selectionId: '4888c303-9880-44d9-885e-51e13755933b',
  mode: 'independent' as const,
};
const request = { intent: '整理后台数据', brainId: 'user-choice' };
function fixture() {
  const records = new Map<string, BrowserLaunchJournalEntry>();
  let queue: Promise<unknown> = Promise.resolve();
  const storage = {
    all: async () => structuredClone([...records.values()]),
    put: vi.fn(async (entry: BrowserLaunchJournalEntry) => {
      records.set(entry.clientRequestId, structuredClone(entry));
    }),
    remove: async (id: string) => {
      records.delete(id);
    },
    lock: <T>(run: () => Promise<T>): Promise<T> => {
      const next = queue.then(run);
      queue = next.catch(() => undefined);
      return next;
    },
  };
  let receipt: BrowserLaunchCreationReceipt = { state: 'absent' };
  let current = true;
  let connection = 'socket-first';
  let browserSessionId = profile;
  const tasks: string[] = [];
  const prepared = new Map<string, number>();
  const deps = {
    current: async () => {
      if (!current) throw new Error('account changed');
    },
    receipt: vi.fn(async () => receipt),
    resolve: vi.fn(async () => ({
      extensionClientId: connection,
      tabId: 42,
      expectedUrl: source.origin,
      selectionId: source.selectionId,
      launchBrowserSessionId: browserSessionId,
    })),
    prepare: vi.fn(async (target: BrowserLaunchTarget, id: string, _resumeOnly: boolean) => {
      if (!prepared.has(id)) prepared.set(id, 100 + prepared.size);
      return { ...target, tabId: prepared.get(id)! };
    }),
    create: vi.fn(async (_body: Record<string, unknown>) => {
      const taskId = `tsk_${tasks.length + 1}`;
      tasks.push(taskId);
      receipt = { state: 'created', taskId, status: 'executing' };
      return { taskId, status: 'executing' };
    }),
    release: vi.fn(async (_entry: BrowserLaunchJournalEntry) => {}),
  };
  return {
    records,
    storage,
    deps,
    tasks,
    prepared,
    journal: () => new BrowserLaunchJournal(storage),
    setReceipt: (r: BrowserLaunchCreationReceipt) => {
      receipt = r;
    },
    reconnect: () => {
      connection = 'socket-reconnected';
    },
    otherProfile: () => {
      browserSessionId = 'a924f85c-8070-4020-a30c-7226bd95b415';
    },
    switchAccount: () => {
      current = false;
    },
  };
}
it('recovers a lost create response before preparing anything again after a UI restart', async () => {
  const h = fixture();
  const create = h.deps.create.getMockImplementation()!;
  h.deps.create.mockImplementationOnce(async (body) => {
    await create(body);
    throw new Error('lost response');
  });
  await expect(h.journal().run('owner-a', request, source, h.deps)).rejects.toThrow(
    'lost response',
  );
  h.reconnect();
  const result = await h.journal().run('owner-a', request, source, h.deps);
  expect(result).toMatchObject({ taskId: 'tsk_1', recovered: true });
  expect(h.tasks).toEqual(['tsk_1']);
  expect(h.prepared.size).toBe(1);
  expect(h.deps.resolve).toHaveBeenCalledTimes(1);
  expect(h.deps.prepare).toHaveBeenCalledTimes(1);
  const stored = JSON.stringify([...h.records]);
  expect(stored).not.toContain('owner-a');
  expect(stored).not.toContain('socket-first');
});
it('keeps the same operation IDs while rebinding the same browser session after a pre-claim failure', async () => {
  const h = fixture();
  h.deps.create.mockRejectedValueOnce(new Error('request not admitted'));
  await expect(h.journal().run('owner-a', request, source, h.deps)).rejects.toThrow('not admitted');
  const first = [...h.records.values()][0]!;
  h.reconnect();
  const result = await h.journal().resume('owner-a', first.clientRequestId, h.deps);
  expect(result.taskId).toBe('tsk_1');
  expect(h.tasks).toEqual(['tsk_1']);
  expect(h.prepared.size).toBe(1);
  expect(h.deps.prepare.mock.calls[1]?.slice(0, 3)).toMatchObject([
    expect.objectContaining({ extensionClientId: 'socket-reconnected' }),
    first.preparationId,
    true,
  ]);
  expect(h.deps.create.mock.calls[1]?.[0]).toMatchObject({
    clientRequestId: first.clientRequestId,
    brainId: 'user-choice',
  });
});
it.each(['pending', 'unknown'] as const)(
  'does not dispatch preparation or task creation when a prior receipt is %s',
  async (state) => {
    const h = fixture();
    h.deps.create.mockRejectedValueOnce(new Error('lost'));
    await expect(h.journal().run('owner-a', request, source, h.deps)).rejects.toThrow();
    h.setReceipt({ state });
    await expect(h.journal().run('owner-a', request, source, h.deps)).rejects.toThrow('尚未确认');
    expect(h.deps.prepare).toHaveBeenCalledTimes(1);
    expect(h.deps.create).toHaveBeenCalledTimes(1);
  },
);
it('refuses an absent receipt beyond its retention window and a different browser session', async () => {
  const h = fixture();
  h.deps.create.mockRejectedValueOnce(new Error('lost'));
  await expect(h.journal().run('owner-a', request, source, h.deps)).rejects.toThrow();
  h.otherProfile();
  await expect(h.journal().run('owner-a', request, source, h.deps)).rejects.toThrow(
    '原 Chrome 会话',
  );
  [...h.records.values()][0]!.createdAt = Date.now() - 24 * 60 * 60 * 1000;
  await expect(h.journal().run('owner-a', request, source, h.deps)).rejects.toThrow('尚未确认');
  expect(h.tasks).toEqual([]);
  expect(h.prepared.size).toBe(1);
});
it('keeps confirmed tasks confirmed while retrying non-destructive preparation cleanup', async () => {
  const h = fixture();
  const first = await h.journal().run('owner-a', request, source, h.deps);
  h.deps.release.mockRejectedValueOnce(new Error('offline'));
  await h.journal().acknowledge('owner-a', first.operationId, h.deps);
  expect(await h.journal().pending('owner-a')).toEqual([]);
  expect(h.records.get(first.operationId)?.phase).toBe('acknowledged');
  await h.journal().cleanup('owner-a', h.deps);
  expect(h.records.size).toBe(0);
  expect(h.tasks).toEqual(['tsk_1']);
});
it('does not cross account boundaries or discard an unresolved operation after storage failure', async () => {
  const h = fixture();
  h.storage.put.mockRejectedValueOnce(new Error('storage failed'));
  await expect(h.journal().run('owner-a', request, source, h.deps)).rejects.toThrow(
    'storage failed',
  );
  expect(h.prepared.size).toBe(0);
  h.deps.create.mockRejectedValueOnce(new Error('lost'));
  await expect(h.journal().run('owner-a', request, source, h.deps)).rejects.toThrow();
  expect(await h.journal().pending('owner-b')).toEqual([]);
  h.switchAccount();
  await expect(h.journal().resume('owner-a', [...h.records.keys()][0]!, h.deps)).rejects.toThrow(
    'account changed',
  );
  expect(h.records.size).toBe(1);
});
it('sends only the selected-target wire fields, without discovery UI metadata', async () => {
  const h = fixture();
  h.deps.prepare.mockImplementationOnce(async (target) => ({
    ...target,
    tabId: 100,
    title: 'PRIVATE PAGE TITLE',
    launchRecoveryReady: true,
  }));
  await h.journal().run('owner-a', request, source, h.deps);
  expect(Object.keys(h.deps.create.mock.calls[0]![0].localChrome as object).sort()).toEqual([
    'expectedUrl',
    'extensionClientId',
    'launchBrowserSessionId',
    'selectionId',
    'tabId',
  ]);
  expect(JSON.stringify([...h.records])).not.toContain('PRIVATE PAGE TITLE');
});
it('honors an existing cancelled task instead of starting the submission again', async () => {
  const h = fixture();
  h.deps.create.mockRejectedValueOnce(new Error('lost response'));
  await expect(h.journal().run('owner-a', request, source, h.deps)).rejects.toThrow();
  h.setReceipt({ state: 'created', taskId: 'tsk_cancelled', status: 'cancelled' });
  expect(await h.journal().run('owner-a', request, source, h.deps)).toMatchObject({
    taskId: 'tsk_cancelled',
    status: 'cancelled',
    recovered: true,
  });
  expect(h.deps.create).toHaveBeenCalledOnce();
  expect(h.deps.prepare).toHaveBeenCalledOnce();
});
it('captures the submitted instruction and target before asynchronous journal work', async () => {
  const h = fixture();
  const input = { intent: '原始指令' };
  const capturedSource = { ...source };
  const operation = h.journal().run('owner-a', input, capturedSource, h.deps);
  input.intent = '后来编辑的新指令';
  capturedSource.tabId = 99;
  await operation;
  expect(h.deps.create.mock.calls[0]![0].intent).toBe('原始指令');
  expect([...h.records.values()][0]?.source.tabId).toBe(42);
});
it('does not mint another operation after model options or page mode change on an unresolved submission', async () => {
  const h = fixture();
  h.deps.create.mockRejectedValueOnce(new Error('lost'));
  await expect(h.journal().run('owner-a', request, source, h.deps)).rejects.toThrow();
  await expect(
    h.journal().run('owner-a', { ...request, brainId: 'new-choice' }, source, h.deps),
  ).rejects.toThrow('内容发生变化');
  await expect(
    h.journal().run('owner-a', request, { ...source, mode: 'current' }, h.deps),
  ).rejects.toThrow('已改变');
  expect(h.records.size).toBe(1);
  expect(h.deps.prepare).toHaveBeenCalledOnce();
});

it('wires durable sidepanel loading checks with fixed source and id and strips UI capabilities', async () => {
  vi.useFakeTimers();
  try {
    let calls = 0;
    const requests: unknown[] = [];
    const target = {
      extensionClientId: 'socket-first',
      tabId: 42,
      expectedUrl: source.origin,
      selectionId: source.selectionId,
      launchBrowserSessionId: profile,
      preparationReadiness: true,
    };
    const deps = sidePanelLaunchDependencies(
      async <T>(procedure: string, body?: unknown): Promise<T> => {
        expect(procedure).toBe('localChromeTaskTab');
        requests.push(body);
        calls++;
        return (
          calls === 1
            ? {
                preparationState: 'loading',
                taskTabCreated: true,
                extensionClientId: target.extensionClientId,
                preparationId: '61c56349-421b-4a44-b946-507476393185',
                sourceTabId: 42,
                sourceOrigin: source.origin,
                tabId: 100,
                launchBrowserSessionId: profile,
              }
            : { ...target, tabId: 100 }
        ) as T;
      },
      async () => {},
    );
    const operation = deps.prepare(
      target,
      '61c56349-421b-4a44-b946-507476393185',
      true,
      'independent',
    );
    await vi.advanceTimersByTimeAsync(1100);
    expect(await operation).toMatchObject({ tabId: 100 });
    expect(calls).toBe(2);
    expect(requests[0]).toEqual(requests[1]);
    expect(requests[0]).toHaveProperty('resumeOnly', true);
    expect(requests[0]).toHaveProperty('reportReadiness', true);
    expect((requests[0] as { selection: object }).selection).not.toHaveProperty(
      'preparationReadiness',
    );
  } finally {
    vi.useRealTimers();
  }
});
