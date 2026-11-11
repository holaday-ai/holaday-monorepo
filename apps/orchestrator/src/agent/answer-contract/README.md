# Answer contract — price / price comparison (REBUILD-3)

Behind `ANSWER_CONTRACT_PRICE` (`config/env.ts`, default `false`). With the flag off nothing here
runs: the browser loop gets no `answerContract`, its finish tool, prompt and finish path are the
legacy ones.

## Which tasks

`isPriceTask(userIntent)` (`price-task.ts`): 价格 / 多少钱 / 报价 / 售价 / 比价 / 最便宜 / price /
cost / how much / cheapest — not share prices, funds or exchange rates, not writing about prices,
not arithmetic on given prices, and not requests that also ask for values the schema has no field
for (rating, sales, stock, specs, address, opening hours). Decided once in the supercar runner on
the user's own words.

## Contract

`finish` gets a required `price_result`:

```
{ language: zh|en,
  items:   [{ name, variant, price, currency, source_url, quote, block_ref }],
  missing: [{ field, item, reason }],
  note }
```

`block_ref` is the snapshot node ref the executor issued (`e123`, `f1e5` in a frame, optionally
`<tabId>/e123`): the model already uses it for every action, it is unique within a snapshot, and
the node's subtree (by the AI aria snapshot's indentation) is the card / list item / row. Reads
without refs (get_page_text, read_url, tables) use `block_ref: "text"` — the quote itself is the
block, so name, variant and price must sit in one contiguous run of page text.

## What code does

1. **Check** (`price-verify.ts`) against every read of this run (`contractReads`, kept in the
   loop's `remember`, 48 reads / 1 MB): the quote occurs in text read; name, variant, every number
   of the price (whole numbers: 12.4 is not 12.45) and the quote are in the block. First failure:
   one send-back listing the problems with the block's text as read. Second failure (or the final
   turn): that item moves to `missing`. Missing items are never sent back.
2. **Render** (`price-render.ts`): zh / en template, one numbered line per item with its link
   (the model's link when the run saw it, else the card's own link, else the page), a
   「部分完成：…没有拿到。」 / "Partially completed: …" lead and a 没有拿到 list when anything is
   missing, a 未核实 line only for prices read on a search-results page, the note only when it names
   no amount (a reason's amounts are left out). Fewer items than asked for (「前三个」) adds missing
   entries. No item left: the task fails with the missing list.
3. **Degrade**: schema invalid → one retry; invalid again with a screenshot in context → two steps
   (describe the screenshots as text, then a text-only forced `finish`); still invalid → the
   legacy finish path (the old rules still run for that answer).

A completed contract answer carries `answerContract: 'price'` (loop outcome, `SupercarOutcome`)
and `markAnswerContract(taskId)` lets the execution pipeline drop its `ecommerce_rows` criterion.

## Legacy rules bypassed for a contract answer (rules-inventory.md, production 8ea5cb70)

31 of 647 (4.8 %):

| Where | Rules |
|---|---|
| finish facts check (`assessCompletionFacts`) | R127 R133 R134 R135 R138 R143 R146 R147 R152 R153 |
| 故宫 tab attribution (`section-attribution.ts`) | R183 R184 |
| variant price (`variant-price.ts`) | R230 R231 R232 R233 R234 |
| 未核实 note / 部分完成 lead stitching | R150 R201 |
| `plainAnswer` (also tasks.ts search-lane 原样 clean-up) | R214 R215 R218 R219 R221 R223 |
| ecommerce rows (`reviewFinish` / `partialNote` / pipeline criterion) | R456 R457 R458 R459 R462 R463 |

Nothing is deleted: every rule still runs for non-price tasks and for a price task whose
`price_result` never validated. Also skipped on the contract path but not counted (they serve all
answers): R128–R132 / R136–R137 / R139–R142 / R144–R145 / R148–R149 / R151 / R154–R160 (the rest
of the facts check), R207 `fieldLines`, R217 `withoutRepeatedList`, R222 `absentLead`.

Kept on purpose: R259 (generate lane), R531 (honesty red line, all lanes), R453 / R455 / R461
(shared parsing and the user's sort requirement), R212 / R213 (rescue source line — applies to a
rescued contract answer too), R590 / R578 / R583 / R586 (front-end copy), the routing rules
(R294 R301–R303 R394–R396 R491 R492 — the router's domain) and the A-share rules.

Delete after DEPLOY-R1 (once the flag is on for good and bench60 shows no non-price browser
task leans on them): `variant-price.ts` (R230–R234), `section-attribution.ts` (R183 R184), the
amazon-card helpers in `completion-fields.ts` (R134 R135 R138 R147 R152 R153) and the
price-only parts of `plainAnswer` (R214 R215 R218 R219 R221). R223 and R456–R463 stay while the
scrape / search lanes still produce free-text price answers.

## Fixed-sample replay (`../bench-replay/`)

`BENCH_RECORD_DIR=<dir>` makes the supercar runner record each task under `<dir>/<taskId>/`:
`fixture.json` (intent, every tool call and the result the loop received, final URL / title,
recorded outcome) plus `step-<n>.jpg` screenshots. `scripts/replay-bench.ts` replays fixtures
(default `test-fixtures/bench60/`) through the real loop with a replay executor (unknown calls get
`not_in_fixture`) and the gateway's `brain` model, 60 s cap per item.
