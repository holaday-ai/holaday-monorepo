/**
 * Hardcoded smoke-test plans. These bypass the Anthropic planner so we
 * can verify the whole dispatch → driver → result loop against real
 * DOM, independent of the planner's ability to produce correct
 * selectors for any given site.
 *
 * Use case: end-to-end bring-up. When Opus-generated plans are failing
 * on selector mismatch against a target site, the smoke plan gives us
 * a known-good fixture — if even the smoke plan fails, the bug is
 * below the planner layer (adapter, WS, SW, permissions). If the
 * smoke plan succeeds, the planner is the weak link.
 */

import { type ResilientSelector, newExternalId } from '@holaday/shared-types';
import type { PlannedStep } from './task-controller.js';

/**
 * Baidu search smoke test. 7 steps, all against stable #kw / #su DOM
 * that has been Baidu's structure for years. Extracts the top search
 * result headings for "半导体" (semiconductor) — a neutral, evergreen
 * keyword that won't change the result shape across dogfood runs.
 *
 * Known risks that are NOT adapter bugs and should be tolerated:
 *  - Baidu sometimes shows a graphical captcha on first search from a
 *    fresh profile. That'll surface as extract returning an empty
 *    texts array or a captcha-hint title. Not a driver failure.
 *  - Occasional AB-tested card layouts put titles in `.c-title` or
 *    `.c-container h3` instead of `.result h3`; the extract selector
 *    below fans out across both.
 */
export function buildBaiduSmokePlan(): PlannedStep[] {
  // The search input — #kw has been Baidu's input id since ~2006.
  // Three resilient fallbacks so volatile class changes can't take
  // the whole step down.
  const searchInput: ResilientSelector = {
    description: 'Baidu search input (#kw)',
    strategies: [
      { kind: 'css', value: '#kw' },
      { kind: 'css', value: 'input[name="wd"]' },
      { kind: 'role', role: 'searchbox' },
    ],
    scope: { timeoutMs: 10_000 },
    selfHeal: false,
  };

  // Note: we explicitly DON'T click #su — Baidu's hydration briefly
  // detaches the submit button after type-into-#kw fires an input
  // event, so every selector strategy times out during that window.
  // Instead step 4 presses Enter on the still-focused #kw input,
  // which triggers the form's normal submit handler exactly like a
  // human user pressing Enter.

  // Any of these means the result page rendered. `.c-container` is
  // the universal wrapper across organic + special cards (zhidao,
  // baike, knowledge panels). `.result` / `.result-op` are the
  // legacy organic/special wrappers, still emitted as classes on
  // `.c-container` for back-compat. Empty-state captcha pages have
  // none of these, so this wait also doubles as a "are we blocked?"
  // probe — the step fails fast instead of extract returning zero.
  const resultContainer: ResilientSelector = {
    description: 'Baidu result list container',
    strategies: [
      { kind: 'css', value: '#content_left .c-container' },
      { kind: 'css', value: '#content_left .result' },
      { kind: 'css', value: '#content_left .result-op' },
      { kind: 'css', value: '#content_left > div[tpl]' },
    ],
    scope: { timeoutMs: 15_000 },
    selfHeal: false,
  };

  // Every Baidu result card (organic or special) carries an <h3> with
  // the headline. `h3 a` is the title link specifically — most useful
  // for text extraction since it skips the URL-and-arrow trailer that
  // some card types append to the h3.
  const resultTitles: ResilientSelector = {
    description: 'Baidu result headline (h3)',
    strategies: [
      { kind: 'css', value: '#content_left h3 a' },
      { kind: 'css', value: '#content_left h3' },
      { kind: 'css', value: '#content_left .c-title' },
    ],
    scope: { timeoutMs: 5_000 },
    selfHeal: false,
  };

  return [
    {
      id: newExternalId('taskStep'),
      kind: 'goto',
      risk: 'low',
      payload: { url: 'https://www.baidu.com' },
    },
    {
      id: newExternalId('taskStep'),
      kind: 'wait',
      risk: 'low',
      selector: searchInput,
    },
    {
      id: newExternalId('taskStep'),
      kind: 'type',
      risk: 'low',
      selector: searchInput,
      payload: { text: '半导体' },
    },
    {
      id: newExternalId('taskStep'),
      kind: 'key',
      risk: 'low',
      // Target the same input as step 3 so focus survives re-render;
      // doKey focuses first, then page.keyboard.press() fires a real
      // keyboard event through CDP that Baidu treats identically to a
      // human hitting Enter. Bypasses the button selector entirely.
      selector: searchInput,
      payload: { key: 'Enter' },
    },
    {
      id: newExternalId('taskStep'),
      kind: 'wait',
      risk: 'low',
      selector: resultContainer,
    },
    {
      id: newExternalId('taskStep'),
      kind: 'extract',
      risk: 'low',
      selector: resultTitles,
      payload: { limit: 10 },
    },
    {
      id: newExternalId('taskStep'),
      kind: 'screenshot',
      risk: 'low',
    },
  ];
}
