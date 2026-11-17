import type { DriverAction, DriverResult, VerifiedTaskFile } from '@holaday/browser-driver';
import {
  type SelectedChromeUploadCommand,
  USER_BROWSER_PROTOCOL,
  selectedChromeSessionCommandSchema,
} from '@holaday/shared-types';
import { describe, expect, it } from 'vitest';
import { SelectedChromeSession, type SessionReply } from './selected-chrome-session.js';

const capability = 'task_file_upload_v1';
const token = '22222222-2222-4222-8222-222222222222';
const file = {
  fileId: 'file_731',
  name: 'report.csv',
  mimeType: 'text/csv',
  sizeBytes: 3,
  sha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
};
const action = {
  kind: 'upload',
  selector: { description: 'Report', strategies: [{ kind: 'css', value: '#report' }] },
  payload: { files: [file] },
};
function command(input: unknown): SelectedChromeUploadCommand {
  return selectedChromeSessionCommandSchema.parse(input) as SelectedChromeUploadCommand;
}
function ok(reply: SessionReply) {
  if (!reply.ok) throw new Error(reply.error);
  return reply;
}
function harness(mode: 'success' | 'unknown' | 'changed' | 'paused' = 'success', supports = true) {
  let owner = 'alice';
  let revision = 0;
  let deliveries = 0;
  const received: string[] = [];
  let started!: () => void;
  let release!: () => void;
  const issued = new Promise<void>((resolve) => {
    started = resolve;
  });
  const resumed = new Promise<void>((resolve) => {
    release = resolve;
  });
  const driver = {
    attachExistingTab: async (): Promise<DriverResult> => ({ status: 'ok', data: { tabId: 42 } }),
    observeCurrentPage: async (): Promise<DriverResult> => ({
      status: 'ok',
      data: {
        tabId: 42,
        origin: 'https://work.example',
        title: 'Report',
        bodyText: deliveries ? 'Selected report.csv' : 'Draft',
        ariaSnapshot: '',
        truncated: false,
        observationRevision: ++revision,
      },
    }),
    describeTarget: async (_action: DriverAction, expected: number): Promise<DriverResult> => ({
      status: 'ok',
      data: {
        token,
        elementId: token,
        objectDigest: 'a'.repeat(64),
        tabId: 42,
        frameId: 'main',
        origin: 'https://work.example',
        observationRevision: expected,
        capturedAt: 1,
        page: { url: 'https://work.example/reports', transactional: false },
        element: {
          role: 'textbox',
          visibleText: null,
          ariaLabel: 'Report',
          title: null,
          placeholder: null,
          name: 'report',
          inputType: 'file',
          tagName: 'input',
        },
        form: null,
        fileInput: {
          accept: '.csv',
          multiple: false,
          disabled: false,
          directory: false,
          credentialForm: false,
          formOrigin: 'https://work.example',
          formMethod: 'get',
          selectedCount: 0,
        },
      },
    }),
    execute: async (): Promise<DriverResult> => ({ status: 'ok' }),
    executeBound: async (): Promise<DriverResult> => ({ status: 'ok' }),
    ...(supports
      ? {
          uploadBound: async (
            _action: DriverAction,
            _binding: unknown,
            files: readonly VerifiedTaskFile[],
            dispatchAllowed?: () => boolean,
          ): Promise<DriverResult> => {
            if (mode === 'paused') {
              started();
              await resumed;
              if (dispatchAllowed?.() === false)
                return {
                  status: 'error',
                  error: { code: 'session_unavailable', message: 'cancelled before dispatch' },
                };
            }
            if (mode === 'changed')
              return { status: 'error', error: { code: 'target_changed', message: 'changed' } };
            deliveries++;
            received.push(...files.map((value) => new TextDecoder().decode(value.bytes)));
            return mode === 'unknown'
              ? { status: 'error', error: { code: 'input_outcome_unknown', message: 'ack lost' } }
              : { status: 'ok' };
          },
        }
      : {}),
    dispose: async () => {},
  };
  const session = new SelectedChromeSession({ makeDriver: () => driver, owner: () => owner });
  return {
    session,
    received,
    issued,
    release,
    deliveries: () => deliveries,
    setOwner: (value: string) => {
      owner = value;
    },
    open: async (enabled = true) =>
      ok(
        await session.open({
          taskId: 'task-a',
          tabId: 42,
          validate: async () => {},
          protocol: {
            ...USER_BROWSER_PROTOCOL,
            capabilities: [...USER_BROWSER_PROTOCOL.capabilities, ...(enabled ? [capability] : [])],
          },
          grantedOrigins: ['https://work.example'],
        }),
      ),
  };
}
async function prepare(h: ReturnType<typeof harness>, sessionId: string) {
  const described = ok(
    await h.session.upload(
      'task-a',
      command({ op: 'upload_describe', sessionId, action, observationRevision: 1 }),
    ),
  );
  const binding = {
    token: described.target!.token,
    observationRevision: described.target!.observationRevision,
  };
  const beginCommand = command({ op: 'upload_begin', sessionId, action, binding });
  const begun = ok(await h.session.upload('task-a', beginCommand));
  if (begun.uploadState?.phase !== 'begun') throw new Error('missing upload begin receipt');
  return { transferId: begun.uploadState.transferId, beginCommand };
}

