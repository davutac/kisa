# Mail engine

Status: in progress on `feat/imap-mail-transport`. This design replaced the Gmail REST backend, which is recorded in [the Gmail API capabilities](../research/2026-08-10-gmail-api-capabilities.md) and [the full-account indexing design](../research/2026-08-07-gmail-api-full-account-indexing.md). It is written as a new app: no existing cache, credentials or settings are migrated, and the engine uses a new database file.

Measurements behind the choices below are in [the Gmail IMAP probe](../research/2026-11-21-gmail-imap-probe.md).

## Goals

- **One engine for every provider.** Gmail and iCloud first, then any IMAP host with an app password, then Outlook. All of them go through IMAP for reading and SMTP for sending.
- **Useful within a minute of connecting.** The whole mailbox is listable and searchable by sender and subject long before every body has downloaded.
- **Local-first.** Lists, threads and search read SQLite. The network fills the cache; it is never on the path of a scroll.
- **Bounded and resumable.** Every background step works in small batches, commits before it advances, and can stop at any point.

## Non-goals for now

POP, Exchange EWS, JMAP, an offline change queue, calendar and contacts.

## Providers

| Provider | Incoming | Outgoing | Sign-in | Dialect |
| --- | --- | --- | --- | --- |
| Gmail | `imap.gmail.com:993` TLS | `smtp.gmail.com:465` TLS | App password (needs 2-Step Verification) | Gmail |
| iCloud | `imap.mail.me.com:993` TLS | `smtp.mail.me.com:587` STARTTLS | App-specific password | Generic |
| Other IMAP | Entered by hand | Entered by hand | App password or password | Gmail if the server offers `X-GM-EXT-1`, otherwise generic |
| Outlook.com | `outlook.office365.com:993` TLS | `smtp-mail.outlook.com:587` STARTTLS | Microsoft sign-in (OAuth, XOAUTH2) | Generic |
| Microsoft 365 | `outlook.office365.com:993` TLS | `smtp.office365.com:587` STARTTLS | Microsoft sign-in (OAuth, XOAUTH2) | Generic |

