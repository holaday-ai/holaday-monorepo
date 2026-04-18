import { describe, expect, it } from 'vitest';
import { MockDriver } from './mock.js';

describe('MockDriver', () => {
  it('default responds ok with stub data for any kind', async () => {
    const d = new MockDriver();
    const res = await d.execute({ kind: 'click' });
    expect(res.status).toBe('ok');
    expect(res.data).toEqual({ stub: true, kind: 'click' });
  });

  it('per-kind handler overrides default', async () => {
    const d = new MockDriver().on('extract', async (action) => ({
      status: 'ok',
      data: { resolvedKind: action.kind, got: 42 },
    }));
    const res = await d.execute({ kind: 'extract' });
    expect(res.data).toEqual({ resolvedKind: 'extract', got: 42 });
  });

  it('handler can signal awaiting_user (e.g. login page detected)', async () => {
    const d = new MockDriver().on('goto', async () => ({
      status: 'awaiting_user',
      data: { prompt: '请先登录抖音商家号' },
    }));
    const res = await d.execute({
      kind: 'goto',
      payload: { url: 'https://compass.jinritemai.com/' },
    });
    expect(res.status).toBe('awaiting_user');
  });

  it('handler can signal error', async () => {
    const d = new MockDriver().on('click', async () => ({
      status: 'error',
      error: { code: 'CLICK_FAILED', message: 'obscured by modal' },
    }));
    const res = await d.execute({ kind: 'click' });
    expect(res.status).toBe('error');
    expect(res.error?.code).toBe('CLICK_FAILED');
  });

  it('dispose clears handlers', async () => {
    const d = new MockDriver().on('click', async () => ({
      status: 'ok',
      data: { custom: true },
    }));
    await d.dispose();
    const res = await d.execute({ kind: 'click' });
    // Back to default stub path.
    expect(res.data).toEqual({ stub: true, kind: 'click' });
  });

  it('autoAckDelayMs inserts a measurable delay before the default ack', async () => {
    const d = new MockDriver({ autoAckDelayMs: 100 });
    const t0 = Date.now();
    await d.execute({ kind: 'wait' });
    expect(Date.now() - t0).toBeGreaterThanOrEqual(90);
  });
});
