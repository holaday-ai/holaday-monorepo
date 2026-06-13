# Phase 1 #1 模板填充 — Backlog

> Line accepted/closed 2026-06-13. Deferred items below — not blockers.
> e2e regression guard: `apps/orchestrator/src/agent/template/template-fill-e2e.test.ts`.

## P1 — xlsx multi-row loop support
Multi-row xlsx loops (`{#x}…{/x}` spanning >1 template row) currently DEGRADE
(skipped → partial_success + an explanation note); single-row loops work. Real
templates commonly need multi-row (a per-item block of 2–3 rows).
- **Approach A (recommended)**: exceljs block-duplication — duplicate the K-row
  loop body per item (`duplicateRow`/`insertRows`), fill each. Free, no new dep.
  Hard parts: merged cells, formulas, row heights. Scope v2 to non-merged /
  non-formula bodies first.
- **Approach B**: docxtemplater's xlsx module — native, but PAID (license + dep).
- Code: `agent/template/xlsx-template-engine.ts` `fill()` — the
  `loop.startRow !== loop.endRow` branch that currently pushes to `skippedLoops`.

## P3 — derived-field unit echo dedup (`20%%`)
When a template cell is `{gmv_wow}%` and the model returns the value WITH the
unit (`"20%"`), the output doubles it → `20%%`. Cosmetic; the value is correct.
- Fix idea: strip a trailing unit from a value when the adjacent template literal
  already carries it (or normalise `%` on the way out).
- Code: `agent/template/placeholder-schema.ts` (coercion / derivation path) or
  the renderer.

## P3 — multi-row loop-skip residual separator
A skipped multi-row loop body clears the `{placeholders}` but leaves literal
separators, e.g. `{task_name} — {task_status}` → ` — `. Cosmetic.
- Fix idea: when skipping a loop, blank the whole body cell if it reduces to only
  punctuation / whitespace after substitution.
- Code: `agent/template/xlsx-template-engine.ts` (the simple-field pass that
  clears skipped-loop cells).
