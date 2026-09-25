import { defineManifest } from '@crxjs/vite-plugin';
import { version } from './package.json';

const includeDevWorkbenchHosts = process.env.VITE_EXTENSION_INCLUDE_DEV_HOSTS === '1';
const localChromeQa = process.env.VITE_LOCAL_CHROME_QA === '1';
const qaEndpointKeys = [
  'VITE_WORKBENCH_URL',
  'VITE_ORCHESTRATOR_HTTP',
  'VITE_ORCHESTRATOR_WS',
] as const;
const qaEndpointValues = qaEndpointKeys.map((key) => process.env[key]);

// Manifest imports run before Vite loads env files. Fail closed if those
// files would make the runtime differ from the manifest's explicit QA config.
export function assertLocalQaBuildEnv(env: Record<string, unknown>): void {
  if (
    (env.VITE_LOCAL_CHROME_QA === '1') !== localChromeQa ||
    (localChromeQa && qaEndpointKeys.some((key, index) => env[key] !== qaEndpointValues[index]))
  ) {
    throw new Error('Local Chrome QA configuration must match explicit shell build variables');
  }
}

function localQaMatch(value: string | undefined, protocol: string): string {
  const url = new URL(value ?? '');
  if (
    url.protocol !== protocol ||
    !['127.0.0.1', 'localhost'].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error('Local Chrome QA requires explicit loopback endpoints');
  }
  return `http://${url.hostname}/*`;
}
const qaWorkbenchMatch = localChromeQa ? localQaMatch(process.env.VITE_WORKBENCH_URL, 'http:') : '';
const qaHostMatches = localChromeQa
  ? [
      ...new Set([
        qaWorkbenchMatch,
        localQaMatch(process.env.VITE_ORCHESTRATOR_HTTP, 'http:'),
        localQaMatch(process.env.VITE_ORCHESTRATOR_WS, 'ws:'),
      ]),
    ]
  : [];
const workbenchMatches = localChromeQa
  ? [qaWorkbenchMatch]
  : [
      'https://holaday.ai/*',
      'https://*.holaday.ai/*',
      'https://hd-app.orangebench.tech/*',
      ...(includeDevWorkbenchHosts
        ? [
            'http://localhost/*',
            'http://localhost:*/*',
            'http://127.0.0.1/*',
            'http://127.0.0.1:*/*',
          ]
        : []),
    ];

// MV3 manifest for the HOLA DAY extension:
// - service worker = src/background/index.ts (TS, ESM)
// - default popup = src/popup/index.html (React shell)
// - host permissions intentionally broad: the agent operates across the
//   user's existing logged-in tabs (千牛, 生意参谋, 券商网页 ...).
//   Keep this permission tied to the browser-agent feature and review it
//   again before every public release.

export default defineManifest({
  manifest_version: 3,
  name: localChromeQa ? 'HOLA DAY · Local QA' : 'HOLA DAY',
  version: localChromeQa ? '0.0.3' : version,
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
    ...(localChromeQa ? [] : ['cookies' as const]),
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
    ...(localChromeQa ? [] : ['history' as const]),
  ],

  host_permissions: localChromeQa ? qaHostMatches : ['<all_urls>'],

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
    // Dev localhost hosts are enabled only by the dev script via
    // VITE_EXTENSION_INCLUDE_DEV_HOSTS=1. Public release packages keep
    // the content-script surface to HOLA DAY-owned origins.
    {
      matches: workbenchMatches,
      js: ['src/content/auth-bridge.ts'],
      run_at: 'document_start',
      all_frames: false,
    },
  ],
});
