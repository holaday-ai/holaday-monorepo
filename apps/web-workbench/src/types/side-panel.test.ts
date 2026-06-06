import { describe, expect, it } from 'vitest';
import { computeSidePanelMode, sidePanelModeForToolbar } from './side-panel';

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
