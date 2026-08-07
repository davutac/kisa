# Minimal Gmail Client for Electron

Research date: 2026-08-06. External claims below use Google, Electron, or official package/source documentation. **Fact** records documented behavior; **Recommendation** is an implementation choice for this repository.

## Decision

**Recommendation:** Build the first version as a local-first Gmail REST API client. Run OAuth, token refresh, Gmail requests, MIME processing, and persistence in Electron's main process; expose narrow operations through the existing preload/IPC boundary. Use a **Desktop app** OAuth client, the system browser, an ephemeral loopback listener, PKCE S256, and the scopes `gmail.readonly` plus `gmail.send`. Treat Gmail labels as first-class mailbox navigation and filtering data. Poll while the app is open and defer Gmail `watch`/Pub/Sub until there is a justified backend.

This is smaller than IMAP/SMTP, matches Gmail's thread/message model directly, avoids the all-mail IMAP scope, and does not require always-on cloud infrastructure. The main launch risk is not API implementation but OAuth review: reading message bodies requires the restricted `gmail.readonly` scope, while sending alone uses the sensitive `gmail.send` scope ([Gmail scope classifications](https://developers.google.com/workspace/gmail/api/auth/scopes)).

## Gmail API Surface

**Fact:** `users.messages.list` returns message `id` and `threadId`, newest first, with pagination, Gmail search query, labels, and optional spam/trash filtering; full details require `messages.get`. A page defaults to 100 and allows at most 500 messages ([listing guide](https://developers.google.com/workspace/gmail/api/guides/list-messages), [method reference](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/list)).

**Fact:** `users.threads.list` provides the equivalent conversation-oriented listing, and `threads.get` returns the ordered messages in a conversation. A thread is Gmail's grouping of replies; threads cannot be created directly, but sent messages can join one ([thread guide](https://developers.google.com/workspace/gmail/api/guides/threads), [thread list reference](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.threads/list)).

**Recommendation:** List threads for the inbox UI. When the user opens any email, use its `threadId` with `threads.get` and render every message in the conversation in order, rather than calling `messages.get` for only the selected email. Retain each message ID for attachment access and reply construction. Do not download an entire mailbox for the minimum product.

### Labels and Filtering

**Fact:** Gmail has reserved `SYSTEM` labels such as `INBOX`, `SENT`, `UNREAD`, `STARRED`, and category labels, plus user-created `USER` labels. `users.labels.list` returns all labels for the mailbox; individual label resources expose their ID, name, type, visibility settings, optional user-label colors, and message/thread counts ([label guide](https://developers.google.com/workspace/gmail/api/guides/labels), [label list reference](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.labels/list), [label resource](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.labels)).

**Fact:** Both `threads.list` and `messages.list` accept `labelIds`. When multiple IDs are supplied, results must match all of them. They also accept Gmail's `q` search syntax, allowing label filters to be combined with search criteria ([thread list reference](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.threads/list), [message list reference](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/list), [search guide](https://developers.google.com/workspace/gmail/api/guides/filtering)).

**Fact:** Labels ultimately exist on messages. A thread's label set is the union of labels found on any message in the thread, so a label shown on a thread does not imply that every message in the conversation has that label ([label guide](https://developers.google.com/workspace/gmail/api/guides/labels#manage_labels_on_threads_and_messages)).

**Recommendation:** Load and cache the label catalog after account connection, refresh it during synchronization, and persist external label IDs rather than treating names as stable identifiers. Use `threads.list` with `labelIds` for server-side mailbox filtering and pagination; do not fetch an unfiltered mailbox and filter only the local page. Present selected system labels as mailbox views and user labels as a filterable list, while preserving Gmail's label colors and visibility preferences where useful.

**Recommendation:** Keep label support read-only initially. Listing labels and filtering messages are already covered by `gmail.readonly`; do not add `gmail.labels` merely to display labels because that non-sensitive scope manages label definitions but cannot read messages. If the product later applies labels, archives, marks read/unread, stars, or otherwise changes message membership, replace the read scope with `gmail.modify` rather than accumulating overlapping read and modify scopes ([Gmail scopes](https://developers.google.com/workspace/gmail/api/auth/scopes)).

### Message and MIME Handling

**Fact:** `messages.get` supports four representations: `minimal` (IDs and labels), `metadata` (IDs, labels, headers), `full` (parsed MIME tree in `payload`), and `raw` (entire RFC-formatted message as base64url); `full` and `raw` cannot be used with `gmail.metadata` ([format reference](https://developers.google.com/workspace/gmail/api/reference/rest/v1/Format), [get reference](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/get)).

**Fact:** A full message contains recursive `MessagePart` nodes with MIME type, filename, headers, body, and child parts. A part body is base64url data inline or an `attachmentId` retrieved with `users.messages.attachments.get` ([message resource](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages), [part-body resource](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages.attachments#MessagePartBody), [attachment method](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages.attachments/get)).

**Recommendation:** Fetch list rows as IDs, fetch selected conversations with `format=full`, recursively traverse multipart nodes, prefer a suitable `text/html` part with sanitized rendering and retain `text/plain` as fallback. Download attachment bytes only when requested. Use a maintained MIME library for encoded headers, multipart boundaries, transfer encodings, and RFC edge cases rather than hand-parsing raw mail.

### Send and Reply

**Fact:** Gmail sends either through `messages.send` or `drafts.send`. The JSON workflow supplies an RFC-formatted MIME message as a base64url string in `Message.raw`; attachments are MIME parts inside that message ([sending guide](https://developers.google.com/workspace/gmail/api/guides/sending), [send method](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/send)). Gmail also supports `message/rfc822` media uploads, including resumable upload ([upload guide](https://developers.google.com/workspace/gmail/api/guides/uploads)).

**Fact:** A reply joins an existing Gmail thread only when the request includes the target `threadId`, `References` and `In-Reply-To` are valid, and the subject matches ([thread guide](https://developers.google.com/workspace/gmail/api/guides/threads#add_drafts_and_messages_to_threads)). Drafts have a stable draft ID but replace the underlying message when edited; sending deletes the draft and creates a sent message with a new ID ([draft guide](https://developers.google.com/workspace/gmail/api/guides/drafts)).

**Recommendation:** The minimum composer should send directly with `messages.send`; add server-side Gmail drafts only when cross-device draft continuity is a product requirement. Construct replies from the original message's RFC `Message-ID`, preserve matching subject, set `In-Reply-To` and `References`, and pass Gmail's `threadId`.

## Official Node and TypeScript Packages

**Fact:** Google's official Node client is [`googleapis`](https://www.npmjs.com/package/googleapis), written in TypeScript with generated Gmail types. Google's Gmail Node quickstart calls it a recommended API client library and uses it with `@google-cloud/local-auth`, while warning that the quickstart's simplified authentication is for testing rather than production ([Node quickstart](https://developers.google.com/workspace/gmail/api/quickstart/nodejs)).

**Fact:** Google also publishes the generated Gmail-only [`@googleapis/gmail`](https://www.npmjs.com/package/@googleapis/gmail) package with built-in types. The official client repository says API submodules may be installed separately to reduce startup time; both forms come from the same officially supported client, which is in maintenance mode ([official repository](https://github.com/googleapis/google-api-nodejs-client#installation), [support status](https://github.com/googleapis/google-api-nodejs-client#support-and-maintenance)).

**Fact:** [`google-auth-library`](https://www.npmjs.com/package/google-auth-library) is Google's officially supported Node OAuth library. Its OAuth client handles access-token refresh when given a refresh token, and its current source exposes PKCE generation and code-verifier token exchange ([official package](https://www.npmjs.com/package/google-auth-library), [OAuth2Client source](https://github.com/googleapis/google-auth-library-nodejs/blob/main/src/auth/oauth2client.ts)).

**Recommendation:** Prefer `@googleapis/gmail` plus `google-auth-library` for this single-API desktop app. `googleapis` is equally official and is the quickstart choice, but the narrow package communicates intent and reduces loaded/generated API surface. Do not treat `@google-cloud/local-auth` as the production design merely because it appears in the quickstart.

**Fact (2026-08-07):** `google-auth-library` cannot run on Cloudflare Workers. Version 11 publishes no browser, worker, or edge export condition — its `package.json` declares only `main: ./build/src/index.js` (CommonJS) — and that entrypoint statically requires `googleauth.js`, which imports `child_process` to shell out to `gcloud config config-helper` for Application Default Credentials. Bundling for workerd therefore demands `assert, buffer, child_process, crypto, events, fs, http, https, net, os, path, process, querystring, stream, tls, url, util`. `child_process` has no workerd implementation under any `nodejs_compat` flag, and no import path reaches `OAuth2Client` without it.

**Recommendation:** Apply the package split by runtime, not uniformly. `apps/desktop` runs on Node under Electron, so it uses `@googleapis/gmail` and takes its OAuth2 client from that package's re-exported `AuthPlus` — a separately installed `google-auth-library` resolves to a second copy and is a distinct nominal type that the generated client's `auth` parameter rejects. `apps/auth-worker` runs on workerd and keeps direct `fetch` calls to `https://oauth2.googleapis.com/token`; this is the correct implementation for that runtime, not deferred work.

**Recommendation:** Accept the official Node client's maintenance-mode status as a known risk. It is the only official option, the desktop surface is confined to `GmailGateway`, and that interface is the seam to replace the client behind if support lapses.

## Installed-App OAuth

### Flow and Redirect

**Fact:** Google treats installed applications as public clients that cannot keep secrets. They must open the system browser and use a local redirect; embedded user-agents are prohibited ([installed-app guide](https://developers.google.com/identity/protocols/oauth2/native-app), [OAuth browser policy](https://developers.google.com/identity/protocols/oauth2/policies#use-secure-browsers)).

**Fact:** For macOS, Linux, and Windows desktop applications, Google recommends a loopback redirect and a **Desktop app** client. The app listens on a random available port at `http://127.0.0.1:<port>` or `http://[::1]:<port>`. Google's redirect-method section says custom URI schemes are no longer supported because of app-impersonation risk, and out-of-band copy/paste is no longer supported ([redirect methods](https://developers.google.com/identity/protocols/oauth2/native-app#redirect-uri_loopback)).

**Fact:** Google supports PKCE and recommends S256. A unique high-entropy verifier and its SHA-256 base64url challenge bind the authorization code to the initiating client; Google recommends `state` to correlate the callback and requires the client to prevent CSRF ([PKCE and state](https://developers.google.com/identity/protocols/oauth2/native-app#step1-code-verifier), [OAuth best practices](https://developers.google.com/identity/protocols/oauth2/resources/best-practices)). The desktop token exchange marks `client_secret` optional, consistent with the inability of an installed app to keep one confidential ([token exchange](https://developers.google.com/identity/protocols/oauth2/native-app#exchange-authorization-code)).

**Recommendation:** Bind a short-lived HTTP server specifically to loopback, use an OS-assigned port, accept exactly one callback with matching `state`, exchange the code with its verifier, return a simple success page, and close the listener. Launch the URL with Electron `shell.openExternal`; never authenticate inside a `BrowserWindow`. A client ID may ship with the app, but no value bundled in an Electron archive should be regarded as a secret.

### Offline Access and Refresh Tokens

**Fact:** A refresh token allows access-token renewal without user interaction. Google's installed-app guide says refresh tokens are returned for installed applications and must be stored in secure long-lived storage; Google's Node auth documentation uses `access_type=offline` and notes that a new refresh token may require renewed consent ([installed-app tokens](https://developers.google.com/identity/protocols/oauth2/native-app#exchange-authorization-code), [official Node auth package](https://www.npmjs.com/package/google-auth-library#obtaining-a-new-refresh-token)). Refresh tokens can be revoked, expire, or be displaced by issuance limits, so applications must handle reauthorization ([refresh behavior](https://developers.google.com/identity/protocols/oauth2/native-app#offline), [OAuth best practices](https://developers.google.com/identity/protocols/oauth2/resources/best-practices#handle_refresh_token_revocation_and_expiration)).

**Recommendation:** Request offline access, save the refresh token immediately, and never replace a stored refresh token with an absent value from a later token response. Keep access tokens in memory where possible, persist the granted scope set, handle `invalid_grant` by reconnecting the account, and revoke the grant on an explicit "Disconnect Google account" action.

## Scopes and Verification

**Fact:** Google requires the narrowest scopes necessary and classifies Gmail scopes as follows ([scope table](https://developers.google.com/workspace/gmail/api/auth/scopes), [OAuth scope policy](https://developers.google.com/identity/protocols/oauth2/policies#only-request-scopes-that-you-need)):

| Need | Scope | Classification |
| --- | --- | --- |
| Send only | `https://www.googleapis.com/auth/gmail.send` | Sensitive |
| Read messages, labels, and settings | `https://www.googleapis.com/auth/gmail.readonly` | Restricted |
| Create and manage label definitions only | `https://www.googleapis.com/auth/gmail.labels` | Non-sensitive |
| Create/manage drafts and send | `https://www.googleapis.com/auth/gmail.compose` | Restricted |
| Read, modify, compose, and send | `https://www.googleapis.com/auth/gmail.modify` | Restricted |
| Headers/labels only, no body | `https://www.googleapis.com/auth/gmail.metadata` | Restricted |
| IMAP/POP/SMTP and permanent delete | `https://mail.google.com/` | Restricted, broadest |

**Recommendation:** Request `gmail.readonly` and `gmail.send`. This supports reading, listing labels, filtering by labels, attachments, composing, sending, and replying without permission to alter mailbox state. Do not request `gmail.modify` unless the product adds applying/removing labels, mark-read, archive, trash, or similar actions. Do not request `gmail.labels` unless the product manages label definitions without otherwise modifying messages, and do not request `gmail.compose` unless Gmail-hosted drafts are implemented.

**Fact:** Installed apps do not support incremental authorization, so their required scopes should be designed before the consent request ([installed-app scope guidance](https://developers.google.com/identity/protocols/oauth2/native-app#identify-access-scopes)). Users can still grant only some requested permissions, and the client must inspect granted scopes and disable unavailable features ([granular permission handling](https://developers.google.com/identity/protocols/oauth2/native-app#step6-check-granted-scopes)).

### Cloud and Consent Setup

**Fact:** A calling application needs a Google Cloud project with Gmail API enabled, OAuth consent/branding configured, an audience selected, declared data-access scopes, and a Desktop app OAuth client ID ([Gmail Node setup](https://developers.google.com/workspace/gmail/api/quickstart/nodejs#set_up_your_environment), [installed-app prerequisites](https://developers.google.com/identity/protocols/oauth2/native-app#prerequisites)). External production apps need a public homepage, privacy policy, and terms links on a verified owned domain, with data practices accurately disclosed ([branding requirements](https://support.google.com/cloud/answer/15549049), [user-data policy](https://developers.google.com/terms/api-services-user-data-policy)). Google requires separate Cloud projects for test and production deployment tiers ([production readiness](https://developers.google.com/identity/protocols/oauth2/production-readiness/policy-compliance#separate-projects-testing-production)).

**Recommendation:** Create separate development and production projects immediately. Configure Branding, Audience, and Data Access; enable Gmail API; declare exactly `gmail.readonly` and `gmail.send`; create a Desktop app client; and prepare the public product/privacy pages before verification submission.

### Testing, Production, and Review

**Fact:** An External app in **Testing** is restricted to at most 100 explicitly listed test users. Gmail-scope authorizations, including offline refresh tokens, expire seven days after consent ([audience and publishing status](https://support.google.com/cloud/answer/15549945#publishing-status)).

**Fact:** An unverified app requesting unapproved sensitive or restricted scopes is subject to an unverified-app warning and a lifetime cap of 100 new users after the warning is presented; the production user cap is distinct from the 100-person testing list ([unverified apps](https://support.google.com/cloud/answer/7454865#unverified-app-user-cap), [OAuth user cap](https://support.google.com/cloud/answer/15549945#oauth-user-cap)). Internal apps limited to one Google Workspace/Cloud Identity organization and personal/development uses can qualify for review exceptions, subject to the documented conditions ([verification exceptions](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification#exceptions)).

**Fact:** Public production use of `gmail.send` needs sensitive-scope verification; `gmail.readonly` needs restricted-scope verification. Restricted verification requires justification, accurate disclosures, demonstration of each requested scope, and permitted use. If restricted-scope data is accessed from or through a third-party server, an annual Google-approved security assessment is required ([sensitive verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification), [restricted verification and assessment](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification#security-assessment)).

**Recommendation:** Keep OAuth tokens and message data device-local in v1 and avoid a mail-processing backend. This does not remove restricted-scope verification, but it avoids introducing the cited server-side restricted-data security-assessment trigger. Confirm the final design with Google's verification team rather than treating this report as a compliance determination.

## Quotas and Operational Limits

**Fact:** Gmail API quotas are 1,200,000 units/minute/project and 6,000 units/minute/user/project. Relevant costs are `messages.list` 5, `messages.get` 20, `attachments.get` 20, `threads.list` 10, `threads.get` 40, `history.list` 2, and `messages.send` 100 units. Gmail also documents a 500-recipient maximum per API message ([quota table](https://developers.google.com/workspace/gmail/api/reference/quota)).

**Fact:** Gmail API mail sends share the account's standard daily sending limits with Gmail web and SMTP. Per-user bandwidth and concurrent-request limits also apply; quota/rate and transient server errors should use bounded exponential backoff, and batches above 50 requests are not recommended ([error and limit guide](https://developers.google.com/workspace/gmail/api/guides/handle-errors)).

**Recommendation:** Bound per-account concurrency, page rather than exhaustively sync, cache selected thread content, and use jittered exponential backoff for 429/appropriate 403 and 5xx responses. Treat send retries specially: an ambiguous network failure can otherwise create duplicate mail, so surface uncertain outcomes and reconcile the Sent mailbox before retrying automatically.

## Synchronization: Polling Before Push

**Fact:** Google describes full sync as listing IDs then fetching messages/threads and retaining a recent `historyId`; partial sync calls `history.list` from that cursor. History is usually available for at least a week but can be shorter; an out-of-range cursor returns 404 and requires full sync ([sync guide](https://developers.google.com/workspace/gmail/api/guides/sync)).

**Fact:** Gmail `watch` delivers mailbox-change signals through Google Cloud Pub/Sub, not directly to an Electron process. Google explicitly recommends poll-based synchronization for installed/user-owned devices. A watch must be renewed at least every seven days (Google recommends daily), notifications contain an email address and new history ID rather than mail content, delivery can be delayed or dropped, and the per-user notification rate is capped at one event/second ([push guide](https://developers.google.com/workspace/gmail/api/guides/push)). Pub/Sub push delivery requires a publicly addressable HTTPS endpoint ([Pub/Sub push subscriptions](https://cloud.google.com/pubsub/docs/push)).

**Recommendation:** For v1, poll the first inbox page at startup, on window focus, after send, on manual refresh, and on a modest foreground timer; use `history.list` once a cursor is persisted. Add Pub/Sub only with a real always-on backend requirement, then use it merely as a sync trigger with periodic fallback polling.

## Desktop Security

**Fact:** Google's policies require encrypted token storage at rest, no plaintext transmission, revocation when no longer needed, and permanent deletion after revocation ([OAuth policy](https://developers.google.com/identity/protocols/oauth2/policies#handle-user-tokens-securely)). Electron `safeStorage` uses OS-provided key systems, but its guarantees vary: macOS uses Keychain, Windows DPAPI does not protect against other apps in the same userspace, and Linux may fall back to the weak `basic_text` backend when no secret store exists ([Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage)).

**Recommendation:** Store refresh tokens only in the main process using asynchronous `safeStorage`; reject or clearly warn on Linux `basic_text` instead of silently treating it as secure. Never expose tokens through preload, renderer state, logs, crash reports, or analytics. Store only the account identifier and encrypted token blob in local persistence. Consider encrypting cached bodies/attachments too, or initially cache only metadata and fetch bodies on demand.

**Recommendation:** Keep all Gmail/OAuth capabilities behind narrow IPC methods consistent with `apps/desktop/src/preload/index.ts` and `apps/desktop/src/preload/window.d.ts`. Validate renderer inputs in main, disallow arbitrary Gmail URLs/queries through IPC, sanitize HTML mail, block scripts and active content, proxy or explicitly gate remote images to avoid sender tracking, and open links externally only after showing their actual destination.

## IMAP/SMTP Alternative

**Fact:** Gmail supports IMAP, POP, and SMTP with OAuth 2.0 SASL XOAUTH2. Endpoints are `imap.gmail.com:993` over SSL and `smtp.gmail.com` on 465 (SSL) or 587 (STARTTLS); OAuth-authenticated IMAP sessions are normally limited by the roughly one-hour access-token validity and require reconnect/reauthentication ([IMAP/SMTP overview](https://developers.google.com/workspace/gmail/imap/imap-smtp)). XOAUTH2 uses the broad `https://mail.google.com/` scope; Google says apps that do not fully need it should migrate to granular Gmail API scopes ([XOAUTH2 scope guidance](https://developers.google.com/workspace/gmail/imap/xoauth2-protocol#oauth_20_scopes)).

**Fact:** Google's official XOAUTH2 libraries page currently supplies Java, Python, and PHP examples, not an official Node IMAP or SMTP client package ([official libraries and samples](https://developers.google.com/workspace/gmail/imap/xoauth2-libraries)). Gmail-specific IMAP extensions expose Gmail search, labels, message IDs, and thread IDs, but add protocol-specific mapping work ([IMAP extensions](https://developers.google.com/workspace/gmail/imap/imap-extensions)).

**Recommendation:** Do not use IMAP/SMTP for a Gmail-only minimum client. It needs third-party Node protocol/MIME libraries, long-lived connection management, Gmail label/thread reconciliation, and the broadest restricted mail scope. Reconsider it only if provider portability is a primary requirement; in that case, isolate a provider-neutral mail domain from Gmail-specific behavior and perform a separate security/library evaluation.

## Minimal Implementation Shape

**Recommendation:** Use these boundaries when implementation begins:

1. `GoogleAuthService` in Electron main owns loopback OAuth + PKCE, granted scopes, refresh/revoke, and OS-backed token storage.
2. `GmailGateway` in main wraps the official Gmail client with operations such as `listLabels`, `listThreads` with label filters, `getThread`, `getAttachment`, and `sendMessage`; `getThread` returns the complete ordered conversation for the email viewer, and renderer code never receives an auth client or token. The interface lives in `packages/gmail/src/gateway.ts`; its `@googleapis/gmail` implementation lives in `apps/desktop/src/main/mail/gmail-gateway.ts`, keeping transport out of the package. The gateway does not refresh tokens — refresh belongs to the auth worker, so a 401 surfaces as `GmailReauthorizationRequiredError` for the caller to resolve.
3. `MimeService` converts Gmail MIME trees into safe display models and composes standards-compliant outbound/reply messages.
4. A local repository stores account metadata, the label catalog, thread/message summaries and label relationships, sync `historyId`, and optionally encrypted body cache. It remains distinct from token storage.
5. Narrow preload APIs return application-owned DTOs, not raw Google responses, and main-process Effect boundaries map OAuth/API/network failures into typed errors.
6. Initial sync loads only a recent inbox window; opening an item fetches its complete thread on demand; partial sync uses `history.list`; attachments and older pages are lazy.
7. Disconnect revokes OAuth, deletes the encrypted token, clears account cache, and removes sync cursors.

## Delivery Checklist

**Recommendation:** Before coding, resolve these operational gates:

- Decide whether the app is personal/internal or public; public read access commits the product to restricted-scope verification.
- Create separate development and production Google Cloud projects.
- Publish verified-domain homepage, privacy policy, and terms that accurately describe local storage, retention, deletion, and any diagnostics.
- Enable Gmail API, configure Branding/Audience/Data Access, and create Desktop app clients.
- Select and security-review MIME parsing/composition and HTML sanitization dependencies.
- Define cache encryption/retention and "Disconnect account" deletion behavior.
- Test revoked/expired tokens, seven-day test-token expiry, partial-grant behavior, history 404 recovery, malformed MIME, large attachments, send ambiguity, rate limits, offline startup, and Linux without a secure secret store.
- Submit scope verification well before public release and recheck Google's scope classifications, OAuth policy, and Gmail quotas at launch.
