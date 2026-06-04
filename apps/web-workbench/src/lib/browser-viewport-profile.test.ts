import { describe, expect, it } from 'vitest';
import {
  clampInlineBrowserPanelWidth,
  estimateInlineBrowserPanelWidth,
  pickBrowserViewportProfile,
  pickWorkbenchBrowserViewportProfile,
} from './browser-viewport-profile';

describe('pickBrowserViewportProfile', () => {
  it('uses the mobile profile on narrow app viewports', () => {
    expect(
      pickBrowserViewportProfile({
        viewportWidth: 390,
        viewportHeight: 844,
        panelWidth: 390,
        panelHeight: 560,
      }),
    ).toBe('mobile');
  });

  it('uses fullscreen geometry when the browser panel takes over the shell', () => {
    expect(
      pickBrowserViewportProfile({
        viewportWidth: 1440,
        viewportHeight: 900,
        panelWidth: 1440,
        panelHeight: 900,
        fullscreen: true,
      }),
    ).toBe('fullscreen');
  });

  it('keeps tall side panels on a portrait-friendly profile', () => {
    expect(
      pickBrowserViewportProfile({
        viewportWidth: 1440,
        viewportHeight: 900,
        panelWidth: 540,
        panelHeight: 720,
      }),
    ).toBe('sidepanel');
  });

  it('switches short wide panels to desktop so the browser fills the width', () => {
    expect(
      pickBrowserViewportProfile({
        viewportWidth: 1280,
        viewportHeight: 720,
        panelWidth: 560,
        panelHeight: 520,
      }),
    ).toBe('desktop');
  });

  it('uses desktop geometry for explicitly wide browser panels', () => {
    expect(
      pickBrowserViewportProfile({
        viewportWidth: 1800,
        viewportHeight: 1000,
        panelWidth: 1120,
        panelHeight: 760,
      }),
    ).toBe('desktop');
  });

  it('falls back to the overlay panel size when concrete panel metrics are unavailable', () => {
    expect(
      pickBrowserViewportProfile({
        viewportWidth: 1180,
        viewportHeight: 780,
        panelWidth: null,
        panelHeight: null,
      }),
    ).toBe('desktop');
  });
});

describe('pickWorkbenchBrowserViewportProfile', () => {
  it('clamps saved inline panel widths so the main column is not clipped', () => {
    expect(
      clampInlineBrowserPanelWidth({
        width: 980,
        rowWidth: 1180,
      }),
    ).toBe(760);
  });

  it('keeps inline panel widths above the readable minimum', () => {
    expect(
      clampInlineBrowserPanelWidth({
        width: 180,
        rowWidth: 1180,
      }),
    ).toBe(300);
  });

  it('estimates the inline desktop panel from the actual flex row width', () => {
    expect(
      estimateInlineBrowserPanelWidth({
        rowWidth: 1180,
        explicitPanelWidth: null,
      }),
    ).toBe(708);

    expect(
      pickWorkbenchBrowserViewportProfile({
        viewportWidth: 1440,
        viewportHeight: 900,
        rowWidth: 1180,
        rowHeight: 900,
        explicitPanelWidth: null,
        isTablet: false,
      }),
    ).toBe('desktop');
  });

  it('keeps tighter inline panels portrait-friendly near the desktop breakpoint', () => {
    expect(
      pickWorkbenchBrowserViewportProfile({
        viewportWidth: 1360,
        viewportHeight: 900,
        rowWidth: 1100,
        rowHeight: 900,
        explicitPanelWidth: null,
        isTablet: false,
      }),
    ).toBe('sidepanel');
  });

  it('uses the tablet overlay dimensions instead of a stale desktop estimate', () => {
    expect(
      pickWorkbenchBrowserViewportProfile({
        viewportWidth: 1180,
        viewportHeight: 780,
        rowWidth: 1180,
        rowHeight: 780,
        explicitPanelWidth: null,
        isTablet: true,
      }),
    ).toBe('sidepanel');
  });

  it('switches short tablet overlays to desktop geometry', () => {
    expect(
      pickWorkbenchBrowserViewportProfile({
        viewportWidth: 1280,
        viewportHeight: 720,
        rowWidth: 1280,
        rowHeight: 720,
        explicitPanelWidth: null,
        isTablet: true,
      }),
    ).toBe('desktop');
  });
});
