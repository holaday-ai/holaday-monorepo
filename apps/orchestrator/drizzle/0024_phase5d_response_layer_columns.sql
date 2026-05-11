-- Optimization #2 — OpenAI response formatter / style layer.
--
-- Tasks now carry THREE new columns to track the formatter's work:
--   original_summary       agent's raw output (pre-formatter)
--   formatted_summary      polished output OR original on fallback
--   response_layer_metadata { model, latency_ms, changes[], fallbackReason }
--
-- The existing `result.summary` JSON field is what the SPA reads.
-- When the formatter runs cleanly, `result.summary` = formatted text
-- and `original_summary` holds the unpolished version for forensics.
-- When the formatter falls back (timeout / post-check rejection),
-- `result.summary` = original = formatted_summary and the metadata
-- carries `fallbackReason` so we can audit which prompts trip
-- post-check and at what rate.
--
-- All three columns are nullable so existing rows (pre-formatter)
-- compile fine without backfill. The formatter only writes them on
-- new tasks once OPENAI_RESPONSE_LAYER_ENABLED=true.
--
-- MEDIUMTEXT for the summary columns: same shape as the agent's
-- existing summary path; ~16MB ceiling is comfortably above the
-- 2K-char tool result + verifier output.

ALTER TABLE `tasks` ADD COLUMN `original_summary` MEDIUMTEXT NULL;--> statement-breakpoint
ALTER TABLE `tasks` ADD COLUMN `formatted_summary` MEDIUMTEXT NULL;--> statement-breakpoint
ALTER TABLE `tasks` ADD COLUMN `response_layer_metadata` JSON NULL;
