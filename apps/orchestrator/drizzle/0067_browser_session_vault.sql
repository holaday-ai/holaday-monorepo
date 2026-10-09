-- Default-off browser session vault. No legacy data is copied without site consent.
CREATE TABLE IF NOT EXISTS browser_session_vaults (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  revision INT UNSIGNED NOT NULL,
  document JSON NOT NULL,
  next_expiry_at BIGINT UNSIGNED NULL,
  UNIQUE KEY uk_browser_session_vault_user (user_id),
  KEY idx_browser_session_vault_next_expiry (next_expiry_at),
  CONSTRAINT fk_browser_session_vault_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
