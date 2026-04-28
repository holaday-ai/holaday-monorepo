import { defineManifest } from '@crxjs/vite-plugin';

// MV3 manifest for the HOLA DAY extension. Phase 0 / PoC A1:
// - service worker = src/background/index.ts (TS, ESM)
// - default popup = src/popup/index.html (React shell)
// - host permissions intentionally broad: the agent operates across the
//   user's existing logged-in tabs (千牛, 生意参谋, 券商网页 ...).
//   We will narrow this once Phase 0 dogfood shows the real list.

export default defineManifest({
  manifest_version: 3,
  name: 'HOLA DAY',
  version: '0.0.1',
  description: 'HOLA DAY browser agent — Phase 0 PoC',
  minimum_chrome_version: '120',

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
  ],

  host_permissions: ['<all_urls>'],

  side_panel: {
    default_path: 'src/sidepanel/index.html',
  },

  content_scripts: [
    {
      matches: ['<all_urls>'],
      js: ['src/content/index.ts'],
      run_at: 'document_idle',
      all_frames: false,
    },
  ],
});