Every account connects in the Add account window (see [Accounts](#accounts)). Gmail, iCloud and other IMAP accounts sign in with an app password: Gmail and iCloud addresses take their servers from a preset, any other address enters them by hand. Outlook.com and Microsoft 365 sign in with Microsoft in the system browser, because Microsoft's servers take no passwords from mail apps (`LOGINDISABLED`; refused for Outlook.com since September 2024).

**Outlook's IMAP server offers little.** Probed on 2026-11-22 without signing in, it advertises `IMAP4rev1 AUTH=XOAUTH2 LOGINDISABLED SASL-IR UIDPLUS MOVE ID UNSELECT CHILDREN IDLE NAMESPACE LITERAL+`: no `CONDSTORE`, `QRESYNC` or `SPECIAL-USE`. Its SMTP server offers `AUTH LOGIN XOAUTH2`. The engine therefore cannot rely on mod-sequences or special-use attributes; see [Staying current](#staying-current) and [Labels](#labels).

**Verified against real servers (2026-11-22).** Gmail, on a test account: sending with an attachment and a Bcc, finding the sent message by its Message-ID, a reply joining the same conversation, star, read state, a label created, applied, renamed, removed and deleted, archive and unarchive, trash and restore. After every change a fresh sync found the server agreeing with the cache. iCloud, read-only, about 1,500 messages: the generic dialect synced every folder in 18 seconds with no message lacking a `Message-ID`, and a second pass found nothing changed. iCloud offers `CONDSTORE`, `QRESYNC`, `IDLE` and `UIDPLUS` but neither `MOVE` (imapflow moves by `COPY`, `\Deleted` and `UID EXPUNGE` instead) nor `SPECIAL-USE`: its Sent, Trash, Junk, Archive and Drafts folders are recognised by imapflow's table of well-known names. Name-based roles are trusted only from servers without `SPECIAL-USE`, so a Gmail label called "Archive" stays a label.

**Removing single messages.** Moves use `UID MOVE` where offered, otherwise `UID COPY` and then removing the originals; a refused copy leaves the source untouched. With `UIDPLUS` the originals are removed with `UID EXPUNGE`. Without it a plain `EXPUNGE` would also remove mail another program marked `\Deleted` and kept, so those messages are unmarked for that moment and marked again afterwards, even if the expunge fails; if Kisa cannot tell which they are, it expunges nothing. MailCraft does the same.

A **dialect** is the only provider-specific code in the engine. It decides how a server's messages map to Kisa's identities and labels:

- **Gmail** uses `X-GM-MSGID`, `X-GM-THRID` and `X-GM-LABELS`. It syncs only All Mail, Spam and Trash, because every other Gmail folder is a label view of All Mail.
- **Generic** syncs every selectable folder, derives identities from message headers, and threads locally.

The dialect follows the server, not the address. An account gets the Gmail dialect when its IMAP server advertises the `X-GM-EXT-1` capability at sign-in, so a Google Workspace address entered by hand with `imap.gmail.com` gets it too; every other server gets the generic dialect.

## Identity

Every key below is scoped by account. An account is identified by its normalized email address.

### Messages

A **message** is one logical email. A **location** is one physical copy: `(mailbox path, UIDVALIDITY, UID)`. A message has one or more locations.

| Dialect | Message id |
| --- | --- |
| Gmail | `X-GM-MSGID` as a decimal string. Stable across moves between All Mail, Spam and Trash. |
| Generic | `h:` followed by a hash of the `Message-ID` header. When the header is missing, the hash covers the `Date` header, sender, subject and size, so the same copy always hashes the same way. |

How the three hard cases resolve:

- **A Gmail message moves from All Mail to Trash.** Its `X-GM-MSGID` is unchanged, so the message keeps its id and bodies. Its All Mail location vanishes and a Trash location appears.
- **Another client moves an iCloud message.** The copy vanishes from one folder and appears in another with the same `Message-ID`. A message left without a location is deleted only at the end of a pass, after every mailbox has been read, so the message survives and its bodies are not downloaded again.
- **One `Message-ID` sits in two folders.** That is one message with two locations, and it carries both folders' labels. A change to the message (read state, trash) is applied to every location, which is Gmail's model too.

A message is deleted only when a complete pass over its account's mailboxes leaves it with no location.

### Threads

| Dialect | Thread id |
| --- | --- |
| Gmail | `X-GM-THRID` as a decimal string. |
| Generic | `h:` followed by a hash of the first `References` entry, else `In-Reply-To`, else the message's own `Message-ID`, else its message id. |

The generic rule needs no global state: by convention the first `References` entry is the root of the conversation, so a reply and its original reach the same thread id in whichever order they are fetched. A reply that carries only `In-Reply-To` to a message that is not the root starts its own thread. That case is rare and accepted.

### Labels

Messages carry label ids. Threads carry the union of their messages' labels.

- **System labels** use fixed ids shared by every provider: `INBOX`, `SENT`, `DRAFT`, `SPAM`, `TRASH`, `STARRED`, `IMPORTANT` and `UNREAD`. The renderer already understands these.
- **User labels** use `u:` followed by the label's path, with `/` as the separator. For Gmail the path is the label name. For other providers it is a folder that has no special use.

How they are derived:

| Source | Gmail | Generic |
| --- | --- | --- |
| Inbox | `\Inbox` in `X-GM-LABELS` | A location in `INBOX` |
| Sent | `\Sent` | A location in the `\Sent` folder |
| Drafts | `\Draft`, or the `\Draft` flag | A location in `\Drafts`, or the `\Draft` flag |
| Spam | A location in the `\Junk` mailbox | A location in `\Junk` |
| Trash | A location in the `\Trash` mailbox | A location in `\Trash` |
| Starred | `\Starred`, or the `\Flagged` flag | The `\Flagged` flag |
| Important | `\Important` | Not available |
| Unread | No `\Seen` flag | A location without the `\Seen` flag |
| User label | Any other `X-GM-LABELS` entry | A location in a folder with no special use |

An Archive folder (`\Archive`) produces no label: archived mail is mail without `INBOX`, as it is in Gmail.

Gmail's category labels (Promotions, Social and so on) are not exposed over IMAP and are dropped. Label colours are not part of IMAP; Kisa keeps an optional local colour per label.

## Schema

The engine writes a new database file. Tables are prefixed `mail_`.

- **`mail_accounts`:** address, provider (`gmail`, `icloud` or `imap`), dialect, display name (the sender name outgoing mail carries), sign-in name, the sealed app password, incoming and outgoing server settings, and sort order. Planned: a stored sync status with its last error. Today which accounts are syncing is kept in memory and sent to the renderer as an event.
- **`mail_mailboxes`:** account, path, delimiter, role, whether it can be selected, whether the dialect syncs it, `UIDVALIDITY` and `HIGHESTMODSEQ` (both stored as text), `UIDNEXT`, message count, the skeleton floor: every UID at or above it has cached metadata, and `null` means the walk has not started, and the flag cursor: on a server without `CONDSTORE`, where the next re-read of older flags begins.
- **`mail_message_locations`:** account, mailbox path, UID, `UIDVALIDITY`, message id, mod-sequence, flags, and the labels this copy gives its message. The primary key is `(account, mailbox, uid)`, with an index on `(account, message id)`.
- **`mail_messages`:** account, message id, thread id, `Message-ID`, `In-Reply-To`, first reference, received and sent dates, size, sender, `Reply-To`, recipients, subject, label ids, read, starred and draft state, attachment list, snippet, body state, plain text, gzipped HTML, remote-image flag, sender authentication, the version of the body format, and the few raw headers that sender branding, replies and unsubscribe need. The MIME structure itself is not stored.
- **`mail_threads`:** the per-thread projection the list pages over: subject, snippet, latest date and message, message count, sender, unread state, labels, attachment list, when it first appeared in Spam, and indexed `is_in_inbox`, `is_in_sent`, `is_in_spam` and `is_in_trash` flags, each with a keyset index in the list's order.
- **`mail_labels`:** account, label id, name, kind (system or user), backing mailbox path, and an optional local colour.
- **`mail_messages_fts`:** FTS5 over subject, sender address and body text, with `mail_messages` as external content, kept in step by triggers.

A thread row is recomputed from its messages in the same transaction that changes them.

## Sync

### Connections

Each account has at most two IMAP connections: one for foreground work (opening a thread, a change the user made, attachments) and one for background work (sync, skeleton, bodies). Calls on one connection run one at a time. The connections are pooled per account in main, not held by the work supervisor. Disconnecting first suspends the account's work supervisor, which cancels the background loop and foreground work and waits for them, then closes both connections. Attachment downloads are the exception: they do not run under the supervisor, so closing the connection is what ends them. A connection unused for two minutes is closed. A refused sign-in, a lost connection, throttling or an interruption drops the connection, and the next use opens a new one. imapflow logging is off.

### Tiers

Background work runs in cycles on the background connection. A cycle first catches up with the server (see [Staying current](#staying-current)), then for up to 20 seconds alternates one skeleton batch with one batch of recent bodies. While work is left, the next cycle starts at once; when none is left, the loop waits for the next poll. So the tiers below overlap rather than run one after another.

1. **Discover.** `LIST` with special-use attributes at the start of every cycle, then a `STATUS` per synced mailbox. A server with `SPECIAL-USE` is trusted for roles. Without it, a role attribute the server sends anyway wins over one guessed from the folder's name, and a role an attribute claims is not given to a second folder by name; otherwise imapflow's name table decides, which knows Outlook's English and German names ("Sent Items" and "Gesendete Elemente", "Deleted Items" and "Gelöschte Elemente", "Junk Email" and "Junk-E-Mail", "Drafts" and "Entwürfe", "Archive" and "Archiv"). An action that needs a role no folder has (trash, archive, spam, delete forever, removing a folder label) fails before any server command; sending without a Sent folder files no copy. Gmail syncs All Mail, Spam and Trash; generic syncs every selectable folder. Mailboxes are read in priority order: Inbox and All Mail first, then Sent and Drafts, other folders, and Spam and Trash last.
2. **First screen.** Planned: the newest 50 Inbox conversations get metadata, structure and text bodies at once, so the list is useful within seconds. Today nothing is fetched specially for the Inbox: the skeleton walks Inbox and All Mail first, and bodies download newest first.
3. **Skeleton.** Metadata for every message, newest first, in batches of 500: identifiers, flags, labels, dates, size and the envelope. Generic also fetches the `References` header, for threading. UIDs are sparse, so each batch searches the 2,000 UIDs below the skeleton floor and widens the window fourfold until it holds a full batch or reaches UID 1. Each batch commits together with the new floor. One mailbox is walked at a time, in priority order. The whole mailbox becomes listable and searchable by sender and subject. The probe measured about a minute for 21,000 messages.
4. **Recent bodies.** Structure and text parts (never attachments) for mail received in the last 365 days, newest first, 25 messages per batch.
5. **Everything else.** Opening a conversation downloads its missing bodies first, on the foreground connection; this also retries bodies that failed before. Once the skeleton is complete and no recent body is left to fetch, the background loop downloads older bodies, newest first, 25 at a time.

A snippet is the first 200 characters of a message's body text, with whitespace collapsed. A thread shows the snippet of its newest message that has one, and a thread with no body downloaded yet shows none. Planned: rows that scroll into view ask for their bodies at foreground priority.

### Staying current

- **Polling:** Planned: `IDLE` on the Inbox on the background connection. Today Kisa does not use `IDLE` (imapflow's automatic `IDLE` is off). An account with no background work left is polled every two minutes. The loop also runs at once after a send, after a change that failed, on a label refresh or a "Sync now", when the account is connected again, and when a Kisa window gains focus (at most every 30 seconds). A failed cycle is retried after 5 seconds, 15 seconds, a minute, then every 5 minutes, or after the delay a throttling server gives. A refused sign-in stops the loop until the account is connected again.
- **Changes:** with `CONDSTORE`, and only when a mailbox's `HIGHESTMODSEQ` has moved, a `UID FETCH` of flags (and Gmail labels) with `CHANGEDSINCE` the stored mod-sequence, over the UIDs from the skeleton floor up to the stored `UIDNEXT`. Without `CONDSTORE` (Outlook, and any server that reports no mod-sequence) the background pass re-reads flags instead: each pass, the flags of the newest 500 cached copies of every synced mailbox, plus the next 2,000 below a stored cursor that walks down to the skeleton floor and then starts again. That is at most 2,500 short answers per mailbox per pass, no message content, and covers a 50,000-message mailbox in 25 passes. The cursor is saved in the same transaction as the flags it covers, so an interrupted pass repeats its slice rather than skipping one. Only differences are written: a pass that finds nothing changed writes no message, location or thread row and publishes nothing, and `\Recent`, which a server shows to one connection only, is ignored. The refresh after the user's own change does not re-read.
- **New mail:** UIDs at or above the stored `UIDNEXT`.
- **Deletions:** neither Gmail nor iCloud is assumed to offer `QRESYNC`. When a mailbox's message count is lower than the stored count plus new arrivals, `UID SEARCH ALL` is compared with the cached locations of that mailbox, and locations that are gone are removed at once. Messages left without any location are deleted at the end of the pass, after every mailbox has been read, and again when a skeleton walk finishes. That clean-up waits until every skeleton is complete, because until then a missing copy may only be one the walk has not reached. Delete forever is the exception: it deletes exactly the messages it expunged once they have no copy left.
- **`UIDVALIDITY` changes:** the mailbox's locations are dropped and its skeleton restarts. Messages survive if they reappear under the same id.

## Bodies

Bodies are fetched as `BODYSTRUCTURE` and a fixed list of header fields, then the text parts, never the whole source. The structure is planned into the text parts to fetch and the attachment list; only the attachment list is stored. When an HTML part has a plain-text alternative, only the HTML is fetched, and search indexes text extracted from it. Text parts get their transfer encoding removed and their charset converted to UTF-8. Attachments stay on the server until the user opens one, and are then fetched by part number, up to 64 MB. Inline images that a message's HTML names with `cid:` are fetched when the conversation is opened.

Limits applied in main when the structure is planned: depth 16, 500 parts, 5 MB per text part and 8 MB of text per message. A text part over a limit is offered as an attachment. Parts beyond the depth or part limit are left out.

## Changes

A change is applied to the server first, then to the cache, so the cache never shows something the server refused. Flag and Gmail label changes update the cached copies directly; moves, copies and expunges re-read the mailboxes they touched (and All Mail on Gmail). Each change acts on every cached copy of the conversation's messages.

| Change | Gmail | Generic |
| --- | --- | --- |
| Read, unread | `\Seen` on every copy | Same |
| Star | `\Flagged` on every copy | Same |
| Archive, move to Inbox | Remove or add `\Inbox` in `X-GM-LABELS` on the All Mail copy | Move Inbox copies to the Archive folder, or back |
| User label | Add or remove the label in `X-GM-LABELS` on the All Mail copy | Copy into the folder. On removal, delete the folder's copy if a live copy remains elsewhere; otherwise move it to Archive |
| Important | `\Important` on the All Mail copy | Not available |
| Trash, spam | Move every copy to `\Trash` or `\Junk` | Same |
| Not spam, restore | Move copies out of `\Junk` or `\Trash` into `INBOX`, which Gmail files in All Mail | Same, into `INBOX` |
| Delete forever | Expunge the copies in `\Junk` or `\Trash`; copies elsewhere stay | Same |

"A live copy" excludes copies in Trash and Spam, and the mailboxes holding the other copies are re-read before the decision. A label the account does not have, or a system label that cannot be set, is refused rather than ignored.

**Labels.** Names nest with `/`. The server path uses the account's own hierarchy separator, and a name is refused if it starts with a system mailbox name, has an empty segment or control characters, contains a separator other than `/`, or already exists. Every operation resolves the server path from the cached mailbox list, never from the renderer.

- **Create** makes the mailbox. A generic folder is read straight away, so mail filed into it at once is picked up.
- **Rename** renames the mailbox on the server. The cache then moves the mailbox, those under it, their copies, their label ids and their colours to the new names. Nothing is walked again, and Gmail need not report the relabelled messages.
- **Delete** on Gmail removes the label and leaves the mail in All Mail. Deleting a generic folder would delete its mail, so everything in it is first moved to Archive with a server-side search. The folder is deleted only if it is then empty.

**Ordering.** Background sync and foreground changes take turns per account on an account-wide lock, so a sync that read the server before a change cannot undo what the change cached. Foreground work runs under the account's work supervisor: disconnecting cancels it and waits for it before the account's mail is deleted. A change that fails part way asks for a sync, so the cache returns to what the server has.

**Bulk.** A selection is grouped by account and changed in rounds of 250 conversations. The reply lists the conversations that failed so the interface can restore them.

## Sending

SMTP with the account's app password, through nodemailer's `SMTPConnection`: one connection per message, logging off, and `[127.0.0.1]` as the EHLO name so the computer's name stays private.

**The message.** Kisa composes it itself. Header text is stripped of line breaks and encoded (RFC 2047 words of at most 64 characters, RFC 2231 file names). Base64 is folded at 76 characters. Media types and content ids from a forwarded message are checked before they reach a header. `In-Reply-To` and `References` come only from parsed message ids in the cache: the root, the parent's `In-Reply-To`, and the parent. Gmail's skeleton does not fetch `References`, so a Gmail reply carries the parent and grandparent only; that shortened chain is valid and still threads. A forward fetches the original's attachments from the server and keeps the thread headers.

**Bcc.** The envelope lists every recipient. The transmitted message has no `Bcc` header. The copy filed in Sent keeps it, so the sender can see whom they Bcc'd. Gmail files what its SMTP server received, so a Gmail Sent copy shows no Bcc.

**Outcomes.** The server's reply decides: 5xx means refused, 4xx means try later. A failure without a reply means nothing was sent if it came before the message was handed over, and an unknown outcome if it came after. The hand-over is the moment the connection starts reading the message, which happens only after the server accepts `DATA`. The send itself is uninterruptible, bounded by socket timeouts.

| Failure | Meaning | Scheduled send |
| --- | --- | --- |
| `MailAuthError` | Sign-in refused | Needs the user |
| `MailConnectionError`, `MailThrottledError` | Not sent; try again | Retried with backoff |
| `MailSendRejectedError` | Refused | Needs the user |
| `MailProtocolError` | The message or an address is invalid | Needs the user |
| `MailSendUnknownError` | May have been delivered | Looked for in sent mail, then the user decides |

A server may accept a message while refusing some recipients. That is a send: the reply lists the refused addresses, and the composer warns instead of reporting a failure that would invite a second send. Scheduled sends do not yet report refused recipients.

**Sent copy.** Gmail and Outlook file sent mail themselves. For iCloud and other IMAP servers, Kisa searches Sent for the Message-ID and appends a copy with `\Seen` only if none is there, so a retry never leaves two. Outlook files its copy a moment after accepting the message, under a Message-ID of its own: tried on Outlook.com, appending left two copies, since no search for Kisa's Message-ID could find Outlook's. So Kisa adds none, and refreshes Sent 3 and 15 seconds after the send, as MailCraft does for its Graph and Exchange accounts, so the copy shows without waiting for the next sync. That refresh runs as the account's supervised work: the send replies at once, and disconnecting or quitting cancels it. Which rule a provider gets is one table, `SENT_COPY_FILER` in `mail-send.ts`. A failure here never fails the send.

**Finding a sent message.** A scheduled send keeps one Message-ID across attempts. After an unknown outcome, Kisa searches All Mail with `rfc822msgid:` on Gmail, or Sent with a `Message-ID` header search elsewhere. Not finding it does not prove it was not sent (outside Gmail, the Sent copy could have failed after SMTP accepted the message), so the worker asks the user rather than sending again. That Gmail's SMTP server keeps the client's Message-ID has not been verified with a real send yet.

## New mail

When the store caches a message for the first time it reports the message as arrived. Only the incremental part of a sync passes arrivals on: the skeleton walk caches old mail, and a known message moving between mailboxes was not new. After each background pass, and after a change whose refresh found new mail first, the engine:

- shows notifications for arrivals that are unread and in the Inbox (see [notifications](notifications.md));
- hands conversations that began with an Inbox arrival to automatic categorization, when the account has it on, which fetches their bodies first because the model reads them.

Every thread-list update also closes notifications for conversations that are no longer unread in the Inbox.

## Search

Search reads only the local cache: FTS over subject, sender address and body text, plus `from:`, `to:`, `subject:`, `is:`, `label:` and `has:attachment` filters answered from cached columns. Mail whose body has not downloaded is found by its subject, sender and other metadata only. Planned: for mail without a cached body, search the server too (`X-GM-RAW` on Gmail, `SEARCH TEXT` elsewhere) and fetch matching messages that are not cached at foreground priority.

## Security

- Credentials live only in main: each account's app password, or a Microsoft account's refresh token, sealed with `safeStorage` and opened only to sign in a new IMAP or SMTP connection. A Microsoft access token is never stored; it is renewed from the refresh token and kept in memory. How either sign-in happens is described under [Accounts](#accounts).
- Everything a server sends is hostile input. imapflow refuses a literal over 64 MB and a response over 96 MB. Bodies fetch only named header fields, a header block is read up to 1,000 fields, and structure and text are capped as described under [Bodies](#bodies). Those text limits trust the sizes `BODYSTRUCTURE` declares; the bytes actually received are bounded only by imapflow's literal and response caps.
- **Sender authentication is trusted per provider.** Gmail accounts trust only the topmost `Authentication-Results` header, and only when it comes from `mx.google.com`; Gmail adds its header above all others, so a lower one may be the sender's. Other providers report every sender as unauthenticated until their receiving server's header has been verified. Otherwise a sender could forge Google's header in mail sent to an iCloud address.
- No credential, address or message content is written to a log.

## Accounts

An account signs in to IMAP and SMTP with an app password, or, for Outlook.com and Microsoft 365, through Microsoft sign-in. Accounts are rows in `mail_accounts`, keyed by the lowercased address; the sealed credential blob holds the app password or the Microsoft refresh token, tagged with which it is, and is the only place either exists after it is saved.

**Which accounts can connect.** Gmail app passwords require 2-Step Verification. Google does not offer them to accounts whose 2-Step Verification uses only security keys, to work, school or other organization accounts, or to accounts in Advanced Protection ([Google's help](https://support.google.com/accounts/answer/185833)), so those accounts cannot connect to Kisa for now. iCloud accounts use an app-specific password from their Apple Account.

**Where a password is typed.** A dedicated Add account window, opened from the login screen or the account menu ("Add account"). Over the main window it is a modal dialog, a sheet on macOS, and Escape or Cancel closes it; without one it opens as a window of its own. Either way it is its own `BrowserWindow` with its own HTML entry and preload, sandboxed with context isolation, no Node integration, a `default-src 'none'` policy, no navigation, and no mail content. Its only outside links are the presets' app-password pages (Google's app passwords page and Apple's guide to app-specific passwords) and Microsoft's page on turning IMAP on for Outlook.com, which open in the system browser; it cannot open any other URL. Its preload exposes exactly four calls: submit a password sign-in, start or cancel a Microsoft sign-in, and close. The mail window can only ask main to open or focus it.

**Name.** The window has an optional Name field: the sender name outgoing mail carries, stored as the account's display name. Blank sends with the bare address. Accounts have no avatar; the interface shows initials.

**The one exception to credentials never crossing IPC.** The user has to type the password somewhere the renderer draws, so it crosses IPC once, from the setup window to main, write-only:

- The password input is uncontrolled; React state holds only whether it is empty.
- Main checks the sender is the open setup window and accepts one submission at a time.
- Main decodes the request with an Effect Schema in the handler, not in the IPC runtime, and wraps the password in `Redacted` as it decodes. A malformed request gets one fixed message: a schema issue quotes the value it rejected, and Electron logs a rejected handler.
- Every failure the window sees is fixed text chosen by main. A server's reply is never shown or logged.
- Nothing is returned on success; main closes the window and publishes the updated account list.

**Server settings.** Presets by the address's domain, with no network lookup, and the full address as the sign-in name: `gmail.com` and `googlemail.com` use `imap.gmail.com:993` and `smtp.gmail.com:465`, both over TLS; `icloud.com`, `me.com` and `mac.com` use `imap.mail.me.com:993` over TLS and `smtp.mail.me.com:587` with STARTTLS. Any other domain shows host, port and security fields for IMAP and SMTP; only TLS and STARTTLS are offered. Google shows an app password in groups of four characters, so spaces are removed from the password before signing in to Google's servers.

**Dialect.** Chosen from the IMAP server's capabilities at sign-in, not from the address: `X-GM-EXT-1` gives the Gmail dialect, anything else the generic one (see [Providers](#providers)). A Google Workspace address entered by hand with `imap.gmail.com` therefore gets the Gmail dialect.

**Verify before saving.** Main refuses an address that is already connected, then signs in over IMAP with the engine's imapflow adapter and lists the mailboxes, then signs in over SMTP and quits without sending. A refused sign-in says so, and for iCloud says to use an app-specific password rather than the Apple Account password; an unreachable server, a busy server and an unexpected reply each have their own message. Only then is the password sealed with `safeStorage` (Linux `basic_text` refused), the row inserted in a transaction that checks the address again, and the engine started through the account-connected event. Closing the window abandons a verification in progress and nothing is saved, though an IMAP sign-in already under way finishes and logs out first. Once verification has passed, saving and starting the account always run to the end.

**Sign-in at connection time.** Main decrypts the blob for each new IMAP or SMTP connection and hands the connection a `Redacted` password; an unreadable blob is a refused sign-in that asks the user to add the account again. Changing a saved password today means removing the account and adding it again.

**Microsoft sign-in.** An Outlook.com, Hotmail, Live or MSN address (told by the first label of its domain, so `hotmail.co.uk` counts) is signed in with Microsoft; any other address can choose it with "Sign in with Microsoft instead", which is how a Microsoft 365 address on its own domain gets there, and typing Microsoft's IMAP server switches to it. A password sign-in to Microsoft's servers is refused before any server is contacted. The flow is the authorization-code flow for native apps (RFC 8252) with PKCE, and works like this:

- **What the window sends.** Only the address and the optional name. No credential, code or token ever reaches a window.
- **The browser.** Main opens `login.microsoftonline.com/common` in the system browser with the address as `login_hint`, asking for `IMAP.AccessAsUser.All`, `SMTP.Send` and `offline_access`, plus `openid email` to learn who signed in.
- **The redirect.** It returns to a listener bound to `127.0.0.1` on a port the operating system picks, and named `http://localhost:<port>`, the one host whose port Microsoft does not compare with the registration. Only a request carrying the attempt's random `state` counts; other requests are answered and ignored. The listener closes when the sign-in ends: success, refusal, the user's Cancel, closing the window, a ten-minute timeout, or quitting.
- **The check.** The code is exchanged for tokens, the mailbox is opened over IMAP and SMTP accepts the same token, and only then is the refresh token sealed and the account saved. A mailbox that refuses a token Microsoft has just issued usually has IMAP turned off, the default for a new Outlook.com account; if the browser signed in a different account than the one typed, the message says so instead.
- **Signing in again.** Adding an address already connected through Microsoft replaces its sign-in and keeps its cached mail and settings. An address connected with a password is refused.
- **Renewal.** A connection asks for an access token: the one in memory if it has more than five minutes left, otherwise one renewed from the refresh token, one renewal at a time per account. The mail scopes are named in every renewal, since without them a personal account's renewed token is refused for SMTP. Microsoft replaces the refresh token with each renewal; the new one is written over the old with an update only, so an account removed meanwhile does not come back. A token a server refuses is dropped and renewed once.
- **Failures.** Microsoft refusing a renewal asks the user to sign in again. Microsoft being busy, throttling or unreachable is a lost connection that is tried again later, never a sign-out.
- **The client.** Microsoft issues tokens only to a registered app: Kisa's public-client registration in Microsoft Entra, for "Any Entra ID Tenant + Personal Microsoft accounts", with the redirect URI `http://localhost` and no secret. Its Application (client) ID is not in the source: the build reads `MAIN_VITE_MICROSOFT_CLIENT_ID` from `apps/desktop/.env.local` or the shell (see `apps/desktop/.env.example`), and the release workflow from the `MICROSOFT_CLIENT_ID` secret of the GitHub `Prod` environment. A build without it does not offer Microsoft sign-in, and an Outlook account already added asks to sign in again.

Work and school accounts are best-effort: an organization may require an administrator's consent or a verified publisher before users can sign in, and may have SMTP client submission turned off.

**Disconnect.** Main cancels the account's work and waits for it, closes its connections, then deletes the account's sealed sign-in, its access token in memory, cached mail, index rows, progress, settings and sender trust. Nothing is revoked at the provider; a user who wants the app password, or Kisa's access to a Microsoft account, to stop working revokes it in their provider's account settings.

## Interface contract

The mail renderer and its IPC schemas stay as they are. The IPC layer maps the engine's tables to the existing `Gmail*` DTOs, keeping the system label strings the renderer tests for. Renaming those DTOs is cosmetic and comes last.

Account methods are provider-neutral: `listAccounts`, `onAccountsChanged`, `reorderAccounts` and `disconnectAccount`, declared in `shared/ipc/accounts.ts` on `desktop:accounts:*` channels. Adding an account belongs to the Add account window's own bridge, described under [Accounts](#accounts).

## Slices

1. **Read-only Gmail:** schema, IMAP transport, Gmail dialect, skeleton and bodies, list, open thread, local search. Done.
2. **Read-only iCloud:** generic dialect and local threading. Done, and verified read-only against a real iCloud mailbox.
3. **Changes:** read state, star, labels and folders, archive, spam, trash, delete forever, label create, rename and delete. Done; verified on Gmail except spam and delete forever, and not yet on iCloud.
4. **Sending:** SMTP, replies, forwards, scheduled mail. Done; new mail and replies verified on Gmail.
5. **New mail:** notifications and automatic categorization from arrivals. Done.
6. **Accounts:** app-password sign-in in a dedicated setup window, with the dialect chosen from the server's capabilities. Done, and verified in the app with a real Gmail account.
7. **Outlook:** Microsoft sign-in, token renewal, and the engine's handling of a server without `CONDSTORE` or `SPECIAL-USE`. Done and tested with fakes and a local token endpoint; not yet run against Microsoft, which needs Kisa's registration. Signed in to a real Outlook.com account: its Sent copy carries a Message-ID of Outlook's own, so a scheduled send whose outcome was unknown cannot be confirmed on Outlook and asks the user to check Sent instead. Still open: whether Exchange sends role attributes in `LIST`, and how fast it answers a 2,500-message flag fetch.
8. **Removal:** the Gmail REST backend, its quota governor, `packages/gmail` and the `gmail_*` tables are gone. The schema is a baseline migration in a new database file, `mail.sqlite` (`mail.dev.sqlite` in development), plus later migrations that drop the account sign-in kind and avatar columns and add the mailbox flag cursor.
