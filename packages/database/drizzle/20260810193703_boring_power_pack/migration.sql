CREATE TABLE `composer_templates` (
	`account_email` text,
	`bcc` text NOT NULL,
	`body_html` text NOT NULL,
	`body_text` text NOT NULL,
	`cc` text NOT NULL,
	`created_at` integer NOT NULL,
	`id` text PRIMARY KEY,
	`name` text NOT NULL,
	`subject` text NOT NULL,
	`to` text NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_composer_templates_account_email_google_accounts_email_fk` FOREIGN KEY (`account_email`) REFERENCES `google_accounts`(`email`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE INDEX `composer_templates_name_idx` ON `composer_templates` (`name`);