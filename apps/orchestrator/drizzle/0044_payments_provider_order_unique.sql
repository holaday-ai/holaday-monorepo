-- Production was audited before this migration: no duplicate
-- (provider, provider_order_id) groups existed. MySQL unique indexes allow
-- multiple NULLs, preserving pre-order checkout rows.
CREATE UNIQUE INDEX `uk_payments_provider_order`
  ON `payments` (`provider`, `provider_order_id`);
DROP INDEX `ix_payments_provider_order` ON `payments`;
