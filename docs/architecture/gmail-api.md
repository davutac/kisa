# Gmail API capabilities

The Gmail API is broad enough to support a nearly complete desktop mail client. It is a REST API centered on messages, conversation threads, labels, drafts, mailbox history, and account settings. Google's [Gmail API overview](https://developers.google.com/workspace/gmail/api/guides) and [REST reference](https://developers.google.com/workspace/gmail/api/reference/rest) are the authoritative inventories.

## Capability overview

| Area | Available operations |
| --- | --- |
| Mailbox | List and retrieve messages or complete conversation threads. |
| Search | Use most Gmail search syntax, including `from:`, `is:unread`, `after:`, and `has:attachment`. |
| Message content | Retrieve headers, snippets, parsed MIME parts, HTML and plain-text bodies, or the original RFC-formatted message. |
| Attachments | Discover attachments in MIME parts and download their contents on demand. |
| Mail actions | Mark conversations read or unread, archive them, recover them from spam, move them to or from trash, star them, and apply or remove supported labels. |
| Bulk actions | Modify labels on multiple messages or permanently delete multiple messages when the granted scope permits it. |
| Compose | Create, replace, delete, and send Gmail-hosted drafts. |
| Send | Send new messages, replies, forwards, HTML mail, and attachments as MIME messages. |
| Organization | List, create, rename, recolor, and delete user labels. |
| Synchronization | Retrieve mailbox changes since a stored `historyId`. |
| Account settings | Manage supported filters, forwarding addresses, send-as aliases, signatures, vacation responders, delegates, and enterprise settings. Availability and required scopes vary. |
| Migration | Import a message through Gmail's normal scanning and classification, or insert it directly in a mailbox similarly to IMAP `APPEND`. |

## Local-client synchronization

Kisa uses the API as a remote source of truth while keeping an account-scoped cache in local SQLite. A typical client lifecycle is:

1. Authorize each account with OAuth 2.0 and retain a refresh token securely.
2. Run an initial paginated mailbox synchronization.
3. Fetch the required thread and message details into the local cache.
4. Persist the newest mailbox `historyId` with the corresponding data changes.
5. Call `history.list` periodically to apply incremental changes.
6. Reconcile with a full synchronization if Gmail reports that the stored history is no longer available.

History records are usually available for at least a week, but they can expire sooner. An out-of-range `startHistoryId` returns HTTP 404 and requires a full synchronization. See Google's [client synchronization guide](https://developers.google.com/workspace/gmail/api/guides/sync).

