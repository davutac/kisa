ALTER TABLE `mail_inline_images` ADD `used_at` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX `mail_inline_images_used_idx` ON `mail_inline_images` (`account_id`,`used_at`);