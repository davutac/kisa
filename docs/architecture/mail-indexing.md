# Full-Account Mail Indexing

Design for indexing an entire Gmail account on connect: every email thread, including Spam and Trash but excluding Gmail Chats, with message bodies stored locally and searchable while the user reads normally.

## Goals

- A newly connected account ends up fully indexed without the user waiting on it.
- Scrolling, opening, and searching stay responsive for the whole build.
- The build survives quit, crash, network loss, and token expiry, and resumes where it stopped.
- Gmail's per-user quota is never exhausted, and foreground work always wins against indexing.
- Accounts index independently of each other, since the quota that binds is per-user.

## Non-goals

- Attachment bytes. Only attachment metadata is indexed; bodies of attachments stay on demand.
- Gmail Chats, which are not email and carry no useful mail body.
- Showing Spam in default search results. Spam remains behind its explicit mailbox scope; Trash is available through all-mail search once indexed.
- Server-side search. Local FTS replaces the `q=` round trip for indexed mail; Gmail search stays as the fallback for anything not yet indexed.

## Where the current code stands

Three properties of the existing implementation decide most of this design.

**Bodies are already downloaded and discarded.** `fetchThreadSummaries` calls `threads.get` with `format: "full"` for every thread (`apps/desktop/src/main/mail/gmail-gateway.ts`), because summaries need the per-part `attachmentId` that `metadata` omits. The response carries complete message payloads, and `GmailStoreLive.saveThread` throws them away — it is a deliberate no-op, paired with `getThread: () => Effect.succeedNone`, so opening a thread always hits the network.

Storing bodies therefore costs **no extra API quota**. It is a disk decision only, and it makes thread opens instant and offline-capable as a side effect.

**`threads.list` returns newest-first**, the same direction the user scrolls. Indexing deepens the list exactly where the reader is heading, so the two never fight for position.

**The thread list already pages over the local cache.** `listCachedThreadPage` (`apps/desktop/src/main/mail/mail-sync.ts`) is a keyset query over `gmail_threads`. Anything the indexer commits becomes scrollable with no renderer change at all.

## Quota and bandwidth budget

Two limits are enforced at once, and the smaller one always binds.

| Limit | Value | Scope |
| --- | --- | --- |
| Units per minute, per user | 15,000 | One Gmail account |
| Units per minute (credentials) | 1,200,000 | The OAuth client's GCP project |
| Units per day (billing threshold) | 80,000,000 | The project |

Read from the project's own quota page, not the docs. Google's published default per-user figure is now 6,000/minute; established projects keep the older 15,000. The console is authoritative for the project actually being billed.

**The per-user limit is what caps a single mailbox.** Project headroom cannot be spent on one account: 1,200,000/minute is 80× the per-user ceiling, but an account is still capped at 15,000/minute no matter how idle the project is. The only way to use the project budget is more accounts at once — which is safe precisely because every request carries its own account's credentials.

| Call                       | Units |
| -------------------------- | ----- |
| `messages.batchModify`     | 50    |
| `threads.get`              | 40    |
| `threads.trash`            | 20    |
| `messages.get`             | 20    |
| `messages.attachments.get` | 20    |
| `threads.list`             | 10    |
| `threads.modify`           | 10    |
| `messages.list`            | 5     |
| `history.list`             | 2     |
| `getProfile`               | 1     |
| `labels.list`              | 1     |

`threads.get` at 40 units dominates: it runs once per thread and costs four times the list call that finds it. There is no cheaper bulk path — `messages.get` at 20 only wins for single-message threads and loses from two messages up.

The indexer runs at **150 units/second per account**, 60% of the ceiling. The headroom matters because the limit is a sliding one-minute window and the indexer spends in lumps: a page of 100 threads costs `10 + 100 × 40 = 4,010` units, so at 150/second a page lands every ~27 seconds and any 60-second window holds at most three — 12,030 units. Running at the full 250 would put a window at exactly 15,000, leaving nothing for the history poll or a thread the user opens.

At 3.75 threads/second, a 20,000-thread mailbox indexes in about 1.5 hours and a 50,000-thread one in under 4. Progress is durable, so that time need not be continuous.

