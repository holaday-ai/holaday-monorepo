import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PlaywrightCrxAdapter } from './crx-adapter.js';
import type { DriverAction } from './driver.js';

const boundary = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('playwright-crx', () => ({ crx: { get: boundary.get, start: vi.fn() } }));

// Only the browser boundary is replaced. Real adapter resolves the selector,
// interprets the DOM, chooses the primitive, and verifies its returned state.
function fixture(config: { revert?: boolean; throws?: boolean; input?: boolean } = {}) {
  const options = [
    {
      index: 0,
      label: '基础方案 · 20 /份',
      value: 'basic',
      selected: true,
      disabled: false,
      parentElement: null,
    },
    {
      index: 1,
      label: '标准方案 · 42 /份',
      value: 'standard',
      selected: false,
      disabled: false,
      parentElement: null,
    },
  ];
  const element = {
    tagName: config.input ? 'INPUT' : 'SELECT',
    disabled: false,
    multiple: false,
    options,
    get selectedOptions() {
      return options.filter((option) => option.selected);
    },
  };
  const keyboard = { type: vi.fn(async () => undefined) };
  const locator = {
    first() {
      return this;
    },
    waitFor: vi.fn(async () => undefined),
    evaluate: vi.fn(async (fn: (element: unknown) => unknown) => fn(element)),
    fill: vi.fn(async () => {
      if (!config.input) throw Error('not an input');
    }),
    focus: vi.fn(async () => undefined),
    selectOption: vi.fn(async (target: { index: number }) => {
      if (config.throws) throw Error('select interrupted');
      if (!config.revert)
        for (const option of options) option.selected = option.index === target.index;
      return ['standard']; // Deliberately not sufficient proof: read-back can differ.
    }),
  };
  const page = {
    isClosed: () => false,
    url: () => 'https://allowed.example/form',
    locator: () => locator,
    keyboard,
  };
  boundary.get.mockResolvedValue({
    on: vi.fn(),
    off: vi.fn(),
    attach: async () => page,
    detach: vi.fn(),
  });
  const adapter = new PlaywrightCrxAdapter({
    attachToTabId: 42,
    allowedOrigins: ['allowed.example'],
  });
  return { adapter, locator, keyboard, element, options };
}
const action = (text: string): DriverAction => ({
  kind: 'type',
  payload: { text },
  selector: {
    description: '方案',
    strategies: [{ kind: 'css', value: 'select' }],
    scope: { timeoutMs: 5000 },
    selfHeal: true,
  },
});
beforeEach(() => vi.clearAllMocks());

describe('native select through existing type action', () => {
  it.each(['标准方案 · 42 /份', 'standard'])(
    'selects exact label/value %s and returns verified state',
    async (text) => {
      const h = fixture();
      await h.adapter.attachExistingTab();
      expect(await h.adapter.execute(action(text))).toMatchObject({
        status: 'ok',
        data: {
          control: 'select',
          selectedValue: 'standard',
          selectedLabel: '标准方案 · 42 /份',
          verified: true,
        },
      });
      expect(h.locator.selectOption).toHaveBeenCalledWith(
        { index: 1, label: '标准方案 · 42 /份', value: 'standard' },
        { timeout: 5000 },
      );
      expect(h.locator.fill).not.toHaveBeenCalled();
      expect(h.keyboard.type).not.toHaveBeenCalled();
    },
  );
  it('does not report success when page reverts selection after selectOption returns', async () => {
    const h = fixture({ revert: true });
    await h.adapter.attachExistingTab();
    expect(await h.adapter.execute(action('standard'))).toMatchObject({
      status: 'error',
      error: { code: 'TYPE_FAILED' },
    });
    expect(h.keyboard.type).not.toHaveBeenCalled();
  });
  it.each(['missing', 'duplicate', 'disabled', 'multiple', 'disabled-control'])(
    'rejects %s before native selection or keyboard input',
    async (condition) => {
      const h = fixture();
      const [basic, standard] = h.options;
      if (!basic || !standard) throw Error('fixture options missing');
      if (condition === 'duplicate') basic.label = '标准方案 · 42 /份';
      if (condition === 'disabled') standard.disabled = true;
      if (condition === 'multiple') h.element.multiple = true;
      if (condition === 'disabled-control') h.element.disabled = true;
      await h.adapter.attachExistingTab();
      const result = await h.adapter.execute(
        action(condition === 'missing' ? '标准方案' : '标准方案 · 42 /份'),
      );
      expect(result.status).toBe('error');
      expect(h.locator.selectOption).not.toHaveBeenCalled();
      expect(h.keyboard.type).not.toHaveBeenCalled();
    },
  );
  it('never falls back to typing after native selection throws', async () => {
    const h = fixture({ throws: true });
    await h.adapter.attachExistingTab();
    expect((await h.adapter.execute(action('standard'))).status).toBe('error');
    expect(h.keyboard.type).not.toHaveBeenCalled();
  });
  it('preserves ordinary input filling', async () => {
    const h = fixture({ input: true });
    await h.adapter.attachExistingTab();
    expect(await h.adapter.execute(action('3'))).toMatchObject({
      status: 'ok',
      data: { typedChars: 1 },
    });
    expect(h.locator.fill).toHaveBeenCalledWith('3', { timeout: 5000 });
    expect(h.locator.selectOption).not.toHaveBeenCalled();
  });
});
