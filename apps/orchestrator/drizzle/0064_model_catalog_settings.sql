-- Global model-catalog settings (admin "模型管理"). Additive only.
-- `mcp_servers`: Bailian hosted MCP servers (label + SSE url) attached to the
-- generate / scrape lanes. Credentials are never stored here: the DashScope
-- key is added at request time.
CREATE TABLE IF NOT EXISTS `model_catalog_settings` (
  `id` varchar(64) NOT NULL,
  `value` json NOT NULL,
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`)
);
--> statement-breakpoint
INSERT IGNORE INTO `model_catalog_settings` (`id`, `value`) VALUES ('mcp_servers', JSON_ARRAY());