Bandwidth is comfortable: 3.75 threads/second at ~50 KB per thread is ~190 KB/s per account.

`users.getProfile` returns `threadsTotal` and `messagesTotal` for one unit — the progress denominator, fetched once per run.

### The project limit is a multi-user concern, not a single-user one

At 9,000 units/minute per indexing account, roughly 130 accounts could index simultaneously across the whole user base before the project ceiling binds. That failure would hit every user at once rather than only the heavy ones.

The governor does not model this: it buckets per account only. A project-level 403 would be attributed to whichever account happened to trigger it, and only that account would slow down. Correct behaviour would be a global backoff. Known gap, not yet worth building.

## Concurrency

Every connected account can index concurrently. Gmail quota and backoff are account-scoped, while database operations remain safely serialized by the utility process. Kisa does not impose a speculative global concurrency cap; shared bandwidth or database limits should be introduced only in response to measured contention.

## Cursor design

Resumability is the core of "robust", so the cursor is two-level.

- **Session cursor** — the `pageToken` from `threads.list`. Fast, exact, used for as long as a single run lasts.
- **Durable watermark** — the oldest `internalDate` committed so far. On resume after a restart, an invalidated page token, or a reconnect, the run restarts from `q=before:YYYY/MM/DD` at the watermark and safely replays the overlap.

Each page's cache transaction completes before the watermark advances, so a crash between the two can only replay a page, never skip one. Replay is harmless because every write is an upsert keyed by `(account_email, thread_id)` or `(account_email, message_id)`.

The watermark doubles as user-visible progress: "indexed back to March 2019" means more to a reader than a percentage.

## Schema

New tables in `packages/database/src/schemas`.

### `gmail_backfill_state`

One row per account: `accountEmail` (PK), `status` (`idle | running | paused | complete | failed`), `pageToken`, `oldestIndexedAt` watermark, `indexedThreads`, `indexedMessages`, `estimatedThreads`, `startedAt`, `updatedAt`, `completedAt`, `lastError`.

### `gmail_messages`

`accountEmail` + `messageId` composite PK, `threadId`, `internalDate`, `fromAddress`, `fromName`, `toAddresses`, `ccAddresses`, `bccAddresses`, `replyToAddress`, `subject`, `labelIds` (json), `bodyText`, `bodyHtml`, `hasBlockedRemoteImages`, `attachments` (json), `schemaVersion`, `updatedAt`.

`bodyText` stays uncompressed because the FTS index reads it as external content; `bodyHtml` is gzipped, which is where nearly all of the bytes are. Gzip runs at tens of MB/s against a ~750 KB/s inbound stream, so the CPU cost is noise, and it takes a large mailbox from roughly 1 GB into the 250–350 MB range.

HTML is stored exactly as `GmailMime.parseThread` produces it. Note that despite the `sanitizedHtml` field name, that value is _not_ transformed — the renderer contains message HTML in a sandboxed iframe under `default-src 'none'`, which is what actually makes it safe. `schemaVersion` records which parser produced a row so a future change to that representation can invalidate stale rows rather than silently serving them.

An HTML message also gets a plain-text rendition in `bodyText`, flattened by `toIndexText`. Without it, search would only ever match the `text/plain` alternative — and most mail does not have one.

Indexes: `(account_email, thread_id)` and `(account_email, internal_date desc)`.

### `gmail_messages_fts`

An FTS5 external-content virtual table over `gmail_messages`, indexing `subject`, `fromAddress`, and `bodyText`. External content avoids storing the text twice. `better-sqlite3` bundles FTS5, so no dependency changes.

Drizzle does not model virtual tables, so this lives in a hand-written custom migration under `packages/database/drizzle`.

Rows are maintained by SQLite triggers rather than by the write path. The original plan here was the opposite — bulk inserts avoid per-row trigger dispatch — but message rows leave the table from several directions (thread removal, account disconnect, re-index on conflict), and an external-content FTS delete has to replay the row's _old_ column values. Hand-maintaining that across every delete path is a standing source of silent index drift, and the dispatch cost is noise next to the network. The triggers are covered end to end by the migration test: insert, update, and delete each keep the index in step.

### Changes to `gmail_threads`

