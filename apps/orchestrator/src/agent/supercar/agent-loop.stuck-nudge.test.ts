/**
 * Phase 24 fix #1 — Apify rescue at the stuck-exit threshold.
 *
 * The supercar agent-loop nudges Claude when the page-screenshot hash
 * stops changing (stuckCount). Two tiers:
 *
 *   - WARN  (stuckCount >= STUCK_WARN_THRESHOLD): every turn, browser-
 *           first guidance (mobile sites, alternate paths, reset).
 *           NO mention of search/Apify — the Phase 5 benchmark showed
 *           that mentioning either too early collapses the model into
 *           abandoning the browser path.
 *   - EXIT  (stuckCount >= STUCK_EXIT_THRESHOLD): one-shot when crossing
 *           the line. Pre-Phase-24, this said "stop using computer
 *           tools, use web_search or summarize." Result: the agent
 *           never tried `scrape_website` / `search_ecommerce` (the
 *           Apify-backed escape hatches added in Phase 23 step 3), even
 *           though those were registered as tools.
 *
 * Phase 24 rewrites the EXIT-tier nudge to lead with Apify tools when
 * available, and only falls back to the web_search wording when the
 * orchestrator boots without an Apify adapter.
 */

import { describe, expect, it } from 'vitest';
import {
  STUCK_EXIT_THRESHOLD,
  STUCK_WARN_THRESHOLD,
  buildStuckNudge,
} from './agent-loop.js';

describe('buildStuckNudge', () => {
  it('returns null below the warn threshold', () => {
    expect(
      buildStuckNudge({
        stuckCount: STUCK_WARN_THRESHOLD - 1,
        hasApifyTools: true,
        alreadyForcedExit: false,
      }),
    ).toBeNull();
  });

  it('returns warn-tier text in [warn, exit), browser-first, no Apify mention', () => {
    const out = buildStuckNudge({
      stuckCount: STUCK_WARN_THRESHOLD,
      hasApifyTools: true,
      alreadyForcedExit: false,
    });
    expect(out).not.toBeNull();
    expect(out?.tier).toBe('warn');
    expect(out?.text).toMatch(/未变化/);
    expect(out?.text).toMatch(/m\.jd\.com|移动版/);
    expect(out?.text).not.toMatch(/scrape_website/);
    expect(out?.text).not.toMatch(/search_ecommerce/);
    expect(out?.text).not.toMatch(/web_search/);
  });

  it('warn-tier still fires at stuckCount=exit-1 (boundary)', () => {
    const out = buildStuckNudge({
      stuckCount: STUCK_EXIT_THRESHOLD - 1,
      hasApifyTools: true,
      alreadyForcedExit: false,
    });
    expect(out?.tier).toBe('warn');
  });

  it('exit-tier rescue mentions scrape_website + search_ecommerce when Apify available', () => {
    const out = buildStuckNudge({
      stuckCount: STUCK_EXIT_THRESHOLD,
      hasApifyTools: true,
      alreadyForcedExit: false,
    });
    expect(out).not.toBeNull();
    expect(out?.tier).toBe('exit-first');
    expect(out?.text).toMatch(/scrape_website/);
    expect(out?.text).toMatch(/search_ecommerce/);
    // The pre-Phase-24 wording ordered the model to drop computer
    // tools entirely. That's the bug we're fixing — make sure it
    // doesn't sneak back in.
    expect(out?.text).not.toMatch(/绝对不要再.*computer 工具/);
  });

  it('exit-tier still surfaces web_search as a final fallback', () => {
    const out = buildStuckNudge({
      stuckCount: STUCK_EXIT_THRESHOLD,
      hasApifyTools: true,
      alreadyForcedExit: false,
    });
    expect(out?.text).toMatch(/web_search/);
  });

  it('exit-tier without Apify falls back to web_search-only guidance', () => {
    const out = buildStuckNudge({
      stuckCount: STUCK_EXIT_THRESHOLD,
      hasApifyTools: false,
      alreadyForcedExit: false,
    });
    expect(out).not.toBeNull();
    expect(out?.tier).toBe('exit-first');
    expect(out?.text).not.toMatch(/scrape_website/);
    expect(out?.text).not.toMatch(/search_ecommerce/);
    expect(out?.text).toMatch(/web_search/);
  });

  it('exit-tier is one-shot: alreadyForcedExit=true falls back to warn', () => {
    const out = buildStuckNudge({
      stuckCount: STUCK_EXIT_THRESHOLD + 5,
      hasApifyTools: true,
      alreadyForcedExit: true,
    });
    // After the first force, subsequent turns get warn-tier nudges
    // again (browser-first reminder), not the rescue text.
    expect(out?.tier).toBe('warn');
    expect(out?.text).not.toMatch(/scrape_website/);
  });

  it('rescue text tells the model the URL to scrape (URL-aware guidance)', () => {
    const out = buildStuckNudge({
      stuckCount: STUCK_EXIT_THRESHOLD,
      hasApifyTools: true,
      alreadyForcedExit: false,
    });
    // The rescue prompt must explicitly tell the agent that the
    // current URL is the right argument to scrape_website. Without
    // this, the model often calls scrape_website with vague queries
    // and gets nothing useful back.
    expect(out?.text).toMatch(/url|URL|当前.*页面|当前.*网址/);
  });
});
