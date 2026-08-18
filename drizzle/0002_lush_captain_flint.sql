DROP INDEX `idx_t_sched_api` ON `t_schedule_sets_api`;--> statement-breakpoint
CREATE INDEX `idx_t_schedule_sets_api_scope` ON `t_schedule_sets_api` (`team_id`,`project_id`);