describe('optional bound file channel through the real selected session', () => {
  it('stops upload admission while native preparation is still pending', async () => {
    const h = harness('paused');
    const opened = await h.open();
    const p = await prepare(h, opened.sessionId);
    await h.session.upload(
      'task-a',
      command({
        op: 'upload_chunk',
        sessionId: opened.sessionId,
        transferId: p.transferId,
        fileIndex: 0,
        offset: 0,
        data: 'YWJj',
      }),
    );
    const pending = h.session.upload(
      'task-a',
      command({ op: 'upload_commit', sessionId: opened.sessionId, transferId: p.transferId }),
    );
    await h.issued;
    try {
      h.session.stopUploadAdmission('task-a');
    } finally {
      h.release();
      await pending;
      await h.session.close('task-a', opened.sessionId);
    }
    expect(h.deliveries()).toBe(0);
  });
  it('strictly accepts bounded file commands and rejects paths or arbitrary action payloads', () => {
    expect(
      selectedChromeSessionCommandSchema.safeParse({
        op: 'upload_describe',
        sessionId: token,
        action,
        observationRevision: 1,
      }).success,
    ).toBe(true);
    expect(
      selectedChromeSessionCommandSchema.safeParse({
        op: 'upload_describe',
        sessionId: token,
        action: { ...action, payload: { files: [{ ...file, path: '/Users/private.csv' }] } },
        observationRevision: 1,
      }).success,
    ).toBe(false);
    expect(
      selectedChromeSessionCommandSchema.safeParse({ op: 'act', sessionId: token, action }).success,
    ).toBe(false);
    expect(
      selectedChromeSessionCommandSchema.safeParse({
        op: 'upload_chunk',
        sessionId: token,
        transferId: token,
        fileIndex: 0,
        offset: 0,
        data: 'data:secret',
      }).success,
    ).toBe(false);
  });

  it('negotiates the optional channel and stages no website effect before a verified commit', async () => {
    const h = harness();
    const opened = await h.open();
    expect(opened.protocol?.capabilities).toContain(capability);
    const p = await prepare(h, opened.sessionId);
    const duplicate = ok(await h.session.upload('task-a', p.beginCommand));
    expect(duplicate.uploadState).toEqual({ phase: 'begun', transferId: p.transferId });
    const part = command({
      op: 'upload_chunk',
      sessionId: opened.sessionId,
      transferId: p.transferId,
      fileIndex: 0,
      offset: 0,
      data: 'YWJj',
    });
    expect(ok(await h.session.upload('task-a', part)).uploadState).toEqual({
      phase: 'progress',
      transferId: p.transferId,
      fileIndex: 0,
      nextOffset: 3,
    });
    await h.session.upload('task-a', part);
    expect(h.deliveries()).toBe(0);
    const commit = command({
      op: 'upload_commit',
      sessionId: opened.sessionId,
      transferId: p.transferId,
    });
    const first = ok(await h.session.upload('task-a', commit));
    expect(first.uploadState).toMatchObject({
      phase: 'finished',
      receipt: { status: 'handed_to_page', transferId: p.transferId, files: [file] },
    });
    const second = ok(await h.session.upload('task-a', commit));
    expect(second.uploadState).toEqual(first.uploadState);
    expect(h.received).toEqual(['abc']);
    await h.session.close('task-a', opened.sessionId);
  });

  it.each([false, true])(
    'does not upgrade a session without a requested or supported capability: requested=%s',
    async (requested) => {
      const h = harness('success', !requested);
      const opened = await h.open(requested);
      expect(opened.protocol?.capabilities).not.toContain(capability);
      const reply = await h.session.upload(
        'task-a',
        command({
          op: 'upload_describe',
          sessionId: opened.sessionId,
          action,
          observationRevision: 1,
        }),
      );
      expect(reply).toMatchObject({ ok: false, error: 'capability_missing' });
      expect(h.deliveries()).toBe(0);
      await h.session.close('task-a', opened.sessionId);
    },
  );

  it('rejects another task, another owner and commands after closure', async () => {
    const h = harness();
    const opened = await h.open();
    const p = await prepare(h, opened.sessionId);
    const part = command({
      op: 'upload_chunk',
      sessionId: opened.sessionId,
      transferId: p.transferId,
      fileIndex: 0,
      offset: 0,
      data: 'YWJj',
    });
    expect(await h.session.upload('task-b', part)).toMatchObject({
      ok: false,
      error: 'session_unavailable',
    });
    h.setOwner('bob');
    expect(await h.session.upload('task-a', part)).toMatchObject({
      ok: false,
      error: 'session_unavailable',
    });
    h.setOwner('alice');
    await h.session.close('task-a', opened.sessionId);
    expect(await h.session.upload('task-a', part)).toMatchObject({
      ok: false,
      error: 'session_unavailable',
    });
    expect(h.deliveries()).toBe(0);
  });

  it('retains an unknown receipt without repeating the native input or permitting another upload', async () => {
    const h = harness('unknown');
    const opened = await h.open();
    const p = await prepare(h, opened.sessionId);
    await h.session.upload(
      'task-a',
      command({
        op: 'upload_chunk',
        sessionId: opened.sessionId,
        transferId: p.transferId,
        fileIndex: 0,
        offset: 0,
        data: 'YWJj',
      }),
    );
    const commit = command({
      op: 'upload_commit',
      sessionId: opened.sessionId,
      transferId: p.transferId,
    });
    expect(ok(await h.session.upload('task-a', commit)).uploadState).toMatchObject({
      phase: 'finished',
      receipt: { status: 'unknown' },
    });
    expect(ok(await h.session.upload('task-a', commit)).uploadState).toMatchObject({
      phase: 'finished',
      receipt: { status: 'unknown' },
    });
    expect(
      await h.session.upload(
        'task-a',
        command({
          op: 'upload_describe',
          sessionId: opened.sessionId,
          action,
          observationRevision: 2,
        }),
      ),
    ).toMatchObject({ ok: false, error: 'input_outcome_unknown' });
    expect(h.deliveries()).toBe(1);
    await h.session.close('task-a', opened.sessionId);
  });

  it('distinguishes a stale bound target from a native action with an unknown result', async () => {
    const h = harness('changed');
    const opened = await h.open();
    const p = await prepare(h, opened.sessionId);
    await h.session.upload(
      'task-a',
      command({
        op: 'upload_chunk',
        sessionId: opened.sessionId,
        transferId: p.transferId,
        fileIndex: 0,
        offset: 0,
        data: 'YWJj',
      }),
    );
    expect(
      ok(
        await h.session.upload(
          'task-a',
          command({ op: 'upload_commit', sessionId: opened.sessionId, transferId: p.transferId }),
        ),
      ).uploadState,
    ).toMatchObject({
      phase: 'finished',
      receipt: { status: 'not_applied', reason: 'target_changed' },
    });
    expect(h.deliveries()).toBe(0);
    await h.session.close('task-a', opened.sessionId);
  });
});
