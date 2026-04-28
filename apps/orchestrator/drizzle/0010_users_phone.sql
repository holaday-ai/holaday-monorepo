-- Phase 12 — SMS login (Aliyun).
--
-- Phone is the third identity rail alongside email + Google sub.
-- Stored as the canonical 11-digit Chinese mobile number (no +86
-- prefix; the SPA strips it before submitting). Nullable because
-- existing users registered via email/Google never set one. Unique
-- index because each phone can match at most one account; the
-- AuthService.loginOrRegisterByPhone path does the upsert.
--
-- Email becomes nullable too: SMS-first users have no email until
-- they explicitly add one via /profile. The existing uniqueness
-- index `uk_users_email` on a nullable column is fine — MySQL
-- treats NULLs as distinct under UNIQUE, so multiple SMS-only users
-- can coexist with email=NULL. Pre-existing email rows stay unique
-- by their actual address.

ALTER TABLE `users` ADD `phone` varchar(20);--> statement-breakpoint
ALTER TABLE `users` ADD `phone_verified` tinyint(1) NOT NULL DEFAULT 0;--> statement-breakpoint
ALTER TABLE `users` MODIFY `email` varchar(255);--> statement-breakpoint
CREATE UNIQUE INDEX `uk_users_phone` ON `users` (`phone`);