The mailbox projections are needed because the cache holds all mail rather than just the inbox, and the reconciliation mark lets a completed full walk remove rows Gmail no longer returns.

**Add an indexed `is_in_inbox` column.** `listCachedThreadPage` currently pages 50 rows and then filters to INBOX in JavaScript. That is fine today, when the cache only ever contains inbox threads. Once archived mail lands in the same table, a page of 50 rows may yield two visible threads, and the list appears to stall while paging through archived mail it will never show. The INBOX predicate has to move into the SQL `WHERE` clause, and a JSON `LIKE` over the `labels` column will not use an index. A denormalized boolean maintained on upsert will.

**Add the keyset covering index.** The query orders by `latest_at DESC, account_email ASC, thread_id ASC`, and today the only index is the primary key — so every page is a full scan plus a sort. At 50k rows, on the synchronous main-thread connection, that is felt.

The index is `(is_in_inbox, latest_at DESC, account_email, thread_id)`. The mixed directions have to be declared: SQLite only skips the sort when the index matches the ordering forwards or fully reversed, and here the tiebreakers are ASC against a DESC leading term. `is_in_inbox` leads as an equality prefix. `EXPLAIN QUERY PLAN` confirms the result is a range seek (`SEARCH ... USING INDEX gmail_threads_mailbox_idx`); a temp b-tree remains for the last ORDER BY term only, which sorts within groups of equal `latest_at` and is therefore empty in practice.

Sent and Trash membership are projected the same way into indexed `is_in_sent` and `is_in_trash` columns. The primary mailbox combines Inbox and Sent while excluding Trash, and the title-bar toggles narrow to the requested projection. Existing cached rows derive both projections from their stored label array during migration, so the views do not wait for a fresh Gmail sync.

`is_index_seen` is an internal reconciliation mark. A fresh full-account walk unmarks every cached thread for that account, and every authoritative Gmail fetch marks the threads it sees. Only successful completion deletes rows that remain unmarked. Existing rows migrate as marked so an upgrade cannot delete mail before the next complete walk proves it stale.

## Write path

Today `Gmail.listThreads` persists summaries and drops details. The fix is a single write path that every caller shares:

```
store.upsertThreadDetails(accountId, threads)
  → gmail_threads (summary + mailbox projections)
  → gmail_messages (bodies, gzipped)
  → gmail_messages_fts
```

Called by `initialSync`, by history sync, by foreground `listThreads`, and by the backfill. The gateway's `fetchThreadSummaries` returns `{ summary, detail }` pairs instead of discarding the raw thread, and the summaries and their messages land in one transaction. A parsed full thread is authoritative for message membership, so that transaction also removes cached messages no longer present in Gmail; a failed MIME parse preserves the previous bodies.

**Reading back from the cache is deliberately not part of this.** The plan called for `GmailStoreLive.getThread` to start serving the cache, but the desktop's actual thread-open path (`loadFullThread`) does not go through `Gmail.getThread` at all — it calls the gateway directly, because it needs the raw MIME headers that BIMI sender-brand discovery reads, and the index does not store them. A cache path there would need per-message header storage to avoid silently losing sender branding, which is its own change. `getThread` therefore still goes to the network, and instant offline thread opens remain a follow-up with a named prerequisite.

The stored body and FTS data make full-history local search possible. Serving thread opens from that cache remains the separate follow-up described above.

## Index service

`apps/desktop/src/main/mail/mail-backfill.ts` runs one supervised job per active account.

```
read the account checkpoint
stop immediately if it is already complete
if this is a fresh generation, unmark every cached thread for the account
set status = running
estimate the initial total when the run is determinate
loop:
  stop if the account was cancelled
  wait for this account's background quota budget
  list and fetch one Gmail page through the shared Gmail service
  parse MIME, mark its threads, and transactionally reconcile the page
  retry retryable page failures up to the bounded attempt limit
  after the page commit, advance the restart watermark
  emit throttled progress from cached row counts
until no next cursor:
  transactionally delete unmarked threads and their messages
  status = complete and flush progress immediately
```

