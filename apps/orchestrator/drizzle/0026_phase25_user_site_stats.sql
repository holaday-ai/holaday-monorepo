-- Phase 25 — extension-driven browsing intelligence.
--
-- The Chrome extension uploads a per-domain summary of the user's
-- 30-day browsing history at install (initial sync) and incrementally
-- once a day after that. The orchestrator stores aggregates here so:
--   - The site-config router can prefer configs for domains the user
--     actually visits (taobao.com, douyin.com, …) instead of running
--     URL match against every shipped config.
--   - The dashboard / admin tooling can read "this user is a 抖音
--     重度用户" without scraping task logs.
--
-- Privacy contract: only the *origin* (host) is stored. We do NOT
-- store full URLs, query strings, or page titles. `visit_count` and
-- `last_visit_at` are aggregated client-side before upload.
--
-- Schema notes:
--   - `domain` is up to 253 chars per RFC 1035 (longest legal FQDN).
--     Indexed jointly with user_id so the per-user upsert path stays
--     a primary-key lookup.
--   - Rows are upsert-on-conflict — the extension uploads the full
--     30-day snapshot; the endpoint replaces this user's rows
--     atomically (delete + bulk insert in a single transaction).
--   - `source` reserved for future per-row provenance ("extension" vs
--     "task_observed"); only "extension" is written today.
--
-- No FK from a future "user_site_preferences" table — keep this
-- simple and additive. A user delete cascades via the existing
-- `users` FK so we don't leak per-domain data on account removal.

CREATE TABLE `user_site_stats` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `domain` VARCHAR(253) NOT NULL,
  `visit_count` INT UNSIGNED NOT NULL DEFAULT 0,
  `last_visit_at` DATETIME(3) NULL,
  `source` VARCHAR(32) NOT NULL DEFAULT 'extension',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_user_site_stats_user_domain` (`user_id`, `domain`),
  KEY `ix_user_site_stats_user` (`user_id`),
  CONSTRAINT `fk_user_site_stats_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
);
