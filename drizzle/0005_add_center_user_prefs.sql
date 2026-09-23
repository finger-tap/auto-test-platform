CREATE TABLE `center_user_prefs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`pref_key` varchar(64) NOT NULL,
	`pref_value` text NOT NULL,
	`updated_at` varchar(32) NOT NULL,
	CONSTRAINT `center_user_prefs_id` PRIMARY KEY(`id`),
	CONSTRAINT `uk_center_user_prefs` UNIQUE(`user_id`, `pref_key`)
);