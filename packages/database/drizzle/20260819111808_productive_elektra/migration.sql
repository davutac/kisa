ALTER TABLE `account_settings` ADD `email_signature` text DEFAULT '{"html":"","text":""}' NOT NULL;--> statement-breakpoint
ALTER TABLE `mail_drafts` ADD `signature_account_email` text;--> statement-breakpoint
ALTER TABLE `mail_drafts` ADD `signature_html` text;--> statement-breakpoint
ALTER TABLE `mail_drafts` ADD `signature_text` text;