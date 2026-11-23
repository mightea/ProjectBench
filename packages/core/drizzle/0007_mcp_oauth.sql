CREATE TABLE `oauth_clients` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`redirect_uris` text NOT NULL,
	`kind` text NOT NULL,
	`fetched_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `oauth_codes` (
	`code_hash` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`redirect_uri` text NOT NULL,
	`code_challenge` text NOT NULL,
	`scope` text NOT NULL,
	`resource` text NOT NULL,
	`expires_at` text NOT NULL,
	`consumed_at` text,
	`grant_id` text,
	FOREIGN KEY (`client_id`) REFERENCES `oauth_clients`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `oauth_grants` (
	`id` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`scope` text NOT NULL,
	`resource` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`last_used_at` text,
	FOREIGN KEY (`client_id`) REFERENCES `oauth_clients`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `oauth_grants_client_idx` ON `oauth_grants` (`client_id`);--> statement-breakpoint
CREATE TABLE `oauth_tokens` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`grant_id` text NOT NULL,
	`kind` text NOT NULL,
	`expires_at` text NOT NULL,
	`rotated_at` text,
	FOREIGN KEY (`grant_id`) REFERENCES `oauth_grants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `oauth_tokens_grant_idx` ON `oauth_tokens` (`grant_id`);--> statement-breakpoint
CREATE INDEX `oauth_tokens_expiry_idx` ON `oauth_tokens` (`expires_at`);