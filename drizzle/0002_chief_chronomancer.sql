CREATE TABLE `team_invites` (
	`id` int AUTO_INCREMENT NOT NULL,
	`team_id` int NOT NULL,
	`code` varchar(32) NOT NULL,
	`role` varchar(16) NOT NULL DEFAULT 'editor',
	`note` varchar(128),
	`max_uses` int NOT NULL DEFAULT 0,
	`used_count` int NOT NULL DEFAULT 0,
	`expires_at` varchar(32),
	`revoked` int NOT NULL DEFAULT 0,
	`created_by` int NOT NULL,
	`created_at` varchar(32) NOT NULL,
	CONSTRAINT `team_invites_id` PRIMARY KEY(`id`),
	CONSTRAINT `uk_team_invites_code` UNIQUE(`code`)
);
--> statement-breakpoint
CREATE INDEX `idx_team_invites_team` ON `team_invites` (`team_id`);