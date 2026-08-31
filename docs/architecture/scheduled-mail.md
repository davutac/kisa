# Scheduled new-email delivery

Kisa can schedule new emails for local delivery. Scheduling is not a Gmail-hosted draft or a cloud job: Gmail exposes immediate message sending but no send-at operation. Kisa therefore sends due work only while the desktop process is running and able to reach Gmail. Work that becomes overdue while the device is asleep, offline, or Kisa is closed catches up on the next startup, wake, or connectivity opportunity.

Replies, reply-all messages, and forwards remain immediate-only.

## Ownership and persistence

The encrypted local `mail_drafts` row remains the authoritative message content. A `scheduled_messages` row references that draft and stores only lifecycle metadata: the chosen instant, the next attempt instant, revision and attempt data, a stable RFC `Message-ID`, attention and notification state, and timestamps. Scheduling never copies message content into another table.

The scheduled-mail main-process module owns persistence transitions, the single sequential worker, attachment reopening, Gmail reconciliation, retry decisions, and native outcome notifications. Renderer and preload code use narrow, schema-validated operations. Page summaries include a bounded plain-text preview and only the attachment filenames and media types needed for mailbox-style pills, while invalidation and outcome events contain no message content. These payloads never expose full message bodies, attachment records, filesystem paths, attachment capabilities, credentials, or raw Gmail failures.

`ScheduledMailChanged` is an account-qualified invalidation only. A separate sanitized `ScheduledMailOutcome` event carries the account and draft IDs, a `sent` or `attention` kind, and a `feedback` or `open` intent. The renderer uses it for generic visible-window toasts and notification-click navigation; it carries no message content.

Every database connection enables SQLite foreign-key enforcement. Deleting a draft therefore deletes its schedule metadata, while canceling a schedule deliberately deletes only the metadata and returns the draft to the normal stash.

Scheduled drafts must be new-email drafts owned by a connected account, without Gmail thread or message IDs. Before scheduling, rescheduling, or sending, main applies the same authoritative requirements as immediate delivery: a connected account, at least one valid recipient, a subject, and non-signature body content.

## Delivery state machine

The durable internal states are:

- `scheduled`: eligible when `nextAttemptAt` is due;
- `preparing`: claimed transactionally while Kisa validates content and opens attachments;
- `sending`: persisted immediately before the Gmail request, when the outcome may become uncertain;
- `sent`: confirmed by Gmail or by stable-Message-ID reconciliation;
- `attention`: delivery needs an explicit user decision or repair.

One worker processes work in `nextAttemptAt`, scheduled-time, and ID order. Its wake loop runs as one interruptible Effect fiber, keyed mutations share an Effect semaphore, file descriptors use scoped acquisition and release, and database or Electron Promises are entered only through typed adapters. It wakes after a mutation, at startup and resume, and at least once per minute while pending work exists. A transactional claim and attempt ID prevent two wakes or two Send-now actions from dispatching the same revision.

Known offline state returns preparing work to the queue without calling Gmail or consuming an attempt. Only an explicit Gmail 403/429 rate-limit rejection is retried automatically, using 1, 2, 4, 8, 16, 32, and then 60-minute delays, while honoring a later `Retry-After`. Twenty-four hours after the first rate-limit response, the item requires attention.

Timeouts, 5xx responses, connection loss after dispatch, interruption, and unclassified send results are outcome-unknown. Kisa never retries them automatically because Gmail sending has no idempotency key. Each scheduled message carries a stable RFC `Message-ID`; on startup Kisa searches Gmail with `rfc822msgid:` to reconcile a stale `sending` item. A match confirms success. A miss is not proof that Gmail did not accept the message, so the item remains outcome-unknown and requires duplicate-risk confirmation before another attempt.

Startup can safely return stale `preparing` work to `scheduled`, because no Gmail request had started. Confirmed delivery removes both the schedule and its draft after persisting the terminal outcome and refreshing Sent.

## Attachments

Renderer attachment references and prepared send capabilities are window-bound and short-lived, so the scheduler never stores or reuses them. When a schedule is saved, main verifies every selected source through its authorized descriptor and atomically copies the complete attachment set into `app.getPath("userData")/attachments/drafts/<draft-hash>/<opaque-file-id>`. Directories use owner-only permissions and files use owner read/write permissions where the platform supports POSIX modes. The files are intentionally not encrypted separately from the user's original local files; their paths never cross into the renderer.

The draft retains the copied file's main-validated canonical path and identity record. At delivery time main strictly decodes every stored record, opens the app-owned file, verifies its identity and size, reads through that descriptor, and verifies it again after reading. Deleting or moving the original source after scheduling therefore does not affect delivery. Older scheduled records are adopted into app-owned storage before the worker starts; a source that was already missing still fails closed.

A missing, malformed, replaced, modified, oversized, or changed-during-read app-owned attachment moves the item to attention without a Gmail request. Stored attachment decoding fails closed; Kisa never silently omits an attachment from a scheduled message. A confirmed send or permanent discard removes the owned files. Cancel schedule keeps them with the returned stash, successful immediate sending of that stash removes them, account removal deletes them with the draft rows, and startup reconciliation removes crash leftovers that are no longer referenced by any draft.

