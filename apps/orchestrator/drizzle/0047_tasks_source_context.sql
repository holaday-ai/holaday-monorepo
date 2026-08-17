-- Bind tasks created from trusted product surfaces to their immutable source
-- context. The stock task flow stores a server-validated snapshot payload here
-- so retries and historical detail views cannot silently switch to live data.

ALTER TABLE `tasks`
  ADD COLUMN `source_context` JSON NULL AFTER `result`;
