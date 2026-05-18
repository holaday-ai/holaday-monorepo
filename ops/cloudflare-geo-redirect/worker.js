/**
 * Phase 28 — geo redirect Worker for holaday.ai.
 *
 * Triggers when the visitor's CF-IPCountry is "CN" (mainland China
 * only — Hong Kong / Macau / Taiwan are NOT included). The user is
 * sent to the China-accessible mirror at hd-app.orangebench.tech,
 * preserving path + query string + hash.
 *
 * Pass-through (no redirect):
 *   - Non-CN traffic.
 *   - CN traffic on API paths (/api/*, /trpc/*, /ws, /vnc-ws). These
 *     are XHR / WebSocket calls. A 302 here would break the SPA's
 *     fetch handlers (browsers don't auto-follow cross-origin
 *     redirects for credentialed XHR).
 *   - CN traffic on /static, /assets, /_workers — keep the asset
 *     URLs deterministic so the SPA's <script src> works.
 *   - CN traffic on /healthz, /robots.txt, /sitemap.xml — these
 *     are crawler / monitor surfaces that should answer where they
 *     were called.
 *
 * Why a 302 (not 301): we want CN visitors to re-evaluate this
 * Worker if their geo changes (VPN on/off). 301 is permanently
 * cached by browsers and would pin them to one origin forever.
 */

const REDIRECT_TARGET = 'https://hd-app.orangebench.tech';

/** Path prefixes that bypass the redirect even for CN visitors. */
const PASS_THROUGH_PREFIXES = [
  '/api/',
  '/trpc/',
  '/ws',
  '/vnc-ws',
  '/static/',
  '/assets/',
  '/_workers',
  '/healthz',
  '/robots.txt',
  '/sitemap.xml',
  '/favicon.ico',
];

/**
 * Mainland China country code per CF-IPCountry. HK/TW/MO are
 * explicitly excluded — those regions can reach holaday.ai without
 * a VPN, so redirecting them would only add a hop.
 */
const REDIRECT_COUNTRIES = new Set(['CN']);

export default {
  async fetch(request, _env, _ctx) {
    const url = new URL(request.url);

    // Country comes from CF's edge geo lookup. In dev / preview the
    // `cf` object is missing — treat as non-CN (pass through).
    const country = request.cf?.country ?? '';

    if (!REDIRECT_COUNTRIES.has(country)) {
      return fetch(request);
    }

    // Pass-through path check. Use startsWith so /api/anything
    // (including nested paths) is matched in one rule.
    for (const prefix of PASS_THROUGH_PREFIXES) {
      if (url.pathname === prefix || url.pathname.startsWith(prefix)) {
        return fetch(request);
      }
    }

    // Only redirect "real" HTML page loads. Heuristic: GET request
    // whose Accept header asks for HTML, or has no Accept header at
    // all (curl, link-preview bots). POST / PUT / DELETE etc are
    // API-shaped and pass through even on non-/api paths (forms
    // submitting to the same origin, say).
    if (request.method !== 'GET') {
      return fetch(request);
    }
    const accept = request.headers.get('accept') ?? '';
    const looksLikePage =
      accept === '' || accept.includes('text/html') || accept.includes('*/*');
    if (!looksLikePage) {
      return fetch(request);
    }

    // Build the redirect URL: keep path + search + hash, change
    // origin to the China-accessible mirror. The hash is normally
    // dropped by HTTP redirects (the server never sees it), but we
    // include it for defensive symmetry — a few clients preserve it
    // on Location headers.
    const targetUrl = new URL(REDIRECT_TARGET);
    targetUrl.pathname = url.pathname;
    targetUrl.search = url.search;
    targetUrl.hash = url.hash;

    return new Response(null, {
      status: 302,
      headers: {
        Location: targetUrl.toString(),
        // Don't let CF / browser caches pin this 302 for everyone —
        // visitor geo can change (VPN on/off) and the redirect
        // decision must re-run.
        'Cache-Control': 'no-store',
        // Surface the trigger to help debug from DevTools.
        'X-Geo-Redirect': `cf-country=${country}`,
      },
    });
  },
};