The exact page cursor is used only during the live run. The oldest indexed date is the durable restart point; a restart begins before that date to overlap the last committed work. Because page data commits before the watermark advances, an interruption can replay a page but cannot skip one. A `running` or `paused` resume keeps its existing reconciliation marks; unmarking again would make already completed pages look absent and is therefore reserved for a genuinely fresh generation.

### Quota governor

Each account has its own token bucket, charged by **every** Gmail call for that account rather than scoped to the backfill. That is what makes foreground priority possible without making accounts compete with each other. Refill is about 150 units/s per account. Foreground calls (thread open, search, poll) can spend immediately; only the backfill waits for the budget to recover.

### Manual reindex

Each account section in Settings exposes a **Reindex** action. It is deliberately manual because a complete Gmail walk is expensive: the confirmation warns that it can consume substantial Gmail API quota and take a long time for a large mailbox.

Starting it resets that account's durable `gmail_backfill_state` cursor and unmarks its cached threads in one database transaction, then starts the normal resumable indexer. Existing cached threads, messages, and FTS rows remain available while the walk runs. Pages mark and refresh what Gmail still returns; successful completion removes anything still unmarked. Because the preserved rows do not distinguish how much of the current run has been revisited, manual reindex progress is indeterminate; the oldest-indexed date still advances as Gmail is walked. Reindex is disabled while the account is already running.

The first index for a newly connected readable account still starts automatically. Gmail history cursor expiry does not automatically trigger another complete index; normal cursor recovery remains bounded, and the user can choose Reindex if they suspect historical gaps.

Initial indexing, restart recovery, reconnect recovery, and manual reindex all converge on the same account-scoped runner. The only special reindex step is resetting that account's checkpoint while preserving its cached mail; it then calls the same `requestMailBackfill` entry point as every other start. There is no global account queue: each account runs independently through its own quota budget, while foreground mail work retains priority.

On `GmailRateLimitError` — which the gateway classifies including Gmail's 403-with-reason response — the gateway halves only that account's rate. The current page retries with bounded exponential backoff, and the account's rate recovers slowly after the limit stops firing.

### Pausing and failure

| Trigger | Behaviour |
| --- | --- |
| App quit | The latest completed page remains checkpointed as `running`; the process can stop without skipping mail |
| App start | A missing row starts; `running` resumes; `complete`, `failed`, and `paused` remain idle |
| Retryable network/API failure | Retry the current page with bounded exponential backoff; settle as `failed` after the retry budget |
| 401 / reauth required | Settle as `paused`; reconnecting the account starts the same runner from its checkpoint |
| Rate limit | The per-account governor paces work; repeated API failures use the same bounded page retry budget |
| Account disconnected | Suspend the account, abort and join all mail work, then delete |

There is no separate user-pause mode. Failed work stays stopped so launch cannot create an automatic failure loop; Settings reports the failure and offers Reindex as the explicit retry. Running progress is throttled to about once per second, terminal states flush immediately, and disconnect removes the account's progress without allowing an in-flight page to republish it.

Access tokens expire hourly, but `withAuthorization` re-reads authorization per call and `getGoogleAccessToken` refreshes directly with Google from Electron main, so a multi-hour run needs no special handling.

`forgetAccountMailData` clears the account through the shared Gmail store, including messages, FTS rows, index state, thread rows, labels, and sync state. It is the single mail-data cleanup path, and the invariant is that nothing survives a disconnect.

Foreground polling and historical backfill register with one account-scoped work supervisor. Disconnect suspends that account before cleanup, which rejects new poll and backfill work, aborts active work, and waits for every run to settle. Scheduling resumes only after cleanup finishes so reconnecting the same address in the current process remains supported.

## Database process isolation

`better-sqlite3` is synchronous, so the connection and migrations live in one long-running Electron `utilityProcess`, not on Electron's main/UI thread. Main-process services use an Effect RPC client backed by Drizzle's async SQLite proxy. The renderer still reaches data only through the existing typed preload/main IPC boundary.

One semaphore covers each complete `withDatabaseClient` operation. That is broader than an individual SQL statement: an async Drizzle transaction may make several RPC calls, and no second operation may interleave between its `BEGIN` and `COMMIT`. SQLite work is therefore serialized without blocking window management, OS events, or renderer IPC.

