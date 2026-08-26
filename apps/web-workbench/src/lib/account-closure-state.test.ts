// @vitest-environment happy-dom

import { readEnergyProgress, recordEnergyCompletion } from '@/components/energy/energy-progress';
import { useTaskStore } from '@/stores/task-store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearCurrentDeviceClosureData,
  closureCountdownLabel,
  toClosureRecoveryView,
} from './account-closure-state';

describe('account closure recovery state', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', memoryStorage());
    vi.stubGlobal('sessionStorage', memoryStorage());
    useTaskStore.getState().reset();
  });

  afterEach(() => vi.unstubAllGlobals());

  it.each([
    ['pending_grace', 'grace', true],
    ['processing', 'processing', false],
    ['needs_attention', 'attention', false],
    ['completed', 'completed', false],
  ] as const)('maps %s to the truthful recovery view', (requestStatus, kind, canCancel) => {
    expect(
      toClosureRecoveryView(
        {
          requestStatus,
          requestedAt: '2026-08-26T01:00:00.000Z',
          graceEndsAt: '2026-09-02T01:00:00.000Z',
          completedAt: requestStatus === 'completed' ? '2026-09-02T01:15:00.000Z' : null,
          cancelledAt: null,
          canCancel,
          plan: { name: 'pro', expiresAt: '2026-12-31T00:00:00.000Z' },
          mfaRequired: true,
        },
        'ACR-7K2P9',
      ),
    ).toEqual(
      kind === 'grace'
        ? {
            kind,
            graceEndsAt: '2026-09-02T01:00:00.000Z',
            receiptNumber: 'ACR-7K2P9',
            canCancel: true,
          }
        : { kind, receiptNumber: 'ACR-7K2P9', canCancel: false },
    );
  });

  it('uses the exact server deadline for the countdown and never rounds it into another day', () => {
    expect(
      closureCountdownLabel('2026-09-02T01:00:00.000Z', new Date('2026-08-31T23:58:59.000Z')),
    ).toBe('1天 1小时 1分');
    expect(
      closureCountdownLabel('2026-09-02T01:00:00.000Z', new Date('2026-09-02T01:00:00.000Z')),
    ).toBe('已进入处理阶段');
  });

  it('clears current-device account data while preserving only the recovery credential', () => {
    window.localStorage.setItem('holaday.access_token', 'access-token');
    window.localStorage.setItem('holaday.cosmic.profile.v1.usr_1', '{"birthday":"1990-01-01"}');
    window.localStorage.setItem('holaday.energy.progress.v4:usr_1', '{"recent":true}');
    window.localStorage.setItem('holaday.theme', 'light');
    window.sessionStorage.setItem('holaday.mfa_challenge', 'mfa-token');
    window.sessionStorage.setItem('holaday.cosmic.dismissed.task.task_1', '1');
    window.sessionStorage.setItem('holaday.closure_recovery', 'recovery-token');
    recordEnergyCompletion('usr_1', 'tarot', new Date('2026-08-26T00:00:00.000Z'));
    useTaskStore.setState({
      tasks: [
        {
          taskId: 'tsk_cached',
          intent: 'private cached task',
          title: null,
          status: 'completed',
          tickCount: 1,
          createdAt: new Date('2026-08-26T00:00:00.000Z'),
        },
      ],
    });

    clearCurrentDeviceClosureData();

    expect(window.localStorage.getItem('holaday.access_token')).toBeNull();
    expect(window.localStorage.getItem('holaday.cosmic.profile.v1.usr_1')).toBeNull();
    expect(window.localStorage.getItem('holaday.energy.progress.v4:usr_1')).toBeNull();
    expect(window.sessionStorage.getItem('holaday.mfa_challenge')).toBeNull();
    expect(window.sessionStorage.getItem('holaday.cosmic.dismissed.task.task_1')).toBeNull();
    expect(window.sessionStorage.getItem('holaday.closure_recovery')).toBe('recovery-token');
    expect(window.localStorage.getItem('holaday.theme')).toBe('light');
    expect(useTaskStore.getState().tasks).toEqual([]);
    expect(readEnergyProgress('usr_1').completedDates).toEqual([]);
  });
});

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
