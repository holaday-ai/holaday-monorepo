import { describe, expect, it } from 'vitest';
import {
  LegacyScreenshotPageUnderstanding,
  PlaywrightPageUnderstanding,
  type ScreenshotObservation,
  toAccessibilityObservation,
  toScreenshotObservation,
} from './page-understanding.js';
import type { AccessibilityNodeRef, PageLike, PlaywrightExecutor } from './playwright-executor.js';

/**
 * Unit tests for the observation abstraction. We stub the
 * PlaywrightExecutor interface (only four methods touched:
 * getPage / screenshot / accessibilitySnapshot) rather than
 * construct a real one — the executor's own tests cover its
 * internals, these tests only care about the adaptation layer.
 */

function fakeExecutor(opts: {
  getPage?: () => Promise<PageLike>;
  screenshot?: () => Promise<{
    base64?: string;
    viewportWidth?: number;
    viewportHeight?: number;
    error?: string;
  }>;
  accessibilitySnapshot?: () => Promise<{
    text: string;
    refs: AccessibilityNodeRef[];
    url: string;
    title: string;
    error?: string;
  }>;
}): PlaywrightExecutor {
  // Cast through unknown — only the listed methods are touched.
  const fake = {
    getPage: opts.getPage ?? (async () => makePage('https://example.com/', 'Example')),
    screenshot:
      opts.screenshot ??
      (async () => ({
        base64: Buffer.from('jpeg').toString('base64'),
        viewportWidth: 1280,
        viewportHeight: 800,
      })),
    accessibilitySnapshot:
      opts.accessibilitySnapshot ??
      (async () => ({
        text: 'button "Submit"',
        refs: [{ ref: 'e1', role: 'button', name: 'Submit' }],
        url: 'https://example.com/',
        title: 'Example',
      })),
  };
  return fake as unknown as PlaywrightExecutor;
}

function makePage(url: string, title: string): PageLike {
  return {
    url: () => url,
    title: async () => title,
    viewportSize: () => ({ width: 1280, height: 800 }),
    screenshot: async () => Buffer.from(''),
    mouse: { click: async () => {}, move: async () => {}, wheel: async () => {} },
    keyboard: { type: async () => {}, press: async () => {} },
    accessibility: { snapshot: async () => null },
    waitForTimeout: async () => {},
    goto: async () => null,
  };
}

describe('PlaywrightPageUnderstanding', () => {
  it('observe(mode="screenshot") returns a screenshot observation', async () => {
    const pu = new PlaywrightPageUnderstanding(fakeExecutor({}));
    const obs = await pu.observe('screenshot', 3);
    expect(obs.kind).toBe('screenshot');
    if (obs.kind === 'screenshot') {
      expect(obs.tickIndex).toBe(3);
      expect(obs.viewportWidth).toBe(1280);
      expect(obs.url).toBe('https://example.com/');
      expect(obs.title).toBe('Example');
      expect(obs.screenshotBase64.length).toBeGreaterThan(0);
    }
  });

  it('observe(mode="accessibility") returns an accessibility observation', async () => {
    const pu = new PlaywrightPageUnderstanding(fakeExecutor({}));
    const obs = await pu.observe('accessibility', 7);
    expect(obs.kind).toBe('accessibility');
    if (obs.kind === 'accessibility') {
      expect(obs.tickIndex).toBe(7);
      expect(obs.text).toBe('button "Submit"');
      expect(obs.refs).toEqual([{ ref: 'e1', role: 'button', name: 'Submit' }]);
    }
  });

  it('getPage failure → empty observation of the requested kind, no throw', async () => {
    const pu = new PlaywrightPageUnderstanding(
      fakeExecutor({
        getPage: async () => {
          throw new Error('not connected');
        },
      }),
    );
    const screenshot = await pu.observe('screenshot', 0);
    expect(screenshot.kind).toBe('screenshot');
    if (screenshot.kind === 'screenshot') {
      expect(screenshot.screenshotBase64).toBe('');
      expect(screenshot.viewportWidth).toBe(0);
    }
    const a11y = await pu.observe('accessibility', 0);
    expect(a11y.kind).toBe('accessibility');
    if (a11y.kind === 'accessibility') {
      expect(a11y.text).toBe('');
      expect(a11y.refs).toEqual([]);
    }
  });

  it('screenshot failure wrapped into empty observation', async () => {
    const pu = new PlaywrightPageUnderstanding(
      fakeExecutor({
        screenshot: async () => ({ error: 'target closed' }),
      }),
    );
    const obs = await pu.observe('screenshot', 0);
    expect(obs.kind).toBe('screenshot');
    if (obs.kind === 'screenshot') {
      expect(obs.screenshotBase64).toBe('');
    }
  });

  it('accessibility snapshot error still produces a (mostly empty) a11y observation', async () => {
    const pu = new PlaywrightPageUnderstanding(
      fakeExecutor({
        accessibilitySnapshot: async () => ({
          text: '',
          refs: [],
          url: '',
          title: '',
          error: 'snapshot failed',
        }),
      }),
    );
    const obs = await pu.observe('accessibility', 0);
    expect(obs.kind).toBe('accessibility');
    if (obs.kind === 'accessibility') {
      expect(obs.text).toBe('');
      expect(obs.refs).toEqual([]);
    }
  });
});

describe('LegacyScreenshotPageUnderstanding', () => {
  it('always returns the screenshotFn result regardless of requested mode', async () => {
    const fake: ScreenshotObservation = {
      kind: 'screenshot',
      screenshotBase64: 'abc',
      viewportWidth: 1000,
      viewportHeight: 700,
      url: 'https://a.test/',
      title: 'A',
      tickIndex: 2,
    };
    const pu = new LegacyScreenshotPageUnderstanding(async () => fake);
    const obs1 = await pu.observe('screenshot', 2);
    const obs2 = await pu.observe('accessibility', 2);
    expect(obs1).toBe(fake);
    expect(obs2).toBe(fake); // accessibility request degrades silently
  });
});

describe('conversion helpers', () => {
  it('toScreenshotObservation maps absent fields to zero-ish defaults', () => {
    const o = toScreenshotObservation({ error: 'failed' }, 'https://x/', 'X', 5);
    expect(o.kind).toBe('screenshot');
    expect(o.screenshotBase64).toBe('');
    expect(o.viewportWidth).toBe(0);
    expect(o.tickIndex).toBe(5);
    expect(o.url).toBe('https://x/');
    expect(o.title).toBe('X');
  });

  it('toAccessibilityObservation passes through text + refs', () => {
    const o = toAccessibilityObservation(
      {
        text: 'link "Home"\nlink "About"',
        refs: [
          { ref: 'e1', role: 'link', name: 'Home' },
          { ref: 'e2', role: 'link', name: 'About' },
        ],
        url: 'https://x/',
        title: 'X',
      },
      9,
    );
    expect(o.kind).toBe('accessibility');
    expect(o.refs).toHaveLength(2);
    expect(o.tickIndex).toBe(9);
  });
});
