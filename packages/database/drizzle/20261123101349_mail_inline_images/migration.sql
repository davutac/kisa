CREATE TABLE `mail_inline_images` (
	`account_id` text NOT NULL,
	`data` blob NOT NULL,
	`media_type` text NOT NULL,
	`message_id` text NOT NULL,
	`section` text NOT NULL,
	CONSTRAINT `mail_inline_images_pk` PRIMARY KEY(`account_id`, `message_id`, `section`)
);
