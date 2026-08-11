# Composer templates

Kisa stores reusable new-email templates in the encrypted local SQLite database. Templates are independent of drafts and Gmail: they remain available across restarts and are never synchronized to a remote mailbox.

A template has a required name and a complete set of composer-owned values: an optional account, To, Cc, Bcc, Subject, and rich-text Body. Recipient lists and text fields may be empty. Attachments are deliberately excluded.

## Applying a template

Typing `/` in the new-email Body opens a keyboard-accessible menu filtered by template name. Choosing a template replaces To, Cc, Bcc, Subject, and Body, including replacing them with empty values. A stored Account changes the From account; a null Account preserves the account already selected in the composer. Existing attachments are preserved because they are outside the template model. Reply, reply-all, forward, and template-editing composers do not expose the template menu.

The renderer captures one timestamp for the application. It resolves Subject and Body variables from that same timestamp before the new composer state becomes visible. Resolved values are ordinary editable text and never execute or render as HTML.

## Variables

Variables are lowercase expressions. The automatic registry contains:

- `{{date}}`, `{{time}}`, and `{{datetime}}`, each with an optional date-fns format such as `{{date:dd.MM.yyyy}}` or `{{time:HH:mm}}`.
- `{{account.email}}` and `{{account.name}}`, resolved from the template Account or, when that is null, the account already selected in the composer. The name is the connected Google profile's display name and resolves to an empty value when unavailable.
- `{{to.email}}`, resolved only when the template contains exactly one To recipient. It is empty for zero or multiple recipients.

Custom temporal formats use date-fns tokens, where `MM` is month and `mm` is minute. Default forms use the operating system's locale, and all temporal forms use its local time zone. Unknown variables, malformed expressions, and unsupported formats prevent an explicit save.

Body variables are structured inline Tiptap nodes so rich-text markup cannot split or corrupt an expression. Subject variables use the same registry and parser over plain text. Recipient and template-name variables are not supported.

### Variable registry

`apps/desktop/src/shared/template-variables/variables` contains one module per variable. Each module exports a complete definition containing its canonical name, matching regular expression, picker group, optional selectable syntax variants, preview guidance, and resolver function. The central registry only imports, orders, and validates those definitions. Parsing, save validation, and the template editor's searchable Insert Variable command dialog all consume that registry. The picker resolves each advertised expression with the current template account, single To recipient, and current time so its preview matches what will be inserted when possible.

Adding a variable should therefore require one registry definition plus behavior tests through the exported resolution interface. Variable-specific branches do not belong in the parser, Tiptap node, or editor menu. Registry names and insertion expressions are checked for duplicates at module initialization, and every advertised insertion must match its variable's regular expression.

## Persistence and lifecycle

The nullable template account references the connected-account row with `ON DELETE SET NULL`. Disconnect therefore keeps the template but makes it preserve whichever account is selected when it is next applied. Template upserts and removals are broadcast to renderer windows so the management page and an open slash menu share one current list.

Editing uses explicit Save. Unsaved route changes require confirmation, and Delete requires confirmation. The renderer crosses a narrow template interface: list, save, delete, and subscribe to changes.
