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
- Spam is a separate cached mailbox. Existing accounts seed it one bounded page per normal sync and persist the page cursor; Gmail history owns later transitions. Spam stays out of Inbox, default search, unread badges, and OS notifications. The title-bar dot tracks threads newly moved into Spam since that account's Spam mailbox was last opened, so clearing the dot never changes read state.
- **Not spam** performs one Gmail label mutation that removes `SPAM` and adds `INBOX`, preserves `UNREAD`, updates every cached message and the thread projection in one account-scoped transaction, and publishes the normal list event.
- Labels belong to messages. Messages within one thread can have different label sets, and a thread's labels represent their union.
- The thread label picker exposes only labels whose Gmail catalog type is `user`, applies changes optimistically, and rolls back on failure.
- Rendered label collections place system labels first and user labels second, sorting each group by display name.
- The main process rejects unknown and system label IDs. Successful changes update every cached message and the thread summary in one account-scoped transaction, then publish the normal thread-list update.
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

Public applications using restricted Gmail scopes generally require OAuth verification. Storing or transmitting restricted-scope data through a server can add security-assessment requirements. Kisa's local-first design reduces that remote data exposure, but it does not remove the need for verification or careful local protection. Credentials remain encrypted in Electron's main process and never cross into the renderer.

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

In short, Gmail supplies remote mailbox state and mutations. Kisa owns local caching, account isolation, synchronization correctness, MIME presentation, optimistic updates, offline behavior, security, and the user experience.
