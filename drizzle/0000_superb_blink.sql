CREATE TABLE `center_users` (
	`id` int AUTO_INCREMENT NOT NULL,
	`account` varchar(128) NOT NULL,
	`password_hash` varchar(255) NOT NULL,
	`account_type` varchar(16) NOT NULL DEFAULT 'email',
	`nickname` varchar(128),
	`avatar` varchar(512),
	`email` varchar(128),
	`phone` varchar(32),
	`created_at` varchar(32) NOT NULL,
	`updated_at` varchar(32) NOT NULL,
	CONSTRAINT `center_users_id` PRIMARY KEY(`id`),
	CONSTRAINT `uk_center_users_account` UNIQUE(`account`)
);
--> statement-breakpoint
CREATE TABLE `projects` (
	`id` int AUTO_INCREMENT NOT NULL,
	`team_id` int NOT NULL,
	`name` varchar(128) NOT NULL,
	`description` varchar(512),
	`created_by` int NOT NULL,
	`created_at` varchar(32) NOT NULL,
	`updated_at` varchar(32) NOT NULL,
	CONSTRAINT `projects_id` PRIMARY KEY(`id`),
	CONSTRAINT `uk_projects_team_name` UNIQUE(`team_id`,`name`)
);
--> statement-breakpoint
CREATE TABLE `team_members` (
	`id` int AUTO_INCREMENT NOT NULL,
	`team_id` int NOT NULL,
	`user_id` int NOT NULL,
	`role` varchar(16) NOT NULL DEFAULT 'editor',
	`created_at` varchar(32) NOT NULL,
	CONSTRAINT `team_members_id` PRIMARY KEY(`id`),
	CONSTRAINT `uk_team_members_team_user` UNIQUE(`team_id`,`user_id`)
);
--> statement-breakpoint
CREATE TABLE `teams` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(128) NOT NULL,
	`description` varchar(512),
	`created_by` int NOT NULL,
	`created_at` varchar(32) NOT NULL,
	`updated_at` varchar(32) NOT NULL,
	CONSTRAINT `teams_id` PRIMARY KEY(`id`),
	CONSTRAINT `uk_teams_name` UNIQUE(`name`)
);
--> statement-breakpoint
CREATE TABLE `presence` (
	`id` int AUTO_INCREMENT NOT NULL,
	`resource_type` varchar(64) NOT NULL,
	`resource_id` int NOT NULL,
	`team_id` int NOT NULL,
	`user_id` int NOT NULL,
	`nickname` varchar(128),
	`last_seen_at` varchar(32) NOT NULL,
	CONSTRAINT `presence_id` PRIMARY KEY(`id`),
	CONSTRAINT `uk_presence_resource_user` UNIQUE(`resource_type`,`resource_id`,`user_id`)
);
--> statement-breakpoint
CREATE TABLE `resource_versions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`resource_type` varchar(64) NOT NULL,
	`resource_id` int NOT NULL,
	`team_id` int NOT NULL,
	`project_id` int,
	`version` int NOT NULL,
	`snapshot` mediumtext NOT NULL,
	`content_hash` varchar(64) NOT NULL,
	`change_summary` varchar(512),
	`origin` varchar(128),
	`changed_by` int NOT NULL,
	`created_at` varchar(32) NOT NULL,
	CONSTRAINT `resource_versions_id` PRIMARY KEY(`id`),
	CONSTRAINT `uk_resource_versions_rid` UNIQUE(`resource_type`,`resource_id`,`version`)
);
--> statement-breakpoint
CREATE TABLE `t_apis` (
	`id` int AUTO_INCREMENT NOT NULL,
	`team_id` int NOT NULL,
	`project_id` int NOT NULL,
	`owner_id` int NOT NULL,
	`version` int NOT NULL DEFAULT 1,
	`name` varchar(255) NOT NULL,
	`method` varchar(16) NOT NULL DEFAULT 'GET',
	`url` text NOT NULL,
	`protocol` varchar(16) NOT NULL DEFAULT 'https',
	`headers` text,
	`body` mediumtext,
	`description` text,
	`tags` text,
	`status` varchar(32) NOT NULL DEFAULT 'active',
	`content_type` varchar(64),
	`assertions` text,
	`pre_script` mediumtext,
	`post_script` mediumtext,
	`pre_db_name` varchar(128),
	`pre_db_query` mediumtext,
	`post_db_name` varchar(128),
	`post_db_query` mediumtext,
	`pre_assertions` text,
	`post_assertions` text,
	`final_assertions` text,
	`ws_send` text,
	`ws_expect` text,
	`pre_actions` text,
	`post_actions` text,
	`parameters` text,
	`created_by` varchar(128),
	`updated_by` varchar(128),
	`created_at` varchar(32) NOT NULL,
	`updated_at` varchar(32) NOT NULL,
	CONSTRAINT `t_apis_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `t_audit_logs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`team_id` int NOT NULL,
	`project_id` int,
	`user_id` int NOT NULL,
	`account` varchar(128) NOT NULL,
	`action` varchar(32) NOT NULL,
	`resource_type` varchar(64) NOT NULL,
	`resource_id` int,
	`resource_name` varchar(255),
	`detail` mediumtext,
	`created_at` varchar(32) NOT NULL,
	CONSTRAINT `t_audit_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `t_case_sets_mobile` (
	`id` int AUTO_INCREMENT NOT NULL,
	`team_id` int NOT NULL,
	`project_id` int NOT NULL,
	`owner_id` int NOT NULL,
	`version` int NOT NULL DEFAULT 1,
	`name` varchar(255) NOT NULL,
	`description` text,
	`test_case_ids` text NOT NULL,
	`tags` text,
	`status` varchar(32) NOT NULL DEFAULT 'active',
	`created_at` varchar(32) NOT NULL,
	`updated_at` varchar(32) NOT NULL,
	CONSTRAINT `t_case_sets_mobile_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `t_case_sets_pc` (
	`id` int AUTO_INCREMENT NOT NULL,
	`team_id` int NOT NULL,
	`project_id` int NOT NULL,
	`owner_id` int NOT NULL,
	`version` int NOT NULL DEFAULT 1,
	`name` varchar(255) NOT NULL,
	`description` text,
	`test_case_ids` text NOT NULL,
	`tags` text,
	`status` varchar(32) NOT NULL DEFAULT 'active',
	`created_at` varchar(32) NOT NULL,
	`updated_at` varchar(32) NOT NULL,
	CONSTRAINT `t_case_sets_pc_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `t_case_sets_web` (
	`id` int AUTO_INCREMENT NOT NULL,
	`team_id` int NOT NULL,
	`project_id` int NOT NULL,
	`owner_id` int NOT NULL,
	`version` int NOT NULL DEFAULT 1,
	`name` varchar(255) NOT NULL,
	`description` text,
	`test_case_ids` text NOT NULL,
	`tags` text,
	`status` varchar(32) NOT NULL DEFAULT 'active',
	`created_at` varchar(32) NOT NULL,
	`updated_at` varchar(32) NOT NULL,
	CONSTRAINT `t_case_sets_web_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `t_devices` (
	`id` int AUTO_INCREMENT NOT NULL,
	`team_id` int NOT NULL,
	`project_id` int,
	`owner_id` int NOT NULL,
	`version` int NOT NULL DEFAULT 1,
	`name` varchar(255) NOT NULL,
	`test_type` varchar(16) NOT NULL,
	`platform` varchar(32) NOT NULL,
	`serial` varchar(255),
	`host` varchar(512),
	`status` varchar(16) NOT NULL DEFAULT 'unknown',
	`last_heartbeat` varchar(32),
	`metadata` text,
	`agent_token` varchar(128),
	`agent_endpoint` varchar(512),
	`agent_version` varchar(64),
	`last_seen_at` varchar(32),
	`ssh_host` varchar(255),
	`ssh_port` int DEFAULT 22,
	`ssh_user` varchar(128),
	`ssh_auth_type` varchar(32),
	`ssh_password` text,
	`ssh_private_key` text,
	`os_type` varchar(32) DEFAULT 'linux',
	`needs_upgrade` int DEFAULT 0,
	`last_push_at` varchar(32),
	`last_push_status` varchar(32),
	`last_push_error` text,
	`preview_kind` varchar(32),
	`ssh_tunnel_port` int,
	`mobile_agent_port` int DEFAULT 4002,
	`created_at` varchar(32) NOT NULL,
	`updated_at` varchar(32) NOT NULL,
	CONSTRAINT `t_devices_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `t_environments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`team_id` int NOT NULL,
	`project_id` int NOT NULL,
	`owner_id` int NOT NULL,
	`version` int NOT NULL DEFAULT 1,
	`name` varchar(255) NOT NULL,
	`variables` text NOT NULL,
	`ssl_cert` text,
	`ssl_key` text,
	`ssl_certs` text NOT NULL,
	`timeout` int DEFAULT 30000,
	`sort_order` int DEFAULT 0,
	`is_default` int DEFAULT 0,
	`created_at` varchar(32) NOT NULL,
	`updated_at` varchar(32) NOT NULL,
	CONSTRAINT `t_environments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `t_mobile_cases` (
	`id` int AUTO_INCREMENT NOT NULL,
	`team_id` int NOT NULL,
	`project_id` int NOT NULL,
	`owner_id` int NOT NULL,
	`version` int NOT NULL DEFAULT 1,
	`name` varchar(255) NOT NULL,
	`description` text,
	`platform` varchar(32) DEFAULT 'android',
	`device_name` varchar(255),
	`platform_version` varchar(32),
	`app_package` varchar(255),
	`app_activity` varchar(255),
	`bundle_id` varchar(255),
	`appium_url` varchar(255) DEFAULT 'http://localhost:4723',
	`capabilities` text,
	`test_script` text,
	`assertions` text,
	`preconditions` text,
	`tags` text,
	`status` varchar(32) NOT NULL DEFAULT 'active',
	`case_content` mediumtext,
	`case_content_type` varchar(16),
	`created_by` varchar(128),
	`updated_by` varchar(128),
	`created_at` varchar(32) NOT NULL,
	`updated_at` varchar(32) NOT NULL,
	CONSTRAINT `t_mobile_cases_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `t_mocks_api` (
	`id` int AUTO_INCREMENT NOT NULL,
	`team_id` int NOT NULL,
	`project_id` int NOT NULL,
	`owner_id` int NOT NULL,
	`version` int NOT NULL DEFAULT 1,
	`name` varchar(255) NOT NULL,
	`method` varchar(16) NOT NULL DEFAULT '*',
	`path_pattern` text NOT NULL,
	`description` text,
	`tags` text,
	`status` varchar(32),
	`response_status` int DEFAULT 200,
	`response_headers` text,
	`response_body` mediumtext,
	`response_delay_ms` int DEFAULT 0,
	`conditions` text,
	`match_mode` varchar(16) NOT NULL DEFAULT 'exact',
	`enabled` int NOT NULL DEFAULT 1,
	`hit_count` int NOT NULL DEFAULT 0,
	`last_hit_at` varchar(32),
	`created_at` varchar(32) NOT NULL,
	`updated_at` varchar(32) NOT NULL,
	CONSTRAINT `t_mocks_api_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `t_mocks_mobile` (
	`id` int AUTO_INCREMENT NOT NULL,
	`team_id` int NOT NULL,
	`project_id` int NOT NULL,
	`owner_id` int NOT NULL,
	`version` int NOT NULL DEFAULT 1,
	`name` varchar(255) NOT NULL,
	`method` varchar(16) NOT NULL DEFAULT '*',
	`path_pattern` text NOT NULL,
	`description` text,
	`tags` text,
	`status` varchar(32),
	`response_status` int DEFAULT 200,
	`response_headers` text,
	`response_body` mediumtext,
	`response_delay_ms` int DEFAULT 0,
	`conditions` text,
	`match_mode` varchar(16) NOT NULL DEFAULT 'exact',
	`enabled` int NOT NULL DEFAULT 1,
	`hit_count` int NOT NULL DEFAULT 0,
	`last_hit_at` varchar(32),
	`created_at` varchar(32) NOT NULL,
	`updated_at` varchar(32) NOT NULL,
	CONSTRAINT `t_mocks_mobile_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `t_mocks_pc` (
	`id` int AUTO_INCREMENT NOT NULL,
	`team_id` int NOT NULL,
	`project_id` int NOT NULL,
	`owner_id` int NOT NULL,
	`version` int NOT NULL DEFAULT 1,
	`name` varchar(255) NOT NULL,
	`method` varchar(16) NOT NULL DEFAULT '*',
	`path_pattern` text NOT NULL,
	`description` text,
	`tags` text,
	`status` varchar(32),
	`response_status` int DEFAULT 200,
	`response_headers` text,
	`response_body` mediumtext,
	`response_delay_ms` int DEFAULT 0,
	`conditions` text,
	`match_mode` varchar(16) NOT NULL DEFAULT 'exact',
	`enabled` int NOT NULL DEFAULT 1,
	`hit_count` int NOT NULL DEFAULT 0,
	`last_hit_at` varchar(32),
	`created_at` varchar(32) NOT NULL,
	`updated_at` varchar(32) NOT NULL,
	CONSTRAINT `t_mocks_pc_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `t_mocks_web` (
	`id` int AUTO_INCREMENT NOT NULL,
	`team_id` int NOT NULL,
	`project_id` int NOT NULL,
	`owner_id` int NOT NULL,
	`version` int NOT NULL DEFAULT 1,
	`name` varchar(255) NOT NULL,
	`method` varchar(16) NOT NULL DEFAULT '*',
	`path_pattern` text NOT NULL,
	`description` text,
	`tags` text,
	`status` varchar(32),
	`response_status` int DEFAULT 200,
	`response_headers` text,
	`response_body` mediumtext,
	`response_delay_ms` int DEFAULT 0,
	`conditions` text,
	`match_mode` varchar(16) NOT NULL DEFAULT 'exact',
	`enabled` int NOT NULL DEFAULT 1,
	`hit_count` int NOT NULL DEFAULT 0,
	`last_hit_at` varchar(32),
	`created_at` varchar(32) NOT NULL,
	`updated_at` varchar(32) NOT NULL,
	CONSTRAINT `t_mocks_web_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `t_notify_channels` (
	`id` int AUTO_INCREMENT NOT NULL,
	`team_id` int NOT NULL,
	`name` varchar(128) NOT NULL,
	`type` varchar(32) NOT NULL,
	`webhook_url` text NOT NULL,
	`secret` text,
	`events` text NOT NULL,
	`enabled` int NOT NULL DEFAULT 1,
	`created_by` int NOT NULL,
	`created_at` varchar(32) NOT NULL,
	`updated_at` varchar(32) NOT NULL,
	CONSTRAINT `t_notify_channels_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `t_pc_cases` (
	`id` int AUTO_INCREMENT NOT NULL,
	`team_id` int NOT NULL,
	`project_id` int NOT NULL,
	`owner_id` int NOT NULL,
	`version` int NOT NULL DEFAULT 1,
	`name` varchar(255) NOT NULL,
	`description` text,
	`tags` text,
	`status` varchar(32) NOT NULL DEFAULT 'active',
	`steps` text,
	`check_points` text,
	`data_drive` text,
	`preconditions` text,
	`window_size` varchar(32),
	`timeout` int,
	`case_content` mediumtext,
	`case_content_type` varchar(16),
	`driver_path` text,
	`display_id` varchar(64),
	`keyboard_driver` varchar(64),
	`xvfb_resolution` varchar(32),
	`headless` int,
	`platform` varchar(32) DEFAULT 'windows',
	`created_by` varchar(128),
	`updated_by` varchar(128),
	`created_at` varchar(32) NOT NULL,
	`updated_at` varchar(32) NOT NULL,
	CONSTRAINT `t_pc_cases_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `t_scenario_edges` (
	`id` int AUTO_INCREMENT NOT NULL,
	`scenario_id` int NOT NULL,
	`edge_id` varchar(128) NOT NULL,
	`source_node_id` varchar(128) NOT NULL,
	`target_node_id` varchar(128) NOT NULL,
	`source_handle` varchar(64),
	`label` varchar(255),
	`created_at` varchar(32) NOT NULL,
	CONSTRAINT `t_scenario_edges_id` PRIMARY KEY(`id`),
	CONSTRAINT `uk_t_scenario_edges` UNIQUE(`scenario_id`,`edge_id`)
);
--> statement-breakpoint
CREATE TABLE `t_scenario_nodes` (
	`id` int AUTO_INCREMENT NOT NULL,
	`scenario_id` int NOT NULL,
	`node_id` varchar(128) NOT NULL,
	`type` varchar(64) NOT NULL,
	`position_x` double NOT NULL DEFAULT 0,
	`position_y` double NOT NULL DEFAULT 0,
	`label` varchar(255),
	`config` mediumtext,
	`created_at` varchar(32) NOT NULL,
	`updated_at` varchar(32) NOT NULL,
	CONSTRAINT `t_scenario_nodes_id` PRIMARY KEY(`id`),
	CONSTRAINT `uk_t_scenario_nodes` UNIQUE(`scenario_id`,`node_id`)
);
--> statement-breakpoint
CREATE TABLE `t_scenario_sets` (
	`id` int AUTO_INCREMENT NOT NULL,
	`team_id` int NOT NULL,
	`project_id` int NOT NULL,
	`owner_id` int NOT NULL,
	`version` int NOT NULL DEFAULT 1,
	`name` varchar(255) NOT NULL,
	`description` text,
	`scenario_ids` text NOT NULL,
	`created_at` varchar(32) NOT NULL,
	`updated_at` varchar(32) NOT NULL,
	CONSTRAINT `t_scenario_sets_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `t_scenarios` (
	`id` int AUTO_INCREMENT NOT NULL,
	`team_id` int NOT NULL,
	`project_id` int NOT NULL,
	`owner_id` int NOT NULL,
	`version` int NOT NULL DEFAULT 1,
	`name` varchar(255) NOT NULL,
	`description` text,
	`status` varchar(32) NOT NULL DEFAULT 'active',
	`tags` text,
	`parameters` text,
	`created_at` varchar(32) NOT NULL,
	`updated_at` varchar(32) NOT NULL,
	CONSTRAINT `t_scenarios_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `t_schedule_sets_api` (
	`id` int AUTO_INCREMENT NOT NULL,
	`team_id` int NOT NULL,
	`project_id` int NOT NULL,
	`owner_id` int NOT NULL,
	`version` int NOT NULL DEFAULT 1,
	`scenario_set_id` int NOT NULL,
	`cron_expr` varchar(128),
	`status` varchar(16) NOT NULL DEFAULT 'none',
	`next_run_at` varchar(32),
	`last_run_at` varchar(32),
	`last_run_status` varchar(32),
	`created_at` varchar(32) NOT NULL,
	`updated_at` varchar(32) NOT NULL,
	CONSTRAINT `t_schedule_sets_api_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `t_schedule_sets_mobile` (
	`id` int AUTO_INCREMENT NOT NULL,
	`team_id` int NOT NULL,
	`project_id` int NOT NULL,
	`owner_id` int NOT NULL,
	`version` int NOT NULL DEFAULT 1,
	`case_set_id` int NOT NULL,
	`cron_expr` varchar(128),
	`status` varchar(16) NOT NULL DEFAULT 'none',
	`next_run_at` varchar(32),
	`last_run_at` varchar(32),
	`last_run_status` varchar(32),
	`created_at` varchar(32) NOT NULL,
	`updated_at` varchar(32) NOT NULL,
	CONSTRAINT `t_schedule_sets_mobile_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `t_schedule_sets_pc` (
	`id` int AUTO_INCREMENT NOT NULL,
	`team_id` int NOT NULL,
	`project_id` int NOT NULL,
	`owner_id` int NOT NULL,
	`version` int NOT NULL DEFAULT 1,
	`case_set_id` int NOT NULL,
	`cron_expr` varchar(128),
	`status` varchar(16) NOT NULL DEFAULT 'none',
	`next_run_at` varchar(32),
	`last_run_at` varchar(32),
	`last_run_status` varchar(32),
	`created_at` varchar(32) NOT NULL,
	`updated_at` varchar(32) NOT NULL,
	CONSTRAINT `t_schedule_sets_pc_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `t_schedule_sets_web` (
	`id` int AUTO_INCREMENT NOT NULL,
	`team_id` int NOT NULL,
	`project_id` int NOT NULL,
	`owner_id` int NOT NULL,
	`version` int NOT NULL DEFAULT 1,
	`case_set_id` int NOT NULL,
	`cron_expr` varchar(128),
	`status` varchar(16) NOT NULL DEFAULT 'none',
	`next_run_at` varchar(32),
	`last_run_at` varchar(32),
	`last_run_status` varchar(32),
	`created_at` varchar(32) NOT NULL,
	`updated_at` varchar(32) NOT NULL,
	CONSTRAINT `t_schedule_sets_web_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `t_tags` (
	`id` int AUTO_INCREMENT NOT NULL,
	`team_id` int NOT NULL,
	`name` varchar(128) NOT NULL,
	`color` varchar(32) DEFAULT '',
	`created_at` varchar(32) NOT NULL,
	CONSTRAINT `t_tags_id` PRIMARY KEY(`id`),
	CONSTRAINT `uk_t_tags` UNIQUE(`team_id`,`name`)
);
--> statement-breakpoint
CREATE TABLE `t_web_cases` (
	`id` int AUTO_INCREMENT NOT NULL,
	`team_id` int NOT NULL,
	`project_id` int NOT NULL,
	`owner_id` int NOT NULL,
	`version` int NOT NULL DEFAULT 1,
	`name` varchar(255) NOT NULL,
	`description` text,
	`tags` text,
	`status` varchar(32) NOT NULL DEFAULT 'active',
	`steps` text,
	`check_points` text,
	`data_drive` text,
	`preconditions` text,
	`browser` varchar(64),
	`window_size` varchar(32),
	`timeout` int,
	`headless_mode` int,
	`base_url` text,
	`case_content` mediumtext,
	`case_content_type` varchar(16),
	`driver_path` text,
	`close_browser_after_execution` int,
	`created_by` varchar(128),
	`updated_by` varchar(128),
	`created_at` varchar(32) NOT NULL,
	`updated_at` varchar(32) NOT NULL,
	CONSTRAINT `t_web_cases_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_projects_team` ON `projects` (`team_id`);--> statement-breakpoint
CREATE INDEX `idx_team_members_user` ON `team_members` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_presence_resource` ON `presence` (`resource_type`,`resource_id`);--> statement-breakpoint
CREATE INDEX `idx_resource_versions_team_project` ON `resource_versions` (`team_id`,`project_id`);--> statement-breakpoint
CREATE INDEX `idx_resource_versions_changed_by` ON `resource_versions` (`changed_by`);--> statement-breakpoint
CREATE INDEX `idx_t_apis_scope` ON `t_apis` (`team_id`,`project_id`);--> statement-breakpoint
CREATE INDEX `idx_t_audit_team` ON `t_audit_logs` (`team_id`,`project_id`);--> statement-breakpoint
CREATE INDEX `idx_t_audit_resource` ON `t_audit_logs` (`resource_type`,`resource_id`);--> statement-breakpoint
CREATE INDEX `idx_t_case_sets_mobile_scope` ON `t_case_sets_mobile` (`team_id`,`project_id`);--> statement-breakpoint
CREATE INDEX `idx_t_case_sets_pc_scope` ON `t_case_sets_pc` (`team_id`,`project_id`);--> statement-breakpoint
CREATE INDEX `idx_t_case_sets_web_scope` ON `t_case_sets_web` (`team_id`,`project_id`);--> statement-breakpoint
CREATE INDEX `idx_t_devices_team` ON `t_devices` (`team_id`);--> statement-breakpoint
CREATE INDEX `idx_t_devices_test_type` ON `t_devices` (`test_type`);--> statement-breakpoint
CREATE INDEX `idx_t_environments_scope` ON `t_environments` (`team_id`,`project_id`);--> statement-breakpoint
CREATE INDEX `idx_t_mobile_cases_scope` ON `t_mobile_cases` (`team_id`,`project_id`);--> statement-breakpoint
CREATE INDEX `idx_t_mocks_api_scope` ON `t_mocks_api` (`team_id`,`project_id`);--> statement-breakpoint
CREATE INDEX `idx_t_mocks_mobile_scope` ON `t_mocks_mobile` (`team_id`,`project_id`);--> statement-breakpoint
CREATE INDEX `idx_t_mocks_pc_scope` ON `t_mocks_pc` (`team_id`,`project_id`);--> statement-breakpoint
CREATE INDEX `idx_t_mocks_web_scope` ON `t_mocks_web` (`team_id`,`project_id`);--> statement-breakpoint
CREATE INDEX `idx_t_notify_team` ON `t_notify_channels` (`team_id`);--> statement-breakpoint
CREATE INDEX `idx_t_pc_cases_scope` ON `t_pc_cases` (`team_id`,`project_id`);--> statement-breakpoint
CREATE INDEX `idx_t_scenario_edges_sid` ON `t_scenario_edges` (`scenario_id`);--> statement-breakpoint
CREATE INDEX `idx_t_scenario_nodes_sid` ON `t_scenario_nodes` (`scenario_id`);--> statement-breakpoint
CREATE INDEX `idx_t_scenario_sets_scope` ON `t_scenario_sets` (`team_id`,`project_id`);--> statement-breakpoint
CREATE INDEX `idx_t_scenarios_scope` ON `t_scenarios` (`team_id`,`project_id`);--> statement-breakpoint
CREATE INDEX `idx_t_schedule_sets_api_scope` ON `t_schedule_sets_api` (`team_id`,`project_id`);--> statement-breakpoint
CREATE INDEX `idx_t_schedule_sets_mobile_scope` ON `t_schedule_sets_mobile` (`team_id`,`project_id`);--> statement-breakpoint
CREATE INDEX `idx_t_schedule_sets_pc_scope` ON `t_schedule_sets_pc` (`team_id`,`project_id`);--> statement-breakpoint
CREATE INDEX `idx_t_schedule_sets_web_scope` ON `t_schedule_sets_web` (`team_id`,`project_id`);--> statement-breakpoint
CREATE INDEX `idx_t_web_cases_scope` ON `t_web_cases` (`team_id`,`project_id`);