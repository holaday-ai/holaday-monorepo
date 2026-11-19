import { expect, it, vi } from 'vitest';
import { TaskTabJournal } from './task-tab-journal.js';

const id = '4488c303-9880-44d9-885e-51e13755933b';
function fixture() {
  const records = new Map<string, unknown>();
  const tabs = new Map<number, { id: number; url: string; status: string; pendingUrl?: string }>();
  tabs.set(42, {
    id: 42,
    url: 'https://work.example/private/path?token=source-secret',
    status: 'complete',
  });
  let owner = 'owner-a';
  const dependencies = {
    owner: () => owner,
    current: () => owner === 'owner-a',
    read: async (key: string) => records.get(key),
    write: vi.fn(async (key: string, value: unknown) => {
      records.set(key, structuredClone(value));
    }),
    count: async () => records.size,
    source: vi.fn(async () => tabs.get(42)!),
    get: vi.fn(async (tabId: number) => {
      const tab = tabs.get(tabId);
      if (!tab) throw new Error('target_closed');
      return { ...tab };
    }),
    find: vi.fn(async (marker: string) => [...tabs.values()].filter((tab) => tab.url === marker)),
    create: vi.fn(async (marker: string) => {
      const tab = { id: 100, url: marker, status: 'complete' };
      tabs.set(100, tab);
      return tab;
    }),
    navigate: vi.fn(async (tabId: number, url: string) => {
      tabs.set(tabId, { id: tabId, url, status: 'complete' });
    }),
    marker: (nonce: string) => `chrome-extension://fixture/task-launch.html#${nonce}`,
    wait: async () => {},
    maxPolls: 2,
  };
  const start = () =>
    new TaskTabJournal(dependencies).prepare({ tabId: 42, origin: 'https://work.example' }, id);
  return {
    records,
    tabs,
    dependencies,
    start,
    switchOwner: () => {
      owner = 'owner-b';
    },
  };
}
it('recovers the same prepared tab in a new worker without storing raw URL or credentials', async () => {
  const h = fixture();
  expect(await h.start()).toMatchObject({ id: 100 });
  expect(await h.start()).toMatchObject({ id: 100 });
  expect(h.dependencies.create).toHaveBeenCalledOnce();
  expect(h.dependencies.navigate).toHaveBeenCalledOnce();
  const stored = JSON.stringify([...h.records]);
  expect(stored).not.toContain('source-secret');
  expect(stored).not.toContain('/private/path');
  expect(stored).not.toContain('owner-a');
});
it('adopts an inert marker after the create receipt was lost, instead of creating twice', async () => {
  const h = fixture();
  const create = h.dependencies.create.getMockImplementation()!;
  h.dependencies.create.mockImplementationOnce(async (marker) => {
    await create(marker);
    throw new Error('lost receipt');
  });
  await expect(h.start()).rejects.toThrow('lost receipt');
  expect(await h.start()).toMatchObject({ id: 100 });
  expect(h.dependencies.create).toHaveBeenCalledOnce();
  expect(h.dependencies.navigate).toHaveBeenCalledOnce();
});
it('does not repeat an uncertain navigation or invent a second tab when a create is not visible', async () => {
  const h = fixture();
  h.dependencies.navigate.mockImplementationOnce(async () => {
    throw new Error('lost navigation');
  });
  await expect(h.start()).rejects.toThrow('lost navigation');
  await expect(h.start()).rejects.toThrow('task_tab_not_ready');
  expect(h.dependencies.navigate).toHaveBeenCalledOnce();
  const missing = fixture();
  missing.dependencies.create.mockRejectedValueOnce(new Error('unknown create'));
  await expect(missing.start()).rejects.toThrow('unknown create');
  await expect(missing.start()).rejects.toThrow('task_tab_not_ready');
  expect(missing.dependencies.create).toHaveBeenCalledOnce();
});
it('does not dispatch an effect until its write-ahead record is saved', async () => {
  const h = fixture();
  h.dependencies.write.mockRejectedValueOnce(new Error('storage unavailable'));
  await expect(h.start()).rejects.toThrow('storage unavailable');
  expect(h.dependencies.create).not.toHaveBeenCalled();
  expect(h.dependencies.navigate).not.toHaveBeenCalled();
});
it('refuses changed/closed prepared tabs and changed owners without replacing them', async () => {
  const h = fixture();
  await h.start();
  h.tabs.set(100, { id: 100, url: 'https://other.example/', status: 'complete' });
  await expect(h.start()).rejects.toThrow('target_changed');
  h.tabs.delete(100);
  await expect(h.start()).rejects.toThrow('target_closed');
  h.switchOwner();
  await expect(h.start()).rejects.toThrow('target_changed');
  expect(h.dependencies.create).toHaveBeenCalledOnce();
});
it('does not navigate after an account change while the write-ahead record is being saved', async () => {
  const h = fixture();
  const write = h.dependencies.write.getMockImplementation()!;
  h.dependencies.write.mockImplementationOnce(async (key, value) => {
    await write(key, value);
    h.switchOwner();
  });
  await expect(h.start()).rejects.toThrow('target_changed');
  expect(h.dependencies.create).not.toHaveBeenCalled();
  expect(h.dependencies.navigate).not.toHaveBeenCalled();
});
it('refuses a changed source before the first navigation after a lost marker receipt', async () => {
  const h = fixture();
  const create = h.dependencies.create.getMockImplementation()!;
  h.dependencies.create.mockImplementationOnce(async (marker) => {
    await create(marker);
    throw new Error('lost receipt');
  });
  await expect(h.start()).rejects.toThrow('lost receipt');
  h.tabs.set(42, { id: 42, url: 'https://work.example/changed', status: 'complete' });
  await expect(h.start()).rejects.toThrow('target_changed');
  expect(h.dependencies.create).toHaveBeenCalledOnce();
  expect(h.dependencies.navigate).not.toHaveBeenCalled();
});
it('never interprets a corrupted saved record as a fresh operation', async () => {
  const h = fixture();
  await h.start();
  const key = [...h.records.keys()][0]!;
  h.records.set(key, null);
  await expect(h.start()).rejects.toThrow('preparation_record_invalid');
  expect(h.dependencies.create).toHaveBeenCalledOnce();
});
it('does not overwrite a navigation started by the user on the recovered marker tab', async () => {
  const h = fixture();
  const create = h.dependencies.create.getMockImplementation()!;
  h.dependencies.create.mockImplementationOnce(async (marker) => {
    await create(marker);
    throw new Error('lost receipt');
  });
  await expect(h.start()).rejects.toThrow('lost receipt');
  h.tabs.get(100)!.pendingUrl = 'https://other.example/user-navigation';
  await expect(h.start()).rejects.toThrow('target_changed');
  expect(h.dependencies.navigate).not.toHaveBeenCalled();
  expect(h.dependencies.create).toHaveBeenCalledOnce();
});
it('rebinds an explicitly selected current page without creating or navigating a tab', async () => {
  const h = fixture();
  const prepare = () =>
    new TaskTabJournal(h.dependencies).prepare(
      { tabId: 42, origin: 'https://work.example' },
      id,
      false,
      'current',
    );
  expect(await prepare()).toMatchObject({ id: 42 });
  expect(await prepare()).toMatchObject({ id: 42 });
  expect(h.dependencies.create).not.toHaveBeenCalled();
  expect(h.dependencies.navigate).not.toHaveBeenCalled();
  h.tabs.set(42, { id: 42, url: 'https://work.example/another-account', status: 'complete' });
  await expect(prepare()).rejects.toThrow('target_changed');
});
it('never creates a replacement when recovery was requested but the original journal is missing', async () => {
  const h = fixture();
  await expect(
    new TaskTabJournal(h.dependencies).prepare(
      { tabId: 42, origin: 'https://work.example' },
      id,
      true,
    ),
  ).rejects.toThrow('preparation_unknown');
  expect(h.tabs.size).toBe(1);
  expect(h.dependencies.navigate).not.toHaveBeenCalled();
});
it('releases bookkeeping without closing the result page or allowing an old retry to recreate it', async () => {
  const h = fixture();
  await h.start();
  const journal = new TaskTabJournal(h.dependencies);
  await journal.release(id);
  await journal.release(id);
  expect(h.tabs.get(100)?.url).toBe('https://work.example/private/path?token=source-secret');
  await expect(h.start()).rejects.toThrow('preparation_released');
  expect(h.dependencies.create).toHaveBeenCalledOnce();
});

