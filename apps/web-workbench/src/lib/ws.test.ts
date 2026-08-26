// @vitest-environment happy-dom

import type { ServerMessage } from '@holaday/shared-types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sockets: FakeWebSocket[] = [];
let disconnectCurrent: (() => void) | null = null;

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  sockets.length = 0;
  disconnectCurrent = null;
  vi.stubGlobal('WebSocket', FakeWebSocket);
  vi.stubGlobal('localStorage', memoryStorage());
  vi.stubGlobal('sessionStorage', memoryStorage());
  window.localStorage.setItem('holaday.access_token', 'access-token');
});

afterEach(() => {
  disconnectCurrent?.();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('web workbench WebSocket connection identity', () => {
  it('drops every callback from a disconnected socket without affecting its replacement', async () => {
    const wsClient = await import('./ws');
    disconnectCurrent = wsClient.disconnect;
    const statuses: string[] = [];
    const messages: ServerMessage[] = [];
    wsClient.onStatus((status) => statuses.push(status));
    wsClient.onServerMessage((message) => messages.push(message));

    wsClient.connect();
    const oldSocket = socketAt(0);
    wsClient.disconnect();
    wsClient.connect();
    const currentSocket = socketAt(1);
    currentSocket.emitOpen();
    const currentSendCount = currentSocket.sent.length;

    oldSocket.emitOpen();
    oldSocket.emitMessage({
      type: 'server.task.progress',
      taskId: 'tsk_old',
      message: 'old progress',
    });
    oldSocket.emitClose(1006);
    oldSocket.emitError();

    expect(currentSocket.sent).toHaveLength(currentSendCount);
    expect(messages).toEqual([]);
    expect(wsClient.isConnected()).toBe(true);
    expect(statuses.at(-1)).toBe('open');
    vi.advanceTimersByTime(31_000);
    expect(sockets).toHaveLength(2);

    currentSocket.emitMessage({
      type: 'server.task.progress',
      taskId: 'tsk_current',
      message: 'current progress',
    });
    expect(messages).toMatchObject([
      {
        type: 'server.task.progress',
        taskId: 'tsk_current',
        message: 'current progress',
      },
    ]);
  });
});

describe('account closure WebSocket cleanup', () => {
  it('keeps the task store empty when queued frames arrive from the disconnected session', async () => {
    const wsClient = await import('./ws');
    const { clearCurrentDeviceClosureData } = await import('./account-closure-state');
    const { useTaskStore } = await import('@/stores/task-store');
    disconnectCurrent = wsClient.disconnect;
    const unsubscribe = wsClient.onServerMessage((message) => {
      useTaskStore.getState().applyServerMessage(message);
    });
    useTaskStore.setState({
      tasks: [
        {
          taskId: 'tsk_old',
          intent: 'private task',
          title: null,
          status: 'executing',
          tickCount: 1,
          createdAt: new Date('2026-08-26T00:00:00.000Z'),
        },
      ],
    });
    wsClient.connect();
    const oldSocket = socketAt(0);

    clearCurrentDeviceClosureData();
    oldSocket.emitMessage({
      type: 'server.task.progress',
      taskId: 'tsk_old',
      message: 'old progress',
    });
    oldSocket.emitMessage({
      type: 'server.task.stream',
      taskId: 'tsk_old',
      delta: 'private old stream',
    });
    oldSocket.emitMessage({
      type: 'server.supercar.awaiting_user',
      taskId: 'tsk_old',
      question: 'private old question',
      awaitingKind: 'clarification',
    });

    const state = useTaskStore.getState();
    expect(state.tasks).toEqual([]);
    expect(state.progressByTask).toEqual({});
    expect(state.streamingByTask).toEqual({});
    expect(state.awaitingUserByTask).toEqual({});
    unsubscribe();
  });
});

function socketAt(index: number): FakeWebSocket {
  const socket = sockets[index];
  if (!socket) throw new Error(`Expected WebSocket ${index}`);
  return socket;
}

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
}

class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readonly sent: string[] = [];
  readyState = FakeWebSocket.CONNECTING;
  private readonly listeners = new Map<string, Set<(event: unknown) => void>>();

  constructor(
    readonly url: string,
    readonly protocols?: string | string[],
  ) {
    sockets.push(this);
  }

  addEventListener(type: string, listener: (event: unknown) => void): void {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  close(): void {
    this.readyState = FakeWebSocket.CLOSING;
  }

  send(data: string): void {
    this.sent.push(data);
  }

  emitOpen(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.emit('open', {});
  }

  emitMessage(message: ServerMessage): void {
    this.emit('message', { data: JSON.stringify(message) });
  }

  emitClose(code: number): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.emit('close', { code });
  }

  emitError(): void {
    this.emit('error', {});
  }

  private emit(type: string, event: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}
