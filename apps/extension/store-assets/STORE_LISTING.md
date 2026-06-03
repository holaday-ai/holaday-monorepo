# Chrome Web Store Listing Draft

## Required Assets

- Extension zip: `apps/extension/release/holaday-extension-0.0.1.zip`
- Extension icon: `apps/extension/public/icons/icon-128.png`
- Small promotional image: `apps/extension/store-assets/promo-small.png`
- Screenshot: `apps/extension/store-assets/screenshot-browser-connection.png`

If you want a true live-product screenshot instead of the prepared composition,
replace `screenshot-browser-connection.png` after capturing a logged-in extension session.

## Listing Copy

Short description:

```text
Connect HOLA DAY to your browser so tasks can use the pages you choose.
```

Detailed description:

```text
HOLA DAY connects your browser to the HOLA DAY task workspace.

Use it when you want HOLA DAY to work with pages you already have open, carry browser context into a task, or continue a workflow that needs your logged-in websites.

What it does:
- Mirrors your HOLA DAY login from the web app into the extension.
- Lets HOLA DAY use selected browser pages while a task is running.
- Shows connection state, recent sync status, and quick actions in the popup.
- Sends domain-level browsing-history aggregates so HOLA DAY can choose better site-specific browser skills.
- Syncs selected supported-site login cookies to the cloud browser only for user-authorized task execution.

Privacy highlights:
- Browsing-history sync uploads domain aggregates only, not full URLs, page titles, query strings, or page content.
- Cookie sync is limited to supported domains and is used to transfer authorized login state to the cloud browser that runs your task.
- HOLA DAY does not sell user data or use it for personalized advertising.

Privacy policy: https://holaday.ai/privacy
```

## Privacy Dashboard Answers

Data types to disclose:

- Authentication information: HOLA DAY access token mirrored from the workbench.
- Website content: task-time page context and screenshots when the user asks HOLA DAY to operate on a page.
- Web history: domain-level aggregates only (`domain`, `visitCount`, `lastVisitAt`).
- User activity: task execution state, extension connection state, and browser operation results.

Limited use statement:

```text
HOLA DAY uses Chrome extension data only to provide and improve the user-facing browser-agent feature. Data is transferred only when needed to execute user-authorized tasks, keep the extension connected, migrate supported-site login state to the cloud browser, provide support, protect security, or comply with law. HOLA DAY does not sell user data and does not use it for personalized, retargeted, or interest-based advertising.
```

Single purpose:

```text
Connect HOLA DAY to the user's browser so HOLA DAY can execute user-authorized tasks with the browser pages, login state, and page context the user chooses.
```

## Permission Review Responses

`debugger`

```text
HOLA DAY uses chrome.debugger only while executing a user-authorized browser task. The permission lets the extension drive the selected tab through Chrome DevTools Protocol actions such as navigate, click, type, scroll, screenshot, and extract text. HOLA DAY does not use this permission for background monitoring, advertising, or unrelated browsing analytics.
```

`<all_urls>`

```text
Users can ask HOLA DAY to operate on arbitrary websites they already use, including business dashboards, e-commerce tools, travel sites, and research pages. <all_urls> is required so the browser agent can inspect and operate on the page the user chooses. Release content scripts are still limited to HOLA DAY-owned origins for login-token mirroring; broad host access is used by task-time scripting and browser-agent operations.
```

`cookies`

```text
HOLA DAY reads cookies for a curated list of supported domains to transfer user-authorized login state into the cloud browser that executes the user's task. Cookie values are used only for task execution and are not sold, used for advertising, or exposed to third parties except infrastructure required to run HOLA DAY. A separate login-state signal sends boolean domain availability where possible.
```

`history`

```text
HOLA DAY reads recent browsing history to compute domain-level aggregates on the user's device. The extension uploads only domain, visit count, and last visit time for up to the configured cap. It does not upload full URLs, query strings, page titles, or page content for this feature. The aggregates help HOLA DAY prioritize relevant site-specific browser skills for the user.
```

`scripting`

```text
HOLA DAY uses scripting to read page context from the selected tab during a user-authorized task and to mirror the HOLA DAY web login token from HOLA DAY-owned workbench pages. Production release content-script matches are limited to HOLA DAY-owned origins.
```

`tabs`, `activeTab`, and `webNavigation`

```text
HOLA DAY uses tab metadata and navigation events to identify the selected task tab, recover from page loads, and keep browser-agent status accurate while a user-authorized task runs.
```
