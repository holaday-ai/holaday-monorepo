ALTER TABLE `users`
  ADD COLUMN `model_data_region` varchar(8) NULL AFTER `role`,
  ADD CONSTRAINT `ck_users_model_data_region`
    CHECK (`model_data_region` IS NULL OR `model_data_region` IN ('cn', 'intl'));

ALTER TABLE `organizations`
  ADD COLUMN `model_data_region` varchar(8) NULL AFTER `team_projects_enabled`,
  ADD CONSTRAINT `ck_organizations_model_data_region`
    CHECK (`model_data_region` IS NULL OR `model_data_region` IN ('cn', 'intl'));
