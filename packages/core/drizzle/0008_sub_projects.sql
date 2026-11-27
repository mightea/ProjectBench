ALTER TABLE `projects` ADD `parent_id` text REFERENCES projects(id) ON DELETE SET NULL;--> statement-breakpoint
CREATE INDEX `projects_parent_idx` ON `projects` (`parent_id`);