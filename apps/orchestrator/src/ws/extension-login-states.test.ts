/**
 * Phase 14 — schema tests for the extension login-state message.
 * Server-side handler is exercised via the integration suite (the
 * map is module-private in server.ts); this file just nails down
 * the wire format so any drift in the discriminated union surfaces
 * as a failing test rather than a runtime BAD_FRAME log.
 */

import { parseClientMessage, parseServerMessage } from '@holaday/shared-types';
import { describe, expect, it } from 'vitest';

describe('client.extension.login_states schema', () => {
  it('accepts a non-empty domain → boolean map', () => {
    const result = parseClientMessage(
      JSON.stringify({
        type: 'client.extension.login_states',
        states: { 'jd.com': true, 'taobao.com': false },
      }),
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe('client.extension.login_states');
      if (result.data.type === 'client.extension.login_states') {
        expect(result.data.states['jd.com']).toBe(true);
        expect(result.data.states['taobao.com']).toBe(false);
      }
    }
  });

  it('accepts an empty states object', () => {
    const result = parseClientMessage(
      JSON.stringify({ type: 'client.extension.login_states', states: {} }),
    );
    expect(result.success).toBe(true);
  });

  it('rejects non-boolean values', () => {
    const result = parseClientMessage(
      JSON.stringify({
        type: 'client.extension.login_states',
        states: { 'jd.com': 'yes' },
      }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects more than 32 domain entries', () => {
    const states: Record<string, boolean> = {};
    for (let i = 0; i < 33; i += 1) states[`d${i}.com`] = i % 2 === 0;
    const result = parseClientMessage(
      JSON.stringify({ type: 'client.extension.login_states', states }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects missing type discriminator', () => {
    const result = parseClientMessage(JSON.stringify({ states: { 'jd.com': true } }));
    expect(result.success).toBe(false);
  });

  it('rejects malformed json', () => {
    const result = parseClientMessage('{bad json');
    expect(result.success).toBe(false);
  });
});

describe('classic client frame schemas', () => {
  it('accepts bounded step results and screenshots', () => {
    expect(
      parseClientMessage(
        JSON.stringify({
          type: 'client.step.result',
          taskId: 'tsk_schema',
          stepId: 'stp_schema',
          status: 'error',
          error: { code: 'exec_error', message: 'failed cleanly' },
        }),
      ).success,
    ).toBe(true);

    expect(
      parseClientMessage(
        JSON.stringify({
          type: 'client.screenshot',
          taskId: 'tsk_schema',
          stepId: 'stp_schema',
          key: 'screenshots/tsk_schema/stp_schema.jpg',
          width: 1280,
          height: 720,
        }),
      ).success,
    ).toBe(true);
  });

  it('rejects oversized classic client frame diagnostics and metadata', () => {
    const cases = [
      {
        type: 'client.step.result',
        taskId: 'tsk_schema',
        stepId: 'stp_schema',
        status: 'error',
        error: { code: 'x'.repeat(65), message: 'failed cleanly' },
      },
      {
        type: 'client.step.result',
        taskId: 'tsk_schema',
        stepId: 'stp_schema',
        status: 'error',
        error: { code: 'exec_error', message: 'x'.repeat(2001) },
      },
      {
        type: 'client.screenshot',
        taskId: 'tsk_schema',
        stepId: 'stp_schema',
        key: 'x'.repeat(1025),
        width: 1280,
        height: 720,
      },
      {
        type: 'client.screenshot',
        taskId: 'tsk_schema',
        stepId: 'stp_schema',
        key: 'screenshots/tsk_schema/stp_schema.jpg',
        width: 20_001,
        height: 720,
      },
    ];

    for (const frame of cases) {
      expect(parseClientMessage(JSON.stringify(frame)).success).toBe(false);
    }
  });
});

describe('client.vision.acted schema', () => {
  it('accepts bounded action diagnostics', () => {
    const result = parseClientMessage(
      JSON.stringify({
        type: 'client.vision.acted',
        taskId: 'tsk_vision_schema',
        tickIndex: 0,
        ok: false,
        message: 'CDP error: target closed',
      }),
    );

    expect(result.success).toBe(true);
  });

  it('rejects oversized action diagnostics', () => {
    const result = parseClientMessage(
      JSON.stringify({
        type: 'client.vision.acted',
        taskId: 'tsk_vision_schema',
        tickIndex: 0,
        ok: false,
        message: 'x'.repeat(1001),
      }),
    );

    expect(result.success).toBe(false);
  });
});

describe('client.vision.observation schema', () => {
  const baseObservation = {
    type: 'client.vision.observation',
    taskId: 'tsk_vision_schema',
    tickIndex: 0,
    screenshotBase64: 'AA==',
    viewportWidth: 1280,
    viewportHeight: 800,
    url: 'https://example.com/',
    title: 'Example',
  };

  it('accepts bounded screenshots and metadata', () => {
    const result = parseClientMessage(JSON.stringify(baseObservation));

    expect(result.success).toBe(true);
  });

  it('rejects oversized screenshots and metadata', () => {
    const cases = [
      { screenshotBase64: 'x'.repeat(2_000_001) },
      { viewportWidth: 20_001 },
      { viewportHeight: 20_001 },
      { url: `https://example.com/${'a'.repeat(2050)}` },
      { title: 'x'.repeat(513) },
      { error: 'x'.repeat(1001) },
    ];

    for (const patch of cases) {
      const result = parseClientMessage(
        JSON.stringify({
          ...baseObservation,
          ...patch,
        }),
      );

      expect(result.success).toBe(false);
    }
  });
});

describe('server.extension.tool_call schema', () => {
  it('accepts http(s) navigate urls', () => {
    const result = parseServerMessage(
      JSON.stringify({
        type: 'server.extension.tool_call',
        taskId: 'tsk_schema',
        requestId: 'req_schema',
        kind: 'navigate',
        args: { url: 'https://example.com/path', waitMs: 500 },
        timeoutMs: 30_000,
      }),
    );

    expect(result.success).toBe(true);
  });

  it('rejects non-web navigate urls before they reach the extension', () => {
    for (const url of ['ftp://example.com/file.txt', 'chrome://extensions']) {
      const result = parseServerMessage(
        JSON.stringify({
          type: 'server.extension.tool_call',
          taskId: 'tsk_schema',
          requestId: 'req_schema',
          kind: 'navigate',
          args: { url },
          timeoutMs: 30_000,
        }),
      );

      expect(result.success).toBe(false);
    }
  });
});

describe('server.vision.act schema', () => {
  it('accepts http(s) navigate actions', () => {
    const result = parseServerMessage(
      JSON.stringify({
        type: 'server.vision.act',
        taskId: 'tsk_vision_schema',
        tickIndex: 0,
        action: { kind: 'navigate', url: 'https://example.com/path' },
      }),
    );

    expect(result.success).toBe(true);
  });

  it('rejects non-web navigate actions before they reach the extension', () => {
    for (const url of ['ftp://example.com/file.txt', 'chrome://extensions']) {
      const result = parseServerMessage(
        JSON.stringify({
          type: 'server.vision.act',
          taskId: 'tsk_vision_schema',
          tickIndex: 0,
          action: { kind: 'navigate', url },
        }),
      );

      expect(result.success).toBe(false);
    }
  });

  it('rejects out-of-range driver actions before they reach Chrome CDP', () => {
    const actions = [
      { kind: 'click', x: -1, y: 10 },
      { kind: 'click', x: 10, y: 20_001 },
      { kind: 'scroll', dy: 10_000 },
      { kind: 'type', text: 'x'.repeat(4_001) },
      { kind: 'key', key: 'x'.repeat(65) },
    ];

    for (const action of actions) {
      const result = parseServerMessage(
        JSON.stringify({
          type: 'server.vision.act',
          taskId: 'tsk_vision_schema',
          tickIndex: 0,
          action,
        }),
      );

      expect(result.success).toBe(false);
    }
  });
});

describe('client.vision.user_input — kind=insert_text (CJK input bar)', () => {
  it('accepts insert_text with Chinese text', () => {
    const result = parseClientMessage(
      JSON.stringify({
        type: 'client.vision.user_input',
        kind: 'insert_text',
        text: '你好世界，搜索一下今天的天气',
      }),
    );
    expect(result.success).toBe(true);
    if (result.success && result.data.type === 'client.vision.user_input') {
      expect(result.data.kind).toBe('insert_text');
      expect(result.data.text).toBe('你好世界，搜索一下今天的天气');
    }
  });

  it('rejects insert_text with text > 4000 chars', () => {
    const result = parseClientMessage(
      JSON.stringify({
        type: 'client.vision.user_input',
        kind: 'insert_text',
        text: 'a'.repeat(4_001),
      }),
    );
    expect(result.success).toBe(false);
  });

  it('keeps the existing type/click/scroll/key kinds unchanged', () => {
    for (const kind of ['type', 'click', 'scroll', 'key'] as const) {
      const r = parseClientMessage(
        JSON.stringify({ type: 'client.vision.user_input', kind, text: 'x' }),
      );
      expect(r.success).toBe(true);
    }
  });
});