function loadingStart(h: ReturnType<typeof fixture>) {
  return new TaskTabJournal(h.dependencies).prepare(
    { tabId: 42, origin: 'https://work.example' },
    id,
    false,
    'independent',
    true,
  );
}
it('reports acknowledged navigation still loading and recovers it in a new worker without new effects', async () => {
  const h = fixture();
  const navigate = h.dependencies.navigate.getMockImplementation()!;
  h.dependencies.navigate.mockImplementation(async (tabId, url) => {
    await navigate(tabId, url);
    h.tabs.get(tabId)!.status = 'loading';
  });
  expect(await loadingStart(h)).toEqual({ id: 100, taskTabStatus: 'loading' });
  expect(await loadingStart(h)).toEqual({ id: 100, taskTabStatus: 'loading' });
  expect([...h.records.values()]).toEqual([
    expect.objectContaining({ phase: 'navigating', navigationAcknowledged: true }),
  ]);
  h.tabs.get(100)!.status = 'complete';
  expect(await loadingStart(h)).toMatchObject({ id: 100 });
  expect(h.dependencies.create).toHaveBeenCalledOnce();
  expect(h.dependencies.navigate).toHaveBeenCalledOnce();
});
it('reports an acknowledged marker loading but does not navigate it until ready', async () => {
  const h = fixture();
  const create = h.dependencies.create.getMockImplementation()!;
  h.dependencies.create.mockImplementation(async (marker) => {
    const tab = await create(marker);
    tab.status = 'loading';
    return tab;
  });
  expect(await loadingStart(h)).toEqual({ id: 100, taskTabStatus: 'loading' });
  expect(h.dependencies.navigate).not.toHaveBeenCalled();
  h.tabs.get(100)!.status = 'complete';
  expect(await loadingStart(h)).toMatchObject({ id: 100 });
  expect(h.dependencies.create).toHaveBeenCalledOnce();
  expect(h.dependencies.navigate).toHaveBeenCalledOnce();
});
it('keeps legacy callers strict even after a readiness caller observed loading', async () => {
  const h = fixture();
  const navigate = h.dependencies.navigate.getMockImplementation()!;
  h.dependencies.navigate.mockImplementation(async (tabId, url) => {
    await navigate(tabId, url);
    h.tabs.get(tabId)!.status = 'loading';
  });
  await loadingStart(h);
  await expect(h.start()).rejects.toThrow('task_tab_not_ready');
});
it('does not label unknown navigation as acknowledged loading', async () => {
  const h = fixture();
  h.dependencies.navigate.mockRejectedValueOnce(new Error('lost navigation'));
  await expect(loadingStart(h)).rejects.toThrow('lost navigation');
  await expect(loadingStart(h)).rejects.toThrow('task_tab_not_ready');
  expect(h.dependencies.navigate).toHaveBeenCalledOnce();
});
it('does not label an invisible creation or failed private acknowledgement as loading', async () => {
  const missing = fixture();
  missing.dependencies.create.mockRejectedValueOnce(new Error('lost creation'));
  await expect(loadingStart(missing)).rejects.toThrow('lost creation');
  await expect(loadingStart(missing)).rejects.toThrow('task_tab_not_ready');
  expect(missing.dependencies.create).toHaveBeenCalledOnce();
  const h = fixture();
  const write = h.dependencies.write.getMockImplementation()!;
  h.dependencies.write.mockImplementation(async (key, value) => {
    if ((value as { navigationAcknowledged?: boolean }).navigationAcknowledged)
      throw new Error('storage unavailable');
    await write(key, value);
  });
  await expect(loadingStart(h)).rejects.toThrow('storage unavailable');
});
it('does not trust an old navigating record without a durable navigation acknowledgement', async () => {
  const h = fixture();
  const navigate = h.dependencies.navigate.getMockImplementation()!;
  h.dependencies.navigate.mockImplementation(async (tabId, url) => {
    await navigate(tabId, url);
    h.tabs.get(tabId)!.status = 'loading';
  });
  await loadingStart(h);
  for (const [key, value] of h.records) {
    const old = { ...(value as Record<string, unknown>) };
    delete old.navigationAcknowledged;
    h.records.set(key, old);
  }
  await expect(loadingStart(h)).rejects.toThrow('task_tab_not_ready');
  expect(h.dependencies.navigate).toHaveBeenCalledOnce();
});
it('rejects loading metadata that points outside the original origin', async () => {
  const h = fixture();
  const navigate = h.dependencies.navigate.getMockImplementation()!;
  h.dependencies.navigate.mockImplementation(async (tabId, url) => {
    await navigate(tabId, url);
    h.tabs.get(tabId)!.status = 'loading';
    h.tabs.get(tabId)!.pendingUrl = 'https://other.example/private';
  });
  await expect(loadingStart(h)).rejects.toThrow('origin_grant_required');
});
it('does not return a loading receipt after the account changes during metadata observation', async () => {
  const h = fixture();
  const get = h.dependencies.get.getMockImplementation()!;
  h.dependencies.get.mockImplementation(async (tabId) => {
    const tab = await get(tabId);
    if (tabId === 100) h.switchOwner();
    return { ...tab, status: 'loading' };
  });
  await expect(loadingStart(h)).rejects.toThrow('target_changed');
});
