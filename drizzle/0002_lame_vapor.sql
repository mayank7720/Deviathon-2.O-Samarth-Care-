CREATE TABLE `care_consents` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`senior_id` text NOT NULL,
	`allowed` integer NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `consent_owner_senior` ON `care_consents` (`owner`,`senior_id`);--> statement-breakpoint
CREATE TABLE `care_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`kind` text NOT NULL,
	`job_date` text NOT NULL,
	`status` text NOT NULL,
	`result_json` text NOT NULL,
	`created_at` text NOT NULL,
	`completed_at` text
);
--> statement-breakpoint
CREATE INDEX `jobs_owner_date` ON `care_jobs` (`owner`,`job_date`);--> statement-breakpoint
CREATE TABLE `care_daily_scores` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`senior_id` text NOT NULL,
	`score_date` text NOT NULL,
	`revision` text NOT NULL,
	`payload` text NOT NULL,
	`computed_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `daily_scores_owner_date` ON `care_daily_scores` (`owner`,`score_date`,`senior_id`);--> statement-breakpoint
CREATE TABLE `care_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`senior_id` text NOT NULL,
	`recipient_role` text NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`channel` text NOT NULL,
	`status` text NOT NULL,
	`payload` text NOT NULL,
	`source_id` text NOT NULL,
	`created_at` text NOT NULL,
	`delivered_at` text,
	`read_at` text,
	`last_error` text,
	`attempts` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `deliveries_owner_recipient` ON `care_deliveries` (`owner`,`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `deliveries_owner_status` ON `care_deliveries` (`owner`,`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `care_push_subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`user_id` text NOT NULL,
	`endpoint` text NOT NULL,
	`subscription_json` text NOT NULL,
	`created_at` text NOT NULL,
	`disabled` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `push_owner_user` ON `care_push_subscriptions` (`owner`,`user_id`);--> statement-breakpoint
CREATE TABLE `care_runtime` (
	`owner` text PRIMARY KEY NOT NULL,
	`mode` text NOT NULL,
	`as_of_date` text NOT NULL,
	`timezone` text NOT NULL,
	`updated_at` text NOT NULL
);
