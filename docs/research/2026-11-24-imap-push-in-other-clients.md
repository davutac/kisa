# How other mail clients stay current over IMAP

Research date: 2026-11-24. The question was whether Kisa can be told about changes in every folder as they happen, and how established clients and sync engines handle it. The findings come from reading each project's own source and documentation on that date; the links below name the files. Nothing here was measured against a live server.

Background: `IDLE` reports changes only for the one mailbox a connection has selected, so watching `n` folders that way takes `n` connections. The `NOTIFY` extension (RFC 5465) covers many folders on one connection, but Gmail and Outlook do not offer it, and it was not seen on iCloud.

## Summary

Nobody watches every folder with push. The common design is push on one folder and a timed `STATUS` check for the rest.

| Client | Waits in `IDLE` on | Other folders | Connections per account |
| --- | --- | --- | --- |
| Thunderbird desktop | Whatever each cached connection last selected; the Inbox keeps its own | Timed check every 10 minutes, Inbox only unless the user marks more folders | Up to 5 |
| K-9 Mail / Thunderbird for Android | Inbox on new accounts; the user can add folders, at most 10 | Timed poll every 15 minutes | One per push folder |
| FairEmail | Inbox; the user can switch any folder to push | Polled at each 15-minute keep-alive, cheapened by `HIGHESTMODSEQ` | One per push folder |
| Mailspring | One folder: Inbox, or All Mail on Gmail | Background pass every 2 minutes, `STATUS` per folder | 2 |
| EmailEngine (by imapflow's author) | One folder: Inbox, or All Mail on Gmail; optional extra "sub-connections" for chosen folders | `STATUS` per folder every 15 minutes | 2 or more |
| Geary | Folders it holds open, the Inbox always | `LIST` and `STATUS` every 15 minutes | 2 or more |
| Evolution | Inbox, plus `NOTIFY` for all folders where a server offers it | Periodic check, `LIST-STATUS` where offered | 3, at most 7 |
| Delta Chat | One folder, the Inbox | Not scanned | 1 |
| Nylas sync engine | Inbox, or All Mail on Gmail | Each folder polled every 30 seconds by `STATUS` | 3, plus 1 for writes |

## What stands out

- **Gmail is watched through All Mail.** EmailEngine, Mailspring and Nylas all sync only All Mail, Spam and Trash on Gmail, as Kisa does, and all three wait in `IDLE` on All Mail, not on the Inbox. Kisa waits on the Inbox. All Mail sees every arrival, including mail sent from another device and mail a filter files past the Inbox. The Inbox sees mail leaving it, which on All Mail is only a label change.
- **Extra watched folders are opt-in everywhere.** K-9, FairEmail and EmailEngine let the user or the integrator add folders, one connection each. K-9 caps them at 10. FairEmail's FAQ gives Gmail's limit as 15 simultaneous folder connections and sets Gmail's user folders to poll for that reason.
- **Polling the rest ranges from 30 seconds to 15 minutes.** Kisa's regular cycle runs every 5 minutes, and every 2 minutes for a server without `IDLE`.
- **Flag changes over `IDLE` are not trusted by everyone.** Nylas notes that "Idle doesn't necessarily pick up flag changes" and polls every 30 seconds regardless. EmailEngine acts on flag reports from its watched folder.
- **A report is answered with a delta where the server keeps mod-sequences.** EmailEngine, Mailspring, Nylas and FairEmail fetch what changed (`CHANGEDSINCE`), as Kisa's refresh does. K-9 syncs the folder's newest messages again. Thunderbird fetches only new messages.
- **`NOTIFY` is used by two clients where a server offers it:** Evolution by default, FairEmail as an option. `QRESYNC` is used by Mailspring, and by Evolution as an option.
- **An `IDLE` is restarted between every 9 and every 29 minutes** by the clients that restart it at all (FairEmail 15, K-9 24, Mailspring 28, Evolution 29, Geary 9.5). Kisa's is ended by imapflow's two-minute keepalive and started again.

## What this means for Kisa

These were options when written. What was built from them is in [the mail engine design](../architecture/mail-engine.md#staying-current): the first two, and not `NOTIFY`, which imapflow cannot send.

- **Wait on All Mail for Gmail,** in place of the Inbox or beside it. Beside it costs a third connection per Gmail account and reports both kinds of change. It first needs a check on a real account that Gmail reports arrivals and flag changes to a connection waiting on All Mail; three engines rely on it for arrivals, and none documents it.
- **Wait on Sent for other providers,** one more connection, so mail sent from another device shows at once. This goes further than the defaults above, all of which leave Sent to the poll.
- **Use `NOTIFY` where a server advertises it.** None of Gmail, iCloud or Outlook was seen to, so this helps only other IMAP hosts.
- **Keep the regular cycle as the backstop.** Every client above has one.

## Not verified

- Google's own statement of the connection limit. Its help page, as fetched, says "up to 15 email clients at a time per account".
- Whether K-9's Inbox-push default has shipped; its documentation still says push is off for a new account.
- Which folders Apple Mail on macOS and Outlook on the desktop wait on. Apple's technical note for iOS lists `IDLE`, `CONDSTORE` and `LIST-STATUS` and neither `NOTIFY` nor `QRESYNC`.
- Exchange Online's limit on IMAP connections per mailbox. No published figure was found.

## Sources

- Thunderbird desktop: [mailnews/imap/src](https://github.com/thunderbird/thunderbird-desktop/tree/ee5a92904877d2a433ccc99e3e91eefb0bc26b68/mailnews/imap/src) (`nsImapProtocol.cpp`, `nsImapIncomingServer.cpp`, `nsImapService.cpp`) and [mailnews.js](https://github.com/thunderbird/thunderbird-desktop/blob/ee5a92904877d2a433ccc99e3e91eefb0bc26b68/mailnews/mailnews.js).
- K-9 Mail / Thunderbird for Android: [thunderbird-android](https://github.com/thunderbird/thunderbird-android/tree/b69e4b2d57c68377d320caebc5b8742ec6e0edb4) (`DefaultAccountDefaultsProvider.kt`, `AccountBackendPusherCallback.kt`) and [the push documentation](https://docs.k9mail.app/en/beta/settings/push).
- FairEmail: [FAQ](https://github.com/M66B/FairEmail/blob/07923a014193e1d9ecbdecbeed211fc78832a18c/FAQ.md) (entries 23 and 162) and `ServiceSynchronize.java`, `EntityFolder.java`, `EntityAccount.java` in the same tree.
- Mailspring: [Mailspring-Sync](https://github.com/Foundry376/Mailspring-Sync/tree/master) (`README.md`, `MailSync/SyncWorker.cpp`, `MailSync/main.cpp`).
- EmailEngine: [lib/email-client](https://github.com/postalsys/emailengine/tree/master/lib/email-client) (`imap-client.js`, `imap/mailbox.js`, `imap/listing-diff.js`, `imap/sync-operations.js`) and [performance tuning](https://learn.emailengine.app/docs/advanced/performance-tuning).
- Geary: [src/engine](https://github.com/GNOME/geary/tree/main/src/engine) (`imap-engine/imap-engine-minimal-folder.vala`, `imap-engine/imap-engine-generic-account.vala`, `imap/transport/imap-client-session.vala`).
- Evolution: [camel imapx](https://github.com/GNOME/evolution-data-server/tree/master/src/camel/providers/imapx) (`camel-imapx-server.c`, `camel-imapx-conn-manager.c`, `camel-imapx-settings.c`).
- Delta Chat: [chatmail/core](https://github.com/chatmail/core/tree/main) (`CHANGELOG.md` for 2.42.0 and 2.50.0, `src/scheduler.rs`, `src/imap/idle.rs`).
- Nylas sync engine: [inbox/mailsync/backends](https://github.com/nylas/sync-engine/tree/master/inbox/mailsync/backends) (`imap/generic.py`, `gmail.py`) and `inbox/crispin.py`.
- Apple: [TN3191, IMAP extensions supported by Mail](https://developer.apple.com/documentation/technotes/tn3191-imap-extensions-supported-by-mail).
- Google: [Gmail help on IMAP limits](https://support.google.com/mail/answer/7126229).
- [RFC 5465, the IMAP NOTIFY extension](https://www.rfc-editor.org/rfc/rfc5465).
