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
CREATE INDEX `idx_projects_team` ON `projects` (`team_id`);--> statement-breakpoint
CREATE INDEX `idx_team_members_user` ON `team_members` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_presence_resource` ON `presence` (`resource_type`,`resource_id`);--> statement-breakpoint
CREATE INDEX `idx_resource_versions_team_project` ON `resource_versions` (`team_id`,`project_id`);--> statement-breakpoint
CREATE INDEX `idx_resource_versions_changed_by` ON `resource_versions` (`changed_by`);