Google recommends poll-based synchronization for installed applications. Gmail also supports server-side notifications through Google Cloud Pub/Sub, but that requires backend infrastructure. A notification contains the account and a new `historyId`, not the changed message contents. Watches must be renewed at least every seven days, and notifications can be delayed or dropped, so they cannot replace history reconciliation. See the [push notification guide](https://developers.google.com/workspace/gmail/api/guides/push).

## Gmail semantics that affect Kisa

- Gmail uses labels rather than conventional folders. Archiving removes `INBOX`, while marking unread adds `UNREAD`.
- Spam is a separate cached mailbox. Existing accounts seed it one bounded page per normal sync and persist the page cursor so the dedicated mailbox becomes useful quickly; the complete account index also covers historical Spam and Trash, while Gmail history owns later transitions. Spam stays out of Inbox, default search, the native unread badge, and OS notifications. The title-bar dot remains visible while the current account scope contains a message with both `SPAM` and `UNREAD`; Spam mailbox membership and general thread unread state remain thread-level projections.
- Sent conversations arrive through full-account indexing and Gmail history. The primary mailbox combines Inbox and Sent conversations, marks every thread containing a Sent message with a paper-airplane icon, and exposes a title-bar toggle that narrows the same account scope to Sent only. The cached `is_in_sent` projection and covering index keep both list paths bounded at mailbox scale.
- Trashed conversations arrive through full-account indexing and Gmail history. A title-bar toggle opens Trash for the current account scope; the cached `is_in_trash` projection keeps Trash paging bounded and prevents trashed Sent conversations from leaking back into the primary or Sent mailbox.
- Settings exposes a per-account Reindex action for suspected historical gaps. It warns about Gmail API quota and runtime, resets only that account's resumable index cursor, preserves already downloaded mail, and walks all email again except Gmail Chats. Reindex never starts automatically after Gmail history cursor expiry.
- **Not spam** performs one Gmail label mutation that removes `SPAM` and adds `INBOX`, preserves `UNREAD`, updates every cached message and the thread projection in one account-scoped transaction, and publishes the normal list event.
- **Delete forever** is available only for a cached Spam or Trash conversation, requires confirmation, permanently deletes the Gmail thread with full-mail access, removes its account-scoped thread and message cache rows, and publishes the normal list removal event.
- A thread mutation that returns HTTP 404 triggers one account-scoped `threads.get` reconciliation. If Gmail also reports the thread missing, Kisa removes its cached thread and messages and publishes the normal list removal event. If Gmail returns the thread, Kisa replaces the cached copy with that authoritative state. A direct `threads.get` 404 is already authoritative, so it evicts and publishes immediately. Other fetch failures leave the cache unchanged.
- Resource-addressed 404s remain typed by resource. Deleting an already-missing label removes its cached catalog entry and succeeds idempotently; updating one removes the entry, publishes the catalog refresh, and reports that it disappeared. Labels that vanish between `labels.list` and `labels.get` are omitted without failing the remaining catalog.
- An attachment 404 reconciles its parent thread before reporting the attachment unavailable. A message-batch 404 falls back to bounded per-thread mutations, which cost less than fetching every target. Only a per-thread 404 spends one `threads.get`: missing threads are removed and count as reconciled successes, while threads Gmail still returns are refreshed and remain failed mutations so the renderer rolls back the requested action. Profile, create, list, and send 404s remain friendly operational failures because they do not identify a cached entity that is safe to delete.
- Labels belong to messages. Messages within one thread can have different label sets, and a thread's labels represent their union.
- The thread label picker exposes only labels whose Gmail catalog type is `user`, applies changes optimistically, and rolls back on failure.
- The mailbox label bar also exposes only user labels, but it filters rather than mutates. It is account-scoped, merges equal names across All Accounts, and requires every selected label while preserving Inbox, Spam, and unread scope.
- Rendered label collections place system labels first and user labels second, sorting each group by display name.
- The main process rejects unknown and system label IDs. Successful changes update every cached message and the thread summary in one account-scoped transaction, then publish the normal thread-list update.
- Label definitions are managed per account in Settings. Clicking a user label edits its name and color through Gmail's patch API; the hover X remains the destructive delete action. The thread label picker uses the same dialog to create labels and applies a label created there to the current thread. The dialog keeps an uncolored default and exposes Gmail's accepted values through separate compact background and text palettes. Definition mutations publish an account-scoped catalog event so every open window reloads its cached labels. Renames update the definition and cached thread display names atomically while preserving stable message label IDs. Deletion refreshes Gmail's label metadata before showing the affected thread count and an irreversible-action confirmation. Creating caches Gmail's returned user label. Updating and deleting reject system or unknown IDs; deleting removes the definition and cached membership in one transaction, then reloads that account's mailbox list.
- `labels.list` returns only the basic catalog, so label synchronization follows it with bounded `labels.get` calls for user labels. Full remote label synchronization runs only when an account is first added or the user explicitly chooses Label Sync. Startup, history polling, cursor recovery, and background indexing otherwise read the account-scoped cache; if a fetched thread references an unknown label ID, those paths repair only the missing catalog entries with targeted `labels.get` calls before storing the thread. Kisa stores Gmail's optional foreground/background color pair there and uses it for label badges; system and uncolored labels retain the neutral application style.
- List operations generally return identifiers and thread identifiers. Fetching message content requires additional `get` operations.
- Search supports most, but not all, behavior from Gmail's web interface. Results are paginated with at most 500 messages per page. See [listing messages](https://developers.google.com/workspace/gmail/api/guides/list-messages) and [search differences](https://developers.google.com/workspace/gmail/api/guides/filtering).
- A reply joins an existing Gmail thread only when it supplies the target `threadId`, a matching subject, and valid `References` and `In-Reply-To` headers.
- Message content is MIME data, not safe application markup. Kisa remains responsible for HTML isolation, remote-image blocking, URL validation, and safe attachment handling.
- Gmail message and thread IDs are only unique within their account. Every cached record, cursor, event, and mutation must remain account-scoped.

## Authorization and privacy

The granted OAuth scopes determine which operations are available:

| Scope | Capability | Classification |
| --- | --- | --- |
| `gmail.metadata` | Read headers, identifiers, and labels without message bodies. | Restricted |
| `gmail.readonly` | Read messages and settings. | Restricted |
| `gmail.send` | Send mail without general mailbox access. | Sensitive |
| `gmail.compose` | Manage drafts and send mail. | Restricted |
| `gmail.modify` | Read mail, send mail, and perform ordinary mailbox mutations without immediate permanent deletion. | Restricted |
| `gmail.labels` | Create and manage label definitions without granting message access. | Non-sensitive |
| `mail.google.com` | Full mail access, including immediate permanent deletion. | Restricted |

Request the narrowest set that implements the product. Google's current classifications and exact descriptions are recorded in the [Gmail OAuth scope table](https://developers.google.com/workspace/gmail/api/auth/scopes).

Kisa requests `mail.google.com` because Spam supports immediate permanent deletion; requesting `gmail.modify` alongside it would add no capability. Accounts connected with a narrower scope must connect again.

Google requires applications requesting restricted Gmail scopes to complete an annual security assessment, including local desktop clients. Kisa does not ship a shared OAuth client. Each user creates a personal Google Cloud project and imports its Desktop OAuth credentials. See [Connect Kisa to Google](../google-oauth-setup.md).

Electron main opens the JSON file picker for the first connection and accepts only the `installed` Desktop-client shape. The file is bounded to 64 KiB and its contents never cross renderer IPC. The selected client is encrypted once behind `safeStorage` in the app's user-data directory and reused for later account connections. The client identity is also encrypted with each account's access and refresh tokens because Google refresh tokens belong to the OAuth client that issued them.

Electron main opens the system browser, receives the authorization response on a temporary `127.0.0.1` loopback listener, and protects the code exchange with PKCE and validated OAuth state. Code exchange and refresh requests go directly from the desktop process to Google; Kisa has no OAuth relay or server. A Desktop client secret is public application identity rather than a confidential authorization factor, so PKCE and validated state remain the authorization boundary.

## Boundaries and limitations

The Gmail API does not provide:

- Google Contacts; those belong to the People API.
- Google Calendar data; that belongs to the Calendar API.
- A direct persistent event connection from Gmail to a desktop application.
- Fully reliable push delivery without incremental synchronization and reconciliation.
- Safe HTML rendering, URL handling, or attachment handling on the client's behalf.
- Every feature or search behavior implemented by Gmail's web interface.
- Unlimited requests, concurrency, bandwidth, or sending.

Calls consume method-specific quota units. As of August 10, 2026, Google documents limits of 1,200,000 units per project per minute and 6,000 units per user per project per minute. Representative costs are 2 units for `history.list`, 5 for `messages.list`, 20 for `messages.get`, and 100 for `messages.send`. These values can change and must be rechecked in the [Gmail API usage limits](https://developers.google.com/workspace/gmail/api/reference/quota) before capacity or release decisions.

Bulk mailbox actions cross the renderer boundary once and are grouped by account. When Kisa has the complete cached message membership for every selected conversation, it may use [`messages.batchModify`](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/batchModify), which accepts at most 1,000 message ids and costs 50 units. The fixed cost means batching is used only when it is strictly cheaper: six or more conversations for read state and user labels, or three or more for trash. Smaller groups and conversations whose cached membership is incomplete use the official client's typed whole-thread endpoint, with at most 25 mutations in flight per account over its reused HTTP/2 connection. This keeps parallel work bounded without maintaining a custom multipart transport. Permanent deletion always uses `threads.delete`; `messages.batchDelete` deletes only the supplied messages and therefore cannot safely represent deleting a conversation.

In short, Gmail supplies remote mailbox state and mutations. Kisa owns local caching, account isolation, synchronization correctness, MIME presentation, optimistic updates, offline behavior, security, and the user experience.
