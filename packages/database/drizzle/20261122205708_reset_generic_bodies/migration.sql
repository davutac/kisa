-- Bodies on non-Gmail accounts could be fetched from the wrong copy of a
-- message held in two folders, storing another message's text, attachments,
-- headers and sender authentication. Which bodies are wrong cannot be told
-- now, since copies may have moved since, so every stored body on those
-- accounts is cleared and downloaded again. These are the columns a body
-- save writes; the full-text trigger follows `body_text`.
UPDATE `mail_messages`
SET
  `attachments` = NULL,
  `body_html` = NULL,
  `body_state` = 'none',
  `body_text` = NULL,
  `has_attachments` = 0,
  `has_blocked_remote_images` = 0,
  `headers` = NULL,
  `schema_version` = 0,
  `sender_authenticated` = 0,
  `snippet` = ''
WHERE `body_state` <> 'none'
  AND `account_id` IN (
    SELECT `account_id` FROM `mail_accounts` WHERE `dialect` = 'generic'
  );
--> statement-breakpoint
-- The list's projection of those bodies, until each comes back and its
-- conversation is computed again.
UPDATE `mail_threads`
SET `attachments` = '[]', `has_attachments` = 0, `snippet` = ''
WHERE `account_id` IN (
  SELECT `account_id` FROM `mail_accounts` WHERE `dialect` = 'generic'
);
