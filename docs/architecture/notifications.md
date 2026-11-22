# New email notifications

Kisa shows native Electron notifications from the main process. Notification preferences are account-scoped in `account_settings`; a missing row defaults to enabled, and disconnecting an account deletes its preference with the rest of that account's local state.

## Delivery boundary

Only the incremental part of a sync can produce notifications. When it caches a message for the first time, the store reports it as arrived; the skeleton walk of older mail drops those reports, and a known message that moved between mailboxes was not new. Before showing an alert, the engine checks that the stored message is both `INBOX` and `UNREAD` for the same account.

The first sync of an account, a mailbox started over after a `UIDVALIDITY` change, the skeleton walk, flag and label changes, sent mail, read mail, and archived mail do not produce notifications. Work is bounded to the last 25 added-message candidates and at most five alerts per account per sync, preventing a long-offline mailbox from flooding the OS.

## Sender brands

A notification may use a BIMI sender logo only when Kisa already has a valid, unexpired brand candidate. That cache hit is only a hint: the new message's own cached authentication headers still go through the normal sender-brand validation, so a message whose headers are not cached yet gets no logo. It then rasterizes the validated SVG to PNG for Electron's `NativeImage` API. It never applies a cached logo based on the sender-controlled `From` address alone, and it never looks up a logo that is not already cached: that lookup would tell the sender a message arrived before the reader opened it.

If the logo cannot be validated or converted to a native image, the notification falls back to the normal app presentation. Clicking an alert—or its Open action on platforms that expose notification actions—opens and focuses the exact account-scoped conversation in a thread window. The Mark as read and Trash actions run the same account-scoped engine change as the mailbox, under the account's work supervisor, without opening a window. If a conversation window cannot be created, Kisa restores and focuses the main window instead.

Kisa closes active notifications when a thread is marked as read, leaves Inbox (including archive, Trash, or Spam), or is removed. Dismissal follows successful mutations and saved thread updates, including bulk actions and external changes discovered by sync. Unread Inbox threads and reload events leave alerts alone. Dismissal matches both the account and the thread id, so another account's alerts stay visible. Moving a thread back to Inbox does not recreate dismissed alerts.

## Platform behavior

The body is the thread's snippet, stripped of control and bidirectional characters, and bounded in bytes. Electron hands the body to libnotify unescaped, and Linux notification servers that advertise `body-markup` read it as a markup subset, so on Linux the bounded body is escaped back to text; sender-controlled text never becomes notification markup. The title is plain text by the notification specification, and macOS and Windows show the body as plain text.

Electron's main-process `Notification` API owns delivery. macOS requires a code-signed app for notifications to appear; Windows packaged notifications use Kisa's configured AppUserModelID; Linux delivery depends on the desktop's notification service. OS-level permission or focus settings remain controlled by the user.
