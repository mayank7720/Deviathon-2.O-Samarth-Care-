CREATE TABLE `care_invitations` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`email` text NOT NULL,
	`role` text NOT NULL,
	`senior_id` text NOT NULL,
	`scope_json` text NOT NULL,
	`created_by` text NOT NULL,
	`status` text NOT NULL,
	`expires_at` integer NOT NULL,
	`redeemed_by` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `invitations_token` ON `care_invitations` (`token_hash`);--> statement-breakpoint
CREATE TABLE `care_memberships` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`email` text NOT NULL,
	`display_name` text NOT NULL,
	`role` text NOT NULL,
	`senior_id` text NOT NULL,
	`scope_json` text NOT NULL,
	`is_admin` integer NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `memberships_user_workspace` ON `care_memberships` (`user_id`,`workspace_id`);--> statement-breakpoint
CREATE TABLE `care_workspaces` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_user_id` text NOT NULL,
	`created_at` text NOT NULL
);
