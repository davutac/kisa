# New email notifications

Kisa shows native Electron notifications from the main process. Notification preferences are account-scoped in `account_settings`; a missing row defaults to enabled, and disconnecting an account deletes its preference with the rest of that account's local state.

## Delivery boundary

Only a normal incremental Gmail history sync can produce notifications. The gateway keeps `messagesAdded` message IDs separate from label changes and deletions, and the sync result carries those IDs to the desktop adapter. Before showing an alert, the adapter checks that the stored message is still both `INBOX` and `UNREAD` for the same account.

Initial sync, expired-cursor recovery, historical indexing/backfill, label-only changes, sent mail, read mail, and archived mail do not produce notifications. Work is bounded to the last 25 added-message candidates and at most five alerts per account per sync, preventing a long-offline mailbox from flooding the OS.

## Sender brands

A notification may use a BIMI sender logo only when Kisa already has a valid, unexpired brand candidate. That cache hit is only a quota-saving hint: Kisa re-reads the new message and runs its own authentication headers through the normal sender-brand validation. It then rasterizes the validated SVG to PNG for Electron's `NativeImage` API. It never applies a cached logo based on the sender-controlled `From` address alone.

If the logo cannot be validated or converted to a native image, the notification falls back to the normal app presentation. Clicking an alert—or its Open action on platforms that expose notification actions—opens and focuses the exact account-scoped conversation in a thread window. If that window cannot be created, Kisa restores and focuses the main window instead.

## Platform behavior

Electron's main-process `Notification` API owns delivery. macOS requires a code-signed app for notifications to appear; Windows packaged notifications use Kisa's configured AppUserModelID; Linux delivery depends on the desktop's notification service. OS-level permission or focus settings remain controlled by the user.