Immediate and scheduled delivery resolve attachments differently, then cross one typed new-message delivery seam for recipient parsing, MIME construction, quota handling, Gmail sending, failure classification, and Sent refresh.

## Editing and cancellation

Opening a scheduled item loads an editable snapshot that remains usable until the email is sent or deleted. Save and Reschedule use the latest submitted editor state, so multiple open editors are last-write-wins. Each successful update refreshes the editor's authoritative draft, delivery time, and internal row revision in place.

The scheduled draft's From account stays fixed while editing, including when an account-scoped composer template is applied.

An item that becomes due while its editor is open continues through normal delivery. Once the worker claims it, edit and cancel lose the race and return an already-sending result. Confirmed delivery removes the item and the renderer closes its matching editor automatically.

Cancel schedule preserves the current saved content as a normal stash and publishes a normal draft upsert. Permanent discard remains a separate confirmed action and deletes both records. Scheduled saves publish scheduled invalidation only, so the item cannot leak into the ordinary stash picker.

## Renderer and notifications

`/scheduled` is an account-scoped title-bar workspace. Its animated button sits immediately beside New Message and restores the previous title-bar view when toggled; `Mod+Shift+S` provides the same toggle while that button is available. Home, account buttons, and their account hotkeys close the workspace and open the matching Inbox scope, as they do from other title-bar workspaces. The workspace has no visible title block; its scroll padding, empty state, independent rounded rows, one-pixel row spacing, active state, and trailing loading row match the mailbox thread list. Its 50-item keyset pages show attention items first, then chronological delivery order. Scheduled rows reuse the mailbox thread hierarchy: recipient and sending-account header, subject, one-line preview, mailbox-style filename and type pills for attachments, and compact trailing relative delivery time with the exact local date, time, and timezone in its tooltip. Scheduled attachment pills are summaries rather than Gmail download actions; the row opens the editor where the local attachment can be reviewed. The From account remains visible even in an account-scoped view so the delivery identity is explicit. Hovering or activating a row slides it aside to reveal stacked thread-style quick actions: Cancel schedule returns the draft to Stash, while Discard permanently deletes the scheduled email and draft after confirmation. `Tab`/`ArrowDown`/`J`, `Shift+Tab`/`ArrowUp`/`K`, and `Enter` match mailbox navigation without adding bulk selection; `Mod+S` runs Cancel schedule, `Mod+D` opens the Discard confirmation, and `Escape` clears the active row and returns focus to the workspace's visually hidden heading. The existing scoped attention-count reply also reports whether any scheduled item exists, so the title bar can reveal the Scheduled button without loading message summaries. The badge still counts only attention items and exposes the exact scoped count to assistive technology.

The existing composer has a scheduled-edit mode. Its persisted delivery time appears in the row above the footer. The calendar control only selects a replacement locally; after a selection, the primary action changes from Send now to Reschedule. `Mod+Shift+Enter` opens the Schedule send menu and, after a time is selected, runs Schedule or Reschedule. `Mod+Enter` still sends immediately, while `Mod+S`, Save, and Reschedule persist changes without closing the composer. Pending delivery actions disable the footer controls without replacing their normal labels or icons. A successful reschedule refreshes the displayed delivery time and revision in place. Rescheduling requires a future instant, and dirty close asks whether to abandon unsaved edits. The editor exposes one destructive action: permanent delete after confirmation, also available with `Mod+D`. Cancel schedule remains on the Scheduled list row and moves the saved draft to Stash.

New-email Send also remains immediate until the adjacent calendar menu selects a time locally. The primary action then changes from Send to Schedule, and an X on the selected-time row clears that choice. The menu offers "Tomorrow morning at 08:00," "Tomorrow afternoon at 13:00," "next Monday at 08:00," and a custom local date and time. The picker rejects past, nonexistent, and repeated local times; only the primary Schedule or Reschedule action persists the resulting instant. A later timezone change affects display, not delivery.

Autonomous success and attention transitions are persisted before feedback. Main sends a visible-window outcome only after preload has confirmed that the renderer subscription is installed; reload and window destruction clear that readiness. Until then, Kisa uses the same generic native notification fallback, and it leaves the durable notification pending if neither delivery path is available. A native-notification click is queued until the created or reloaded renderer confirms readiness rather than relying on `did-finish-load` alone.

Notification text never contains the account, recipients, subject, body, or attachment data. Success opens the account's Sent view; attention opens and focuses the account-scoped Scheduled item.

## Account and application lifecycle

Scheduled delivery participates in the account work supervisor. Disconnect suspends new claims, waits for active work, warns before removing unresolved delivery evidence, and deletes pending schedules with the account's other local data. Shutdown stops the scheduler and waits for its active boundary before the database closes. If termination leaves durable state at `sending`, startup reconciliation applies rather than an automatic resend.
