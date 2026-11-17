import {
  type SelectedChromeSessionCommand,
  type SelectedChromeUploadAction,
  type UserBrowserTargetDescription,
  selectedChromeSessionCommandSchema,
  selectedChromeUploadCommandSchema,
} from '@holaday/shared-types';
import { describe, expect, it } from 'vitest';
import {
  type SelectedChromeDriver,
  SelectedChromeSession,
} from '../../../../extension/src/background/selected-chrome-session.js';
import type { ExtensionToolCallOptions, ExtensionToolCallOutcome } from '../../ws/server.js';
import { BrowserControl } from './browser-control.js';
import { SelectedChromeClient } from './selected-chrome-client.js';

const origin = 'https://work.example';
const token = '22222222-2222-4222-8222-222222222222';
const action: SelectedChromeUploadAction = {
  kind: 'upload',
  selector: {
    description: 'Report',
    strategies: [{ kind: 'css', value: '#report' }],
    scope: { timeoutMs: 2000 },
    selfHeal: false,
  },
  payload: {
    files: [
      {
        fileId: 'file_731',
        name: 'report.csv',
        mimeType: 'text/csv',
        sizeBytes: 3,
        sha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
      },
    ],
  },
};
const target: UserBrowserTargetDescription = {
  token,
  elementId: token,
  objectDigest: 'a'.repeat(64),
  tabId: 42,
  frameId: 'main',
  origin,
  observationRevision: 1,
  capturedAt: 1,
  page: { url: `${origin}/reports`, transactional: false },
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
    formOrigin: origin,
    formMethod: 'post',
    selectedCount: 0,
  },
};

/** Actual client/session/stager; only WS delivery and native DOM are boundaries. */
function fixture(requested = true, supported = true) {
  let revision = 0;
  const received: string[] = [];
  const commands: SelectedChromeSessionCommand[] = [];
  let active = true;
  let lose: SelectedChromeSessionCommand['op'] | null = null;
  let losses = 0;
  let cancelAfterChunk = false;
  const driver: SelectedChromeDriver = {
    attachExistingTab: async () => ({ status: 'ok', data: { tabId: 42 } }),
    observeCurrentPage: async () => ({
      status: 'ok',
      data: {
        tabId: 42,
        origin,
        title: 'Report',
        bodyText: received.length ? 'Selected report.csv' : 'Draft',
        ariaSnapshot: '',
        truncated: false,
        observationRevision: ++revision,
      },
    }),
    describeTarget: async (_action, expected) => ({
      status: 'ok',
      data: {
        ...target,
        observationRevision: expected,
      },
    }),
    execute: async () => ({ status: 'ok' }),
    executeBound: async () => ({ status: 'ok' }),
    ...(supported
      ? ({
          uploadBound: async (_action, _binding, files, allowed) => {
            if (!allowed())
              return {
                status: 'error',
                error: { code: 'session_unavailable', message: 'stopped' },
              };
            received.push(...files.map((file) => new TextDecoder().decode(file.bytes)));
            return { status: 'ok' };
          },
        } satisfies Partial<SelectedChromeDriver>)
      : {}),
    dispose: async () => {},
  };
  const session = new SelectedChromeSession({ makeDriver: () => driver, owner: () => 'alice' });
  const control = new BrowserControl();
  const send = async (
    _user: string,
    input: ExtensionToolCallOptions,
  ): Promise<ExtensionToolCallOutcome> => {
    const command = selectedChromeSessionCommandSchema.parse(input.args?.session);
    commands.push(command);
    let result: unknown;
    if (command.op === 'open')
      result = await session.open({
        taskId: input.taskId!,
        tabId: command.target.tabId,
        validate: async () => {},
        protocol: command.protocol,
        grantedOrigins: command.grantedOrigins,
      });
    else if (command.op === 'close')
      result = { ...(await session.close(input.taskId!, command.sessionId)), closed: true };
    else if (command.op === 'observe')
      result = await session.observe(input.taskId!, command.sessionId);
    else if (command.op.startsWith('upload_')) {
      result = await session.upload(
        input.taskId!,
        selectedChromeUploadCommandSchema.parse(command),
      );
      if (command.op === 'upload_chunk' && cancelAfterChunk) active = false;
    } else throw new Error(`unexpected fixture command ${command.op}`);
    if (command.op === lose && losses-- > 0)
      return { ok: false, error: { code: 'timeout', message: 'lost reply after delivery' } };
    return { ok: (result as { ok: boolean }).ok, result };
  };
  const client = new SelectedChromeClient({
    userId: 'alice',
    taskId: 'task-a',
    extensionClientId: 'chrome-a',
    routingV2: true,
    taskFilesV1: requested,
    control,
    send,
  });
  const sources = {
    current: async () => active,
    resolve: async () => [
      { fileId: 'file_731', name: 'report.csv', mimeType: 'text/csv', buffer: Buffer.from('abc') },
    ],
  };
  return {
    client,
    control,
    commands,
    received,
    sources,
    open: () => client.open({ tabId: 42, expectedUrl: origin, selectionId: token }),
    lose: (op: SelectedChromeSessionCommand['op'], count = 1) => {
      lose = op;
      losses = count;
    },
    cancelOnChunk: () => {
      cancelAfterChunk = true;
    },
    cancel: () => {
      active = false;
    },
  };
}

