-- Phase 27 — admin role gate.
--
-- Adds `users.role` (ENUM 'user' | 'admin', default 'user') so the
-- new /admin surface can authorize requests without an extra table.
-- VARCHAR(16) is used (matching the rest of the schema's ENUM-as-
-- varchar convention) — keeps options open for additional roles
-- (e.g. 'support', 'ops') later without DDL churn.
--
-- The new column is indexed because admin counts (`role = 'admin'`)
-- run on every protected admin route as the auth gate; an index lets
-- those checks stay O(1).

ALTER TABLE users
  ADD COLUMN role VARCHAR(16) NOT NULL DEFAULT 'user';
--> statement-breakpoint
CREATE INDEX ix_users_role ON users (role);
