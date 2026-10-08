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
  tabId: 3,
  frameId: 'main',
  origin: 'https://fixture.test',
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
});
