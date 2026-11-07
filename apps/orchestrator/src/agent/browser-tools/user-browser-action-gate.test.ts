import { describe, expect, it, vi } from 'vitest';
import { classifyRuntimeAction } from '../supercar/runtime-action-policy.js';
import { createDescriptionActionGate, describeUserBrowserAction } from './unified-action-gate.js';
const action = {
  kind: 'click' as const,
  selector: {
    scope: { timeoutMs: 2000 },
    selfHeal: false,
    description: 'Search',
    strategies: [{ kind: 'css' as const, value: '#go' }],
  },
};
const target = {
  token: '00000000-0000-4000-8000-000000000001',
  elementId: '22222222-2222-4222-8222-222222222222',
  objectDigest: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  tabId: 3,
  frameId: 'main',
  origin: 'https://fixture.test',
  page: { url: 'https://fixture.test/search', transactional: false },
  observationRevision: 1,
  capturedAt: 1,
  element: {
    role: 'button',
    visibleText: '搜索',
    ariaLabel: null,
    title: null,
    placeholder: null,
    name: null,
    inputType: null,
    tagName: 'button',
  },
  form: null,
};
describe('Chrome uses unified onBeforeAction on host-read targets', () => {
  it('allows ordinary real button and asks for pay/delete despite benign model hint', async () => {
    for (const text of ['搜索', '确认支付', '删除项目']) {
      const description = describeUserBrowserAction(action, {
        ...target,
        element: { ...target.element, visibleText: text },
      });
      const park = vi.fn(async () => null);
      const gate = createDescriptionActionGate({
        describe: async () => description,
        onBeforeAction: classifyRuntimeAction,
        pageUrl: () => target.origin,
        park,
        aborted: () => false,
      });
      expect((await gate(action, 'before')).kind).toBe(text === '搜索' ? 'proceed' : 'stop');
      expect(park).toHaveBeenCalledTimes(text === '搜索' ? 0 : 1);
    }
  });
  it('Enter checks real payment form/amount and neutral or absent submit button', async () => {
    const description = describeUserBrowserAction(
      { kind: 'key', payload: { key: 'Enter' } },
      {
        ...target,
        element: { ...target.element, tagName: 'input' },
        form: {
          action: 'https://fixture.test/payment',
          method: 'post',
          fieldSignal: 'amount',
          hasAmountField: true,
          transactionalAction: true,
          searchLike: false,
          submitControl: null,
        },
      },
    );
    expect(description.transactional).toBeTruthy();
  });
  it('requires confirmation for generic submits but permits identified GET search', () => {
    const key = { kind: 'key' as const, payload: { key: 'Enter' } };
    const form = {
      action: 'https://fixture.test/save',
      method: 'post',
      fieldSignal: '',
      hasAmountField: false,
      transactionalAction: false,
      searchLike: false,
      submitControl: target.element,
    };
    expect(describeUserBrowserAction(key, { ...target, form }).unverified).toBeTruthy();
    expect(
      describeUserBrowserAction(key, {
        ...target,
        form: { ...form, method: 'get', searchLike: true },
      }).unverified,
    ).toBeNull();
  });
  it('confirmation cannot outlive cancellation or changed target', async () => {
    for (const cancelled of [true, false]) {
      let count = 0;
      const original = describeUserBrowserAction(action, {
        ...target,
        element: { ...target.element, visibleText: '删除项目' },
      });
      const gate = createDescriptionActionGate({
        describe: async () =>
          ++count === 1 ? original : describeUserBrowserAction(action, target),
        onBeforeAction: classifyRuntimeAction,
        pageUrl: () => target.origin,
        park: async () => '确认执行',
        aborted: () => cancelled,
      });
      expect((await gate(action, 'before')).kind).toBe(cancelled ? 'stop' : 'skip');
    }
  });
  it.each(['elementId', 'objectDigest'] as const)(
    'rejects changed %s after confirmation',
    async (field) => {
      let calls = 0;
      const initial = { ...target, element: { ...target.element, visibleText: '删除项目' } };
      const changed = {
        ...initial,
        [field]: field === 'elementId' ? '33333333-3333-4333-8333-333333333333' : 'b'.repeat(64),
      };
      const gate = createDescriptionActionGate({
        describe: async () => describeUserBrowserAction(action, calls++ ? changed : initial),
        onBeforeAction: classifyRuntimeAction,
        pageUrl: () => target.origin,
        park: async () => '确认执行',
        aborted: () => false,
      });
      expect((await gate(action, 'before')).kind).toBe('skip');
    },
  );
});

describe('transaction page context read by the extension (FIX-PR250)', () => {
  const next = (url: string, transactional = false, visibleText = '继续') => ({
    ...target,
    page: { url, transactional },
    element: { ...target.element, visibleText, inputType: 'button' },
  });
  const run = async (
    targets: Array<ReturnType<typeof next>>,
    reply: string | null,
    aborted = () => false,
  ) => {
    let call = 0;
    const park = vi.fn(async () => reply);
    const gate = createDescriptionActionGate({
      // Model-supplied page notes never reach here; only extension-read targets.
      describe: async () =>
        describeUserBrowserAction(
          action,
          targets[Math.min(call++, targets.length - 1)] ?? next(''),
        ),
      onBeforeAction: classifyRuntimeAction,
      pageUrl: () => target.origin,
      park,
      aborted,
    });
    return { decision: await gate(action, 'before'), parked: park.mock.calls.length };
  };
  it.each([
    'https://fixture.test/checkout',
    'https://fixture.test/pay',
    'https://fixture.test/order/confirm',
  ])('a neutral 继续/下一步 button on %s asks first; refusal and timeout stop', async (url) => {
    for (const label of ['继续', '下一步']) {
      const refused = await run([next(url, false, label)], '不要');
      expect(refused).toMatchObject({ parked: 1, decision: { kind: 'stop' } });
      const timedOut = await run([next(url, false, label)], null);
      expect(timedOut).toMatchObject({
        parked: 1,
        decision: { kind: 'stop', outcome: { status: 'awaiting_user' } },
      });
    }
  });
  it('a transaction flag computed from query/hash counts too; ordinary pages auto-click', async () => {
    expect(await run([next('https://fixture.test/list', true)], '不要')).toMatchObject({
      parked: 1,
      decision: { kind: 'stop' },
    });
    expect(await run([next('https://fixture.test/list')], '不要')).toMatchObject({
      parked: 0,
      decision: { kind: 'proceed' },
    });
    expect(
      await run([next('https://fixture.test/checkout', false, '查看详情')], '不要'),
    ).toMatchObject({ parked: 0, decision: { kind: 'proceed' } });
  });
  it('confirmation proceeds only while the confirmed page path is unchanged', async () => {
    const checkout = next('https://fixture.test/checkout');
    expect(await run([checkout, checkout], '确认执行')).toMatchObject({
      parked: 1,
      decision: { kind: 'proceed' },
    });
    const moved = await run([checkout, next('https://fixture.test/checkout/pay')], '确认执行');
    expect(moved).toMatchObject({ parked: 1, decision: { kind: 'skip' } });
    const cancelled = await run([checkout, checkout], '确认执行', () => true);
    expect(cancelled.decision).toMatchObject({ kind: 'stop', outcome: { status: 'cancelled' } });
  });
  it('the page path stays separate from the origin used for the binding', () => {
    const description = describeUserBrowserAction(action, next('https://fixture.test/checkout'));
    expect(description.descriptors[0]?.pageUrl).toBe('https://fixture.test/checkout');
    expect(description.bindings?.[0]).toMatchObject({ origin: 'https://fixture.test' });
  });
});
