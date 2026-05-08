-- Phase 1 Day 5 — execution-pipeline persistence columns.
--
-- Adds five new columns to `tasks`. All NULLABLE + DEFAULT NULL so
-- existing queries are unaffected. Populated only when the
-- execution-pipeline feature flags are flipped on at runtime; until
-- then every row writes NULL into these columns and the SPA never
-- reads them.
--
-- Columns:
--   contract_json        — ExecutionContract serialised at task start
--   evidence_json        — EvidenceLedger snapshot at terminal state
--   verification_json    — VerificationResult (deterministic ± LLM)
--   verification_passed  — quick-filter boolean for analytics
--   failure_level        — fixable / needs_clarification / hard_fail
--                          (NULL when verification.passed=true)
--
-- No INDEX added — query patterns will surface from real usage.
-- ALTER TABLE on MariaDB is safe online (instant for ADD COLUMN
-- after MariaDB 10.0); the orchestrator can keep serving while
-- this runs.

ALTER TABLE `tasks`
  ADD COLUMN `contract_json` JSON DEFAULT NULL,
  ADD COLUMN `evidence_json` JSON DEFAULT NULL,
  ADD COLUMN `verification_json` JSON DEFAULT NULL,
  ADD COLUMN `verification_passed` TINYINT(1) DEFAULT NULL,
  ADD COLUMN `failure_level` ENUM('fixable', 'needs_clarification', 'hard_fail') DEFAULT NULL;
