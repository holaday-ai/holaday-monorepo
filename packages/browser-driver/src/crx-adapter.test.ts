import { describe, expect, it, vi } from 'vitest';
import { PlaywrightCrxAdapter } from './crx-adapter.js';
import { DRIVER_ERRORS } from './driver.js';

vi.mock('playwright-crx', () => ({
  crx: {
    start: () => {
      throw new Error('unexpected crx.start in lifecycle guard test');
    },
  },
}));

describe('PlaywrightCrxAdapter lifecycle guards', () => {
  it('forgets a closed page before running non-goto actions', async () => {
    const adapter = new PlaywrightCrxAdapter({ allowedOrigins: ['holaday.ai'] });
    const harness = adapter as unknown as {
      page: { isClosed: () => boolean; url: () => string } | null;
      tabId: number | null;
    };
    harness.page = {
      isClosed: () => true,
      url: () => 'https://holaday.ai/app',
    };
    harness.tabId = 42;

    const result = await adapter.execute({ kind: 'click' });

    expect(result.status).toBe('error');
    expect(result.error?.code).toBe(DRIVER_ERRORS.NOT_ATTACHED);
    expect(harness.page).toBeNull();
    expect(harness.tabId).toBeNull();
  });

  it('forgets a page when the closed-state probe itself fails', async () => {
    const adapter = new PlaywrightCrxAdapter();
    const harness = adapter as unknown as {
      page: { isClosed: () => boolean; url: () => string } | null;
      tabId: number | null;
    };
    harness.page = {
      isClosed: () => {
        throw new Error('page lifecycle unavailable');
      },
      url: () => 'https://holaday.ai/app',
    };
    harness.tabId = 77;

    const result = await adapter.execute({ kind: 'screenshot' });

    expect(result.status).toBe('error');
    expect(result.error?.code).toBe(DRIVER_ERRORS.NOT_ATTACHED);
    expect(harness.page).toBeNull();
    expect(harness.tabId).toBeNull();
  });
});

function observationHarness() {
  let url = 'https://github.com/example/repo';
  let revision = 0;
  const body = {
    innerText: vi.fn(async () => `${revision === 1 ? 'old' : 'fresh'} snapshot secret-value`),
    ariaSnapshot: vi.fn(
      async () => `${revision === 1 ? 'old' : 'fresh'} accessibility secret-value`,
    ),
  };
  const page = {
    isClosed: vi.fn(() => false),
    url: vi.fn(() => url),
    title: vi.fn(async () => 'Repository'),
    locator: vi.fn(() => body),
    evaluate: vi.fn(async () => ['secret-value']),
  };
  const targets = {
    observe: vi.fn(async () => {
      revision += 1;
    }),
    frameContexts: vi.fn(() => [{ frameId: 'main' }]),
    assertObservationFresh: vi.fn(async () => {}),
    observationRevision: 2,
  };
  const adapter = new PlaywrightCrxAdapter({
    allowedOrigins: ['https://github.com'],
    attachToTabId: 42,
    userBrowserRoutingV2: true,
  });
  const state = adapter as unknown as {
    page: typeof page;
    tabId: number;
    targets: typeof targets;
    selectedDisposeRequested: boolean;
  };
  Object.assign(state, { page, tabId: 42, targets });
  return {
    adapter,
    state,
    page,
    targets,
    body,
    setUrl: (value: string) => {
      url = value;
    },
  };
}

describe('PlaywrightCrxAdapter bounded stale snapshot recovery', () => {
  it('discards the stale snapshot and returns a fresh, newly redacted read', async () => {
    const h = observationHarness();
    h.targets.assertObservationFresh.mockRejectedValueOnce(new Error('stale_observation'));
    const result = await h.adapter.observeCurrentPage();
    expect(result.status).toBe('ok');
    expect(result.data).toMatchObject({ tabId: 42, observationRevision: 2 });
    expect(result.data).toMatchObject({
      bodyText: expect.stringContaining('fresh snapshot'),
      ariaSnapshot: expect.stringContaining('fresh accessibility'),
    });
    expect(JSON.stringify(result.data)).not.toContain('secret-value');
    expect(h.page.evaluate).toHaveBeenCalledTimes(2);
    expect(h.targets.observe).toHaveBeenCalledTimes(2);
  });

  it('stops after one additional read when the second snapshot is stale too', async () => {
    const h = observationHarness();
    h.targets.assertObservationFresh.mockRejectedValue(new Error('stale_observation'));
    expect(await h.adapter.observeCurrentPage()).toMatchObject({ status: 'error' });
    expect(h.targets.observe).toHaveBeenCalledTimes(2);
    expect(h.page.evaluate).toHaveBeenCalledTimes(2);
  });

  it('does not repeat redaction or unrelated extraction failures', async () => {
    const h = observationHarness();
    h.page.evaluate.mockRejectedValue(new Error('redaction unavailable'));
    const result = await h.adapter.observeCurrentPage();
    expect(result).toMatchObject({
      status: 'error',
      error: { code: DRIVER_ERRORS.EXTRACT_FAILED },
    });
    expect(result.data).toBeUndefined();
    expect(h.targets.observe).toHaveBeenCalledTimes(1);
  });

  it('rechecks the allowed origin before the additional read', async () => {
    const h = observationHarness();
    h.targets.assertObservationFresh.mockImplementationOnce(async () => {
      h.setUrl('https://unapproved.example/');
      throw new Error('stale_observation');
    });
    expect(await h.adapter.observeCurrentPage()).toMatchObject({
      status: 'error',
      error: { code: DRIVER_ERRORS.ORIGIN_BLOCKED },
    });
    expect(h.targets.observe).toHaveBeenCalledTimes(1);
    expect(h.page.evaluate).toHaveBeenCalledTimes(1);
  });

  it('honors disposal before reading again', async () => {
    const h = observationHarness();
    h.targets.assertObservationFresh.mockImplementationOnce(async () => {
      h.state.selectedDisposeRequested = true;
      throw new Error('stale_observation');
    });
    expect(await h.adapter.observeCurrentPage()).toMatchObject({
      status: 'error',
      error: { code: DRIVER_ERRORS.NOT_ATTACHED },
    });
    expect(h.targets.observe).toHaveBeenCalledTimes(1);
  });
});
