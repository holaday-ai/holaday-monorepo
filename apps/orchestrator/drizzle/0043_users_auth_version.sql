ALTER TABLE `users`
  ADD COLUMN `auth_version` int NOT NULL DEFAULT 0 AFTER `status`;
