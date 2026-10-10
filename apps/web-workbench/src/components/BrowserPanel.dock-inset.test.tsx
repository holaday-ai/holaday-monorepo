// @vitest-environment happy-dom
import { act, cleanup, render, renderHook } from '@testing-library/react';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ query: vi.fn(), mutate: vi.fn(), nav: vi.fn(), refresh: vi.fn(), abort: vi.fn() }));
vi.mock('@/lib/trpc', () => ({ trpc: { tasks: {
  browserControlState: { query: api.query }, browserControl: { mutate: api.mutate }, browserNav: { mutate: api.nav },
  abort: { mutate: api.abort },
} } }));
vi.mock('@/lib/use-stream-token', () => ({ useStreamToken: () => ({ token: 'test', refresh: api.refresh }) }));
vi.mock('@/lib/ws', () => ({ send: vi.fn() }));
vi.mock('@/lib/hd-debug', () => ({ hdDebug: vi.fn() }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ error: vi.fn(), success: vi.fn(), info: vi.fn(), show: vi.fn() }) }));
vi.mock('@/components/CdpScreencastViewport', () => ({ CdpScreencastViewport: () => <div data-testid="viewport" /> }));

import { BROWSER_PANEL_DOCK_INSET_PROPERTY, useBrowserPanelDockInset } from '@/hooks/useBrowserPanelDockInset';
import { useTaskStore } from '@/stores/task-store';
import { BrowserPanel } from './BrowserPanel';

type Observed = { callback: ResizeObserverCallback; target: Element | null; disconnected: boolean };
const observers: Observed[] = [];
let nextWidth = 420;

class FakeResizeObserver {
  private readonly record: Observed;
  constructor(callback: ResizeObserverCallback) {
    this.record = { callback, target: null, disconnected: false };
    observers.push(this.record);
  }
  observe(target: Element): void {
    this.record.target = target;
    emit(this.record, nextWidth);
  }
  unobserve(): void {}
  disconnect(): void {
    this.record.disconnected = true;
  }
}

function emit(record: Observed, width: number): void {
  if (!record.target || record.disconnected) return;
  record.callback(
    [{ target: record.target, contentRect: { width } } as unknown as ResizeObserverEntry],
    record as unknown as ResizeObserver,
  );
}

const inset = () => document.documentElement.style.getPropertyValue(BROWSER_PANEL_DOCK_INSET_PROPERTY);
const base = { activeTaskId: 'tsk_one', taskStatus: 'executing' as const, poolUserId: 'usr_one', onToggleFullscreen: vi.fn() };

beforeEach(() => {
  observers.length = 0;
  nextWidth = 420;
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  document.documentElement.style.removeProperty(BROWSER_PANEL_DOCK_INSET_PROPERTY);
  api.query.mockResolvedValue({ taskId: 'tsk_one', phase: 'agent', lease: null, supported: true, error: null, mode: 'running' });
  useTaskStore.setState({
    browserInteractive: false,
    tasks: [{ taskId: 'tsk_one', intent: '浏览测试网页', title: null, tickCount: 0, status: 'executing', executionMode: 'browser', createdAt: new Date() }],
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

const asLocalChrome = () =>
  useTaskStore.setState((state) => ({
    tasks: state.tasks.map((task) => ({ ...task, browserSource: 'local-chrome' as const })),
  }));

describe('browser side panel keeps the account dock off its header', () => {
  it('reserves the local Chrome rail width so the dock no longer covers its close button', () => {
    asLocalChrome();
    const { unmount } = render(<BrowserPanel {...base} onClose={vi.fn()} />);
    expect(inset()).toBe('436px');
    unmount();
    expect(inset()).toBe('');
  });

  it('leaves the dock alone for the local Chrome mobile sheet', () => {
    asLocalChrome();
    render(<BrowserPanel {...base} layout="sheet" />);
    expect(inset()).toBe('');
  });

  it('still reserves the cloud rail width', () => {
    nextWidth = 512;
    render(<BrowserPanel {...base} />);
    expect(inset()).toBe('528px');
  });

  it('hands the inset over when the rail switches from cloud to local Chrome', () => {
    const { rerender } = render(<BrowserPanel {...base} />);
    expect(inset()).toBe('436px');
    nextWidth = 380;
    act(() => asLocalChrome());
    rerender(<BrowserPanel {...base} />);
    expect(inset()).toBe('396px');
  });
});

describe('useBrowserPanelDockInset', () => {
  it('clears a stale inset when the panel shrinks to zero width', () => {
    const el = document.createElement('div');
    renderHook(() => useBrowserPanelDockInset(React.useRef(el), true));
    expect(inset()).toBe('436px');
    act(() => emit(observers[0]!, 0));
    expect(inset()).toBe('');
  });

  it('does nothing while disabled', () => {
    const el = document.createElement('div');
    renderHook(() => useBrowserPanelDockInset(React.useRef(el), false));
    expect(observers).toHaveLength(0);
    expect(inset()).toBe('');
  });
});
