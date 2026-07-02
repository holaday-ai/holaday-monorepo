import { describe, expect, it } from 'vitest';
import {
  buildSupercarWaitingUserMessage,
  classifySupercarTaskStateTransition,
  shouldPersistSupercarTerminalOutcome,
  shouldRunSupercarTerminalSideEffects,
  supercarResponseLayerTerminalStatus,
} from './task-state-machine.js';

describe('classifySupercarTaskStateTransition', () => {
  it('keeps awaiting_user as a waiting-user transition instead of downgrading to paused', () => {
    expect(
      classifySupercarTaskStateTransition({
        status: 'awaiting_user',
        question: '需要登录后继续。',
      }),
    ).toEqual({
      kind: 'waiting_user',
      awaitingKind: 'clarification',
      question: '需要登录后继续。',
    });
  });

  it('uses summary as the fallback question for awaiting_user outcomes', () => {
    expect(
      classifySupercarTaskStateTransition({
        status: 'awaiting_user',
        question: ' ',
        summary: '请补充目标平台。',
      }),
    ).toEqual({
      kind: 'waiting_user',
      awaitingKind: 'clarification',
      question: '请补充目标平台。',
    });
  });

  it('keeps completed, failed, timeout, cancelled, and generate handoff outcomes terminal', () => {
    for (const status of [
      'completed',
      'failed',
      'timeout',
      'cancelled',
      'handoff_to_generate',
    ] as const) {
      expect(classifySupercarTaskStateTransition({ status })).toEqual({
        kind: 'terminal',
      });
    }
  });

  it('does not run terminal side effects for parked awaiting_user outcomes', () => {
    expect(
      shouldRunSupercarTerminalSideEffects({
        transition: { kind: 'waiting_user', awaitingKind: 'clarification', question: '继续？' },
        persisted: true,
      }),
    ).toBe(false);
    expect(
      shouldRunSupercarTerminalSideEffects({
        transition: { kind: 'terminal' },
        persisted: true,
      }),
    ).toBe(true);
    expect(
      shouldRunSupercarTerminalSideEffects({
        transition: { kind: 'terminal' },
        persisted: false,
      }),
    ).toBe(false);
  });
});

describe('shouldPersistSupercarTerminalOutcome', () => {
  it('refuses awaiting_user outcomes so they cannot be downgraded to paused terminal writes', () => {
    expect(shouldPersistSupercarTerminalOutcome('awaiting_user')).toBe(false);
  });

  it('allows every non-awaiting supercar outcome through the terminal persistence helper', () => {
    for (const status of [
      'completed',
      'failed',
      'timeout',
      'cancelled',
      'handoff_to_generate',
    ] as const) {
      expect(shouldPersistSupercarTerminalOutcome(status)).toBe(true);
    }
  });
});

describe('supercarResponseLayerTerminalStatus', () => {
  it('allows every user-visible terminal status, including partial_success', () => {
    for (const status of ['completed', 'partial_success', 'failed', 'cancelled'] as const) {
      expect(supercarResponseLayerTerminalStatus(status)).toBe(status);
    }
  });

  it('refuses parked or recoverable non-terminal states', () => {
    expect(supercarResponseLayerTerminalStatus('awaiting_user')).toBeNull();
    expect(supercarResponseLayerTerminalStatus('paused')).toBeNull();
    expect(supercarResponseLayerTerminalStatus(null)).toBeNull();
  });
});

describe('buildSupercarWaitingUserMessage', () => {
  it('emits the dedicated awaiting_user websocket frame, never a paused terminal frame', () => {
    expect(
      buildSupercarWaitingUserMessage({
        taskId: 'tsk_wait',
        transition: {
          kind: 'waiting_user',
          awaitingKind: 'clarification',
          question: '需要补充登录信息。',
        },
      }),
    ).toEqual({
      type: 'server.supercar.awaiting_user',
      taskId: 'tsk_wait',
      awaitingKind: 'clarification',
      question: '需要补充登录信息。',
    });
  });
});
