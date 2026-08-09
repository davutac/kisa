-- Existing rows predate `is_in_inbox`, so derive it once from the label names
-- already cached on each row. `listCachedThreadPage` reads the new column from
-- here on, and the write path keeps it in step.
UPDATE `gmail_threads`
SET `is_in_inbox` = 1
WHERE `labels` IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM json_each(`gmail_threads`.`labels`) WHERE json_each.value = 'INBOX'
  );
--> statement-breakpoint
-- External-content FTS5: the index points back at `gmail_messages` rather than
-- keeping a second copy of every body, which matters when the content is the
-- whole mailbox.
CREATE VIRTUAL TABLE `gmail_messages_fts` USING fts5(
  `subject`,
  `from_address`,
  `body_text`,
  content=`gmail_messages`,
  tokenize='unicode61 remove_diacritics 2'
);
--> statement-breakpoint
-- Triggers rather than hand-maintained writes: rows leave `gmail_messages` from
-- several paths (thread removal, account disconnect, re-index on conflict), and
-- an external-content delete has to replay the *old* column values. Letting
-- SQLite do that removes a class of silent index drift.
CREATE TRIGGER `gmail_messages_fts_insert` AFTER INSERT ON `gmail_messages` BEGIN
  INSERT INTO `gmail_messages_fts`(`rowid`, `subject`, `from_address`, `body_text`)
  VALUES (new.`rowid`, new.`subject`, new.`from_address`, new.`body_text`);
END;
--> statement-breakpoint
CREATE TRIGGER `gmail_messages_fts_delete` AFTER DELETE ON `gmail_messages` BEGIN
  INSERT INTO `gmail_messages_fts`(`gmail_messages_fts`, `rowid`, `subject`, `from_address`, `body_text`)
  VALUES ('delete', old.`rowid`, old.`subject`, old.`from_address`, old.`body_text`);
END;
--> statement-breakpoint
CREATE TRIGGER `gmail_messages_fts_update` AFTER UPDATE ON `gmail_messages` BEGIN
  INSERT INTO `gmail_messages_fts`(`gmail_messages_fts`, `rowid`, `subject`, `from_address`, `body_text`)
  VALUES ('delete', old.`rowid`, old.`subject`, old.`from_address`, old.`body_text`);
  INSERT INTO `gmail_messages_fts`(`rowid`, `subject`, `from_address`, `body_text`)
  VALUES (new.`rowid`, new.`subject`, new.`from_address`, new.`body_text`);
END;