describe('selected Chrome client bound task file protocol', () => {
  it('negotiates optional bytes and delivers verified content through actual session staging', async () => {
    const h = fixture();
    expect(await h.open()).toMatchObject({ ok: true });
    try {
      expect(h.client.fileUploadsEnabled).toBe(true);
      expect(await h.client.describeUpload(action, h.client.revision)).toMatchObject({ ok: true });
      const result = await h.client.upload(action, h.client.revision, h.sources);
      expect(result).toMatchObject({
        ok: true,
        uploadReceipt: { status: 'handed_to_page', files: [{ fileId: 'file_731', sizeBytes: 3 }] },
      });
      expect(h.received).toEqual(['abc']);
      expect(await h.client.upload(action, h.client.revision, h.sources)).toMatchObject({
        ok: false,
      });
      expect(h.received).toEqual(['abc']);
    } finally {
      await h.client.close();
    }
  });
  it.each([
    [false, true],
    [true, false],
  ])('does not upgrade unrequested or unsupported upload (%s/%s)', async (requested, supported) => {
    const h = fixture(requested, supported);
    expect(await h.open()).toMatchObject({ ok: true });
    try {
      expect(await h.client.describeUpload(action, h.client.revision)).toMatchObject({
        ok: false,
        error: 'capability_missing',
      });
      expect(h.received).toEqual([]);
    } finally {
      await h.client.close();
    }
  });
  it('rejects same-size substituted bytes before any upload is staged', async () => {
    const h = fixture();
    await h.open();
    try {
      await h.client.describeUpload(action, h.client.revision);
      const result = await h.client.upload(action, h.client.revision, {
        ...h.sources,
        resolve: async () => [{ ...(await h.sources.resolve())[0]!, buffer: Buffer.from('xyz') }],
      });
      expect(result).toMatchObject({
        ok: false,
        error: 'file_payload_invalid',
        actionOutcome: 'not_applied',
      });
      expect(h.commands.some((command) => command.op === 'upload_begin')).toBe(false);
      expect(h.received).toEqual([]);
    } finally {
      await h.client.close();
    }
  });
  it.each(['upload_begin', 'upload_chunk', 'upload_commit'] as const)(
    'reconciles lost %s by repeating the same transfer without another native selection',
    async (op) => {
      const h = fixture();
      await h.open();
      try {
        await h.client.describeUpload(action, h.client.revision);
        h.lose(op);
        expect(await h.client.upload(action, h.client.revision, h.sources)).toMatchObject({
          ok: true,
          uploadReceipt: { status: 'handed_to_page' },
        });
        expect(h.received).toEqual(['abc']);
        const attempts = h.commands.filter((command) => command.op === op);
        expect(attempts).toHaveLength(2);
        expect(attempts[0]).toEqual(attempts[1]);
      } finally {
        await h.client.close();
      }
    },
  );
  it('stops on an unconfirmed commit and never turns it into another selection', async () => {
    const h = fixture();
    await h.open();
    try {
      await h.client.describeUpload(action, h.client.revision);
      h.lose('upload_commit', 2);
      expect(await h.client.upload(action, h.client.revision, h.sources)).toMatchObject({
        ok: false,
        actionOutcome: 'unknown',
      });
      expect(h.received).toEqual(['abc']);
      expect(h.control.canAgentAct()).toBe(false);
      expect(await h.client.upload(action, h.client.revision, h.sources)).toMatchObject({
        ok: false,
      });
      expect(h.received).toEqual(['abc']);
    } finally {
      await h.client.close();
    }
  });
  it('aborts staged bytes when the original task scope disappears between chunks and commit', async () => {
    const h = fixture();
    await h.open();
    try {
      await h.client.describeUpload(action, h.client.revision);
      h.cancelOnChunk();
      expect(await h.client.upload(action, h.client.revision, h.sources)).toMatchObject({
        ok: false,
        actionOutcome: 'not_applied',
      });
      expect(h.commands.some((command) => command.op === 'upload_abort')).toBe(true);
      expect(h.commands.some((command) => command.op === 'upload_commit')).toBe(false);
      expect(h.received).toEqual([]);
    } finally {
      await h.client.close();
    }
  });
  it('drops a prepared upload after a fresh observation instead of reusing an old node plan', async () => {
    const h = fixture();
    await h.open();
    try {
      await h.client.describeUpload(action, h.client.revision);
      await h.client.observe();
      expect(await h.client.upload(action, h.client.revision, h.sources)).toMatchObject({
        ok: false,
        error: 'target_binding_required',
      });
      expect(h.received).toEqual([]);
    } finally {
      await h.client.close();
    }
  });
  it('rechecks synchronous admission after a slow final scope check before commit', async () => {
    const h = fixture();
    await h.open();
    let started!: () => void;
    let release!: () => void;
    const checking = new Promise<void>((resolve) => {
      started = resolve;
    });
    const resumed = new Promise<void>((resolve) => {
      release = resolve;
    });
    await h.client.describeUpload(action, h.client.revision);
    const pending = h.client.upload(action, h.client.revision, {
      ...h.sources,
      current: async () => {
        if (h.commands.some((command) => command.op === 'upload_chunk')) {
          started();
          await resumed;
        }
        return true;
      },
    });
    await checking;
    const closed = h.client.close();
    try {
      release();
      await pending;
      await closed;
      expect(h.received).toEqual([]);
      expect(h.commands.some((command) => command.op === 'upload_commit')).toBe(false);
    } finally {
      release();
      await pending;
      await closed;
    }
  });
  it('revalidates original file availability after staging before native commit', async () => {
    const h = fixture();
    await h.open();
    let reads = 0;
    try {
      await h.client.describeUpload(action, h.client.revision);
      const result = await h.client.upload(action, h.client.revision, {
        ...h.sources,
        resolve: async () => {
          if (++reads > 1) throw new Error('original file expired or removed');
          return h.sources.resolve();
        },
      });
      expect(result).toMatchObject({ ok: false, actionOutcome: 'not_applied' });
      expect(h.received).toEqual([]);
      expect(h.commands.some((command) => command.op === 'upload_abort')).toBe(true);
    } finally {
      await h.client.close();
    }
  });
});
