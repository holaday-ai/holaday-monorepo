import type { Page } from 'playwright-crx';
import { describe, expect, it, vi } from 'vitest';
import { captureMaskedTaskScreenshot } from './task-screenshot.js';

function harness() {
  let loader = 'document-a';
  let current = true;
  const masks: unknown[] = [];
  const frame = {
    evaluate: vi.fn(async () => ['private-human-value']),
    locator: vi.fn((selector: string) => ({ selector })),
    getByText: vi.fn((text: string) => ({ text })),
  };
  const cdp = {
    send: vi.fn(async (_method: string) => ({
      frameTree: { frame: { id: 'f1', loaderId: loader } },
    })),
    detach: vi.fn(async () => {}),
  };
  const page = {
    context: () => ({ newCDPSession: async () => cdp }),
    frames: () => [frame],
    screenshot: vi.fn(async (options: { mask: unknown[] }) => {
      masks.push(...options.mask);
      return Buffer.from([255, 216, 255, 1, 255, 217]);
    }),
  };
  return {
    page: page as unknown as Page,
    raw: page,
    frame,
    cdp,
    masks,
    current: () => current,
    stop: () => {
      current = false;
    },
    navigate: () => {
      loader = 'document-b';
    },
  };
}

describe('task-owned masked background capture', () => {
  it('masks a sensitive value mirrored into a different frame', async () => {
    const h = harness();
    const child = {
      ...h.frame,
      evaluate: vi.fn(async () => [] as string[]),
      getByText: vi.fn((text: string) => ({ text })),
    };
    h.raw.frames = () => [h.frame, child];
    await captureMaskedTaskScreenshot(h.page, h.current, () => h.cdp.send('Page.getFrameTree'));
    expect(child.getByText).toHaveBeenCalledWith('private-human-value', { exact: false });
  });
  it('masks editable controls and sensitive mirrors in every frame without foreground APIs', async () => {
    const h = harness();
    const image = await captureMaskedTaskScreenshot(h.page, h.current, () =>
      h.cdp.send('Page.getFrameTree'),
    );
    expect(image).toBe(Buffer.from([255, 216, 255, 1, 255, 217]).toString('base64'));
    expect(h.frame.locator).toHaveBeenCalledWith(
      'input, textarea, select, [contenteditable], [data-hd-human-typed]',
    );
    expect(h.frame.getByText).toHaveBeenCalledWith('private-human-value', { exact: false });
    expect(h.masks).toHaveLength(2);
    expect(h.cdp.send).toHaveBeenCalledTimes(2);
  });

  it.each(['document', 'owner'] as const)(
    'discards a late image after %s changes',
    async (change) => {
      const h = harness();
      h.raw.screenshot.mockImplementationOnce(async () => {
        if (change === 'document') h.navigate();
        else h.stop();
        return Buffer.from([255, 216, 255, 1, 255, 217]);
      });
      await expect(
        captureMaskedTaskScreenshot(h.page, h.current, () => h.cdp.send('Page.getFrameTree')),
      ).rejects.toThrow('screenshot_unavailable');
    },
  );

  it('fails closed when privacy inspection fails; never retries unmasked', async () => {
    const h = harness();
    h.frame.evaluate.mockRejectedValueOnce(new Error('page text must not escape'));
    await expect(
      captureMaskedTaskScreenshot(h.page, h.current, () => h.cdp.send('Page.getFrameTree')),
    ).rejects.toThrow(/^screenshot_unavailable$/);
    expect(h.raw.screenshot).not.toHaveBeenCalled();
  });

  it('does not downgrade a failed masked capture to raw CDP or visible capture', async () => {
    const h = harness();
    h.raw.screenshot.mockRejectedValueOnce(new Error('secret data'));
    await expect(
      captureMaskedTaskScreenshot(h.page, h.current, () => h.cdp.send('Page.getFrameTree')),
    ).rejects.toThrow(/^screenshot_unavailable$/);
    expect(h.raw.screenshot).toHaveBeenCalledOnce();
    expect(h.cdp.send.mock.calls.every(([method]) => method === 'Page.getFrameTree')).toBe(true);
  });
  it('requires an actual document receipt before any capture', async () => {
    const h = harness();
    await expect(captureMaskedTaskScreenshot(h.page, h.current, async () => ({}))).rejects.toThrow(
      'screenshot_unavailable',
    );
    expect(h.raw.screenshot).not.toHaveBeenCalled();
  });
  it('refuses an image exceeding the transport limit', async () => {
    const h = harness();
    h.raw.screenshot.mockResolvedValueOnce(Buffer.alloc(1024 * 1024 + 1));
    await expect(
      captureMaskedTaskScreenshot(h.page, h.current, () => h.cdp.send('Page.getFrameTree')),
    ).rejects.toThrow('screenshot_unavailable');
  });
});
