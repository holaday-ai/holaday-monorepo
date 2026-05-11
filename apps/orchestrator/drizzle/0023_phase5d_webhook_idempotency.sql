-- Phase 5d follow-up — per-user idempotency keys for the webhook
-- task-creation endpoint. Zapier (and other retry-prone callers)
-- set Idempotency-Key on each request; the server SHA-256s the body
-- + matches against this table:
--
--   hit + hash matches   → return original taskId/response
--   hit + hash differs   → 409 idempotency_conflict
--   miss / missing header → normal flow, write row on success
--
-- 24h `expires_at` so a Zapier retry from days ago doesn't return
-- a stale taskId; cleanup cron sweeps expired rows every hour.
-- FK CASCADE on user delete so account-deletion drops the rows too.

CREATE TABLE `webhook_idempotency` (
  `id` bigint unsigned PRIMARY KEY AUTO_INCREMENT,
  `user_id` bigint unsigned NOT NULL,
  `idempotency_key` varchar(128) NOT NULL,
  `request_hash` varchar(64) NOT NULL,
  `task_id` varchar(32) NOT NULL,
  `response_json` json NOT NULL,
  `expires_at` datetime(3) NOT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT `fk_webhook_idempotency_user_id` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
);--> statement-breakpoint
CREATE UNIQUE INDEX `uk_webhook_idempotency_user_key` ON `webhook_idempotency` (`user_id`, `idempotency_key`);--> statement-breakpoint
CREATE INDEX `ix_webhook_idempotency_expires` ON `webhook_idempotency` (`expires_at`);
