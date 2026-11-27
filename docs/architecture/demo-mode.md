# Demo mode

Demo mode starts Kisa with a made-up mailbox, for screenshots, recordings, and trying the app without an account. It is chosen at launch with the `--demo` switch and lasts for that launch.

```bash
bun run --cwd apps/desktop dev:demo
```

A packaged build takes the same switch: `open -n -a Kisa --args --demo` on macOS, `Kisa.exe --demo` on Windows, and `kisa --demo` (or the AppImage with `--demo`) on Linux. It runs beside a normal Kisa.

## What it shows

Four accounts of one invented person, one on each provider Kisa connects to, with 43 conversations between them:

| Account | Provider | Read as | Sent copy filed by |
| --- | --- | --- | --- |
| `maya@fernhill.example`, work | Other IMAP | Folders | Kisa |
| `maya.lindqvist@gmail.example`, everyday | Gmail | Gmail's labels over All Mail | The server |
| `maya.lindqvist@icloud.example`, family | iCloud | Folders, under Apple's names | Kisa |
| `maya.lindqvist@outlook.example`, housing and paperwork | Outlook | Folders, under Outlook's names | The server |

Each shows its provider's icon and behaves as that provider does, as far as the engine tells them apart. Between them they hold threads with replies (each reply in the Harbor Coffee rebrand quotes the one before it, as Gmail, Apple Mail and Outlook would, so its last message holds a chain of three), unread and starred mail, designed newsletters and receipts, PDF and image attachments, folders and labels (one nested, and `Receipts` in two accounts, which the sidebar merges), Gmail's Important marker, and mail in Sent, Archive, Spam and Trash. Messages are dated back from the moment the app starts, so the list always reads as today's.

The mail is written out in `apps/desktop/src/main/demo/demo-mailbox.ts`. Every name and company is invented, and every address is on the reserved `.example` domain (RFC 2606), which no real mailbox or server can have. The attachments are drawn in code (`demo-attachments.ts`), so the repository carries no sample files. No message refers to a remote image or any other remote resource.

Because the real engine serves it, each account is meant to behave as one on its provider does: opening, searching, read state, stars, archive, trash and restore, spam, labels (created, renamed, deleted), attachment previews, composing, replying, scheduled sends and undo. Nothing is kept: every launch starts from the same mailbox.

## How it works

The mail engine does not know it is in demo mode. It reaches mail servers through two ports, `ImapConnector` and `SmtpTransport` (see [the mail engine](mail-engine.md)), and demo mode provides both from memory when the engine's layer is built (`EngineLayer` in `mail-engine.ts`):

- **IMAP** is `demo-mail-server.ts`: one in-memory server per demo account, answering the session port in one of two ways. As a plain IMAP server it keeps folders and one copy of a message per folder, for the generic dialect. As Gmail it keeps each message once, in All Mail, Spam or Trash, with its labels (`X-GM-LABELS`) and Gmail's own message and thread ids; a move to the Inbox adds the Inbox label in All Mail, and renaming or deleting a label rewrites it on the mail that carries it. Either way UIDs are never reused, and the server offers neither `IDLE` nor `CONDSTORE`, so the engine polls it every two minutes and reads flags again, and the server keeps no state for either.
- **SMTP** accepts every message and delivers none. It hands the message to the account's server, which keeps a copy where the provider does: Gmail in All Mail under the Sent label, in the conversation of the mail it answers, and Outlook in Sent Items. For iCloud and other IMAP the server keeps none, and the engine appends the Sent copy over IMAP, as `SENT_COPY_FILER` in `mail-send.ts` decides for the real providers.

Only the four account rows are written at startup (`demo-accounts.ts`), before the engine lists its accounts. The engine then syncs them like any newly connected account and builds the cache, the search index and the thread list itself. The cache is never seeded directly: a change goes to the server first and opening a conversation fetches its bodies, so a cache with no server behind it would fail on the first click.

Mail enters the server one way, as an RFC 5322 message: the sample mail is composed with Kisa's own `composeMessage`, and a sent copy arrives as the engine appends it. `demo-mime.ts` reads such a message into the envelope, `BODYSTRUCTURE` and numbered sections that IMAP serves. It reads what `composeMessage` writes and is not a general MIME parser.

Each demo account has a sealed placeholder password, so the engine reads its sign-in the usual way and no code path is special-cased for an account without one. That includes the Outlook account, where a real one keeps a Microsoft refresh token: renewing a token would ask Microsoft's servers. The placeholder is not a secret and is never sent anywhere. Sealing it, and the demo database's key, uses `safeStorage` as always, so a development build on macOS may ask for keychain access at launch, as any development launch does; the app waits on that dialog before it shows mail.

## What keeps it away from real mail

- **Its own profile.** Before the single-instance lock and before anything reads the user data path, `demo-profile.ts` points Electron's `userData` and `sessionData` at a new directory in the system's temporary folder. The database, its key, settings, window state, drafts and the theme all live there, so a demo never opens the user's database and can run beside a normal Kisa. If the profile cannot be set up, the app quits instead of starting in the real one.
- **Removed at quit.** Only the directory that launch created is removed, by the exact path `mkdtemp` returned. This is best effort: the database, its key and the settings go, but Chromium can write a few cache files back as it shuts down. They hold no mail and stay in the temporary folder for the system to clear.
- **No real accounts.** The Add account window signs in to real servers through its own connector, whatever the engine is given, so main refuses to open it in demo mode, for a new account and for signing in again. With no window, nothing can submit a password or start a Microsoft sign-in. Importing a database is refused too.
- **No network.** The engine's two ports are the only way it reaches a mail server. Update checks are off. What is left is what a user starts: opening a link from a message in the browser, and AI features, which a new profile has not set up.
- **Decided once.** The switch is read from the process arguments when main starts. No IPC method, setting or renderer state can turn demo mode on or off, and the renderer is not told about it.

## Limits

- Mail sent in the demo goes nowhere, including to the other demo accounts.
- No new mail arrives on its own, so there are no new-mail notifications.
- Senders are shown as on any account whose provider has not verified them: the sample mail carries no `Authentication-Results`, so the Gmail account shows no authenticated senders or verified logos.
- The Outlook account cannot be signed in again, like the others, so Microsoft sign-in is not shown.
- The mailbox fills in a moment after launch, as a newly connected account's does, since the engine syncs it then.

## Tests

`apps/desktop/tests/demo-mode.test.ts` reads the demo mailbox through the real SQLite store with the engine's own sync: one account per provider, every message cached with its body, replies threaded, mail filed where its folders or Gmail labels say, the accounts kept apart, an attachment served under the part the cache lists, the user's changes taken as a folder server and as Gmail take them, sent mail kept once by the providers that file it and not at all by those that leave it to Kisa, the background pass finding nothing to repair on any account, a reply appended to Sent joining its conversation with its text, and the profile: created in the temporary folder, refused when Electron is not in it, and the only directory removed. `tests/account-setup-ipc.test.ts` checks that no Add account window opens in demo mode.
