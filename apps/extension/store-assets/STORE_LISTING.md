# Chrome Web Store Listing Draft

## Required Assets

- Extension zip: `apps/extension/release/holaday-extension-0.0.1.zip`
- Extension icon: `apps/extension/public/icons/icon-128.png`
- Small promotional image: `apps/extension/store-assets/promo-small.png`
- Screenshot: capture at least one 1280x800 or 640x400 screenshot before submission.

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
