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

  const searchButton: ResilientSelector = {
    description: 'Baidu search submit (#su, "百度一下")',
    strategies: [
      { kind: 'css', value: '#su' },
      { kind: 'css', value: 'input[type="submit"][value="百度一下"]' },
      { kind: 'role', role: 'button', name: '百度一下' },
    ],
    scope: { timeoutMs: 5_000 },
    selfHeal: false,
  };

  // Any of these means the result page rendered. `.result` is the
  // organic result container; `.result-op` covers special cards
  // (zhidao, baike, knowledge panels). Empty-state captcha pages
  // have neither, so this wait also doubles as a "are we blocked?"
  // probe — the step fails fast instead of extract returning zero.
  const resultContainer: ResilientSelector = {
    description: 'Baidu result list container',
    strategies: [
      { kind: 'css', value: '#content_left .result' },
      { kind: 'css', value: '#content_left .result-op' },
      { kind: 'css', value: '#content_left > div[tpl]' },
    ],
    scope: { timeoutMs: 15_000 },
    selfHeal: false,
  };

  // h3 is the result headline in every Baidu result template, organic
  // or card — this is the stable extraction target across layouts.
  const resultTitles: ResilientSelector = {
    description: 'Baidu result headline (h3)',
    strategies: [
      { kind: 'css', value: '#content_left h3' },
      { kind: 'css', value: '#content_left .c-title' },
      { kind: 'css', value: '#content_left a em' },
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
      kind: 'click',
      risk: 'low',
      selector: searchButton,
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
