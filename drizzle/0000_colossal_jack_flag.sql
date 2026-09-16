CREATE TABLE `registrations` (
	`id` integer PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`registered_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `registrations_email_unique` ON `registrations` ("email" COLLATE NOCASE);