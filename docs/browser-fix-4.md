# Browser fix 4: field evidence and model-evaluation repairs

Continuation of PR #276 on `codex/browser-fix-3`. The source report is
`/Users/yaleiqi/.holaday-recovery/tasks/local-model-eval-1/report.md`.

## Behavior

- Completion checks each quoted, labeled, tabular or explicitly supplied field
  against successful reads. `finish.fields` can bind a value to a `tabId` or
  `sourceURL`. Separate passages and tabs no longer need a single contiguous
  quote. Rejections name the failing field and show a nearby source passage.
  Navigation still invalidates freshness; a failed navigation and a tab listing
  cannot certify the target page's title. File receipts only certify file facts.
  A known date precision note is separate from the observed relative timestamp;
  invented dates and factual parentheticals still fail grounding.
- A readable document surface in a same-origin/example or known editor frame can
  be hit-tested. Unknown, opaque and unreadable targets still require confirmation;
  payment/submission classification and post-action effect checks remain active.
- `click(ref, newTab=true)` clicks the observed link using the browser's new-tab
  gesture. It is not implemented by navigating to a model-supplied URL. New pages
  remain task-owned and participate in effect checks. Source-link tasks reject
  subsequent direct `navigate` calls which would bypass the requested interaction.
- Text waits select visible matches rather than timing out on a hidden duplicate.
- Link results distinguish video, playlist, channel and ordinary links. Video-only
  requests cannot finish with a playlist/course list item.
- URL extraction in verification, the ledger and auto-fix shares a Unicode-aware
  boundary; Chinese prose/typography and Markdown delimiters stay outside URLs.
  Balanced parentheses inside a URL path (such as Wikipedia article URLs) remain intact.
- Rejected completion arguments are redacted and bounded before the diagnostic
  callback. `browser.finish_rejected` events and the corresponding execution step
  retain the rejected answer and reason. No raw prompt or credential goes into
  model-call accounting.
- First-frame plan calls are recorded at the adapter boundary, including failed or
  rejected plans. Records are buffered until the task row exists, then linked to
  that task so the existing cost totals include them. Usage that is missing stays
  unknown rather than becoming a fabricated zero.

## Browser planning configuration

The browser's first-frame planning default is `qwen3.8-flash`. It no longer
inherits the generic `QWEN_STANDARD_MODEL` value. The existing role selection from
PR #266 is honored, including a task's admitted role adapter.

For an explicit production configuration, set:

```dotenv
BROWSER_BRAIN_PLANNING=alibaba-model-studio:qwen3.8-flash
```

This document describes the desired setting; this task does not inspect or change
production environment variables. Existing regional routing, canaries, provider
opt-ins and the generic standard-model setting remain in force.

## Verification boundaries

Run related regression tests, `pnpm browser:loop-audit`, its `--live` mode, changed
file lint, orchestrator typecheck/build, then one final-HEAD backend full run.
All heavy commands use Node 22.23.3, a 3 GiB heap and one worker. Logs and the final
result table are under `/Users/yaleiqi/.holaday-recovery/tasks/browser-fix-4/`.

The live audit uses a scripted adapter with real browsers, not a real model.
Real-model acceptance belongs to the subsequent LOCAL-MODEL-EVAL-2 task. There is
no merge, deployment, SSH or credential-file access in this change.
