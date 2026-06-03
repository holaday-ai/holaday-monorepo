import { defineManifest } from '@crxjs/vite-plugin';

// MV3 manifest for the HOLA DAY extension:
// - service worker = src/background/index.ts (TS, ESM)
// - default popup = src/popup/index.html (React shell)
// - host permissions intentionally broad: the agent operates across the
//   user's existing logged-in tabs (千牛, 生意参谋, 券商网页 ...).
//   Keep this permission tied to the browser-agent feature and review it
//   again before every public release.

export default defineManifest({
  manifest_version: 3,
  name: 'HOLA DAY',
  version: '0.0.1',
  description: 'Connect HOLA DAY to your browser so tasks can use the pages you choose.',
  minimum_chrome_version: '120',

  icons: {
    16: 'icons/icon-16.png',
    32: 'icons/icon-32.png',
    48: 'icons/icon-48.png',
    128: 'icons/icon-128.png',
  },

  action: {
    default_title: 'HOLA DAY',
    default_popup: 'src/popup/index.html',
  },

  background: {
    service_worker: 'src/background/index.ts',
    type: 'module',
  },

  permissions: [
    'storage',
    'tabs',
    'scripting',
    'activeTab',
    'cookies',
    'webNavigation',
    'alarms',
    // Side Panel surface (Phase 14). Side Panel needs Chrome 114+;
    // we already require 120 via minimum_chrome_version above so
    // gating is implicit. Action click continues to open the popup
    // (preserves Phase 0 UX); Side Panel is opened explicitly from
    // the popup's "在侧边栏打开" button.
    'sidePanel',
    // playwright-crx uses chrome.debugger as its transport; required to
    // drive pages with goto/click/extract/etc. Chrome will show the
    // "HOLA DAY is debugging this browser" banner while attached — that's
    // the visible footprint of the control plane.
    'debugger',
    // Phase 25 — read the user's 30-day browsing history at install
    // and incrementally once a day after that. The extension groups
    // visits by host client-side (we never upload the full URL list)
    // and POSTs the per-domain aggregate to
    // /extension/browsing-history. Lets the orchestrator's site-config
    // router prefer configs for domains the user actually visits.
    'history',
  ],

  host_permissions: ['<all_urls>'],

  side_panel: {
    default_path: 'src/sidepanel/index.html',
  },

  content_scripts: [
    // Phase 25b — auth-bridge content script. Runs ONLY on workbench
    // origins, watches localStorage['holaday.access_token'] for
    // changes, and pushes them to the SW via chrome.runtime.sendMessage.
    // Replaces the popup's email/password form: the source of truth for
    // login now lives on the web side, the extension just mirrors it.
    //
    // Wildcards include subdomain forms so dev / staging / prod all
    // hit the same content script without per-environment patches.
    {
      matches: [
        'https://holaday.ai/*',
        'https://*.holaday.ai/*',
        'https://hd-app.orangebench.tech/*',
        'http://localhost/*',
        'http://localhost:*/*',
        'http://127.0.0.1/*',
        'http://127.0.0.1:*/*',
      ],
      js: ['src/content/auth-bridge.ts'],
      run_at: 'document_start',
      all_frames: false,
    },
  ],
});
