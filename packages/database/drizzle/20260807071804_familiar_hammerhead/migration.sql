PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_gmail_sender_brands` (
	`authority_url` text,
	`domain` text NOT NULL,
	`expires_at` integer NOT NULL,
	`logo_data` blob,
	`logo_url` text,
	`selector` text NOT NULL,
	`status` text NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`domain`, `selector`)
);
--> statement-breakpoint
INSERT INTO `__new_gmail_sender_brands`("authority_url", "domain", "expires_at", "logo_data", "logo_url", "selector", "status", "updated_at") SELECT "authority_url", "domain", "expires_at", "logo_data", "logo_url", 'default', "status", "updated_at" FROM `gmail_sender_brands`;--> statement-breakpoint
DROP TABLE `gmail_sender_brands`;--> statement-breakpoint
ALTER TABLE `__new_gmail_sender_brands` RENAME TO `gmail_sender_brands`;--> statement-breakpoint
PRAGMA foreign_keys=ON;
