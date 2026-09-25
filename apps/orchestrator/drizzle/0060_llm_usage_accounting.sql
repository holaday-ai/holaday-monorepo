-- Preserve historical amounts; legacy labels do not assert historical completeness.
-- No price backfill: unknown costs and usage are NULL, never zero sentinels.
ALTER TABLE `llm_calls`
  MODIFY COLUMN `prompt_tokens` int NULL DEFAULT NULL,
  MODIFY COLUMN `completion_tokens` int NULL DEFAULT NULL,
  MODIFY COLUMN `cache_read_tokens` int NULL DEFAULT NULL,
  MODIFY COLUMN `cache_write_tokens` int NULL DEFAULT NULL,
  MODIFY COLUMN `cost_usd` decimal(12,6) NULL DEFAULT NULL;
--> statement-breakpoint
ALTER TABLE `llm_calls` ADD COLUMN `cost_status` varchar(24) NOT NULL DEFAULT 'legacy_estimate';
--> statement-breakpoint
ALTER TABLE `llm_calls` ADD COLUMN `usage_status` varchar(24) NOT NULL DEFAULT 'legacy_reported';
--> statement-breakpoint
ALTER TABLE `llm_calls` ADD COLUMN `region` varchar(16) NULL;
--> statement-breakpoint
ALTER TABLE `llm_calls` ADD COLUMN `provider_request_id` varchar(128) NULL;