WAL, bounded page transactions, and yielding between pages still matter for write latency and crash recovery. The utility process changes where synchronous work runs; it does not make an oversized transaction cheap.

## Renderer integration

### Search scope

The title-bar search button expands into a single-line field and leaves the ordinary mailbox list as the only result surface. Edited queries cover every indexed non-Spam thread for the selected accounts; the account selector and unread, Sent, Spam, and Trash toggles apply those scopes without adding redundant pills. Filter and address completions appear in a small menu anchored below the field, while matching threads use the mailbox's normal virtualized rows, selection, and actions. Filter-only and broadened empty searches run immediately; free text waits for two characters. Results retain the existing 200-thread relevance cap and identify when only the top 200 matches are shown.

User-label filtering belongs to the horizontal mailbox label bar rather than the search syntax. One account shows its catalog; All Accounts merges equal names case-insensitively and indicates how many accounts own a shared label. Multiple toggles use match-all semantics. The ordinary mailbox page carries those names into its keyset SQL query, and an edited search adds them as internal `label` filters without showing label pills. Label selection is renderer-session state, survives entering and exiting search, and is narrowed to labels available after an account-scope change.

### Compose address completion

Startup warms an account-scoped, main-process snapshot of the 10,000 most-used unique correspondents from the local message index. Compose keystrokes filter that snapshot in memory instead of expanding the message address JSON in SQLite each time, and therefore skip the database-search debounce. Startup does not wait for the scan, and schedules it after the first mailbox page has had a chance to load; an unusually early compose request fills a missing account snapshot on demand. Message details committed by foreground sync or backfill fold newly observed From, To, Cc, and Bcc addresses into an already-loaded snapshot, and disconnect removes the account snapshot with the rest of its private data.

**Progress travels on its own channel.** `onThreadsChanged` triggers a full first-page reload in `use-mailbox-threads.ts`; firing it per backfill page would hammer the list. A new `MAIL_INDEX_PROGRESS_CHANNEL` carries `{ accountId, status, indexedThreads, estimatedThreads, oldestIndexedAt, error? }`, throttled to ~1/second, with a matching getter for initial state and a `useAccountIndexProgress` hook alongside the existing `useSyncingAccountIds`. `threads-changed` keeps firing only for head-of-mailbox changes, as today.

**Indicators.** The account button and title bar show active progress. The thread list shows a passive footer such as "Indexing your mail — back to March 2019", and Settings provides the manual Reindex action plus running, paused, and failed lifecycle copy.

**`hasNextPage` while indexing.** Reaching the end of the cache during a backfill renders the passive indexing footer rather than pretending another cached page exists. `hasNextPage` remains tied to the real cache cursor, so the status row cannot create an automatic paging loop.

Separately, and independent of this work: with an empty query the inbox list paginates over the cache only, and `nextPageTokens` is populated exclusively by the search path, so today the list simply ends when the cache does. Backfill makes that end far deeper, but the on-demand Gmail fallback is still the correct belt-and-braces fix for a user who outruns the index.

## Phasing

Each phase is shippable on its own.

1. **Schema and indexes.** `is_in_inbox`, the keyset covering index, WAL. No behaviour change; fixes list paging cost before it becomes a problem.
2. **Unified write path.** Gateway returns raw details and `upsertThreadDetails` persists bodies and FTS rows in one transaction.
3. **Quota governor.** Shared by all Gmail calls, with foreground priority.
4. **Backfill service.** State table, two-level cursor, resume, cancellation.
5. **Progress IPC and UI.** Channel, hook, ring, footer, settings control.
6. **Local search over FTS.** Replaces the `q=` round trip for indexed mail and is the payoff that makes the index worth its disk.

## Open questions

- **Disk ceiling.** Should there be a hard cap (oldest-first eviction of bodies while keeping metadata), or is unbounded acceptable with a visible size readout? Leaning toward a readout first and eviction only if it proves needed.
- **Metered connections.** Worth detecting, or is pause-in-settings enough for v1? Leaning toward the latter.
- **Re-index trigger.** When the sanitizer `schemaVersion` bumps, re-fetch lazily on open, or sweep in the background?
