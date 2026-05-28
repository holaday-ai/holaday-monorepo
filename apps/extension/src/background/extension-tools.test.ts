import { afterEach, describe, expect, it, vi } from 'vitest';
import { waitForTabComplete } from './extension-tools.js';

type TabListener = (id: number, info: chrome.tabs.TabChangeInfo) => void;
type TabStatus = 'loading' | 'complete' | 'unloaded';

function installChromeTabsMock(initialStatus: TabStatus = 'loading'): {
  listeners: Set<TabListener>;
  setStatus: (next: TabStatus) => void;
} {
  const listeners = new Set<TabListener>();
  let status = initialStatus;
  globalThis.chrome = {
    tabs: {
      get: vi.fn(async () => ({ id: 1, status }) as chrome.tabs.Tab),
      onUpdated: {
        addListener: vi.fn((listener: TabListener) => {
          listeners.add(listener);
        }),
        removeListener: vi.fn((listener: TabListener) => {
          listeners.delete(listener);
        }),
      },
    },
  } as unknown as typeof chrome;
  return {
    listeners,
    setStatus(next) {
      status = next;
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (globalThis as any).chrome;
});

describe('waitForTabComplete', () => {
  it('resolves immediately when the tab already reached complete', async () => {
    const mock = installChromeTabsMock('complete');

    await expect(waitForTabComplete(1, 25_000)).resolves.toBeUndefined();

    expect(mock.listeners.size).toBe(0);
    expect(chrome.tabs.onUpdated.addListener).toHaveBeenCalledTimes(1);
    expect(chrome.tabs.onUpdated.removeListener).toHaveBeenCalledTimes(1);
  });

  it('resolves from the onUpdated complete event', async () => {
    const mock = installChromeTabsMock('loading');
    const pending = waitForTabComplete(1, 25_000);
    await Promise.resolve();

    mock.setStatus('complete');
    for (const listener of mock.listeners) {
      listener(1, { status: 'complete' });
    }

    await expect(pending).resolves.toBeUndefined();
    expect(mock.listeners.size).toBe(0);
  });

  it('rejects when the tab never reaches complete', async () => {
    vi.useFakeTimers();
    installChromeTabsMock('loading');
    const pending = waitForTabComplete(1, 25_000);
    await Promise.resolve();

    vi.advanceTimersByTime(25_000);

    await expect(pending).rejects.toThrow('navigate_timeout');
  });
});
