-- Phase 17 — extension-driven Cookie sync.
--
-- The Chrome extension collects cookies for a curated list of high-
-- frequency Chinese + Western sites and POSTs them to the
-- orchestrator. The server tries to inject them into the user's
-- live Brave instance immediately; if no Brave is allocated, the
-- cookies park here and the BrowserPool's allocate path drains
-- them on next spawn.
--
-- One row per user — re-syncs REPLACE INTO so we never accumulate
-- stale cookies. cookies_json is the entire SyncableCookie[] payload;
-- MEDIUMTEXT (~16MB) is more than enough headroom (a typical sync
-- is <50 KB even for power users).

CREATE TABLE `pending_cookies` (
  `id` bigint unsigned PRIMARY KEY AUTO_INCREMENT,
  `user_id` bigint unsigned NOT NULL,
  `cookies_json` mediumtext NOT NULL,
  `cookie_count` int unsigned NOT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT `fk_pending_cookies_user_id` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
);--> statement-breakpoint
CREATE UNIQUE INDEX `uk_pending_cookies_user_id` ON `pending_cookies` (`user_id`);
