import { describe, expect, it } from 'vitest';
import {
  computeSidePanelMode,
  needsBrowserViewport,
  sidePanelModeForToolbar,
} from './side-panel';

describe('side-panel helpers', () => {
  it('keeps terminal browser tasks closed until the user opens evidence', () => {
    expect(
      computeSidePanelMode({
        hasSelectedTask: true,
        isComposerNew: false,
        selectedNeedsBrowser: false,
        isLiveBrowserTask: false,
        override: null,
      }),
    ).toBe('closed');
  });

  it('honors an explicit browser open for a selected task even if composer state is stale', () => {
    expect(
      computeSidePanelMode({
        hasSelectedTask: true,
        isComposerNew: true,
        selectedNeedsBrowser: false,
        isLiveBrowserTask: false,
        override: 'open',
      }),
    ).toBe('browser-record');
  });

  it('reflects the mobile browser sheet open state in toolbar labels', () => {
    expect(
      sidePanelModeForToolbar({
        sidePanelMode: 'closed',
        isMobile: true,
        browserSheetOpen: true,
      }),
    ).toBe('browser-record');
  });

  it('does not rewrite desktop or already-open panel states', () => {
    expect(
      sidePanelModeForToolbar({
        sidePanelMode: 'closed',
        isMobile: false,
        browserSheetOpen: true,
      }),
    ).toBe('closed');
    expect(
      sidePanelModeForToolbar({
        sidePanelMode: 'browser-live',
        isMobile: true,
        browserSheetOpen: true,
      }),
    ).toBe('browser-live');
  });
});

describe('needsBrowserViewport — video_quote/clarification are chat-only', () => {
  const base = { hasSelectedTask: true, captchaWait: false, needsUser: true };

  it('video_quote → false (报价卡在聊天流, 不挂浏览器面板) [Problem 3 fix]', () => {
    expect(needsBrowserViewport({ ...base, awaitingKind: 'video_quote' })).toBe(false);
  });

  it('clarification → false (纯追问)', () => {
    expect(needsBrowserViewport({ ...base, awaitingKind: 'clarification' })).toBe(false);
  });

  it('genuine browser hand-offs → true', () => {
    for (const k of ['login', 'captcha', 'permission', 'browser_action']) {
      expect(needsBrowserViewport({ ...base, awaitingKind: k })).toBe(true);
    }
  });

  it('captcha wait → true regardless of awaitingKind', () => {
    expect(
      needsBrowserViewport({
        hasSelectedTask: true,
        captchaWait: true,
        needsUser: false,
        awaitingKind: 'video_quote',
      }),
    ).toBe(true);
  });

  it('no task / not awaiting / null kind → false', () => {
    expect(
      needsBrowserViewport({ ...base, hasSelectedTask: false, awaitingKind: 'login' }),
    ).toBe(false);
    expect(needsBrowserViewport({ ...base, needsUser: false, awaitingKind: 'login' })).toBe(false);
    expect(needsBrowserViewport({ ...base, awaitingKind: null })).toBe(false);
  });

  it('end-to-end: video_quote → sidePanelMode "closed" (panel not mounted)', () => {
    const selectedNeedsBrowser = needsBrowserViewport({ ...base, awaitingKind: 'video_quote' });
    expect(
      computeSidePanelMode({
        hasSelectedTask: true,
        isComposerNew: false,
        selectedNeedsBrowser,
        isLiveBrowserTask: false,
        override: null,
      }),
    ).toBe('closed');
  });
});
