# HOLA DAY Chrome Extension Release

## Build

```bash
pnpm --filter @holaday/extension package:chrome
```

The release zip is written to:

```text
apps/extension/release/holaday-extension-0.0.1.zip
```

The package script rebuilds `dist/`, stages a clean Chrome Web Store payload,
checks that all manifest icons exist, removes source maps, and fails if a
`sourceMappingURL` reference leaks into the release package.

Use this debug build only when local source maps are needed:

```bash
pnpm --filter @holaday/extension build:debug
```

## Store Listing Notes

- Name: `HOLA DAY`
- Short description: `Connect HOLA DAY to your browser so tasks can use the pages you choose.`
- Category suggestion: Productivity
- Minimum Chrome: 120

## Permission Justifications

- `storage`: keeps the mirrored HOLA DAY session, reconnect counters, and local UI state.
- `tabs`, `activeTab`, `webNavigation`: finds and follows the user-selected browser tab while a task runs.
- `scripting`: reads page context and the workbench login token from pages the extension can access.
- `cookies`: syncs domain-level login availability for supported sites without uploading full cookie values.
- `history`: syncs 30-day domain aggregates so HOLA DAY can prioritize site-specific browser skills.
- `alarms`: schedules reconnect and daily history refresh work while the service worker sleeps.
- `sidePanel`: provides the task creation and status panel.
- `debugger`: required for the browser-agent control plane that drives pages with CDP.
- `<all_urls>`: required because users can ask HOLA DAY to operate on arbitrary logged-in websites.

## Manual Release Steps

1. Run the package command above.
2. Upload the generated zip in the Chrome Web Store developer dashboard.
3. Fill the permission justifications using the notes above.
4. After approval, verify a clean install and the already-installed update path.
5. For local dogfood only, reload the unpacked extension from `chrome://extensions`.
