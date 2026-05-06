-- Spec B — envelope encryption for pending_cookies.
--
-- Adds the four columns needed by `cookies/cookie-crypto.ts`:
--   * encrypted_blob   — AES-256-GCM ciphertext of the cookies JSON
--   * encryption_iv    — 12-byte IV used for the ciphertext above
--   * encryption_tag   — 16-byte GCM auth tag for the ciphertext
--   * encrypted_key    — packed [iv12 | tag16 | wrapped_data_key32]
--                        = 60 bytes; data key is encrypted under the
--                        master key from COOKIE_MASTER_KEY.
--
-- All four are NULLABLE during the rollout window so:
--   1. Old code keeps working (reads cookies_json plaintext).
--   2. New code dual-writes both columns; reads encrypted with a
--      cookies_json fallback.
--   3. A follow-up migration drops `cookies_json` and flips these
--      columns to NOT NULL once the soak closes (~30 days).
--
-- `cookies_json` itself is being relaxed to NULL so the new code can
-- write rows without it once we're confident about rollback.

ALTER TABLE pending_cookies
  MODIFY COLUMN cookies_json TEXT NULL,
  ADD COLUMN encrypted_blob MEDIUMBLOB NULL,
  ADD COLUMN encryption_iv VARBINARY(12) NULL,
  ADD COLUMN encryption_tag VARBINARY(16) NULL,
  ADD COLUMN encrypted_key VARBINARY(256) NULL;
