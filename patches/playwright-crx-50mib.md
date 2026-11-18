# Playwright CRX 0.15.0: inclusive 50MiB buffer boundary

The locked package's `filePayloadExceedsSizeLimit` checks `>= 50 * 1024 * 1024`
in both distributed module formats, while its error describes buffers *larger*
than 50MiB. Holaday's existing file budget is inclusive at 52,428,800 bytes.
The first actual extension test received all 200 chunks but failed at this
library check before native file selection.

The version-specific pnpm patch changes only those two comparisons to `>`.
It keeps the public `ElementHandle.setInputFiles` payload path, utility-world
handling, target checks and all limits above 50MiB. No file paths, extra upload
permission or alternate page injection API are introduced.

`pnpm-workspace.yaml` and the generated lockfile pin the patch hash. A normal
clean installation applies it through pnpm. For this recovery worktree, the
shared dependency tree is borrowed from another checkout, so validation uses
an independently copied package with the same patch; the shared copy stays
unchanged.

The actual extension regression is `apps/extension/e2e/task-file-upload.e2e.mjs`.
It checks the website's complete file hash and last byte, along with small
files, repeated commits, background targeting and capability/ownership refusal.
Staging and manifest tests still reject totals above 50MiB.

References: [pinned package](https://github.com/ruifigueira/playwright-crx),
[Playwright file inputs](https://playwright.dev/docs/input#upload-files),
[pnpm lockfile-only behavior](https://pnpm.io/cli/install#--lockfile-only).
